import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { DesktopApplication } from "../dist/application.mjs";
if (!process.env.DATA_DIR) throw Error("A real Forge/card cache is required");
const app = new DesktopApplication(process.env.DATA_DIR);
await app.initialize();
const report = [];
try {
  for (const [format, mode, games] of [
    ["modern", "BO3", 2],
    ["commander", "BO1", 1],
  ]) {
    const pool = app.listSnapshots(format).find((p) => p.reference);
    const job = await app.create({
      name: "Desktop " + format + " " + mode + " acceptance",
      format,
      decklist: pool.decks[0].decklist,
      snapshotId: pool.id,
      games,
      seed: 987654,
      clockSeconds: 300,
      gameMode: mode,
      maxMatchGames: 5,
      sideboardMode: mode === "BO3" ? "forge" : "none",
    });
    console.log(
      JSON.stringify({
        event: "desktop_format_started",
        id: job.id,
        format,
        mode,
      }),
    );
    for (let i = 0; i < 600; i++) {
      const j = app.job(job.id);
      assert.notEqual(j.state, "FAILED", j.error);
      if (j.state === "COMPLETED") break;
      await new Promise((r) => setTimeout(r, 1000));
      assert.ok(i < 599);
    }
    const runs = app.runs(job.id);
    assert.equal(runs.length, games);
    for (const run of runs) {
      assert.equal(run.result.termination, "normal");
      const actual =
        run.result.unit === "match" ? run.result.games : [run.result];
      for (const game of actual) {
        assert.equal(game.players.length, format === "commander" ? 4 : 2);
        assert.ok(game.actionHistory.complete);
        assert.ok(app.actions(job.id, game.actionHistory.id).count > 0);
      }
    }
    if (mode === "BO3") {
      const observed = app.observations(job.id);
      assert.ok(observed.length >= 4);
      assert.ok(observed.every((o) => o.review.status === "included"));
    }
    const result = app.results(job.id);
    assert.equal(result.job.completed, games);
    assert.equal(result.job.pending, 0);
    assert.ok(
      app
        .listJobs()
        .find((j) => j.id === job.id)
        .input.name.includes(format),
    );
    report.push({
      id: job.id,
      format,
      mode,
      games: result.summary.games,
      matches: result.matchSummary?.matches,
      placements: result.summary.placementDistribution,
    });
    console.log(
      JSON.stringify({ event: "desktop_format_passed", ...report.at(-1) }),
    );
  }
  await writeFile(
    process.env.DESKTOP_REPORT || join(tmpdir(), "desktop-native-formats.json"),
    JSON.stringify(report, null, 2),
  );
} finally {
  await app.close();
}
