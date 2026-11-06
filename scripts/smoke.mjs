import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
const base = process.env.BASE_URL || "http://localhost:3000";
async function request(path, body, expected = 200, token) {
  const response = await fetch(base + "/api/v1" + path, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  assert.equal(response.status, expected, JSON.stringify(data));
  return data;
}
async function until(id, condition, seconds = 300) {
  const start = Date.now();
  while (Date.now() - start < seconds * 1000) {
    const job = await request("/simulations/" + id);
    if (condition(job)) return job;
    if (job.state === "FAILED") throw new Error("Job failed: " + job.error);
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Timed out waiting for " + id);
}
const status = await request("/status");
assert.match(status.engine, /^Forge \d+\.\d+\.\d+$/);
assert.equal(status.forgeUpdates.channel, "stable");
const snapshots = await request("/meta/pauper/snapshots");
assert.ok(snapshots.length);
const snapshot =
  snapshots.find((s) => s.name === "Pauper · Local reference pool") ||
  snapshots[0];
const decklist = await readFile("examples/burn.txt", "utf8");
const valid = await request("/decks/validate", { decklist, format: "pauper" });
assert.equal(valid.valid, true);
const invalid = await request("/decks/validate", {
  decklist: "59 Mountain\n1 Not A Real Card",
  format: "pauper",
});
assert.equal(invalid.valid, false);
assert.ok(invalid.errors.some((e) => e.code === "UNKNOWN_CARD"));
await request("/simulations/not-a-uuid", undefined, 400);
await request(
  "/simulations/00000000-0000-4000-8000-000000000000",
  undefined,
  404,
);
if (process.env.ADMIN_TOKEN) {
  await request(
    "/meta/import",
    {
      ...JSON.parse(await readFile("examples/pauper-reference.json", "utf8")),
      name: "Smoke imported snapshot",
    },
    201,
    process.env.ADMIN_TOKEN,
  );
}
const created = await request(
  "/simulations",
  {
    name: "Docker E2E smoke",
    decklist,
    format: "pauper",
    snapshotId: snapshot.id,
    games: 2,
    seed: 424242,
  },
  201,
);
console.log(JSON.stringify({ event: "smoke_job_created", id: created.id }));
const stream = await fetch(
  base + "/api/v1/simulations/" + created.id + "/events",
);
assert.equal(stream.headers.get("content-type"), "text/event-stream");
const reader = stream.body.getReader();
const first = await reader.read();
assert.ok(new TextDecoder().decode(first.value).includes("event: progress"));
await reader.cancel();
const completed = await until(created.id, (j) => j.state === "COMPLETED");
assert.equal(completed.completed, 2);
assert.equal(completed.failed, 0);
const results = await request("/simulations/" + created.id + "/results");
assert.equal(results.summary.games, 2);
assert.equal(results.matchups.length, 2);
const runs = await request("/simulations/" + created.id + "/runs");
assert.equal(runs.length, 2);
for (const run of runs) {
  assert.equal(run.result.engine, "forge");
  assert.match(run.result.engineVersion, /2\.0\.15/);
  assert.equal(run.result.termination, "normal");
  assert.ok(run.result.turns > 0);
  assert.ok(run.result.startingPlayer !== null);
}
const cancellation = await request(
  "/simulations",
  {
    name: "Cancellation and resume smoke",
    decklist,
    format: "pauper",
    snapshotId: snapshot.id,
    games: 4,
    seed: 434343,
  },
  201,
);
await until(cancellation.id, (j) => j.state === "RUNNING");
await request("/simulations/" + cancellation.id + "/cancel", {});
assert.equal(
  (await request("/simulations/" + cancellation.id)).state,
  "CANCELLED",
);
let resumed = false;
for (let i = 0; i < 20; i++) {
  const r = await fetch(
    base + "/api/v1/simulations/" + cancellation.id + "/retry",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    },
  );
  if (r.ok) {
    resumed = true;
    break;
  }
  assert.equal(r.status, 409);
  await new Promise((r) => setTimeout(r, 1000));
}
assert.ok(resumed, "Cancelled worker should release its lock");
const resumedJob = await until(cancellation.id, (j) => j.state === "COMPLETED");
assert.equal(resumedJob.completed, 4);
const resumedRuns = await request("/simulations/" + cancellation.id + "/runs");
assert.equal(new Set(resumedRuns.map((r) => r.id)).size, 4);
await mkdir("data", { recursive: true });
await writeFile(
  "data/smoke-report.json",
  JSON.stringify(
    {
      verifiedAt: new Date().toISOString(),
      completedJob: completed.id,
      cancellationJob: cancellation.id,
      results,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    event: "smoke_passed",
    games: 6,
    jobId: created.id,
    cancellationJobId: cancellation.id,
  }),
);
