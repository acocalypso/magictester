import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  compareVersions,
  releaseDescriptor,
  latestStable,
} from "../src/forge-releases.mjs";
import {
  registerRuntime,
  resolveRuntime,
  stableReleaseProblem,
} from "../src/runtime.mjs";
const sha = "a".repeat(64),
  commit = "b".repeat(40);
const release = {
  tag_name: "forge-2.0.16",
  draft: false,
  prerelease: false,
  assets: [
    {
      name: "forge-installer-2.0.16.tar.bz2",
      digest: "sha256:" + sha,
      browser_download_url:
        "https://github.com/Card-Forge/forge/releases/download/forge-2.0.16/forge-installer-2.0.16.tar.bz2",
    },
  ],
};
test("stable release descriptors require official digest and immutable source identity", () => {
  assert.equal(releaseDescriptor(release, commit).version, "2.0.16");
  assert.throws(() =>
    releaseDescriptor({ ...release, prerelease: true }, commit),
  );
  assert.throws(() =>
    releaseDescriptor(
      { ...release, tag_name: "forge-2.0.16-SNAPSHOT" },
      commit,
    ),
  );
  assert.throws(() =>
    releaseDescriptor(
      { ...release, assets: [{ ...release.assets[0], digest: null }] },
      commit,
    ),
  );
  assert.throws(() =>
    releaseDescriptor(
      {
        ...release,
        assets: [
          {
            ...release.assets[0],
            browser_download_url: "https://example.com/archive",
          },
        ],
      },
      commit,
    ),
  );
  assert.throws(() => releaseDescriptor(release, "main"));
  assert.equal(compareVersions("2.0.16", "2.0.9"), 1);
  assert.equal(compareVersions("2.0.15", "2.1.0"), -1);
});
test("latest stable follows annotated tags without using a moving branch", async () => {
  const requests: string[] = [];
  const result = await latestStable(async (url: string) => {
    requests.push(url);
    return url.endsWith("/releases/latest")
      ? release
      : url.includes("/git/ref/")
        ? { object: { type: "tag", sha: commit } }
        : { object: { type: "commit", sha: commit } };
  });
  assert.equal(result.sourceCommit, commit);
  assert.ok(requests[1].endsWith("/tags/forge-2.0.16"));
  assert.ok(requests[2].endsWith("/git/tags/" + commit));
});
test("runtime activation retains old job identity and rejects unavailable pinned engines", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge-registry-"));
  try {
    const old = {
      version: "2",
      engineVersion: "2.0.15",
      sourceHash: "1".repeat(64),
      classDirectory: "bridge-builds/old",
    };
    const next = {
      ...old,
      engineVersion: "2.0.16",
      sourceHash: "2".repeat(64),
    };
    await writeFile(root + "/magictester-bridge.json", JSON.stringify(old));
    await registerRuntime(root, root, old);
    await mkdir(root + "/releases/next", { recursive: true });
    await registerRuntime(root, root + "/releases/next", next, false);
    assert.equal(
      (await resolveRuntime(root)).bridge.engineVersion,
      old.engineVersion,
    );
    await registerRuntime(root, root + "/releases/next", next);
    assert.equal(
      (await resolveRuntime(root)).bridge.sourceHash,
      next.sourceHash,
    );
    assert.equal((await resolveRuntime(root, old)).home, root);
    await assert.rejects(
      resolveRuntime(root, { engineVersion: "0.0.0", sourceHash: sha }),
      /unavailable/,
    );
    await assert.rejects(
      registerRuntime(root, root + "/../escape", next),
      /inside runtime root/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("new jobs wait for a validated latest stable release and a fresh successful check", () => {
  const now = Date.now(),
    checkedAt = new Date(now).toISOString();
  const current = { status: "current", latestVersion: "2.0.15", checkedAt };
  assert.equal(stableReleaseProblem(current, "2.0.15", now), null);
  assert.match(
    stableReleaseProblem(
      { ...current, latestVersion: "2.0.16", status: "validating" },
      "2.0.15",
      now,
    )!,
    /awaiting validation/,
  );
  assert.match(
    stableReleaseProblem({ ...current, status: "error" }, "2.0.15", now)!,
    /unavailable/,
  );
  assert.match(
    stableReleaseProblem(current, "2.0.15", now + 27 * 3600000)!,
    /unavailable/,
  );
  assert.match(
    stableReleaseProblem({ ...current, checkedAt: "invalid" }, "2.0.15", now)!,
    /unavailable/,
  );
});
