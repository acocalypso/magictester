import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
const base = (process.env.BASE_URL || "http://localhost:3000") + "/api/v1";
const token =
  process.env.ADMIN_TOKEN ||
  (await readFile(".env", "utf8")).match(/^ADMIN_TOKEN=(.+)$/m)?.[1];
const initial = await (await fetch(base + "/operations")).json();
const denied = await fetch(base + "/operations/refresh-cards", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: "{}",
});
assert.equal(denied.status, 401);
const started = Date.now();
const response = await fetch(base + "/operations/refresh-cards", {
  method: "POST",
  headers: {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  },
  body: "{}",
});
assert.equal(response.status, 202, await response.text());
let final;
for (let i = 0; i < 120; i++) {
  final = await (await fetch(base + "/operations")).json();
  if (final.metadata.status === "error") throw new Error(final.metadata.error);
  if (
    Date.parse(final.metadata.lastSuccessAt) > started &&
    Date.parse(final.cardData.fetchedAt) > started
  )
    break;
  await new Promise((r) => setTimeout(r, 1000));
}
assert.ok(
  Date.parse(final.cardData.fetchedAt) > started,
  "API hot-loaded the refreshed cache",
);
assert.equal(final.cacheReloadError, null);
assert.equal(
  final.runner.bridgeSourceHash,
  initial.runner.bridgeSourceHash,
  "Card refresh preserves pinned engine source",
);
await mkdir("data", { recursive: true });
await writeFile(
  "data/maintenance-smoke.json",
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      metadata: final.metadata,
      cardData: final.cardData,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    event: "metadata_refresh_passed",
    fetchedAt: final.cardData.fetchedAt,
  }),
);
