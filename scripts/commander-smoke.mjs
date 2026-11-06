// Live API acceptance: cached rules facts and role-specific validation, no fake games.
import assert from "node:assert/strict";
const base = process.env.API_URL || "http://localhost:3000";
const cases = [
  ["commander", "99 Forest\nCommander\n1 Emmara, Soul of the Accord", true],
  [
    "cedh",
    "98 Forest\nCommander\n1 Tymna the Weaver\n1 Thrasios, Triton Hero",
    true,
  ],
  [
    "commander",
    "98 Island\nCommander\n1 Bjorna, Nightfall Alchemist\n1 Wernog, Rider's Chaplain",
    true,
  ],
  ["commander", "99 Forest\nCommander\n1 Grist, the Hunger Tide", true],
  ["commander", "99 Island\nCommander\n1 Shorikai, Genesis Engine", true],
  [
    "duel",
    "98 Mountain\n1 Rograkh, Son of Rohgahh\nCommander\n1 Zurgo Bellstriker",
    true,
  ],
  [
    "duel",
    "99 Mountain\nCommander\n1 Rograkh, Son of Rohgahh",
    false,
    "BANNED_AS_COMMANDER",
  ],
  [
    "commander",
    "98 Forest\n1 Island\nCommander\n1 Emmara, Soul of the Accord",
    false,
    "COLOR_IDENTITY",
  ],
  [
    "commander",
    "99 Forest\nCommander\n1 Muldrotha, the Gravetide\nCompanion\n1 Gyruda, Doom of Depths",
    true,
  ],
  ["commander", "99 Island\nCommander\n1 Lutri, the Spellchaser", true],
  [
    "commander",
    "99 Island\nCommander\n1 Niv-Mizzet, Parun\nCompanion\n1 Lutri, the Spellchaser",
    false,
    "BANNED_AS_COMPANION",
  ],
  [
    "pioneer",
    "80 Island\nCompanion\n1 Yorion, Sky Nomad\nSideboard\n1 Yorion, Sky Nomad\n14 Island",
    true,
  ],
];
for (const [format, decklist, valid, errorCode] of cases) {
  const response = await fetch(base + "/api/v1/decks/validate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ format, decklist }),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(
    result.valid,
    valid,
    JSON.stringify({ format, decklist, errors: result.errors }),
  );
  if (errorCode) assert.ok(result.errors.some((e) => e.code === errorCode));
  assert.ok(
    result.cardData.engineFacts.sha256,
    "Engine rules provenance must be attached",
  );
}
console.log(
  JSON.stringify({
    event: "commander_validation_smoke_passed",
    cases: cases.length,
  }),
);
