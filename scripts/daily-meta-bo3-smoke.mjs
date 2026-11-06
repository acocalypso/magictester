// Real BO3 matrix over sourced Pauper opponents, including double-faced/adventure names.
// Run in forge-runner, not alongside other benchmarks (this calls the adapter directly).
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { CachedCardDataProvider, validateDeck } from "../dist/domain.js";
import { ForgeEngineAdapter, serializeDeck } from "../dist/engine.js";
const provider = await new CachedCardDataProvider().load();
const base = process.env.API_URL || "http://api:3001";
const current = await fetch(base + "/api/v1/meta/pauper/current").then((r) =>
  r.json(),
);
assert.equal(current.status, "current");
const decklist = await readFile(
  process.env.BO3_DECK_FILE || "examples/burn.txt",
  "utf8",
);
const user = validateDeck(decklist, "pauper", provider);
assert.equal(user.valid, true, JSON.stringify(user.errors));
const report = [];
for (let i = 0; i < current.snapshot.decks.length; i++) {
  const source = current.snapshot.decks[i],
    opponent = validateDeck(source.decklist, "pauper", provider);
  assert.equal(opponent.valid, true, JSON.stringify(opponent.errors));
  console.log(
    JSON.stringify({ event: "daily_bo3_started", opponent: source.name }),
  );
  await new ForgeEngineAdapter().runGames(
    {
      decks: [
        serializeDeck(user.cards, "user"),
        serializeDeck(opponent.cards, source.name),
      ],
      games: Number(process.env.BO3_MATCHES || 3),
      bestOf: 3,
      maxMatchGames: 5,
      sideboarding: true,
      companions: [null, null],
      seed: 12345 + i * 100003,
      clockSeconds: 60,
    },
    async (result) => {
      assert.equal(result.termination, "normal", JSON.stringify(result));
      report.push({ opponent: source.name, result });
      console.log(
        JSON.stringify({
          event: "daily_bo3_result",
          opponent: source.name,
          index: result.index,
          termination: result.termination,
        }),
      );
    },
  );
}
await writeFile(
  process.env.BO3_META_REPORT || "/tmp/daily-meta-bo3.json",
  JSON.stringify({
    verifiedAt: new Date().toISOString(),
    snapshotId: current.snapshot.id,
    matches: report.length,
    games: report.reduce((n, r) => n + r.result.games.length, 0),
    report,
  }),
);
console.log(
  JSON.stringify({
    event: "daily_meta_bo3_passed",
    matches: report.length,
    opponents: current.snapshot.decks.length,
  }),
);
