import { tmpdir } from "node:os";
import { join } from "node:path";
// Requires a real cached Forge/card data directory. No outcomes are synthesized.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { DesktopApplication } from "../dist/application.mjs";
if (!process.env.DATA_DIR)
  throw Error("Set DATA_DIR to a real local card/Forge cache");
const app = new DesktopApplication(process.env.DATA_DIR);
await app.initialize();
try {
  const status = await app.status();
  assert.equal(status.ready, true, status.setupError);
  const pools = app.listSnapshots("pauper"),
    pool = pools.find((p) => p.reference);
  assert.ok(pool);
  const body = {
    name: "Native desktop acceptance",
    format: "pauper",
    decklist: pool.decks[0].decklist,
    snapshotId: pool.id,
    games: 4,
    seed: 12345,
    clockSeconds: 300,
    gameMode: "BO1",
    sideboardMode: "none",
    selection: { mode: "equal" },
  };
  const job = await app.create(body);
  console.log(JSON.stringify({ event: "desktop_native_started", id: job.id }));
  async function until(id, condition) {
    for (let i = 0; i < 300; i++) {
      const j = app.job(id);
      assert.notEqual(j.state, "FAILED", j.error);
      if (condition(j)) return j;
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw Error("Native desktop acceptance timed out");
  }
  await until(job.id, (j) => j.state === "COMPLETED");
  const runs = app.runs(job.id);
  assert.equal(runs.length, 4);
  for (const run of runs) {
    assert.equal(run.result.termination, "normal");
    assert.ok(run.result.actionHistory.count > 0);
    const actions = app.actions(job.id, run.result.actionHistory.id);
    assert.equal(actions.complete, true);
    assert.ok(actions.entries.some((e) => e.kind === "TURN"));
  }
  const before = app.runs(job.id);
  const retried = await app.retry({
    id: job.id,
    mode: "new",
    clockSeconds: 240,
  });
  assert.equal(retried.input.clockSeconds, 240);
  assert.deepEqual(retried.config.executionPlan, job.config.executionPlan);
  assert.equal(retried.config.retryOf, job.id);
  await until(retried.id, (j) => j.state === "RUNNING");
  app.cancel(retried.id);
  for (let i = 0; i < 30 && app.active.has(retried.id); i++)
    await new Promise((r) => setTimeout(r, 500));
  assert.equal(app.active.has(retried.id), false);
  const resumed = await app.retry({ id: retried.id, mode: "resume" });
  assert.equal(resumed.id, retried.id);
  await until(retried.id, (j) => j.state === "COMPLETED");
  assert.deepEqual(app.runs(job.id), before);
  await writeFile(
    process.env.DESKTOP_REPORT || join(tmpdir(), "desktop-native-report.json"),
    JSON.stringify(
      {
        job: job.id,
        retry: retried.id,
        results: app.results(job.id).summary,
        verifiedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      event: "desktop_native_passed",
      id: job.id,
      retry: retried.id,
    }),
  );
} finally {
  await app.close();
}
