import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const base = (process.env.BASE_URL || "http://localhost:3000") + "/api/v1";
async function request(path, body, expected = 200) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(base + path, {
      method: body ? "POST" : "GET",
      headers: { "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (r.status === 429 && attempt < 3) {
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          Math.min(
            60000,
            Math.max(1000, Number(r.headers.get("retry-after") || 1) * 1000),
          ),
        ),
      );
      continue;
    }
    const data = await r.json();
    assert.equal(r.status, expected, JSON.stringify(data));
    return data;
  }
}
async function until(id, predicate, interval = 1000) {
  for (let elapsed = 0; elapsed < 600000; elapsed += interval) {
    const job = await request(`/simulations/${id}`);
    assert.notEqual(job.state, "FAILED", job.error);
    if (predicate(job)) return job;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw Error("BO3 acceptance deadline exceeded");
}
const snapshot = (await request("/meta/modern/snapshots")).find(
  (s) => s.name === "Modern · Local reference pool",
);
assert.ok(snapshot);
const sample = await request("/formats/modern/example");
const body = {
  name: "BO3 rate and sideboard acceptance",
  format: "modern",
  snapshotId: snapshot.id,
  decklist: sample.decklist + "\nSideboard\n1 Magma Jet",
  games: 2,
  gameMode: "BO3",
  maxMatchGames: 5,
  sideboardMode: "forge",
  clockSeconds: 30,
  seed: 12345,
};
await request("/simulations", { ...body, games: 1000 }, 422);
const commanderSnapshot = (await request("/meta/commander/snapshots"))[0];
await request(
  "/simulations",
  { ...body, format: "commander", snapshotId: commanderSnapshot.id },
  422,
);
const job = await request("/simulations", body, 201);
assert.equal(job.config.unit, "matches");
assert.equal(job.config.maxGameAttempts, 10);
console.log(JSON.stringify({ event: "bo3_job_started", jobId: job.id }));
await until(job.id, (j) => j.state === "COMPLETED");
const results = await request(`/simulations/${job.id}/results`),
  runs = await request(`/simulations/${job.id}/runs`),
  observed = await request(`/simulations/${job.id}/observations`);
assert.equal(results.matchSummary.matches, 2);
assert.equal(results.matchSummary.attempted, 2);
assert.equal(results.matchSummary.limited, 0);
const actual = runs.flatMap((r) => r.result.games);
assert.equal(results.summary.games, actual.length);
assert.equal(results.matchSummary.gamesPlayed, actual.length);
assert.equal(observed.length, actual.length);
assert.ok(actual.length >= 4);
for (const run of runs) {
  assert.equal(run.result.unit, "match");
  assert.equal(run.result.gameWins[run.result.winner], 2);
  for (const game of run.result.games) {
    assert.equal(game.players[0].deckId, job.deck.id);
    assert.equal(game.bridgeSourceHash, job.config.bridge.sourceHash);
  }
}
assert.ok(results.matchups.every((m) => m.matchSummary.matches === 1));
const interrupted = await request(
  "/simulations",
  {
    ...body,
    name: "BO3 observed-game cancellation acceptance",
    games: 4,
    seed: 24567,
  },
  201,
);
await until(interrupted.id, (j) => j.observedGames >= 1, 500);
const before = await request(`/simulations/${interrupted.id}/observations`);
assert.ok(before.length);
const completedBefore = (
  await request(`/simulations/${interrupted.id}/runs`)
).filter((r) => r.state === "DONE");
await request(`/simulations/${interrupted.id}/cancel`, {});
for (let i = 0; i < 30; i++) {
  const r = await fetch(base + `/simulations/${interrupted.id}/retry`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (r.ok) break;
  assert.equal(r.status, 409);
  if (i === 29) throw Error("Worker did not release the cancelled match");
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
const finished = await until(interrupted.id, (j) => j.state === "COMPLETED");
const after = await request(
    `/simulations/${interrupted.id}/observations?limit=200`,
  ),
  resumedRuns = await request(`/simulations/${interrupted.id}/runs`);
for (const observation of before) {
  // Review status changes when a match resumes; the recorded event stays immutable.
  const { review: _beforeReview, ...recordedBefore } = observation;
  const { review: _afterReview, ...recordedAfter } =
    after.find((o) => o.id === observation.id) || {};
  assert.deepEqual(
    recordedAfter,
    recordedBefore,
    "Actual observations must survive interrupted matches",
  );
}
const validGames = resumedRuns
  .flatMap((run) => run.result?.games || [])
  .filter((game) => ["normal", "rule_draw"].includes(game.termination));
assert.equal(
  after.filter((game) => game.review?.status === "included").length,
  validGames.length,
  "Only finalized valid games count toward game results",
);
assert.ok(
  after.every(
    (game) =>
      game.review &&
      game.review.number >= 1 &&
      game.review.number <= game.review.total,
  ),
);
for (const run of completedBefore)
  assert.deepEqual(resumedRuns.find((r) => r.id === run.id).result, run.result);
assert.equal(finished.completed, 4);
assert.ok(after.length >= finished.actualGames);
await mkdir("data", { recursive: true });
await writeFile(
  "data/bo3-smoke.json",
  JSON.stringify(
    {
      jobId: job.id,
      interruptedJobId: interrupted.id,
      results,
      runs,
      observed,
      resume: {
        observedGames: after.length,
        canonicalGames: finished.actualGames,
        preservedObservations: before.length,
      },
      verifiedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    event: "bo3_api_passed",
    matches: 2,
    actualGames: actual.length,
    interruptedJobId: interrupted.id,
    preservedObservations: before.length,
  }),
);
