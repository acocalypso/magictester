import test from "node:test";
import assert from "node:assert/strict";
import { flavorAliases } from "../src/card-aliases.mjs";
import { validateDeck, type CardDataProvider } from "../src/domain.js";
test("all alias pages are cached and unsafe or repeated pagination fails closed", async () => {
  const aliases = await flavorAliases(async (url: string) =>
    url.includes("page=2")
      ? {
          object: "list",
          data: [{ name: "Counterspell", flavor_name: "A printed alias" }],
          has_more: false,
        }
      : {
          object: "list",
          data: [
            { name: "Lightning Bolt", flavor_name: "Thrum of the Vestige" },
          ],
          has_more: true,
          next_page: "https://api.scryfall.com/cards/search?page=2",
        },
  );
  assert.deepEqual(aliases, {
    "Thrum of the Vestige": "Lightning Bolt",
    "A printed alias": "Counterspell",
  });
  await assert.rejects(
    flavorAliases(async () => ({
      object: "list",
      data: [],
      has_more: true,
      next_page: "https://example.com/cards",
    })),
    /pagination/,
  );
});
test("printed aliases share canonical card identity and copy limits", () => {
  const bolt = {
    name: "Lightning Bolt",
    typeLine: "Instant",
    legalities: { pauper: "legal" },
    oracleText: "",
    colorIdentity: ["R"],
    manaCost: "{R}",
    faces: [],
    scryfallId: "test",
  };
  const mountain = {
    ...bolt,
    name: "Mountain",
    typeLine: "Basic Land — Mountain",
  };
  const provider: CardDataProvider = {
    provenance: {},
    supports: () => true,
    find: (n) =>
      ["lightning bolt", "thrum of the vestige"].includes(n.toLowerCase())
        ? bolt
        : n.toLowerCase() === "mountain"
          ? mountain
          : undefined,
  };
  const good = validateDeck(
    "4 Thrum of the Vestige (FCA) 40\n56 Mountain",
    "pauper",
    provider,
  );
  assert.equal(good.valid, true);
  assert.equal(good.cards[0].name, "Lightning Bolt");
  const bad = validateDeck(
    "4 Thrum of the Vestige\n4 Lightning Bolt\n52 Mountain",
    "pauper",
    provider,
  );
  assert.equal(bad.valid, false);
  assert.ok(bad.errors.some((e) => /copies|copy|four|4/i.test(e.message)));
});
