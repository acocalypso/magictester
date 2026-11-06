import { dirname } from "node:path";
import assert from "node:assert/strict";
import { CachedCardDataProvider, validateDeck } from "../dist/domain.js";
import { referencePool } from "../dist/reference-pools.js";
import { ForgeEngineAdapter, serializeDeck } from "../dist/engine.js";
import { mkdir, writeFile } from "node:fs/promises";
const provider = await new CachedCardDataProvider().load();
const pools = referencePool("modern", provider).decks;
const ins = ["Magma Jet", "Runeclaw Bear"];
const decks = pools.map((d, i) => {
  const v = validateDeck(
    d.decklist + `\nSideboard\n1 ${ins[i]}`,
    "modern",
    provider,
  );
  assert.equal(v.valid, true, JSON.stringify(v.errors));
  const out = v.cards.find(
    (c) =>
      c.section === "MAINBOARD" && !/Land/.test(provider.find(c.name).typeLine),
  ).name;
  return serializeDeck(v.cards, "player-" + i).replace(
    "\n[Main]",
    `\nAiHints=SideboardingPlan$ ${out} -> ${ins[i]}\n[Main]`,
  );
});
const results = [],
  observations = [];
await new ForgeEngineAdapter().runGames(
  {
    decks,
    games: 6,
    bestOf: 3,
    maxMatchGames: 5,
    sideboarding: true,
    companions: [null, null],
    seed: 12345,
    clockSeconds: 30,
  },
  async (r) => {
    results.push(r);
    console.log(
      JSON.stringify({
        event: "real_match",
        index: r.index,
        winner: r.winner,
        score: r.gameWins,
        games: r.games.length,
        termination: r.termination,
      }),
    );
  },
  undefined,
  async (o) => {
    observations.push(o);
    console.log(
      JSON.stringify({
        event: "actual_match_game",
        match: o.matchIndex,
        game: o.result.index,
        winner: o.result.winner,
        swaps: o.result.sideboardChanges,
      }),
    );
  },
);
assert.equal(results.length, 6);
for (const r of results) {
  assert.equal(r.unit, "match");
  assert.equal(r.termination, "normal");
  assert.equal(r.gameWins[r.winner], 2);
  assert.ok(r.games.length >= 2 && r.games.length <= 5);
  assert.equal(r.games.filter((g) => g.winner === r.winner).length, 2);
}
assert.equal(
  observations.length,
  results.reduce((n, r) => n + r.games.length, 0),
);
assert.ok(
  observations.some(
    (o) =>
      o.result.index > 0 &&
      o.result.sideboardChanges?.some((p) => p.added.length > 0),
  ),
  "Native sideboarding must actually change a deck",
);
assert.ok(
  results.some((r) => r.games.length >= 3),
  "Acceptance must include a match requiring a deciding game",
);
const companionText =
  "80 Island\nSideboard\n1 Yorion, Sky Nomad\n1 Gyruda, Doom of Depths\nCompanion\n1 Yorion, Sky Nomad";
const companionDeck = validateDeck(companionText, "pioneer", provider);
assert.equal(companionDeck.valid, true, JSON.stringify(companionDeck.errors));
const opponent = validateDeck(
  referencePool("pioneer", provider).decks[0].decklist,
  "pioneer",
  provider,
);
assert.equal(opponent.valid, true);
const companionResults = [];
await new ForgeEngineAdapter().runGames(
  {
    decks: [
      serializeDeck(companionDeck.cards, "player-0"),
      serializeDeck(opponent.cards, "player-1"),
    ],
    games: 1,
    bestOf: 3,
    maxMatchGames: 5,
    sideboarding: true,
    companions: ["Yorion, Sky Nomad", null],
    seed: 956789,
    clockSeconds: 30,
  },
  async (r) => companionResults.push(r),
);
assert.equal(companionResults[0].termination, "normal");
for (const game of companionResults[0].games)
  assert.equal(
    game.companionSelections[0].selected,
    "Yorion, Sky Nomad",
    "The declared companion must win over another eligible sideboard candidate",
  );
const reportPath = process.env.BO3_REPORT || "data/bo3-engine-smoke.json";
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(
  reportPath,
  JSON.stringify(
    {
      results,
      observations,
      companionResults,
      verifiedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    event: "bo3_engine_passed",
    matches: results.length,
    actualGames: observations.length,
  }),
);
