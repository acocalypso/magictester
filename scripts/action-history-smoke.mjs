import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { rateLimitedFetch } from "./test-http.mjs";
const base = (process.env.BASE_URL || "http://localhost:3000") + "/api/v1";
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function request(path, body, status = 200) {
  const r = await rateLimitedFetch(base + path, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json();
  assert.equal(r.status, status, JSON.stringify(data));
  return data;
}
async function until(id, predicate) {
  for (let i = 0; i < 300; i++) {
    const job = await request(`/simulations/${id}`);
    assert.notEqual(job.state, "FAILED", job.error);
    if (predicate(job)) return job;
    await pause(2000);
  }
  throw Error("Action history acceptance timed out");
}
async function history(jobId, ref) {
  assert.ok(ref);
  const entries = [];
  let next = 0;
  while (next !== null) {
    const page = await request(
      `/simulations/${jobId}/games/${ref.id}/actions?limit=37&offset=${next}`,
    );
    entries.push(...page.entries);
    next = page.nextOffset;
    assert.equal(page.count, ref.count);
    assert.equal(page.complete, ref.complete);
  }
  assert.equal(entries.length, ref.count);
  assert.deepEqual(
    entries.map((e) => e.sequence),
    Array.from({ length: entries.length }, (_, i) => i),
  );
  return entries;
}
const snapshot = (await request("/meta/modern/snapshots")).find(
  (s) => s.name === "Modern · Local reference pool",
);
assert.ok(snapshot);
const sample = await request("/formats/modern/example");
const body = {
  name: "Readable game history acceptance",
  format: "modern",
  snapshotId: snapshot.id,
  decklist: sample.decklist,
  games: 2,
  gameMode: "BO3",
  maxMatchGames: 5,
  sideboardMode: "forge",
  clockSeconds: 120,
  seed: 12345,
};
const job = await request("/simulations", body, 201);
console.log(
  JSON.stringify({ event: "action_history_job_started", id: job.id }),
);
await until(job.id, (j) => j.state === "COMPLETED");
const runs = await request(`/simulations/${job.id}/runs`),
  observed = await request(`/simulations/${job.id}/observations`);
const ids = [];
for (const run of runs) {
  assert.equal(run.result.unit, "match");
  for (const game of run.result.games) {
    assert.equal(
      game.actionLog,
      undefined,
      "Raw histories must not inflate normal result responses",
    );
    assert.ok(game.actionHistory.complete);
    const actions = await history(job.id, game.actionHistory);
    assert.ok(actions.some((e) => e.kind === "LAND"));
    assert.ok(actions.some((e) => e.kind === "STACK_ADD"));
    assert.ok(actions.some((e) => e.kind === "GAME_OUTCOME"));
    const observation = observed.find(
      (o) => o.data.result.actionHistory?.id === game.actionHistory.id,
    );
    assert.ok(
      observation,
      "BO3 observation and final game must share their immutable history",
    );
    ids.push(game.actionHistory.id);
  }
}
assert.equal(new Set(ids).size, ids.length);
await request(
  `/simulations/${job.id}/games/${ids[0]}/actions?offset=-1`,
  undefined,
  400,
);
const commanderPool = (await request("/meta/commander/snapshots")).find(
  (s) => s.name === "Commander · Local reference pool",
);
assert.ok(commanderPool);
const commander = await request(
  "/simulations",
  {
    name: "Commander action history",
    format: "commander",
    snapshotId: commanderPool.id,
    decklist:
      "40 Island\n59 Persistent Petitioners\nCommander\n1 Bruvac the Grandiloquent",
    games: 1,
    clockSeconds: 120,
    seed: 987654,
  },
  201,
);
await until(commander.id, (j) => j.state === "COMPLETED");
const [pod] = await request(`/simulations/${commander.id}/runs`);
assert.equal(pod.result.players.length, 4);
const podActions = await history(commander.id, pod.result.actionHistory);
assert.ok(podActions.some((e) => e.text.includes("Bruvac")));
assert.ok(podActions.some((e) => e.kind === "GAME_OUTCOME"));
await request(
  `/simulations/${commander.id}/games/${ids[0]}/actions`,
  undefined,
  404,
);
const cancelled = await request(
  "/simulations",
  {
    ...body,
    name: "Interrupted action history remains readable",
    games: 4,
    seed: 24567,
  },
  201,
);
await until(cancelled.id, (j) => j.observedGames >= 1);
await request(`/simulations/${cancelled.id}/cancel`, {});
const before = await request(`/simulations/${cancelled.id}/observations`);
assert.ok(before.length);
const original = before[0];
const originalActions = await history(
  cancelled.id,
  original.data.result.actionHistory,
);
for (let i = 0; i < 60; i++) {
  const r = await rateLimitedFetch(
    base + `/simulations/${cancelled.id}/retry`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    },
  );
  if (r.ok) break;
  assert.equal(r.status, 409);
  assert.ok(i < 59);
  await pause(1000);
}
await until(cancelled.id, (j) => j.state === "COMPLETED");
const after = await request(`/simulations/${cancelled.id}/observations`);
assert.deepEqual(
  await history(cancelled.id, original.data.result.actionHistory),
  originalActions,
);
assert.ok(after.some((o) => o.review.status === "previous"));
for (const observation of after)
  await history(cancelled.id, observation.data.result.actionHistory);
const stopped = await request(
  "/simulations",
  {
    name: "Stopped Commander action history",
    format: "commander",
    snapshotId: commanderPool.id,
    decklist:
      "40 Island\n59 Persistent Petitioners\nCommander\n1 Bruvac the Grandiloquent",
    games: 1,
    clockSeconds: 5,
    seed: 987654,
  },
  201,
);
await until(stopped.id, (j) => j.state === "COMPLETED");
const [stoppedRun] = await request(`/simulations/${stopped.id}/runs`);
assert.equal(stoppedRun.result.termination, "timeout");
assert.equal(stoppedRun.result.actionHistory.complete, false);
await history(stopped.id, stoppedRun.result.actionHistory);
await mkdir("data", { recursive: true });
await writeFile(
  "data/action-history-smoke.json",
  JSON.stringify(
    {
      verifiedAt: new Date().toISOString(),
      job: job.id,
      commander: commander.id,
      cancelled: cancelled.id,
      timeout: stopped.id,
      gameHistoryIds: ids,
      originalHistory: original.data.result.actionHistory,
      observations: after.map((o) => ({
        id: o.id,
        history: o.data.result.actionHistory,
        review: o.review,
      })),
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    event: "action_history_api_passed",
    job: job.id,
    commander: commander.id,
    cancelled: cancelled.id,
    gameHistories: ids.length,
  }),
);
