import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { CachedCardDataProvider, validateDeck } from "../dist/domain.js";
import { referencePool } from "../dist/reference-pools.js";
import { ForgeEngineAdapter, serializeDeck } from "../dist/engine.js";
const cards = await new CachedCardDataProvider().load();
const decks = referencePool("pauper", cards).decks.map((d, i) =>
  serializeDeck(validateDeck(d.decklist, "pauper", cards).cards, `player-${i}`),
);
const results = [];
await new ForgeEngineAdapter().runGames(
  { decks, games: 8, indices: [2, 5], seed: 12345, clockSeconds: 30 },
  async (r) => {
    results.push(r);
  },
);
assert.deepEqual(
  results.map((r) => r.index),
  [2, 5],
);
assert.deepEqual(
  results.map((r) => r.gameSeed),
  [14363, 17390],
);
assert.ok(results.every((r) => r.termination === "normal"));
const path = process.env.OPERATIONS_REPORT || "data/operations-engine.json";
await mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
await writeFile(
  path,
  JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2),
);
console.log(
  JSON.stringify({
    event: "unfinished_indices_passed",
    indices: results.map((r) => r.index),
  }),
);
