import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const base = (process.env.BASE_URL || "http://localhost:3000") + "/api/v1";
async function request(path, body, expected = 200, admin = false) {
  let response;
  for (let i = 0; ; i++) {
    try {
      response = await fetch(base + path, {
        method: body ? "POST" : "GET",
        headers: {
          "Content-Type": "application/json",
          ...(admin
            ? { Authorization: "Bearer " + process.env.ADMIN_TOKEN }
            : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      break;
    } catch (error) {
      if (body || i >= 5) throw error;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  const result = await response.json();
  assert.equal(response.status, expected, JSON.stringify(result));
  return result;
}
const formats = (await request("/formats")).filter(
  (f) =>
    f.enabled &&
    !f.commander &&
    (!process.env.FORMAT_FILTER ||
      process.env.FORMAT_FILTER.split(",").includes(f.id)),
);
assert.ok(formats.length);
const reports = [];
for (const format of formats) {
  let snapshot = (await request(`/meta/${format.id}/snapshots`)).find(
    (s) => s.name === `${format.name} · Local reference pool`,
  );
  assert.ok(snapshot, `Reference pool missing: ${format.name}`);
  if (process.env.ADMIN_TOKEN)
    snapshot = await request(
      "/meta/import",
      {
        name: `${format.name} format acceptance ${Date.now()}`,
        format: format.id,
        source:
          "Project-authored reference lists imported by the format acceptance test. Not tournament data.",
        selectionMethod: "equal_archetype",
        decks: snapshot.decks,
      },
      201,
      true,
    );
  const decklist = snapshot.decks[0].decklist;
  const validation = await request("/decks/validate", {
    decklist,
    format: format.id,
  });
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));
  const job = await request(
    "/simulations",
    {
      name: format.name + " format acceptance",
      format: format.id,
      decklist,
      snapshotId: snapshot.id,
      games: 2,
      seed: 62345,
      clockSeconds: 30,
    },
    201,
  );
  console.log(
    JSON.stringify({
      event: "format_job_started",
      format: format.id,
      jobId: job.id,
    }),
  );
  let done = false;
  for (let i = 0; i < 600; i++) {
    const current = await request("/simulations/" + job.id);
    assert.notEqual(
      current.state,
      "FAILED",
      current.error || "Simulation failed",
    );
    if (current.state === "COMPLETED") {
      done = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  assert.ok(done, "Simulation exceeded acceptance deadline");
  const result = await request("/simulations/" + job.id + "/results");
  const runs = await request("/simulations/" + job.id + "/runs");
  assert.equal(result.job.format, format.id);
  assert.equal(result.summary.games, 2);
  assert.equal(result.job.failed, 0);
  assert.equal(runs.length, 2);
  for (const run of runs) {
    assert.equal(run.result.engine, "forge");
    assert.equal(run.result.players.length, format.players);
    assert.ok(["normal", "rule_draw"].includes(run.result.termination));
  }
  const report = {
    format: format.id,
    jobId: job.id,
    snapshotId: snapshot.id,
    importVerified: Boolean(process.env.ADMIN_TOKEN),
    games: result.summary.games,
    failed: result.job.failed,
    players: format.players,
  };
  reports.push(report);
  console.log(JSON.stringify({ event: "format_passed", ...report }));
}
await mkdir("data", { recursive: true });
await writeFile(
  "data/formats-smoke.json",
  JSON.stringify({ verifiedAt: new Date().toISOString(), reports }, null, 2),
);
console.log(
  JSON.stringify({
    event: "formats_acceptance_passed",
    formats: reports.length,
    realGames: reports.reduce((sum, r) => sum + r.games, 0),
  }),
);
