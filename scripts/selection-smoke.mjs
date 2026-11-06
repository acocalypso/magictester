import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
const base = (process.env.BASE_URL || "http://localhost:3000") + "/api/v1";
async function request(path, body, status = 200) {
  const r = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (r.status === 429) {
    await new Promise((resolve) =>
      setTimeout(
        resolve,
        Math.min(
          60000,
          Math.max(1000, Number(r.headers.get("retry-after") || 1) * 1000),
        ),
      ),
    );
    return request(path, body, status);
  }
  const data = await r.json();
  assert.equal(r.status, status, JSON.stringify(data));
  return data;
}
const snapshot = (await request("/meta/pauper/snapshots"))[0];
const sample = await request("/formats/pauper/example");
const [a, b] = snapshot.decks;
const input = {
  name: "Weighted opponent acceptance",
  decklist: sample.decklist,
  format: "pauper",
  snapshotId: snapshot.id,
  games: 7,
  seed: 12345,
  selection: { mode: "custom", weights: { [a.id]: 3, [b.id]: 1 } },
};
await request("/simulations", { ...input, selection: { mode: "meta" } }, 422);
await request(
  "/simulations",
  {
    ...input,
    selection: { mode: "custom", weights: { [a.id]: 0, [b.id]: 0 } },
  },
  422,
);
const job = await request("/simulations", input, 201);
assert.deepEqual(
  job.config.executionPlan.map((p) => p.games),
  [5, 2],
);
for (let i = 0; i < 300; i++) {
  const state = await request(`/simulations/${job.id}`);
  assert.notEqual(state.state, "FAILED", state.error);
  if (state.state === "COMPLETED") break;
  await new Promise((r) => setTimeout(r, 1000));
}
const result = await request(`/simulations/${job.id}/results`);
assert.equal(result.summary.games, 7);
assert.deepEqual(result.matchups.map((m) => m.games).sort(), [2, 5]);
await mkdir("data", { recursive: true });
await writeFile(
  "data/selection-smoke.json",
  JSON.stringify(
    { id: job.id, plan: job.config.executionPlan, summary: result.summary },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({ event: "weighted_acceptance_passed", id: job.id }),
);
