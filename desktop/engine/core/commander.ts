import type { Card, CardDataProvider, ValidationError } from "./domain.js";

/** Role checks use the same rules parser and partner matrix as the pinned engine. */
export function validateCommanders(
  cards: Card[],
  format: string,
  provider: CardDataProvider,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const commanders = cards.filter((c) => c.section === "COMMANDER");
  const count = commanders.reduce((n, c) => n + c.quantity, 0);
  const size = cards
    .filter((c) => ["MAINBOARD", "COMMANDER"].includes(c.section))
    .reduce((n, c) => n + c.quantity, 0);
  if (size !== 100)
    errors.push({
      code: "COMMANDER_DECK_SIZE",
      message: `Commander decks contain exactly 100 cards including commanders; found ${size}.`,
    });
  if (count < 1 || count > 2 || commanders.some((c) => c.quantity !== 1))
    errors.push({
      code: "COMMANDER_COUNT",
      message: count === 0
        ? "No commanders were found. Add a Commander or Commanders section, followed by each commander on its own '1 Card name' line. Put the remaining cards under Deck."
        : "Designate one commander, or two different commanders with a compatible pairing ability, each listed once.",
    });
  const facts = commanders.map((c) => provider.engineFacts?.(c.name));
  for (const [i, c] of commanders.entries()) {
    if (!facts[i])
      errors.push({
        code: "COMMANDER_FACTS_UNAVAILABLE",
        card: c.name,
        message:
          "Commander eligibility could not be verified against the pinned Forge release.",
      });
    else if (
      !facts[i]!.canBeCommander ||
      (count === 1 && !facts[i]!.soloCommander)
    )
      errors.push({
        code: "INELIGIBLE_COMMANDER",
        card: c.name,
        message: `${c.name} is not eligible for this commander configuration.`,
      });
    if (
      format === "duel" &&
      provider.find(c.name)?.legalities.duel === "restricted"
    )
      errors.push({
        code: "BANNED_AS_COMMANDER",
        card: c.name,
        message: `${c.name} is banned as a commander in Duel Commander (it may be in the library).`,
      });
  }
  if (
    count === 2 &&
    commanders.length === 2 &&
    facts.every(Boolean) &&
    !facts[0]!.allowedPartners.includes(facts[1]!.name)
  )
    errors.push({
      code: "INCOMPATIBLE_COMMANDERS",
      message:
        "These commanders do not have compatible partner, Background or Doctor pairing abilities.",
    });
  // An absent or unrecognized commander gives no reliable identity to compare
  // against. Report the role/lookup problem instead of blaming every card.
  if (count < 1 || count > 2 || commanders.length !== count ||
      commanders.some((c) => c.quantity !== 1 || !provider.find(c.name)))
    return errors;
  const identity = new Set(
    commanders.flatMap((c) => provider.find(c.name)?.colorIdentity || []),
  );
  const extraColors = facts.filter((f) => f?.wildColor).length;
  // Piper and Faceless One each choose one color before the game begins. Store
  // the required union implicitly: a deck cannot require more colors than those choices.
  const required = new Set<string>();
  for (const c of cards.filter(
    (c) => !["MAYBEBOARD", "COMMANDER"].includes(c.section),
  )) {
    const meta = provider.find(c.name);
    if (!meta) continue;
    const colors = new Set(meta.colorIdentity);
    for (const [type, color] of Object.entries({
      Plains: "W",
      Island: "U",
      Swamp: "B",
      Mountain: "R",
      Forest: "G",
    }))
      if (
        /\bLand\b/.test(meta.typeLine) &&
        new RegExp(`\\b${type}\\b`).test(meta.typeLine)
      )
        colors.add(color);
    for (const color of colors) if (!identity.has(color)) required.add(color);
    if (!extraColors && [...colors].some((color) => !identity.has(color)))
      errors.push({
        code: "COLOR_IDENTITY",
        card: c.name,
        message: `${c.name} is outside the commanders' color identity.`,
      });
  }
  if (extraColors && required.size > extraColors)
    errors.push({
      code: "COLOR_IDENTITY",
      message: `The deck requires ${required.size} additional colors, but its commanders can choose only ${extraColors}.`,
    });
  return errors;
}
