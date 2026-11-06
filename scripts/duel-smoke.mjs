import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const base = (process.env.BASE_URL || "http://localhost:3000") + "/api/v1";
async function request(path, body, expected = 200) {
  const r = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const value = await r.json();
  assert.equal(r.status, expected, JSON.stringify(value));
  return value;
}
const snapshot = (await request("/meta/duel/snapshots")).find(
  (s) => s.name === "Duel Commander · Local reference pool",
);
assert.ok(snapshot);
const example = await request("/formats/duel/example");
const job = await request(
  "/simulations",
  {
    name: "Duel rules acceptance",
    format: "duel",
    snapshotId: snapshot.id,
    decklist: example.decklist,
    games: 2,
    seed: 777777,
  },
  201,
);
assert.equal(job.config.players, 2);
assert.equal(job.config.rules.engineMode, "duel");
assert.equal(job.config.rules.startingLife, 20);
assert.ok(
  [
    "forge/game/player/Player.java",
    "forge/game/staticability/StaticAbilityCantBeCast.java",
  ].every((path) =>
    job.config.bridge.upstreamOverrides.some(
      (override) => override.path === path,
    ),
  ),
);
console.log(JSON.stringify({ event: "duel_job_started", jobId: job.id }));
let completed = false;
for (let i = 0; i < 600; i++) {
  const current = await request(`/simulations/${job.id}`);
  assert.notEqual(current.state, "FAILED", current.error);
  if (current.state === "COMPLETED") {
    completed = true;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
assert.equal(completed, true);
const result = await request(`/simulations/${job.id}/results`);
const runs = await request(`/simulations/${job.id}/runs`);
assert.equal(result.summary.games, 2);
assert.equal(result.summary.placementGames, 2);
assert.ok(result.summary.commanderTiming);
for (const run of runs) {
  assert.equal(run.result.mode, "duel");
  assert.equal(run.result.mulliganRule, "London");
  assert.equal(run.result.termination, "normal");
  assert.deepEqual(run.result.startingLife, [20, 20]);
  assert.equal(run.result.players.length, 2);
  assert.ok(run.result.commanderCasts.length);
}
assert.deepEqual(await request(`/simulations/${job.id}/pods`), []);
await mkdir("data", { recursive: true });
await writeFile(
  "data/duel-smoke.json",
  JSON.stringify(
    {
      jobId: job.id,
      results: result,
      runs,
      verifiedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({ event: "duel_api_passed", jobId: job.id, games: 2 }),
);
