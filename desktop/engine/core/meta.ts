import { validationFormatIds } from "./formats.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { parse } from "csv-parse/sync";
import {
  validateDeck,
  type CardDataProvider,
  type Opponent,
} from "./domain.js";
export const snapshotInput = z.object({
  name: z.string().trim().min(1).max(150),
  format: z.enum(validationFormatIds()),
  source: z.string().trim().min(1).max(500),
  sourceDate: z.iso.date().nullable().optional(),
  selectionMethod: z.enum([
    "equal_archetype",
    "top_individual_lists",
    "custom_pool",
  ]),
  decks: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(150),
        archetype: z.string().trim().min(1).max(100),
        strategy: z
          .enum(["AGGRO", "MIDRANGE", "CONTROL", "COMBO", "UNKNOWN"])
          .default("UNKNOWN"),
        decklist: z.string().min(1).max(32768),
        sourceUrl: z.url().nullable().optional(),
        metaShare: z.number().min(0).max(1).nullable().optional(),
      }),
    )
    .min(1)
    .max(50),
});
export interface MetaDeckProvider {
  normalize(
    input: unknown,
    cards: CardDataProvider,
  ): ReturnType<typeof normalizeSnapshot>;
}
export function normalizeSnapshot(input: unknown, cards: CardDataProvider) {
  const data = snapshotInput.parse(input);
  const decks: Opponent[] = data.decks.map((deck, i) => {
    const result = validateDeck(deck.decklist, data.format, cards);
    if (!result.valid)
      throw Object.assign(
        new Error(`Invalid opponent ${i + 1}: ${deck.name}`),
        { details: result.errors },
      );
    return {
      ...deck,
      id: randomUUID(),
      cards: result.cards,
      sourceUrl: deck.sourceUrl || null,
      metaShare: deck.metaShare ?? null,
    };
  });
  if (
    data.selectionMethod === "equal_archetype" &&
    new Set(decks.map((d) => d.archetype.toLowerCase())).size !== decks.length
  )
    throw new Error(
      "Equal archetype mode requires one representative deck per archetype.",
    );
  return { ...data, decks };
}
export class JsonImportProvider implements MetaDeckProvider {
  normalize(input: unknown, cards: CardDataProvider) {
    return normalizeSnapshot(input, cards);
  }
}
export class CsvImportProvider implements MetaDeckProvider {
  normalize(input: unknown, cards: CardDataProvider) {
    const data = z
      .object({
        name: z.string(),
        source: z.string(),
        format: z.enum(validationFormatIds()),
        csv: z.string().max(1800000),
      })
      .parse(input);
    const rows = parse(data.csv, {
      columns: true,
      skip_empty_lines: true,
      bom: true,
    });
    return normalizeSnapshot(
      { ...data, selectionMethod: "custom_pool", decks: rows },
      cards,
    );
  }
}
