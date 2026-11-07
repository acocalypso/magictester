import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RuntimeManager } from "../dist/runtime-manager.mjs";
import {
  registerRuntime,
  resolveRuntime,
  baseline,
} from "../dist/core/runtime.mjs";
test("failed bridge validation never activates a candidate, including a same-version app update", async () => {
  const data = await mkdtemp(join(tmpdir(), "desktop-runtime-"));
  const root = join(data, "forge"),
    home = join(root, "releases", "old"),
    old = {
      version: "2",
      engineVersion: baseline.version,
      sourceHash: "a".repeat(64),
      release: baseline,
      classDirectory: "bridge-builds/old",
    };
  await mkdir(home, { recursive: true });
  await writeFile(join(home, "build.txt"), "fixture");
  await writeFile(join(home, "magictester-bridge.json"), JSON.stringify(old));
  await registerRuntime(root, home, old);
  const original = globalThis.fetch;
  globalThis.fetch = async (url) =>
    Response.json(
      String(url).endsWith("/releases/latest")
        ? {
            tag_name: baseline.tag,
            draft: false,
            prerelease: false,
            assets: [
              {
                name: `forge-installer-${baseline.version}.tar.bz2`,
                digest: "sha256:" + baseline.archiveSha256,
                browser_download_url: baseline.archiveUrl,
              },
            ],
          }
        : { object: { type: "commit", sha: baseline.sourceCommit } },
    );
  try {
    const manager = new RuntimeManager(data, () => {});
    manager.run = async (_script, _args, env) => {
      await writeFile(
        join(env.FORGE_CANDIDATE_HOME, "magictester-bridge.json"),
        JSON.stringify({ ...old, sourceHash: "b".repeat(64) }),
      );
    };
    manager.validate = async () => {
      throw Error("native contract mismatch");
    };
    await assert.rejects(manager.setup(), /native contract mismatch/);
    assert.equal(
      (await resolveRuntime(root)).bridge.sourceHash,
      old.sourceHash,
    );
    assert.equal(
      JSON.parse(await readFile(join(home, "magictester-bridge.json"), "utf8")).sourceHash,
      old.sourceHash,
      "staging writes must not alter the active manifest through a hard link",
    );
    const state = JSON.parse(
      await readFile(join(root, "forge-updates.json"), "utf8"),
    );
    assert.equal(state.status, "error");
    assert.equal(state.latestVersion, baseline.version);
    assert.equal(
      (await readdir(root)).some((n) => n.startsWith(".staging-")),
      false,
    );
  } finally {
    globalThis.fetch = original;
    await rm(data, { recursive: true, force: true });
  }
});
