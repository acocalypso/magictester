import { dirname } from "node:path";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { CachedCardDataProvider, validateDeck } from "../dist/domain.js";
import { ForgeEngineAdapter, serializeDeck } from "../dist/engine.js";
import { referencePool } from "../dist/reference-pools.js";
const provider = await new CachedCardDataProvider().load();
const red = validateDeck(
  referencePool("vintage", provider).decks[0].decklist,
  "vintage",
  provider,
);
assert.equal(red.valid, true);
const cases = [];
for (const side of [
  "1 Yorion, Sky Nomad\n1 Gyruda, Doom of Depths",
  "1 Yorion, Sky Nomad",
]) {
  const deck = validateDeck(
    "80 Island\nSideboard\n" + side,
    "vintage",
    provider,
  );
  assert.equal(deck.valid, true, JSON.stringify(deck.errors));
  await new ForgeEngineAdapter().runGames(
    {
      decks: [
        serializeDeck(deck.cards, "player-0"),
        serializeDeck(red.cards, "player-1"),
      ],
      games: 1,
      seed: 995678,
      clockSeconds: 30,
      companions: [null, null],
    },
    async (result) => {
      assert.equal(result.termination, "normal");
      assert.equal(result.unit, "game");
      assert.equal(result.companionSelections[0].selected, null);
      cases.push(result);
    },
  );
}
const text =
  "40 Forest\n4 Wall of Roots\n4 Wall of Blossoms\n4 Nest Invader\n4 Elvish Visionary\n4 Grizzly Bears\nSideboard\n1 Llanowar Elves\n1 Gyruda, Doom of Depths\n1 Jegantha, the Wellspring\nCompanion\n1 Gyruda, Doom of Depths";
const green = validateDeck(text, "vintage", provider);
assert.equal(green.valid, true, JSON.stringify(green.errors));
const native = serializeDeck(green.cards, "player-0").replace(
  "\n[Main]",
  "\nAiHints=SideboardingPlan$ Wall of Roots -> Llanowar Elves\n[Main]",
);
let match;
await new ForgeEngineAdapter().runGames(
  {
    decks: [native, serializeDeck(red.cards, "player-1")],
    games: 1,
    bestOf: 3,
    maxMatchGames: 5,
    sideboarding: true,
    companions: ["Gyruda, Doom of Depths", null],
    seed: 12345,
    clockSeconds: 30,
  },
  async (result) => {
    match = result;
  },
);
assert.equal(match.termination, "normal");
assert.equal(
  match.games[0].companionSelections[0].selected,
  "Gyruda, Doom of Depths",
);
const postboard = match.games
  .slice(1)
  .find((g) =>
    g.sideboardChanges.some(
      (p) => p.player === 0 && p.added.some((c) => c.name === "Llanowar Elves"),
    ),
  );
assert.ok(
  postboard,
  "Native predefined test plan must actually bring in the odd-mana card",
);
assert.equal(
  postboard.companionSelections[0].selected,
  null,
  "Decline the now-ineligible candidate; do not substitute eligible Jegantha",
);
cases.push(match);
const reportPath = process.env.COMPANION_REPORT || "data/companion-smoke.json";
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(
  reportPath,
  JSON.stringify({ cases, verifiedAt: new Date().toISOString() }, null, 2),
);
console.log(
  JSON.stringify({
    event: "companion_acceptance_passed",
    cases: cases.length,
    postboardCandidateDeclined: true,
  }),
);
