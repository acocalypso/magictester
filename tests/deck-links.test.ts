import test from "node:test";
import assert from "node:assert/strict";
import { deckLink, decodeDeckLink, importDeckLink } from "../src/deck-links.js";
import { parseDeck } from "../src/domain.js";
const id = "U_e-z8UhZ0Ol42QMUgs9Tw";
const card = (name: string, quantity = 1) => ({ quantity, card: { name } });
test("deck links normalize share URLs and reject arbitrary hosts, credentials and ambiguous paths", () => {
  assert.equal(
    deckLink(
      "https://www.moxfield.com/decks/" + id + "/primer?utm_source=x#ignored",
    ).url,
    "https://moxfield.com/decks/" + id,
  );
  assert.equal(
    deckLink("archidekt.com/decks/123/some_name").api,
    "https://archidekt.com/api/decks/123/",
  );
  for (const url of [
    "http://moxfield.com/decks/" + id,
    "https://moxfield.com.evil.test/decks/" + id,
    "https://localhost/decks/1",
    "https://user@moxfield.com/decks/" + id,
    "https://moxfield.com:8080/decks/" + id,
    "https://api2.moxfield.com/v2/decks/all/" + id,
    "https://archidekt.com/decks/../api",
    "https://archidekt.com/decks/0",
  ])
    assert.throws(() => deckLink(url));
});
test("Moxfield imports actual role boards and quantities without importing tokens or pricing", () => {
  const result = decodeDeckLink("moxfield", {
    name: "A public deck",
    format: "commander",
    mainboard: { a: card("Island", 98) },
    sideboard: {},
    commanders: { a: card("Bruvac the Grandiloquent") },
    companions: { b: card("Lutri, the Spellchaser") },
    maybeboard: { c: card("Opt", 3) },
    tokens: [{ notACard: true }],
  });
  const parsed = parseDeck(result.decklist);
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(
    parsed.cards.map((c) => [c.name, c.quantity, c.section]),
    [
      ["Island", 98, "MAINBOARD"],
      ["Bruvac the Grandiloquent", 1, "COMMANDER"],
      ["Lutri, the Spellchaser", 1, "COMPANION"],
      ["Opt", 3, "MAYBEBOARD"],
    ],
  );
  assert.equal(result.sourceFormat, "commander");
});
test("Archidekt honors included categories and separate roles; split printings aggregate", () => {
  const data = {
    name: "Reference deck",
    categories: [
      { name: "Commander", includedInDeck: true },
      { name: "Considering", includedInDeck: false },
    ],
    cards: [
      {
        quantity: 60,
        categories: null,
        card: { oracleCard: { name: "Island" } },
      },
      {
        quantity: 38,
        categories: [],
        card: { oracleCard: { name: "Island" } },
      },
      {
        quantity: 1,
        categories: ["Commander"],
        card: { oracleCard: { name: "Bruvac the Grandiloquent" } },
      },
      {
        quantity: 1,
        categories: ["Considering"],
        card: { oracleCard: { name: "Opt" } },
      },
    ],
  };
  const parsed = parseDeck(decodeDeckLink("archidekt", data).decklist);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.cards[0].quantity, 98);
  assert.equal(parsed.cards[2].section, "MAYBEBOARD");
  assert.throws(
    () =>
      decodeDeckLink("archidekt", {
        ...data,
        cards: [{ ...data.cards[0], categories: ["Commander", "Maybeboard"] }],
      }),
    /conflicting/,
  );
  assert.throws(
    () => decodeDeckLink("archidekt", { ...data, customCards: [{}] }),
    /custom cards/,
  );
});
test("malformed responses and unsupported auxiliary decks never silently truncate a list", () => {
  const data = { name: "Deck", mainboard: { a: card("Island", 60) } };
  assert.throws(() =>
    decodeDeckLink("moxfield", {
      ...data,
      mainboard: { a: card("Island\nCommander", 60) },
    }),
  );
  assert.throws(
    () =>
      decodeDeckLink("moxfield", {
        ...data,
        signatureSpells: { a: card("Opt") },
      }),
    /signature spells/,
  );
  assert.throws(
    () => decodeDeckLink("moxfield", { ...data, mainboard: {} }),
    /mainboard/,
  );
  assert.throws(() =>
    decodeDeckLink("moxfield", {
      ...data,
      mainboard: { a: card("Island", -1) },
    }),
  );
});
test("link downloads use constructed API URLs without redirects and bound upstream failures", async () => {
  const data = { name: "Deck", mainboard: { a: card("Island", 60) } };
  const mock: typeof fetch = async (url, options) => {
    assert.equal(url, "https://api2.moxfield.com/v2/decks/all/" + id);
    assert.equal(options?.redirect, "error");
    return Response.json(data);
  };
  const result = await importDeckLink("https://moxfield.com/decks/" + id, mock);
  assert.match(result.source.sha256, /^[a-f0-9]{64}$/);
  await assert.rejects(
    importDeckLink(
      "https://moxfield.com/decks/" + id,
      async () => new Response("private", { status: 403 }),
    ),
    /private/,
  );
  await assert.rejects(
    importDeckLink(
      "https://moxfield.com/decks/" + id,
      async () => new Response("<html>challenge</html>"),
    ),
    /instead of a deck/,
  );
  await assert.rejects(
    importDeckLink(
      "https://moxfield.com/decks/" + id,
      async () =>
        new Response("x", { headers: { "content-length": "5000000" } }),
    ),
    /too large/,
  );
});
