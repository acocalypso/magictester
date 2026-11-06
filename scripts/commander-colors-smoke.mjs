import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { CachedCardDataProvider, validateDeck } from "../dist/domain.js";
import { referencePool } from "../dist/reference-pools.js";
import { ForgeEngineAdapter, serializeDeck } from "../dist/engine.js";
const cards = await new CachedCardDataProvider().load();
const starting =
  "97 Swamp\n1 Forest\nCommander\n1 The Prismatic Piper\n1 Tymna the Weaver";
const submitted = validateDeck(starting, "commander", cards);
assert.equal(submitted.valid, true, JSON.stringify(submitted.errors));
const refs = referencePool("commander", cards).decks;
const lists = [
  submitted.cards,
  ...[0, 1, 0].map(
    (i) => validateDeck(refs[i].decklist, "commander", cards).cards,
  ),
];
const results = [];
await new ForgeEngineAdapter().runGames(
  {
    decks: lists.map((deck, i) => serializeDeck(deck, `player-${i}`)),
    mode: "commander",
    games: 1,
    seed: 12345,
    clockSeconds: 120,
  },
  async (result) => {
    results.push(result);
  },
);
assert.equal(results.length, 1);
assert.equal(results[0].termination, "normal");
assert.deepEqual(results[0].commanderColors, [
  { player: 0, card: "The Prismatic Piper", colors: ["green"] },
]);
assert.equal(results[0].players.length, 4);
const path =
  process.env.COMMANDER_COLORS_REPORT || "data/commander-colors.json";
await mkdir(dirname(path), { recursive: true });
await writeFile(
  path,
  JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2),
);
console.log(
  JSON.stringify({
    event: "commander_colors_game_passed",
    colors: results[0].commanderColors,
    sourceHash: results[0].bridgeSourceHash,
  }),
);
