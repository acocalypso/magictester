// Real games from active and archived bridge builds; historical versions are never relabelled.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { ForgeEngineAdapter } from "../dist/engine.js";
import { resolveRuntime, runtimeRoot } from "../src/runtime.mjs";
const root = runtimeRoot(),
  active = await resolveRuntime(root);
const registry = JSON.parse(
  await readFile(root + "/runtime-registry.json", "utf8"),
);
const archived = registry.entries.find((e) => e.key !== active.key);
const decks = await Promise.all(
  ["deck-a", "deck-b"].map((n) =>
    readFile("services/forge-runner/fixtures/" + n + ".dck", "utf8"),
  ),
);
const report = [];
for (const entry of [active, ...(archived ? [archived] : [])]) {
  await new ForgeEngineAdapter().runGames(
    { runtime: entry.bridge, decks, games: 1, seed: 12345, clockSeconds: 120 },
    async (r) => {
      assert.equal(r.termination, "normal");
      assert.equal(r.bridgeSourceHash, entry.bridge.sourceHash);
      assert.ok(r.engineVersion.startsWith(entry.bridge.engineVersion + " / "));
      report.push({ expected: entry.bridge, actual: r });
    },
  );
}
await writeFile(
  process.env.PINNING_REPORT || "/tmp/runtime-pinning.json",
  JSON.stringify(
    {
      verifiedAt: new Date().toISOString(),
      archivedRuntimeTested: Boolean(archived),
      report,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    event: "runtime_pinning_passed",
    archivedRuntimeTested: Boolean(archived),
    identities: report.map((r) => ({
      version: r.actual.engineVersion,
      hash: r.actual.bridgeSourceHash,
    })),
  }),
);
