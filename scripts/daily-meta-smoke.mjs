import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { rateLimitedFetch } from "./test-http.mjs";
const base = (process.env.BASE_URL || "http://localhost:3000") + "/api/v1";
async function request(path, method = "GET", body, status = 200, token) {
  const r = await rateLimitedFetch(base + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json();
  assert.equal(r.status, status, JSON.stringify(data));
  return data;
}
const formats = (await request("/formats")).map((f) => f.id);
let current;
for (let attempt = 0; attempt < 180; attempt++) {
  current = await Promise.all(
    formats.map(async (format) => ({
      format,
      ...(await request(`/meta/${format}/current`)),
    })),
  );
  if (
    current.every(
      (r) => r.snapshot && ["current", "refreshing"].includes(r.status),
    )
  )
    break;
  if (attempt === 179)
    throw new Error(
      JSON.stringify(
        current.map((r) => ({
          format: r.format,
          status: r.status,
          error: r.error,
        })),
      ),
    );
  await new Promise((r) => setTimeout(r, 10000));
}
for (const pool of current) {
  assert.ok(pool.snapshot.decks.length > 0 && pool.snapshot.decks.length <= 50);
  assert.equal(pool.snapshot.metadata.provider, "mtgtop8");
  assert.ok(
    pool.snapshot.metadata.pages.every((p) => /^[a-f0-9]{64}$/.test(p.sha256)),
  );
  assert.ok(pool.snapshot.metadata.representatives.every((r) => r.eventDate));
}
const source = current.find((r) => r.format === "pauper");
const saved = (await request("/meta/pauper/snapshots")).find((s) =>
  s.name.includes("Local reference pool"),
);
const body = {
  name: "Daily sourced opponent acceptance",
  decklist: await readFile("examples/burn.txt", "utf8"),
  format: "pauper",
  games: 1,
  clockSeconds: 120,
  seed: 12345,
  poolMode: "latest",
  selection: { mode: "meta" },
};
await request("/simulations", "POST", { ...body, snapshotId: saved.id }, 409);
const token =
  process.env.ADMIN_TOKEN ||
  (await readFile(".env", "utf8")).match(/^ADMIN_TOKEN=(.+)$/m)?.[1];
if (token) {
  try {
    await request(
      `/meta/feeds/${source.feedId}`,
      "PATCH",
      { enabled: false },
      200,
      token,
    );
    await request("/simulations", "POST", body, 503);
  } finally {
    await request(
      `/meta/feeds/${source.feedId}`,
      "PATCH",
      { enabled: true },
      200,
      token,
    );
  }
}
const job = await request("/simulations", "POST", body, 201);
assert.equal(job.snapshotId, source.snapshot.id);
assert.equal(job.config.poolMode, "latest");
let final;
for (let attempt = 0; attempt < 180; attempt++) {
  final = await request(`/simulations/${job.id}`);
  assert.notEqual(final.state, "FAILED", final.error);
  if (final.state === "COMPLETED") break;
  await new Promise((r) => setTimeout(r, 2000));
}
assert.equal(final.state, "COMPLETED");
const [run] = await request(`/simulations/${job.id}/runs`);
assert.equal(run.result.termination, "normal");
const report = {
  verifiedAt: new Date().toISOString(),
  jobId: job.id,
  formats: current.map((r) => ({
    format: r.format,
    snapshotId: r.snapshot.id,
    provider: r.snapshot.metadata.provider,
    window: r.snapshot.metadata.window,
    decks: r.snapshot.decks.length,
    reportedShares: r.snapshot.metadata.selectedMetaShare,
    excludedCandidates: r.snapshot.metadata.exclusions.length,
  })),
  immutableSnapshotVerified: true,
  noSilentReferenceFallback: true,
};
await mkdir("data", { recursive: true });
await writeFile(
  "data/daily-metagame-report.json",
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({
    event: "daily_all_format_sources_passed",
    jobId: job.id,
    formats: report.formats,
  }),
);
