import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
import { rateLimitedFetch } from "./test-http.mjs";
const base = (process.env.BASE_URL || "http://localhost:3000") + "/api/v1";
async function req(path, body, status = 200) {
  const r = await rateLimitedFetch(base + path, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json();
  assert.equal(r.status, status, JSON.stringify(data));
  return data;
}
async function done(id) {
  for (let i = 0; i < 300; i++) {
    const j = await req(`/simulations/${id}`);
    assert.notEqual(j.state, "FAILED", j.error);
    if (j.state === "COMPLETED") return j;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw Error("Retry settings acceptance timed out");
}
let sourceId = process.env.RETRY_SOURCE_ID;
if (!sourceId) {
  const pool = (await req("/meta/commander/snapshots")).find(
    (s) => s.name === "Commander · Local reference pool",
  );
  const source = await req(
    "/simulations",
    {
      name: "Retry clock acceptance",
      format: "commander",
      snapshotId: pool.id,
      decklist:
        "40 Island\n59 Persistent Petitioners\nCommander\n1 Bruvac the Grandiloquent",
      games: 1,
      clockSeconds: 5,
      seed: 987654,
    },
    201,
  );
  sourceId = source.id;
  await done(sourceId);
}
const source = await req(`/simulations/${sourceId}`),
  before = await req(`/simulations/${sourceId}/runs`);
for (const clockSeconds of [4, 301, 150.5])
  await req(
    `/simulations/${sourceId}/retry`,
    { mode: "new", clockSeconds },
    400,
  );
await req(
  `/simulations/${sourceId}/retry`,
  { mode: "resume", clockSeconds: 300 },
  400,
);
const retried = await req(`/simulations/${sourceId}/retry`, {
  mode: "new",
  clockSeconds: 300,
});
assert.notEqual(retried.id, sourceId);
assert.equal(retried.clockSeconds, 300);
assert.equal(retried.config.retryOf, sourceId);
assert.equal(retried.deckVersionId, source.deckVersionId);
assert.equal(retried.snapshotId, source.snapshotId);
assert.equal(retried.seed, source.seed);
assert.equal(retried.games, source.games);
const { retryOf: _lineage, ...originalSettings } = retried.config;
const { retryOf: _previous, ...sourceSettings } = source.config;
assert.deepEqual(originalSettings, sourceSettings);
console.log(
  JSON.stringify({
    event: "retry_with_300_seconds_started",
    source: sourceId,
    id: retried.id,
  }),
);
await req(
  `/simulations/${retried.id}/retry`,
  { mode: "new", clockSeconds: 300 },
  409,
);
const completed = await done(retried.id);
assert.equal(completed.clockSeconds, 300);
assert.equal(completed.timeouts, 0);
assert.deepEqual(await req(`/simulations/${sourceId}/runs`), before);
assert.deepEqual(await req(`/simulations/${sourceId}`), source);
const [run] = await req(`/simulations/${retried.id}/runs`);
assert.equal(run.result.termination, "normal");
assert.equal(run.result.gameSeed, before[0].result.gameSeed);
assert.notEqual(run.result.actionHistory.id, before[0].result.actionHistory.id);
const historyId = before[0].result.actionHistory.id;
await req(`/simulations/${sourceId}/games/${historyId}/actions`);
await mkdir("data", { recursive: true });
await writeFile(
  "data/retry-settings-smoke.json",
  JSON.stringify(
    {
      source: sourceId,
      retried: retried.id,
      clockSeconds: completed.clockSeconds,
      completed: completed.completed,
      verifiedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ event: "retry_settings_passed", id: retried.id }));
