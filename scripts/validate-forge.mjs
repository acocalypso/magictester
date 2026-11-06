// Real native contracts and played games; no fabricated engine outcomes.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { ForgeEngineAdapter } from "../dist/engine.js";
import { resolveRuntime } from "../src/runtime.mjs";
const home = resolve(process.argv[2]);
const { bridge } = await resolveRuntime(home);
for (const name of [
  "DuelContracts",
  "MatchContracts",
  "CommanderColorContracts",
]) {
  execFileSync(
    "java",
    [
      "-Xmx1024m",
      "-Djava.awt.headless=true",
      "-cp",
      home +
        "/" +
        bridge.classDirectory +
        ":" +
        home +
        "/" +
        bridge.release.jarName,
      resolve("services/forge-runner/tests/" + name + ".java"),
    ],
    { cwd: home, stdio: "inherit", timeout: 120000 },
  );
}
const decks = await Promise.all(
  ["deck-a", "deck-b"].map((d) =>
    readFile("services/forge-runner/fixtures/" + d + ".dck", "utf8"),
  ),
);
const commander = (name) =>
  "[metadata]\nName=Stable release contract\n[Main]\n40 Island\n59 Persistent Petitioners\n[Commander]\n1 " +
  name;
const blue = [
  commander("Bruvac the Grandiloquent"),
  commander("Ambassador Laquatus"),
];
const cases = [
  { name: "BO1", decks, mode: "constructed" },
  { name: "BO3", decks, bestOf: 3, sideboarding: true },
  { name: "Commander", decks: [...blue, ...blue], mode: "commander" },
  { name: "Duel Commander", decks: blue, mode: "duel" },
];
const report = [];
for (const c of cases) {
  let result;
  await new ForgeEngineAdapter(home, home + "/validation-logs").runGames(
    { ...c, games: 1, seed: 12345, clockSeconds: 120 },
    async (r) => {
      assert.equal(r.termination, "normal", JSON.stringify(r));
      result = r;
    },
  );
  assert.ok(result, "Validation produced no result");
  console.log(
    JSON.stringify({
      event: "forge_candidate_game_passed",
      name: c.name,
      termination: result.termination,
    }),
  );
  report.push({
    name: c.name,
    termination: result.termination,
    engineVersion: result.engineVersion,
    bridgeSourceHash: result.bridgeSourceHash,
    turns: result.turns,
    unit: result.unit || "game",
  });
}
await writeFile(
  home + "/validation.json",
  JSON.stringify({
    validatedAt: new Date().toISOString(),
    contracts: ["DuelContracts", "MatchContracts", "CommanderColorContracts"],
    played: report,
  }),
);
console.log(
  JSON.stringify({
    event: "forge_candidate_validation_passed",
    version: bridge.engineVersion,
    played: report,
  }),
);
