import test from "node:test";
import assert from "node:assert/strict";
import { canonicalizeForgeDeck } from "../src/engine.js";
const facts = {
  "Tithing Blade": { name: "Tithing Blade" },
  "Sagu Wildling": { name: "Sagu Wildling" },
  "Fire // Ice": { name: "Fire // Ice" },
  "Delver of Secrets": { name: "Delver of Secrets" },
  "Valakut Awakening": { name: "Valakut Awakening" },
};
test("Forge input uses native rules names for transform and adventure cards without splitting actual split cards", () => {
  const deck =
    "[metadata]\nName=4 Tithing Blade // Consuming Sepulcher\n[Main]\n4 Tithing Blade // Consuming Sepulcher\n2 Sagu Wildling // Roost Seek\n1 Fire // Ice\n[Sideboard]\n3 Valakut Awakening // Valakut Stoneforge\n[Commander]\n1 Delver of Secrets // Insectile Aberration\n";
  const result = canonicalizeForgeDeck(deck, facts);
  assert.equal(
    result,
    "[metadata]\nName=4 Tithing Blade // Consuming Sepulcher\n[Main]\n4 Tithing Blade\n2 Sagu Wildling\n1 Fire // Ice\n[Sideboard]\n3 Valakut Awakening\n[Commander]\n1 Delver of Secrets\n",
  );
  assert.equal(canonicalizeForgeDeck(result, facts), result);
});
test("unrecognized names remain visible to the native loader and quantities are never dropped", () => {
  assert.equal(
    canonicalizeForgeDeck("[Main]\n3 Unknown // Other\n2 Fire // Ice", facts),
    "[Main]\n3 Unknown // Other\n2 Fire // Ice",
  );
});

test("archived jobs with alternate printed names use the cached canonical rules identity", () => {
  assert.equal(
    canonicalizeForgeDeck(
      "[Main]\n4 Thrum of the Vestige",
      { "Lightning Bolt": { name: "Lightning Bolt" } },
      { "Thrum of the Vestige": "Lightning Bolt" },
    ),
    "[Main]\n4 Lightning Bolt",
  );
});
