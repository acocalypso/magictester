import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseDeck,
  validateDeck,
  planGames,
  CachedCardDataProvider,
  type CardMetadata,
  type CardDataProvider,
  type Opponent,
} from "../src/domain.js";
import { readFile } from "node:fs/promises";
import { normalizeSnapshot } from "../src/meta.js";
const meta = (
  name: string,
  typeLine = "Sorcery",
  oracleText = "",
): CardMetadata => ({
  name,
  typeLine,
  oracleText,
  legalities: { pauper: "legal" },
  colorIdentity: [],
  faces: [],
  scryfallId: name,
});
const map = new Map([
  ["forest", meta("Forest", "Basic Land — Forest")],
  ["lightning bolt", meta("Lightning Bolt")],
  [
    "relentless rats",
    meta(
      "Relentless Rats",
      "Creature",
      "A deck can have any number of cards named Relentless Rats.",
    ),
  ],
]);
const provider: CardDataProvider = {
  find: (n) => map.get(n.toLowerCase()),
  supports: () => true,
  provenance: { source: "test" },
};
test("parser normalizes sections, whitespace, export printings, duplicate counts and errors", () => {
  const p = parseDeck(
    "Deck\n 2x Lightning Bolt \n2 Lightning Bolt (M11) 146\nSideboard\n1 Forest\nSB: 1 Lightning Bolt\nMaybeboard\n1 Relentless Rats\ninvalid\n0 Forest",
  );
  assert.equal(p.cards[0].quantity, 4);
  assert.equal(p.cards[1].section, "SIDEBOARD");
  assert.equal(p.cards[3].section, "MAYBEBOARD");
  assert.deepEqual(
    p.errors.map((e) => e.line),
    [9, 10],
  );
});
test("validation counts copies across mainboard and sideboard and exempts basic lands", () => {
  assert.equal(validateDeck("60 Forest", "pauper", provider).valid, true);
  const result = validateDeck(
    "56 Forest\n4 Lightning Bolt\nSideboard\n1 Lightning Bolt",
    "pauper",
    provider,
  );
  assert.ok(result.errors.some((e) => e.code === "COPY_LIMIT"));
});
test("validation rejects unknown, unsupported, illegal cards and unsupported modes", () => {
  assert.equal(validateDeck("60 Unknown", "pauper", provider).valid, false);
  assert.equal(validateDeck("60 Forest", "commander", provider).valid, false);
  assert.equal(
    validateDeck("60 Forest", "pauper", { ...provider, supports: () => false })
      .valid,
    false,
  );
  assert.equal(
    validateDeck("60 Forest", "pauper", {
      ...provider,
      find: (n) => ({ ...provider.find(n)!, legalities: { pauper: "banned" } }),
    }).valid,
    false,
  );
});
test("card-defined quantity exceptions work", () => {
  assert.equal(
    validateDeck("20 Forest\n40 Relentless Rats", "pauper", provider).valid,
    true,
  );
});
test("planner conserves games, allocates remainder predictably, and has stable seeds", () => {
  const opponents = [{ id: "a" }, { id: "b" }, { id: "c" }] as Opponent[];
  const plans = planGames(50, opponents, 12345);
  assert.deepEqual(
    plans.map((p) => p.games),
    [17, 17, 16],
  );
  assert.equal(
    plans.reduce((s, p) => s + p.games, 0),
    50,
  );
  assert.deepEqual(
    planGames(1, opponents, 12345).map((p) => p.opponent.id),
    ["a"],
  );
  assert.deepEqual(planGames(50, opponents, 12345), plans);
});
test("duplicate archetypes are rejected for equal archetype benchmarks", () => {
  const deck = {
    name: "Forest",
    archetype: "same",
    strategy: "AGGRO",
    decklist: "60 Forest",
  };
  assert.throws(
    () =>
      normalizeSnapshot(
        {
          name: "pool",
          format: "pauper",
          source: "test",
          selectionMethod: "equal_archetype",
          decks: [deck, deck],
        },
        provider,
      ),
    /one representative/,
  );
});
test(
  "bundled lists pass real bulk metadata and Forge compatibility validation",
  { skip: !process.env.DATA_DIR },
  async () => {
    const cards = await new CachedCardDataProvider().load();
    const fixture = JSON.parse(
      await readFile("examples/pauper-reference.json", "utf8"),
    );
    const normalized = normalizeSnapshot(fixture, cards);
    assert.equal(normalized.decks.length, 2);
    assert.ok(cards.provenance.sha256);
  },
);
test("exact names survive token collisions and adventure-face aliases", async () => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "card-provider-test-"));
  try {
    const cards = [
      meta("Llanowar Elves", "Creature"),
      meta("Llanowar Elves", "Token Creature"),
      meta("Lightning Bolt"),
      {
        ...meta("Emeritus of Conflict // Lightning Bolt"),
        legalities: { pauper: "not_legal" },
        faces: [
          { name: "Lightning Bolt", typeLine: "Sorcery", oracleText: "" },
        ],
      },
    ];
    await writeFile(
      dir + "/cards.json",
      JSON.stringify({ cards, source: "test" }),
    );
    await writeFile(
      dir + "/forge-cards.json",
      '["Llanowar Elves","Lightning Bolt"]',
    );
    const provider = await new CachedCardDataProvider().load(dir);
    assert.equal(provider.find("Llanowar Elves")!.typeLine, "Creature");
    assert.equal(provider.find("Lightning Bolt")!.name, "Lightning Bolt");
    assert.equal(provider.find("Lightning Bolt")!.legalities.pauper, "legal");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
