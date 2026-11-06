import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { FORMATS } from "./formats.js";
export { FORMATS } from "./formats.js";
export const SECTIONS = [
  "MAINBOARD",
  "SIDEBOARD",
  "COMMANDER",
  "COMPANION",
  "MAYBEBOARD",
] as const;
export type Section = (typeof SECTIONS)[number];
export interface Card {
  name: string;
  quantity: number;
  section: Section;
  normalizedName: string;
}
export interface ValidationError {
  code: string;
  message: string;
  line?: number;
  card?: string;
}
export const normalize = (s: string) =>
  s
    .normalize("NFKC")
    .replace(/[’]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
export function parseDeck(text: string): {
  cards: Card[];
  errors: ValidationError[];
} {
  const cards: Card[] = [];
  const errors: ValidationError[] = [];
  let section: Section = "MAINBOARD";
  const aliases: Record<string, Section> = {
    deck: "MAINBOARD",
    main: "MAINBOARD",
    mainboard: "MAINBOARD",
    sideboard: "SIDEBOARD",
    commander: "COMMANDER",
    companion: "COMPANION",
    maybeboard: "MAYBEBOARD",
  };
  text.split(/\r?\n/).forEach((raw, i) => {
    let line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) return;
    const title = normalize(line.replace(/^\[|\]$|:$/g, ""));
    if (aliases[title]) {
      section = aliases[title];
      return;
    }
    let lineSection = section;
    if (/^SB:\s*/i.test(line)) {
      line = line.replace(/^SB:\s*/i, "");
      lineSection = "SIDEBOARD";
    }
    const m = line.match(/^(\d+)x?\s+(.+?)\s*$/i);
    if (!m) {
      errors.push({
        code: "MALFORMED_LINE",
        line: i + 1,
        message: "Expected a quantity followed by a card name.",
      });
      return;
    }
    const quantity = Number(m[1]);
    const name = m[2]
      .replace(/\s+\([A-Za-z0-9]+\)\s+\S+(?:\s+\*F\*)?$/, "")
      .trim();
    if (
      !Number.isSafeInteger(quantity) ||
      quantity < 1 ||
      quantity > 1000 ||
      /[\r\n[\]|]/.test(name)
    ) {
      errors.push({
        code: "INVALID_CARD",
        line: i + 1,
        message: "Invalid quantity or card name.",
      });
      return;
    }
    const normalizedName = normalize(name);
    const existing = cards.find(
      (c) => c.normalizedName === normalizedName && c.section === lineSection,
    );
    if (existing) existing.quantity += quantity;
    else cards.push({ name, quantity, section: lineSection, normalizedName });
  });
  return { cards, errors };
}
export interface CardMetadata {
  name: string;
  legalities: Record<string, string>;
  typeLine: string;
  colorIdentity: string[];
  oracleText: string;
  faces: { name: string; typeLine: string; oracleText: string }[];
  scryfallId: string;
}
export interface CardDataProvider {
  find(name: string): CardMetadata | undefined;
  supports(name: string): boolean;
  provenance: Record<string, unknown>;
}
export class CachedCardDataProvider implements CardDataProvider {
  private cards = new Map<string, CardMetadata>();
  private supported = new Set<string>();
  provenance: Record<string, unknown> = {};
  async load(dir = process.env.DATA_DIR || "/data") {
    const raw = await readFile(dir + "/cards.json", "utf8");
    const data = JSON.parse(raw);
    this.provenance = {
      source: data.source,
      sourceUpdatedAt: data.sourceUpdatedAt,
      fetchedAt: data.fetchedAt,
      sha256: createHash("sha256").update(raw).digest("hex"),
    };
    for (const card of data.cards as CardMetadata[])
      if (!/^(Token|Emblem)\b/.test(card.typeLine))
        this.cards.set(normalize(card.name), card);
    for (const card of data.cards as CardMetadata[])
      for (const face of card.faces || [])
        if (!this.cards.has(normalize(face.name)))
          this.cards.set(normalize(face.name), card);
    this.supported = new Set(
      (
        JSON.parse(
          await readFile(dir + "/forge-cards.json", "utf8"),
        ) as string[]
      ).map(normalize),
    );
    return this;
  }
  find(name: string) {
    return this.cards.get(normalize(name));
  }
  supports(name: string) {
    return (
      this.supported.has(normalize(name)) ||
      name.split(" // ").every((n) => this.supported.has(normalize(n)))
    );
  }
}
export function validateDeck(
  text: string,
  format: string,
  provider: CardDataProvider,
) {
  const { cards, errors } = parseDeck(text);
  const definition = FORMATS.find((f) => f.id === format);
  if (!definition?.validationSupported)
    errors.push({
      code: "FORMAT_UNAVAILABLE",
      message: `Deck validation is not available for ${format}.`,
    });
  for (const card of cards) {
    const meta = provider.find(card.name);
    if (!meta) {
      errors.push({
        code: "UNKNOWN_CARD",
        card: card.name,
        message: `Unknown card: ${card.name}`,
      });
      continue;
    }
    card.name = meta.name;
    card.normalizedName = normalize(meta.name);
    if (card.section === "MAYBEBOARD") continue;
    if (
      !["legal", "restricted"].includes(
        meta.legalities[definition?.legalityKey || format],
      )
    )
      errors.push({
        code: "CARD_NOT_LEGAL",
        card: card.name,
        message: `${card.name} is ${meta.legalities[definition?.legalityKey || format] || "not legal"} in ${format}.`,
      });
    if (!provider.supports(card.name))
      errors.push({
        code: "ENGINE_UNSUPPORTED_CARD",
        card: card.name,
        message: "Card script is absent from the pinned Forge release.",
      });
    if (["COMMANDER", "COMPANION"].includes(card.section))
      errors.push({
        code: "SECTION_UNAVAILABLE",
        card: card.name,
        message:
          "Commander and companion configurations are not yet enabled for this format.",
      });
  }
  const main = cards
    .filter((c) => c.section === "MAINBOARD")
    .reduce((a, c) => a + c.quantity, 0);
  const side = cards
    .filter((c) => c.section === "SIDEBOARD")
    .reduce((a, c) => a + c.quantity, 0);
  if (main < (definition?.min ?? 60))
    errors.push({
      code: "DECK_TOO_SMALL",
      message: `Mainboard needs at least ${definition?.min ?? 60} cards; found ${main}.`,
    });
  if (main > 250)
    errors.push({
      code: "DECK_TOO_LARGE",
      message: "This service limits mainboards to 250 cards.",
    });
  if (side > (definition?.sideboard ?? 15))
    errors.push({
      code: "SIDEBOARD_TOO_LARGE",
      message: `Sideboard may contain at most ${definition?.sideboard ?? 15} cards; found ${side}.`,
    });
  const totals = new Map<string, number>();
  for (const c of cards.filter((c) => c.section !== "MAYBEBOARD"))
    totals.set(
      c.normalizedName,
      (totals.get(c.normalizedName) || 0) + c.quantity,
    );
  for (const [name, count] of totals) {
    const meta = provider.find(name);
    if (!meta || /\bBasic\b.*\bLand\b/.test(meta.typeLine)) continue;
    const unlimited = /A deck can have any number of cards named/i.test(
      meta.oracleText,
    );
    const written = meta.oracleText.match(
      /A deck can have up to (\w+|\d+) cards named/i,
    )?.[1];
    const numberWords: Record<string, number> = {
      one: 1,
      two: 2,
      three: 3,
      four: 4,
      five: 5,
      six: 6,
      seven: 7,
      eight: 8,
      nine: 9,
      ten: 10,
    };
    const specialLimit = written
      ? (numberWords[written.toLowerCase()] ?? Number(written))
      : null;
    const restricted =
      meta.legalities[definition?.legalityKey || format] === "restricted";
    const limit = restricted
      ? 1
      : unlimited
        ? Infinity
        : specialLimit && Number.isFinite(specialLimit)
          ? specialLimit
          : (definition?.copyLimit ?? 4);
    if (count > limit)
      errors.push({
        code: restricted ? "RESTRICTED_CARD_LIMIT" : "COPY_LIMIT",
        card: meta.name,
        message: restricted
          ? `${meta.name} is restricted to one copy across mainboard and sideboard in ${definition?.name || format}.`
          : `Too many copies of ${meta.name} across mainboard and sideboard (maximum ${limit}).`,
      });
  }
  return {
    valid: errors.length === 0,
    cards,
    errors,
    counts: { mainboard: main, sideboard: side },
    cardData: provider.provenance,
  };
}
export interface Opponent {
  id: string;
  name: string;
  archetype: string;
  strategy: "AGGRO" | "MIDRANGE" | "CONTROL" | "COMBO" | "UNKNOWN";
  decklist: string;
  cards: Card[];
  sourceUrl: string | null;
  metaShare: number | null;
}
export function planGames(games: number, opponents: Opponent[], seed: number) {
  if (!Number.isInteger(games) || games < 1 || opponents.length < 1)
    throw new Error("Invalid game plan");
  return opponents
    .map((opponent, i) => ({
      opponent,
      games:
        Math.floor(games / opponents.length) +
        (i < games % opponents.length ? 1 : 0),
      seed: (seed + i * 100003) % 2147483647,
    }))
    .filter((p) => p.games > 0);
}
