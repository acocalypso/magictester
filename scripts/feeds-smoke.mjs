import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
const base = (process.env.BASE_URL || "http://localhost:3000") + "/api/v1";
const env =
  process.env.ADMIN_TOKEN ||
  (await readFile(".env", "utf8")).match(/^ADMIN_TOKEN=(.+)$/m)?.[1];
assert.ok(env, "Admin token required");
async function request(
  path,
  method = "GET",
  body,
  expected = 200,
  authorized = true,
) {
  const response = await fetch(base + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(authorized ? { authorization: `Bearer ${env}` } : {}),
    },
    ...(body || method === "POST" ? { body: JSON.stringify(body || {}) } : {}),
  });
  const data = await response.json();
  assert.equal(response.status, expected, JSON.stringify(data));
  return data;
}
await request("/meta/feeds", "POST", {}, 401, false);
await request(
  "/meta/feeds",
  "POST",
  {
    name: "Invalid",
    url: "https://localhost/pool",
    format: "pauper",
    permission: "Owned integration feed",
  },
  422,
);
const url =
  "https://raw.githubusercontent.com/acocalypso/magictester/main/examples/pauper-reference.json";
let feed = (await request("/meta/feeds")).find((f) => f.url === url);
if (!feed)
  feed = await request(
    "/meta/feeds",
    "POST",
    {
      name: "Project reference feed",
      url,
      format: "pauper",
      permission: "Project-authored feed under repository GPL license",
      intervalHours: 24,
    },
    201,
  );
const first = await request(`/meta/feeds/${feed.id}/sync`, "POST");
assert.ok(first.snapshotId);
const second = await request(`/meta/feeds/${feed.id}/sync`, "POST");
assert.equal(second.changed, false);
assert.equal(second.snapshotId, first.snapshotId);
const snapshot = (await request("/meta/pauper/snapshots")).find(
  (s) => s.id === first.snapshotId,
);
assert.equal(snapshot.metadata.url, url);
assert.match(snapshot.metadata.sha256, /^[a-f0-9]{64}$/);
assert.equal(snapshot.decks.length, 2);
await request(`/meta/feeds/${feed.id}`, "PATCH", { enabled: false });
assert.equal(
  (await request("/meta/feeds")).find((f) => f.id === feed.id).enabled,
  false,
);
await request(`/meta/feeds/${feed.id}`, "PATCH", { enabled: true });
await mkdir("data", { recursive: true });
await writeFile(
  "data/feeds-smoke.json",
  JSON.stringify(
    {
      feedId: feed.id,
      snapshotId: first.snapshotId,
      sha256: snapshot.metadata.sha256,
      checkedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    event: "feeds_acceptance_passed",
    feedId: feed.id,
    snapshotId: first.snapshotId,
  }),
);
