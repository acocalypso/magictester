import { rateLimitedFetch } from "./test-http.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
const base = (process.env.BASE_URL || "http://localhost:3000") + "/api/v1";
async function request(path, body) {
  for (let i = 0; i < 30; i++) {
    try {
      const r = await rateLimitedFetch(base + path, {
        method: body ? "POST" : "GET",
        headers: { "content-type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(JSON.stringify(data));
      return data;
    } catch (e) {
      if (body || i === 29) throw e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}
const snapshot = (await request("/meta/pauper/snapshots"))[0];
const job = await request("/simulations", {
  name: "Worker/database/Redis restart acceptance",
  decklist: await readFile("examples/burn.txt", "utf8"),
  format: "pauper",
  snapshotId: snapshot.id,
  games: 4,
  gameMode: "BO3",
  maxMatchGames: 5,
  seed: 12345,
});
let before;
for (let i = 0; i < 240; i++) {
  const rows = await request(`/simulations/${job.id}/runs`);
  before = rows.filter((r) => r.state === "DONE");
  if (before.length) break;
  await new Promise((r) => setTimeout(r, 250));
}
assert.ok(
  before.length > 0 && before.length < 4,
  "Interrupt after a checkpoint while unfinished work remains",
);
execFileSync(
  "docker",
  [
    "kill",
    "--signal",
    "KILL",
    process.env.WORKER_CONTAINER || "magictester-worker-1",
  ],
  { stdio: "inherit" },
);
execFileSync(
  "docker",
  [
    "restart",
    process.env.POSTGRES_CONTAINER || "magictester-postgres-1",
    process.env.REDIS_CONTAINER || "magictester-redis-1",
  ],
  { stdio: "inherit" },
);
execFileSync(
  "docker",
  ["start", process.env.WORKER_CONTAINER || "magictester-worker-1"],
  { stdio: "inherit" },
);
let final;
for (let i = 0; i < 300; i++) {
  final = await request(`/simulations/${job.id}`);
  assert.notEqual(final.state, "FAILED", final.error);
  if (final.state === "COMPLETED") break;
  await new Promise((r) => setTimeout(r, 1000));
}
assert.equal(final.state, "COMPLETED");
const after = await request(`/simulations/${job.id}/runs`);
for (const saved of before)
  assert.deepEqual(
    after.find((r) => r.id === saved.id),
    saved,
    "Completed checkpoints survive restart unchanged",
  );
assert.equal(after.filter((r) => r.state === "DONE").length, 4);
const operations = await request("/operations");
assert.equal(operations.runner.status, "ok");
await mkdir("data", { recursive: true });
await writeFile(
  "data/recovery-smoke.json",
  JSON.stringify(
    {
      id: job.id,
      preservedCheckpoints: before.length,
      completed: final.completed,
      actualGames: final.actualGames,
      observedGames: final.observedGames,
      checkedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    event: "restart_recovery_passed",
    id: job.id,
    preservedCheckpoints: before.length,
  }),
);
