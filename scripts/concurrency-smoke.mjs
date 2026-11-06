import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const base = (process.env.BASE_URL || "http://localhost:3000") + "/api/v1";
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function request(path, body, expected = 200) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await fetch(base + path, {
      method: body ? "POST" : "GET",
      headers: { "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (r.status === 429) {
      await r.body?.cancel();
      await pause(
        Math.min(
          60000,
          Math.max(1000, Number(r.headers.get("retry-after") || 1) * 1000),
        ),
      );
      continue;
    }
    const data = await r.json();
    assert.equal(r.status, expected, JSON.stringify(data));
    return data;
  }
  throw Error("API rate limit did not clear");
}
const capacity = (await request("/operations")).runner.resources;
assert.ok(
  capacity.max >= 2,
  "This acceptance test requires hardware/configuration allowing two Forge slots",
);
const snapshot = (await request("/meta/modern/snapshots")).find(
  (s) => s.name === "Modern · Local reference pool",
);
assert.ok(snapshot);
const sample = await request("/formats/modern/example");
const body = {
  name: "Parallel acceptance",
  format: "modern",
  snapshotId: snapshot.id,
  decklist: sample.decklist,
  games: 8,
  seed: 71234,
  clockSeconds: 30,
  selection: {
    mode: "custom",
    opponentIds: [snapshot.decks[0].id],
    weights: { [snapshot.decks[0].id]: 1 },
  },
};
const samples = [];
async function complete(jobs, minimumAnalyses) {
  let sawParallel = false;
  for (let i = 0; i < 450; i++) {
    const states = await Promise.all(
      jobs.map((job) => request(`/simulations/${job.id}`)),
    );
    for (const state of states)
      assert.notEqual(state.state, "FAILED", state.error);
    const resources = (await request("/operations")).runner.resources;
    if (resources.active >= 2 && resources.activeAnalyses >= minimumAnalyses)
      sawParallel = true;
    if (samples.length < 300)
      samples.push({ at: new Date().toISOString(), ...resources });
    if (states.every((state) => state.state === "COMPLETED")) {
      assert.ok(
        sawParallel,
        `Expected simultaneous batches across ${minimumAnalyses} analyses`,
      );
      for (const job of jobs) {
        const runs = await request(`/simulations/${job.id}/runs`);
        assert.equal(runs.length, job.games);
        assert.equal(
          new Set(runs.map((r) => `${r.opponentId}:${r.batchIndex}`)).size,
          runs.length,
        );
        const plan = job.config.executionPlan[0];
        assert.deepEqual(
          runs.map((r) => r.batchIndex).sort((a, b) => a - b),
          Array.from({ length: runs.length }, (_, i) => i),
        );
        for (const run of runs) {
          assert.equal(run.state, "DONE");
          assert.equal(run.result.seed, plan.seed);
          assert.equal(run.result.index, run.batchIndex);
          assert.equal(
            run.result.gameSeed,
            (plan.seed + run.batchIndex * 1009) % 2147483647,
          );
          assert.equal(run.result.termination, "normal");
        }
      }
      return;
    }
    await pause(3000);
  }
  throw Error("Parallel acceptance timed out");
}
const solo = await request(
  "/simulations",
  { ...body, name: "One analysis, parallel batches" },
  201,
);
console.log(JSON.stringify({ event: "parallel_solo_started", id: solo.id }));
await complete([solo], 1);
const pair = await Promise.all(
  [1, 2].map((n) =>
    request(
      "/simulations",
      {
        ...body,
        name: `Shared runner analysis ${n}`,
        games: 12,
        seed: body.seed + n,
      },
      201,
    ),
  ),
);
console.log(
  JSON.stringify({
    event: "parallel_pair_started",
    ids: pair.map((j) => j.id),
  }),
);
await complete(pair, 2);
const interrupted = await request(
  "/simulations",
  { ...body, name: "Parallel cancellation and retry", games: 24 },
  201,
);
let before = [];
for (let i = 0; i < 240; i++) {
  const state = await request(`/simulations/${interrupted.id}`);
  assert.notEqual(state.state, "FAILED", state.error);
  if (state.completed >= 1 && state.completed < 24) {
    before = (await request(`/simulations/${interrupted.id}/runs`)).filter(
      (r) => r.state === "DONE",
    );
    break;
  }
  await pause(3000);
}
assert.ok(before.length, "Need completed evidence before interruption");
await request(`/simulations/${interrupted.id}/cancel`, {});
let drained = false;
for (let i = 0; i < 30; i++) {
  const resources = (await request("/operations")).runner.resources;
  if (resources.active === 0 && resources.waiting === 0) {
    drained = true;
    break;
  }
  await pause(1000);
}
assert.ok(drained, "Cancellation must release running and queued engine work");
for (let i = 0; i < 30; i++) {
  const r = await fetch(base + `/simulations/${interrupted.id}/retry`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (r.ok) break;
  assert.equal(r.status, 409);
  assert.ok(i < 29, "Worker did not release cancelled analysis");
  await pause(1000);
}
const resumed = await request(`/simulations/${interrupted.id}`);
await complete([resumed], 1);
const after = await request(`/simulations/${interrupted.id}/runs`);
assert.equal(after.length, 24);
for (const run of before)
  assert.deepEqual(after.find((r) => r.id === run.id).result, run.result);
await mkdir("data", { recursive: true });
await writeFile(
  "data/concurrency-smoke.json",
  JSON.stringify(
    {
      verifiedAt: new Date().toISOString(),
      capacity,
      solo: solo.id,
      pair: pair.map((j) => j.id),
      cancelled: interrupted.id,
      preservedResults: before.length,
      samples,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    event: "parallel_acceptance_passed",
    preservedResults: before.length,
  }),
);
