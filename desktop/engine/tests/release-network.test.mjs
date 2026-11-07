import test from "node:test";
import assert from "node:assert/strict";
import { latestStable } from "../dist/core/forge-releases.mjs";
import { baseline } from "../dist/core/runtime.mjs";

function valid(url) {
  return Response.json(String(url).endsWith("/releases/latest") ? {
    tag_name: baseline.tag, draft: false, prerelease: false,
    assets: [{ name: `forge-installer-${baseline.version}.tar.bz2`, digest: "sha256:" + baseline.archiveSha256, browser_download_url: baseline.archiveUrl }],
  } : { object: { type: "commit", sha: baseline.sourceCommit } });
}
test("stable discovery recovers from a transient GitHub gateway failure", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url) => ++calls === 1 ? new Response("Temporary gateway failure", { status: 504 }) : valid(url);
  try { assert.equal((await latestStable()).version, baseline.version); assert.equal(calls, 3); }
  finally { globalThis.fetch = original; }
});
test("stable discovery bounds retries and never retries permanent or malformed responses", async () => {
  const original = globalThis.fetch;
  try {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response("Unavailable", { status: 503 }); };
    await assert.rejects(latestStable(), /HTTP 503/); assert.equal(calls, 3);
    calls = 0;
    globalThis.fetch = async () => { calls++; return new Response("Missing", { status: 404 }); };
    await assert.rejects(latestStable(), /HTTP 404/); assert.equal(calls, 1);
    calls = 0;
    globalThis.fetch = async () => { calls++; return Response.json({ tag_name: "forge-99.0.0-SNAPSHOT", prerelease: true }); };
    await assert.rejects(latestStable(), /stable/); assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});
