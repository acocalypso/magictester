// Run inside the API container, with the normal worker stopped and no active jobs.
// Exercises exhausted BullMQ attempts, durable failure reconciliation and explicit retry.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Worker } from "bullmq";
import { queue } from "../dist/queue.js";
import { redisOptions } from "../dist/config.js";
const base = "http://localhost:3001/api/v1";
async function request(path, body) {
  const r = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json();
  assert.equal(
    r.status,
    body && path === "/simulations" ? 201 : 200,
    JSON.stringify(data),
  );
  return data;
}
const existing = await request("/simulations");
assert.ok(
  !existing.some((j) =>
    ["QUEUED", "PREPARING", "RUNNING", "AGGREGATING"].includes(j.state),
  ),
  "Use an idle lab for this operational test",
);
const snapshot = (await request("/meta/pauper/snapshots")).find(
  (s) => s.name === "Pauper · Local reference pool",
);
const job = await request("/simulations", {
  name: "Controlled queue failure recovery",
  decklist: await readFile("examples/burn.txt", "utf8"),
  format: "pauper",
  snapshotId: snapshot.id,
  games: 1,
  seed: 989898,
});
await (await queue.getJob(job.id)).remove();
await queue.add("benchmark", { id: job.id }, { jobId: job.id, attempts: 1 });
const failing = new Worker(
  "simulations",
  async () => {
    throw new Error("Controlled integration-test worker failure");
  },
  { connection: redisOptions },
);
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Failure injection timed out")),
      15000,
    );
    failing.once("failed", () => {
      clearTimeout(timer);
      resolve();
    });
    failing.once("error", reject);
  });
} finally {
  await failing.close();
}
let failed;
for (let i = 0; i < 30; i++) {
  failed = await request("/simulations/" + job.id);
  if (failed.state === "FAILED") break;
  await new Promise((r) => setTimeout(r, 1000));
}
assert.equal(failed.state, "FAILED");
assert.equal(failed.failed, 1);
assert.match(failed.error, /retry\/stall budget/);
await new Promise((r) => setTimeout(r, 11000));
assert.equal((await request("/simulations/" + job.id)).state, "FAILED");
assert.equal(await (await queue.getJob(job.id)).getState(), "failed");
await request("/simulations/" + job.id + "/retry", {});
assert.equal((await request("/simulations/" + job.id)).state, "QUEUED");
console.log(
  JSON.stringify({
    event: "exhausted_retry_verified",
    jobId: job.id,
    automaticRequeueStopped: true,
    explicitRetryQueued: true,
  }),
);
await queue.close();
