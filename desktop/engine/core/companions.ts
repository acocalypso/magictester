import type {
  Card,
  CardDataProvider,
  CardMetadata,
  ValidationError,
} from "./domain.js";

const TYPES = [
  "Artifact",
  "Battle",
  "Creature",
  "Enchantment",
  "Instant",
  "Land",
  "Planeswalker",
  "Sorcery",
  "Kindred",
];
export function validateCompanion(
  cards: Card[],
  commander: boolean,
  provider: CardDataProvider,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const companions = cards.filter((c) => c.section === "COMPANION");
  if (!companions.length) return errors;
  if (companions.length !== 1 || companions[0].quantity !== 1)
    return [
      {
        code: "COMPANION_COUNT",
        message: "Designate exactly one companion card.",
      },
    ];
  const companion = companions[0];
  const meta = provider.find(companion.name);
  if (!meta) return errors;
  const fail = (message: string) =>
    errors.push({
      code: "COMPANION_REQUIREMENT",
      card: companion.name,
      message,
    });
  if (
    !(meta.keywords || []).includes("Companion") &&
    !/Companion —/.test(meta.oracleText)
  ) {
    fail("This card does not have the companion ability.");
    return errors;
  }
  if (commander && companion.name === "Lutri, the Spellchaser") {
    errors.push({
      code: "BANNED_AS_COMPANION",
      card: companion.name,
      message:
        "Lutri is banned as a companion in Commander, cEDH and Duel Commander.",
    });
    return errors;
  }
  const deck = cards.filter((c) =>
    ["MAINBOARD", "COMMANDER"].includes(c.section),
  );
  const characteristic = (m: CardMetadata) =>
    m.faces.length &&
    ["modal_dfc", "transform", "adventure", "flip"].includes(m.layout || "")
      ? { ...m, ...m.faces[0], manaValue: m.manaValue }
      : m;
  const entries = deck
    .map((c) => ({ card: c, meta: provider.find(c.name) }))
    .filter((e): e is { card: Card; meta: CardMetadata } => !!e.meta)
    .map((e) => ({ ...e, meta: characteristic(e.meta) }));
  const types = (m: CardMetadata) =>
    new Set(
      TYPES.filter(
        (t) =>
          new RegExp(`\\b${t}\\b`).test(m.typeLine) ||
          (t === "Creature" &&
            provider.engineFacts?.(m.name)?.startingCreature),
      ),
    );
  const permanent = (m: CardMetadata) =>
    [...types(m)].some((t) =>
      [
        "Artifact",
        "Battle",
        "Creature",
        "Enchantment",
        "Land",
        "Planeswalker",
      ].includes(t),
    );
  const every = (predicate: (m: CardMetadata) => boolean) =>
    entries.every((e) => predicate(e.meta));
  const knownMana = () => every((m) => Number.isFinite(m.manaValue));
  let valid: boolean;
  switch (companion.name) {
    case "Gyruda, Doom of Depths":
      valid = knownMana() && every((m) => m.manaValue! % 2 === 0);
      break;
    case "Jegantha, the Wellspring":
      valid = every((m) => {
        if (m.manaCost === undefined) return false;
        const symbols = m.manaCost.match(/\{[^}]+\}/g) || [];
        return new Set(symbols).size === symbols.length;
      });
      break;
    case "Kaheera, the Orphanguard":
      valid = every(
        (m) =>
          !types(m).has("Creature") ||
          (m.keywords || []).includes("Changeling") ||
          provider.engineFacts?.(m.name)?.allCreatureTypes === true ||
          /\b(Cat|Elemental|Nightmare|Dinosaur|Beast)\b/.test(m.typeLine),
      );
      break;
    case "Keruga, the Macrosage":
      valid =
        knownMana() && every((m) => types(m).has("Land") || m.manaValue! >= 3);
      break;
    case "Lurrus of the Dream-Den":
      valid = knownMana() && every((m) => !permanent(m) || m.manaValue! <= 2);
      break;
    case "Lutri, the Spellchaser": {
      const nonlands = entries.filter((e) => !types(e.meta).has("Land"));
      valid =
        nonlands.every((e) => e.card.quantity === 1) &&
        new Set(nonlands.map((e) => e.meta.name)).size === nonlands.length;
      break;
    }
    case "Obosh, the Preypiercer":
      valid =
        knownMana() &&
        every((m) => types(m).has("Land") || m.manaValue! % 2 === 1);
      break;
    case "Umori, the Collector": {
      const nonlands = entries.filter((e) => !types(e.meta).has("Land"));
      valid = TYPES.some((t) => nonlands.every((e) => types(e.meta).has(t)));
      break;
    }
    case "Yorion, Sky Nomad":
      valid = !commander && deck.reduce((n, c) => n + c.quantity, 0) >= 80;
      break;
    case "Zirda, the Dawnwaker":
      valid = every(
        (m) =>
          !permanent(m) ||
          provider.engineFacts?.(m.name)?.hasActivatedAbility === true,
      );
      break;
    default:
      fail("The companion requirement is not supported by this validator.");
      return errors;
  }
  if (!valid)
    fail(
      `The starting deck, including commanders, does not satisfy ${companion.name}'s companion requirement (or required engine facts are unavailable).`,
    );
  return errors;
}
