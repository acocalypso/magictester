import { test } from "node:test";
import assert from "node:assert/strict";
import { CachedCardDataProvider, validateDeck } from "../src/domain.js";
import { serializeDeck } from "../src/engine.js";

const cache = process.env.DATA_DIR;
const enabled = { skip: !cache };
const load = () => new CachedCardDataProvider().load();
const deck = (commander: string, main = "99 Forest", companion = "") =>
  `${main}\nCommander\n${commander}${companion ? `\nCompanion\n1 ${companion}` : ""}`;
const codes = (r: ReturnType<typeof validateDeck>) =>
  r.errors.map((e) => e.code);
function good(r: ReturnType<typeof validateDeck>) {
  assert.equal(r.valid, true, JSON.stringify(r.errors));
}

test(
  "real commander eligibility includes Vehicles, Spacecraft and outside-battlefield creature abilities",
  enabled,
  async () => {
    const p = await load();
    for (const [name, land] of [
      ["Grist, the Hunger Tide", "Forest"],
      ["Shorikai, Genesis Engine", "Island"],
      ["Emmara, Soul of the Accord", "Forest"],
      ["Faceless One", "Forest"],
    ])
      good(validateDeck(deck(`1 ${name}`, `99 ${land}`), "commander", p));
    for (const name of [
      "Llanowar Elves",
      "Jace, the Mind Sculptor",
      "Agent of the Iron Throne",
    ])
      assert.ok(
        codes(validateDeck(deck(`1 ${name}`), "commander", p)).includes(
          "INELIGIBLE_COMMANDER",
        ),
        name,
      );
    assert.ok(
      codes(
        validateDeck(
          deck("1 Emmara, Soul of the Accord", "98 Forest"),
          "commander",
          p,
        ),
      ).includes("COMMANDER_DECK_SIZE"),
    );
    assert.ok(
      codes(validateDeck("100 Forest", "commander", p)).includes(
        "COMMANDER_COUNT",
      ),
    );
  },
);

test(
  "partner, named partner, Background, Doctor and grouped partners use Forge's actual pairing matrix",
  enabled,
  async () => {
    const p = await load();
    const pairs = [
      ["Tymna the Weaver", "Thrasios, Triton Hero", "Forest"],
      ["Bjorna, Nightfall Alchemist", "Wernog, Rider's Chaplain", "Island"],
      ["Wilson, Refined Grizzly", "Agent of the Iron Throne", "Forest"],
      ["The Tenth Doctor", "Rose Tyler", "Island"],
      ["Pir, Imaginative Rascal", "Toothy, Imaginary Friend", "Forest"],
    ];
    for (const [a, b, land] of pairs)
      good(validateDeck(deck(`1 ${a}\n1 ${b}`, `98 ${land}`), "commander", p));
    for (const [a, b] of [
      ["Tymna the Weaver", "Wernog, Rider's Chaplain"],
      ["Emmara, Soul of the Accord", "Agent of the Iron Throne"],
      ["Pir, Imaginative Rascal", "Thrasios, Triton Hero"],
    ])
      assert.ok(
        codes(
          validateDeck(deck(`1 ${a}\n1 ${b}`, "98 Forest"), "commander", p),
        ).includes("INCOMPATIBLE_COMMANDERS"),
        `${a} + ${b}`,
      );
  },
);

test(
  "identity, exact size, singleton exceptions, wild colors and sideboard bounds are enforced",
  enabled,
  async () => {
    const p = await load();
    assert.ok(
      codes(
        validateDeck(
          deck("1 Emmara, Soul of the Accord", "98 Forest\n1 Island"),
          "commander",
          p,
        ),
      ).includes("COLOR_IDENTITY"),
    );
    assert.ok(
      codes(
        validateDeck(
          deck("1 Emmara, Soul of the Accord", "97 Forest\n2 Llanowar Elves"),
          "commander",
          p,
        ),
      ).includes("COPY_LIMIT"),
    );
    good(
      validateDeck(
        deck("1 Marrow-Gnawer", "60 Swamp\n39 Relentless Rats"),
        "commander",
        p,
      ),
    );
    good(
      validateDeck(
        deck("1 The Prismatic Piper", "98 Forest\n1 Llanowar Elves"),
        "commander",
        p,
      ),
    );
    assert.ok(
      codes(
        validateDeck(
          deck("1 The Prismatic Piper", "98 Forest\n1 Island"),
          "commander",
          p,
        ),
      ).includes("COLOR_IDENTITY"),
    );
    assert.ok(
      codes(
        validateDeck(
          deck("1 Emmara, Soul of the Accord") + "\nSideboard\n1 Forest",
          "commander",
          p,
        ),
      ).includes("SIDEBOARD_TOO_LARGE"),
    );
    assert.ok(
      codes(
        validateDeck(deck("1 Emmara, Soul of the Accord"), "commander", {
          ...p,
          find: p.find.bind(p),
          supports: () => true,
          engineFacts: () => undefined,
        }),
      ).includes("COMMANDER_FACTS_UNAVAILABLE"),
    );
  },
);

test(
  "Duel commander-only restrictions differ from library bans; cEDH shares commander legality",
  enabled,
  async () => {
    const p = await load();
    assert.equal(
      p.find("Rograkh, Son of Rohgahh")!.legalities.duel,
      "restricted",
    );
    assert.ok(
      codes(
        validateDeck(
          deck("1 Rograkh, Son of Rohgahh", "99 Mountain"),
          "duel",
          p,
        ),
      ).includes("BANNED_AS_COMMANDER"),
    );
    good(
      validateDeck(
        deck("1 Zurgo Bellstriker", "98 Mountain\n1 Rograkh, Son of Rohgahh"),
        "duel",
        p,
      ),
    );
    assert.ok(
      codes(
        validateDeck(
          deck("1 Zurgo Bellstriker", "98 Mountain\n1 Sol Ring"),
          "duel",
          p,
        ),
      ).includes("CARD_NOT_LEGAL"),
    );
    good(
      validateDeck(
        deck("1 Lutri, the Spellchaser", "99 Island"),
        "commander",
        p,
      ),
    );
    good(validateDeck(deck("1 Emmara, Soul of the Accord"), "cedh", p));
  },
);

test(
  "all ten companion requirements include commanders; Lutri is banned only in the companion role",
  enabled,
  async () => {
    const p = await load();
    const valid = [
      ["1 Muldrotha, the Gravetide", "99 Forest", "Gyruda, Doom of Depths"],
      ["1 Najeela, the Blade-Blossom", "99 Forest", "Jegantha, the Wellspring"],
      ["1 Kaheera, the Orphanguard", "99 Forest", "Kaheera, the Orphanguard"],
      ["1 Animar, Soul of Elements", "99 Forest", "Keruga, the Macrosage"],
      [
        "1 Tymna the Weaver\n1 Thrasios, Triton Hero",
        "98 Forest",
        "Umori, the Collector",
      ],
      ["1 Kenrith, the Returned King", "99 Mountain", "Zirda, the Dawnwaker"],
      [
        "1 Rograkh, Son of Rohgahh\n1 Tymna the Weaver",
        "98 Mountain",
        "Obosh, the Preypiercer",
      ],
      [
        "1 Yoshimaru, Ever Faithful\n1 Tymna the Weaver",
        "98 Plains",
        "Lurrus of the Dream-Den",
      ],
    ];
    // A companion cannot be a second copy of a commander, and commander mana values
    // are part of the restriction. These two deliberately similar configurations fail.
    const mustFail = new Set([
      "Kaheera, the Orphanguard",
      "Obosh, the Preypiercer",
      "Lurrus of the Dream-Den",
    ]);
    for (const [cmd, main, companion] of valid) {
      const r = validateDeck(deck(cmd, main, companion), "commander", p);
      if (mustFail.has(companion)) assert.equal(r.valid, false, companion);
      else good(r);
    }
    good(
      validateDeck(
        deck(
          "1 Arahbo, Roar of the World",
          "99 Forest",
          "Kaheera, the Orphanguard",
        ),
        "commander",
        p,
      ),
    );
    good(
      validateDeck(
        deck("1 Ayli, Eternal Pilgrim", "99 Plains", "Lurrus of the Dream-Den"),
        "commander",
        p,
      ),
    );
    good(
      validateDeck(
        deck(
          "1 Vial Smasher the Fierce",
          "99 Mountain",
          "Obosh, the Preypiercer",
        ),
        "commander",
        p,
      ),
    );
    const invalid = [
      ["1 Omnath, Locus of Mana", "99 Forest", "Gyruda, Doom of Depths"],
      ["1 Sigarda, Host of Herons", "99 Forest", "Jegantha, the Wellspring"],
      ["1 Grist, the Hunger Tide", "99 Forest", "Kaheera, the Orphanguard"],
      ["1 Thrasios, Triton Hero", "99 Forest", "Keruga, the Macrosage"],
      ["1 Tymna the Weaver", "99 Plains", "Lurrus of the Dream-Den"],
      ["1 Shorikai, Genesis Engine", "99 Island", "Yorion, Sky Nomad"],
      [
        "1 Akiri, Line-Slinger",
        "98 Mountain\n1 Ornithopter",
        "Zirda, the Dawnwaker",
      ],
    ];
    for (const [cmd, main, companion] of invalid)
      assert.ok(
        codes(
          validateDeck(deck(cmd, main, companion), "commander", p),
        ).includes("COMPANION_REQUIREMENT"),
        companion,
      );
    assert.ok(
      codes(
        validateDeck(
          deck("1 Niv-Mizzet, Parun", "99 Island", "Lutri, the Spellchaser"),
          "commander",
          p,
        ),
      ).includes("BANNED_AS_COMPANION"),
    );
  },
);

test(
  "Arena companion designation is one physical sideboard card and Forge receives Sideboard",
  enabled,
  async () => {
    const p = await load();
    const text =
      "80 Island\nCompanion\n1 Yorion, Sky Nomad\nSideboard\n1 Yorion, Sky Nomad\n14 Island";
    const result = validateDeck(text, "pioneer", p);
    good(result);
    assert.equal(result.counts.sideboard, 15);
    const native = serializeDeck(result.cards, "test");
    assert.equal(native.includes("[Companion]"), false);
    assert.equal((native.match(/1 Yorion, Sky Nomad/g) || []).length, 1);
    assert.ok(
      codes(validateDeck(text + "\n1 Island", "pioneer", p)).includes(
        "SIDEBOARD_TOO_LARGE",
      ),
    );
    const commanderDeck =
      deck(
        "1 Kenrith, the Returned King",
        "99 Mountain",
        "Zirda, the Dawnwaker",
      ) + "\nSideboard\n1 Zirda, the Dawnwaker";
    good(validateDeck(commanderDeck, "commander", p));
  },
);

test("Commander rules and companion deduplication do not depend on external metadata downloads", async () => {
  const normalize = (s: string) => s.toLowerCase();
  const card = (
    name: string,
    typeLine: string,
    manaValue = 0,
    oracleText = "",
  ) => ({
    name,
    typeLine,
    manaValue,
    manaCost: "",
    oracleText,
    colorIdentity: ["G"],
    legalities: { commander: "legal", duel: "legal", pioneer: "legal" },
    faces: [],
    keywords: [] as string[],
    scryfallId: name,
  });
  const metadata = [
    card("Forest", "Basic Land — Forest"),
    card("Leader", "Legendary Creature — Cat", 2),
    {
      ...card(
        "Gyruda, Doom of Depths",
        "Legendary Creature",
        6,
        "Companion — Each card has even mana value.",
      ),
      keywords: ["Companion"],
    },
  ];
  const p = {
    find: (n: string) =>
      metadata.find((c) => normalize(c.name) === normalize(n)),
    supports: () => true,
    provenance: { source: "test" },
    engineFacts: (n: string) => ({
      name: n,
      canBeCommander: n === "Leader",
      soloCommander: true,
      background: false,
      startingCreature: n === "Leader",
      wildColor: false,
      hasActivatedAbility: true,
      keywords: [],
      allowedPartners: [],
    }),
  };
  good(
    validateDeck(
      deck("1 Leader", "99 Forest", "Gyruda, Doom of Depths"),
      "commander",
      p,
    ),
  );
  good(
    validateDeck(
      deck("1 Leader", "99 Forest", "Gyruda, Doom of Depths") +
        "\nSideboard\n1 Gyruda, Doom of Depths",
      "commander",
      p,
    ),
  );
  assert.ok(
    codes(validateDeck(deck("1 Leader", "98 Forest"), "commander", p)).includes(
      "COMMANDER_DECK_SIZE",
    ),
  );
  metadata[1].manaValue = 3;
  assert.ok(
    codes(
      validateDeck(
        deck("1 Leader", "99 Forest", "Gyruda, Doom of Depths"),
        "commander",
        p,
      ),
    ).includes("COMPANION_REQUIREMENT"),
  );
});

test(
  "Kaheera uses all creature types outside the battlefield; Zirda recognizes Aura swap",
  enabled,
  async () => {
    const p = await load();
    assert.equal(p.engineFacts("Mistform Ultimus")!.allCreatureTypes, true);
    good(
      validateDeck(
        deck(
          "1 Morophon, the Boundless",
          "98 Island\n1 Mistform Ultimus",
          "Kaheera, the Orphanguard",
        ),
        "commander",
        p,
      ),
    );
    assert.equal(p.engineFacts("Arcanum Wings")!.hasActivatedAbility, true);
    good(
      validateDeck(
        deck(
          "1 Kenrith, the Returned King",
          "98 Mountain\n1 Arcanum Wings",
          "Zirda, the Dawnwaker",
        ),
        "commander",
        p,
      ),
    );
  },
);
