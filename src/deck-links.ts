import { createHash } from "node:crypto";
import { z } from "zod";
import { config } from "./config.js";

export class DeckLinkError extends Error {
  constructor(
    message: string,
    public statusCode = 422,
  ) {
    super(message);
  }
}
export function deckLink(value: string) {
  let url: URL;
  try {
    url = new URL(
      /^https?:\/\//i.test(value.trim())
        ? value.trim()
        : "https://" + value.trim(),
    );
  } catch {
    throw new DeckLinkError(
      "Enter a valid Moxfield or Archidekt deck link.",
      400,
    );
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port)
    throw new DeckLinkError(
      "Deck links must use HTTPS without credentials or a custom port.",
      400,
    );
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "moxfield.com") {
    const id = /^\/decks\/([A-Za-z0-9_-]{22})(?:\/primer)?\/?$/.exec(
      url.pathname,
    )?.[1];
    if (id)
      return {
        provider: "moxfield" as const,
        id,
        url: "https://moxfield.com/decks/" + id,
        api: "https://api2.moxfield.com/v2/decks/all/" + id,
      };
  }
  if (host === "archidekt.com") {
    const id = /^\/decks\/([1-9]\d{0,11})(?:\/[^/]*)?\/?$/.exec(
      url.pathname,
    )?.[1];
    if (id)
      return {
        provider: "archidekt" as const,
        id,
        url: "https://archidekt.com/decks/" + id,
        api: "https://archidekt.com/api/decks/" + id + "/",
      };
  }
  throw new DeckLinkError(
    "Use a public or unlisted Moxfield or Archidekt deck link. Other sites can be imported by pasting their text export.",
    400,
  );
}
const name = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine(
    (s) =>
      !/[\r\n[\]|]/.test(s) &&
      Array.from(s).every(
        (c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127,
      ),
    "Invalid card name",
  );
const quantity = z.number().int().min(1).max(1000);
const entry = z.object({ quantity, card: z.object({ name }) });
const board = z.record(z.string(), entry);
const moxfield = z.object({
  name: z.string().trim().min(1).max(1000),
  format: z.string().optional(),
  mainboard: board,
  sideboard: board.default({}),
  commanders: board.default({}),
  companions: board.default({}),
  maybeboard: board.default({}),
  signatureSpells: board.default({}),
  attractions: board.default({}),
  stickers: board.default({}),
});
const archidekt = z.object({
  name: z.string().trim().min(1).max(1000),
  deckFormat: z.number().optional(),
  categories: z.array(
    z.object({ name: z.string(), includedInDeck: z.boolean() }),
  ),
  cards: z
    .array(
      z.object({
        quantity,
        categories: z
          .array(z.string())
          .nullish()
          .transform((value) => value || []),
        companion: z.boolean().nullable().optional(),
        deletedAt: z.string().nullable().optional(),
        card: z.object({ oracleCard: z.object({ name }) }),
      }),
    )
    .min(1)
    .max(2000),
  customCards: z.array(z.unknown()).default([]),
});
type Section =
  "Mainboard" | "Sideboard" | "Commander" | "Companion" | "Maybeboard";
export function decodeDeckLink(
  provider: "moxfield" | "archidekt",
  input: unknown,
) {
  const sections: Record<Section, Map<string, number>> = {
    Mainboard: new Map(),
    Sideboard: new Map(),
    Commander: new Map(),
    Companion: new Map(),
    Maybeboard: new Map(),
  };
  const add = (section: Section, card: string, count: number) => {
    const total = (sections[section].get(card) || 0) + count;
    if (total > 1000)
      throw new DeckLinkError(
        "An imported card quantity exceeds the supported limit.",
      );
    sections[section].set(card, total);
  };
  let title: string, sourceFormat: string | undefined;
  try {
    if (provider === "moxfield") {
      const data = moxfield.parse(input);
      title = data.name;
      sourceFormat = data.format;
      if (
        [data.signatureSpells, data.attractions, data.stickers].some(
          (b) => Object.keys(b).length,
        )
      )
        throw new DeckLinkError(
          "This deck uses signature spells, Attractions or Stickers, which this importer does not support. Paste and review a text export instead.",
        );
      for (const [key, section] of [
        ["mainboard", "Mainboard"],
        ["sideboard", "Sideboard"],
        ["commanders", "Commander"],
        ["companions", "Companion"],
        ["maybeboard", "Maybeboard"],
      ] as const) {
        for (const c of Object.values(data[key]))
          add(section, c.card.name, c.quantity);
      }
    } else {
      const data = archidekt.parse(input);
      title = data.name;
      if (data.customCards.length)
        throw new DeckLinkError(
          "This deck contains custom cards that cannot be imported reliably. Paste and review a text export instead.",
        );
      const categories = new Map(data.categories.map((c) => [c.name, c]));
      for (const c of data.cards) {
        if (c.deletedAt) continue;
        const roles = c.categories.map((s) => s.trim().toLowerCase());
        const explicit: Section[] = [];
        if (roles.includes("commander")) explicit.push("Commander");
        if (c.companion || roles.includes("companion"))
          explicit.push("Companion");
        if (roles.includes("sideboard")) explicit.push("Sideboard");
        if (roles.includes("maybeboard")) explicit.push("Maybeboard");
        if (explicit.length > 1)
          throw new DeckLinkError(
            "A card has conflicting deck sections. Resolve its Commander, Companion, Sideboard or Maybeboard categories on Archidekt and retry.",
          );
        const excluded =
          c.categories.length > 0 &&
          c.categories.every(
            (n) => categories.get(n)?.includedInDeck === false,
          );
        add(
          explicit[0] || (excluded ? "Maybeboard" : "Mainboard"),
          c.card.oracleCard.name,
          c.quantity,
        );
      }
    }
  } catch (e) {
    if (e instanceof DeckLinkError) throw e;
    throw new DeckLinkError(
      "The deck site returned an unsupported or incomplete deck. Your editor has not been changed; try pasting a text export.",
    );
  }
  if (!sections.Mainboard.size)
    throw new DeckLinkError(
      "The link did not contain a mainboard. Your editor has not been changed.",
    );
  const decklist = Object.entries(sections)
    .filter(([, cards]) => cards.size)
    .map(
      ([section, cards]) =>
        section +
        "\n" +
        Array.from(cards, ([card, count]) => count + " " + card).join("\n"),
    )
    .join("\n\n");
  if (Buffer.byteLength(decklist, "utf8") > config.MAX_DECKLIST_BYTES)
    throw new DeckLinkError("Imported deck exceeds the decklist size limit.");
  return {
    name: title.replace(/\s+/g, " ").slice(0, 150),
    decklist,
    sourceFormat: sourceFormat || null,
  };
}
export async function importDeckLink(value: string, get: typeof fetch = fetch) {
  const link = deckLink(value);
  let response: Response;
  try {
    response = await get(link.api, {
      redirect: "error",
      signal: AbortSignal.timeout(20000),
      headers: {
        Accept: "application/json",
        "User-Agent":
          "MagicTester/0.1 (+https://github.com/acocalypso/magictester)",
      },
    });
  } catch {
    throw new DeckLinkError(
      "The deck site could not be reached. Retry or paste its text export.",
      502,
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    if ([401, 403, 404].includes(response.status))
      throw new DeckLinkError(
        "This deck is private, unavailable, or the site denied access. Make the deck accessible or paste its text export.",
      );
    if (response.status === 429)
      throw new DeckLinkError(
        "The deck site is rate limiting imports. Wait and retry, or paste its text export.",
        503,
      );
    throw new DeckLinkError(
      "The deck site could not provide the deck. Retry or paste its text export.",
      502,
    );
  }
  const limit = 4 * 1024 * 1024;
  if (
    !response.body ||
    Number(response.headers.get("content-length") || 0) > limit
  ) {
    await response.body?.cancel();
    throw new DeckLinkError("The deck response is empty or too large.");
  }
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit)
        throw new DeckLinkError("The deck response exceeds 4 MB.");
      chunks.push(value);
    }
  } catch (e) {
    await reader.cancel().catch(() => {});
    if (e instanceof DeckLinkError) throw e;
    throw new DeckLinkError(
      "The deck download was interrupted. Retry or paste its text export.",
      502,
    );
  }
  const bytes = Buffer.concat(chunks);
  let input: unknown;
  try {
    input = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new DeckLinkError(
      "The deck site returned a page instead of a deck. Retry or paste its text export.",
    );
  }
  return {
    ...decodeDeckLink(link.provider, input),
    source: {
      provider: link.provider,
      url: link.url,
      fetchedAt: new Date().toISOString(),
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
  };
}
