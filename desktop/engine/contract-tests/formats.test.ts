import { test } from "node:test";
import assert from "node:assert/strict";
import { FORMATS, enabledFormatIds } from "../src/formats.js";
import {
  CachedCardDataProvider,
  validateDeck,
  type CardDataProvider,
  type CardMetadata,
} from "../src/domain.js";
import { referencePool } from "../src/reference-pools.js";
import { normalizeSnapshot } from "../src/meta.js";
const constructedIds = () =>
  FORMATS.filter((f) => f.enabled && !f.commander).map((f) => f.id);
const legalities = Object.fromEntries(
  enabledFormatIds().map((format) => [format, "legal"]),
);
const forest: CardMetadata = {
  name: "Forest",
  typeLine: "Basic Land — Forest",
  oracleText: "",
  colorIdentity: ["G"],
  legalities,
  faces: [],
  scryfallId: "forest",
};
const lotus: CardMetadata = {
  ...forest,
  name: "Black Lotus",
  typeLine: "Artifact",
  legalities: { ...legalities, vintage: "restricted", modern: "not_legal" },
};
const provider: CardDataProvider = {
  find: (name) =>
    name.toLowerCase() === "forest"
      ? forest
      : name.toLowerCase() === "black lotus"
        ? lotus
        : undefined,
  supports: () => true,
  provenance: { source: "test" },
};
test("the six constructed formats validate legal decks with centralized deck and sideboard bounds", () => {
  for (const id of constructedIds()) {
    assert.equal(validateDeck("60 Forest", id, provider).valid, true, id);
    assert.ok(
      validateDeck("59 Forest", id, provider).errors.some(
        (e) => e.code === "DECK_TOO_SMALL",
      ),
    );
    assert.ok(
      validateDeck("60 Forest\nSideboard\n16 Forest", id, provider).errors.some(
        (e) => e.code === "SIDEBOARD_TOO_LARGE",
      ),
    );
  }
  assert.equal(FORMATS.filter((f) => f.enabled && !f.commander).length, 6);
});
test("Vintage restricted status is legal for one copy and counts the sideboard", () => {
  assert.equal(
    validateDeck("59 Forest\n1 Black Lotus", "vintage", provider).valid,
    true,
  );
  assert.ok(
    validateDeck("58 Forest\n2 Black Lotus", "vintage", provider).errors.some(
      (e) => e.code === "RESTRICTED_CARD_LIMIT",
    ),
  );
  assert.ok(
    validateDeck(
      "59 Forest\n1 Black Lotus\nSideboard\n1 Black Lotus",
      "vintage",
      provider,
    ).errors.some((e) => e.code === "RESTRICTED_CARD_LIMIT"),
  );
  assert.ok(
    validateDeck("59 Forest\n1 Black Lotus", "modern", provider).errors.some(
      (e) => e.code === "CARD_NOT_LEGAL",
    ),
  );
});
test("snapshots accept other constructed formats and preserve their format", () => {
  const snapshot = normalizeSnapshot(
    {
      name: "Modern test",
      format: "modern",
      source: "test",
      selectionMethod: "custom_pool",
      decks: [
        { name: "Forest test", archetype: "test", decklist: "60 Forest" },
      ],
    },
    provider,
  );
  assert.equal(snapshot.format, "modern");
  assert.equal(snapshot.decks[0].cards[0].quantity, 60);
});
test(
  "all constructed reference pools validate against the real cached card data",
  { skip: !process.env.DATA_DIR },
  async () => {
    const cards = await new CachedCardDataProvider().load();
    for (const format of constructedIds()) {
      const snapshot = normalizeSnapshot(referencePool(format, cards), cards);
      assert.equal(snapshot.decks.length, 2);
      for (const deck of snapshot.decks) {
        const validation = validateDeck(deck.decklist, format, cards);
        assert.equal(
          validation.valid,
          true,
          JSON.stringify({ format, errors: validation.errors }),
        );
        assert.equal(validation.counts.mainboard, 60);
        assert.ok(
          deck.cards.length > 1,
          "Reference decks must include supported spells",
        );
      }
    }
  },
);
