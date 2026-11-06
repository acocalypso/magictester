import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { rateLimitedFetch } from "./test-http.mjs";
const base = (process.env.BASE_URL || "http://localhost:3000") + "/api/v1";
async function request(path, body, status = 200) {
  const r = await rateLimitedFetch(base + path, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json();
  assert.equal(r.status, status, JSON.stringify(data));
  return data;
}
const snapshot = (await request("/meta/commander/snapshots"))[0];
const [a, b] = snapshot.decks;
assert.ok(
  snapshot.decks.every((d) => d.metaShare === null),
  "Use a reference pool with explicitly unavailable shares",
);
const job = await request(
  "/simulations",
  {
    name: "Explicit pod weights and legal pregame color",
    format: "commander",
    snapshotId: snapshot.id,
    decklist:
      "97 Swamp\n1 Forest\nCommander\n1 The Prismatic Piper\n1 Tymna the Weaver",
    games: 1,
    seed: 12345,
    selection: {
      mode: "meta",
      allowRepeatedLists: true,
      pods: [{ opponentIds: [a.id, b.id, a.id], weight: 1 }],
    },
  },
  201,
);
assert.deepEqual(job.config.executionPlan[0].opponentIds, [a.id, b.id, a.id]);
assert.match(job.config.distribution, /explicit ordered pods/);
let final;
for (let i = 0; i < 240; i++) {
  final = await request(`/simulations/${job.id}`);
  assert.notEqual(final.state, "FAILED", final.error);
  if (final.state === "COMPLETED") break;
  await new Promise((r) => setTimeout(r, 1000));
}
assert.equal(final.state, "COMPLETED");
const [run] = await request(`/simulations/${job.id}/runs`);
assert.equal(run.result.termination, "normal");
assert.deepEqual(run.result.commanderColors, [
  { player: 0, card: "The Prismatic Piper", colors: ["green"] },
]);
assert.equal(new Set(run.result.players.map((p) => p.id)).size, 4);
await mkdir("data", { recursive: true });
await writeFile(
  "data/pod-selection-smoke.json",
  JSON.stringify(
    {
      jobId: job.id,
      config: job.config,
      result: run.result,
      checkedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    event: "explicit_pod_selection_passed",
    jobId: job.id,
    colors: run.result.commanderColors,
  }),
);
