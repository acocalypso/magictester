import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
const base = (process.env.BASE_URL || "http://localhost:3000") + "/api/v1";
async function request(path, body, expected = 200) {
  const r = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json();
  assert.equal(r.status, expected, JSON.stringify(data));
  return data;
}
async function until(id, predicate, seconds = 600) {
  for (let i = 0; i < seconds; i++) {
    const job = await request("/simulations/" + id);
    if (job.state === "FAILED") throw Error(job.error);
    if (predicate(job)) return job;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw Error("Pod acceptance deadline exceeded");
}
const reports = [];
for (const format of ["commander", "cedh"]) {
  const snapshot = (await request(`/meta/${format}/snapshots`)).find((s) =>
    s.name.endsWith("Local reference pool"),
  );
  assert.ok(snapshot);
  const example = await request(`/formats/${format}/example`);
  const job = await request(
    "/simulations",
    {
      name: format + " pod acceptance",
      format,
      snapshotId: snapshot.id,
      decklist: example.decklist,
      games: format === "commander" ? 2 : 1,
      seed: 987654,
    },
    201,
  );
  assert.equal(job.clockSeconds, 120);
  assert.ok(job.config.executionPlan.every((p) => p.opponentIds.length === 3));
  console.log(
    JSON.stringify({ event: "pod_job_started", format, jobId: job.id }),
  );
  let checkpoint;
  if (format === "commander") {
    await until(job.id, (j) => j.completed >= 1);
    checkpoint = (await request(`/simulations/${job.id}/runs`)).find(
      (r) => r.state === "DONE",
    );
    assert.ok(checkpoint);
    await request(`/simulations/${job.id}/cancel`, {});
    for (let i = 0; i < 30; i++) {
      const response = await fetch(base + `/simulations/${job.id}/retry`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (response.ok) break;
      assert.equal(response.status, 409);
      if (i === 29) throw Error("Pod worker did not release its lock");
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  await until(job.id, (j) => j.state === "COMPLETED");
  const results = await request(`/simulations/${job.id}/results`);
  const runs = await request(`/simulations/${job.id}/runs`);
  assert.equal(results.summary.games, job.games);
  assert.equal(results.summary.placementGames, job.games);
  assert.ok(
    results.summary.averagePlacement >= 1 &&
      results.summary.averagePlacement <= 4,
  );
  assert.ok(results.summary.commanderTiming.observedGames === job.games);
  for (const run of runs) {
    assert.equal(run.result.termination, "normal");
    assert.equal(run.result.players.length, 4);
    assert.equal(
      new Set(run.result.players.map((p) => p.id)).size,
      4,
      "Repeated decks need unique player identities",
    );
    assert.deepEqual(run.result.startingLife, [40, 40, 40, 40]);
    const plan = job.config.executionPlan.find((p) => p.key === run.opponentId);
    assert.ok(plan);
    assert.deepEqual(
      run.result.players.slice(1).map((p) => p.deckId),
      plan.opponentIds,
    );
  }
  if (checkpoint) {
    const preserved = runs.find((r) => r.id === checkpoint.id);
    assert.deepEqual(preserved.result, checkpoint.result);
  }
  reports.push({
    format,
    jobId: job.id,
    summary: results.summary,
    plans: job.config.executionPlan,
  });
  console.log(
    JSON.stringify({
      event: "pod_job_passed",
      format,
      jobId: job.id,
      games: job.games,
    }),
  );
}
await mkdir("data", { recursive: true });
await writeFile(
  "data/pods-smoke.json",
  JSON.stringify({ verifiedAt: new Date().toISOString(), reports }, null, 2),
);
