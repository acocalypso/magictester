import { load } from "cheerio";
import { createHash } from "node:crypto";
import { validateDeck, type CardDataProvider } from "./domain.js";
import { getFormat, FORMATS } from "./formats.js";
import {
  SourceClient,
  sourceUrl,
  SourceUnavailableError,
} from "./source-http.js";
const top8: Record<string, string> = {
  standard: "ST",
  pioneer: "PI",
  modern: "MO",
  pauper: "PAU",
  legacy: "LE",
  vintage: "VI",
  duel: "EDH",
  commander: "cEDH",
  cedh: "cEDH",
};
export const dailySources = FORMATS.map((f) => ({
  format: f.id,
  name: `${f.name} · Daily metagame`,
  provider: "mtgtop8",
  url: `https://www.mtgtop8.com/format?f=${top8[f.id]}`,
}));
interface Archetype {
  name: string;
  url: string;
  share: number;
  strategy: "AGGRO" | "MIDRANGE" | "CONTROL" | "COMBO" | "UNKNOWN";
}
const clean = (text: string) => text.replace(/\s+/g, " ").trim();
export function parseArchetypes(html: string, url: string, provider: string) {
  const $ = load(html);
  const result: Archetype[] = [];
  const seen = new Set<string>();
  const anchors =
    provider === "mtgdecks"
      ? $("#allArchetypes tbody tr strong a[href]")
      : $('a[href*="archetype?"]');
  anchors.each((_, element) => {
    const link = $(element);
    const href = link.attr("href");
    if (!href) return;
    const target = sourceUrl(new URL(href, url).href);
    const key =
      provider === "mtgdecks" ? target.pathname : target.searchParams.get("a");
    if (!key || seen.has(key)) return;
    seen.add(key);
    const row =
      provider === "mtgdecks" ? link.closest("tr") : link.closest(".hover_tr");
    const shareText =
      provider === "mtgdecks"
        ? row.find(".meta-share.hidden-xs").first().text()
        : row
            .find(".S14")
            .map((_, e) => $(e).text())
            .get()
            .find((t) => /[%‰]/.test(t)) || "";
    const number = shareText.replace(",", ".").match(/([\d.]+)\s*([%‰])/);
    if (!number) return;
    const share = Number(number[1]) / (number[2] === "‰" ? 1000 : 100);
    if (!Number.isFinite(share) || share <= 0 || share > 1) return;
    const group = clean(row.prevAll(".meta_arch").first().text()).split(" ")[0];
    result.push({
      name: clean(link.text()).slice(0, 100),
      url: target.href,
      share,
      strategy: ["AGGRO", "MIDRANGE", "CONTROL", "COMBO"].includes(group)
        ? (group as Archetype["strategy"])
        : "UNKNOWN",
    });
  });
  return result.sort(
    (a, b) => b.share - a.share || a.name.localeCompare(b.name),
  );
}
export function sourceDate(text: string) {
  const match = clean(text).match(/\b(\d{2})\/(\d{2})\/(\d{2}|\d{4})\b/);
  if (!match) return null;
  const year =
    match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  const iso = `${year}-${match[2]}-${match[1]}`;
  if (
    Number.isNaN(Date.parse(iso)) ||
    new Date(iso).toISOString().slice(0, 10) !== iso
  )
    return null;
  return iso;
}
export function parseDeckLinks(html: string, url: string, provider: string) {
  const $ = load(html);
  const seen = new Set<string>();
  const result: { url: string; date: string | null }[] = [];
  $("a[href]").each((_, element) => {
    const link = $(element);
    const target = new URL(link.attr("href")!, url);
    const isDeck =
      provider === "mtgdecks"
        ? /-decklist-by-.+-\d+$/.test(target.pathname)
        : target.pathname === "/event" && target.searchParams.has("d");
    if (!isDeck) return;
    sourceUrl(target.href);
    if (seen.has(target.href)) return;
    seen.add(target.href);
    const text = link.closest("tr").find("td").last().text();
    let date = sourceDate(text);
    if (provider === "mtgdecks") {
      const raw = clean(text).match(/(\d{2})-([A-Za-z]{3})\s*-?\s*(\d{4})/);
      if (raw) {
        const months = [
          "Jan",
          "Feb",
          "Mar",
          "Apr",
          "May",
          "Jun",
          "Jul",
          "Aug",
          "Sep",
          "Oct",
          "Nov",
          "Dec",
        ];
        const month =
          months.findIndex((m) => m.toLowerCase() === raw[2].toLowerCase()) + 1;
        if (month)
          date = `${raw[3]}-${String(month).padStart(2, "0")}-${raw[1]}`;
      }
    }
    result.push({ url: target.href, date });
  });
  return result.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}
export function parseSourceDeck(html: string, provider: string) {
  const $ = load(html);
  if (provider === "mtgdecks") {
    const text = $("#arena_deck").first().text().trim();
    if (!text) throw new Error("Source has no public textual decklist");
    return text;
  }
  const sections: Record<string, string[]> = {
    MAINBOARD: [],
    SIDEBOARD: [],
    COMMANDER: [],
    COMPANION: [],
  };
  const seen = new Set<string>();
  $(".deck_line[id]").each((_, element) => {
    const row = $(element);
    const id = row.attr("id")!;
    if (seen.has(id)) return;
    seen.add(id);
    const name = clean(row.find(".L14").first().text());
    const quantity = clean(row.text()).match(/^(\d+)\s/);
    if (!name || !quantity) return;
    const heading = clean(row.prevAll("div.O14").first().text()).toUpperCase();
    const section = heading.includes("COMMANDER")
      ? "COMMANDER"
      : heading.includes("COMPANION")
        ? "COMPANION"
        : id.startsWith("sb")
          ? "SIDEBOARD"
          : "MAINBOARD";
    sections[section].push(`${quantity[1]} ${name}`);
  });
  const declared = $(".S14")
    .map((_, e) => clean($(e).text()))
    .get()
    .find((t) => /^MD \d+ SB \d+$/.test(t));
  if (declared) {
    const match = declared.match(/^MD (\d+) SB (\d+)$/)!;
    const count = (items: string[]) =>
      items.reduce((n, line) => n + Number(line.match(/^\d+/)![0]), 0);
    if (
      count(sections.MAINBOARD) !== Number(match[1]) ||
      count([
        ...sections.SIDEBOARD,
        ...sections.COMMANDER,
        ...sections.COMPANION,
      ]) !== Number(match[2])
    )
      throw new Error(
        "Parsed source deck does not match its declared main/sideboard counts",
      );
  }
  if (!sections.MAINBOARD.length)
    throw new Error("Source has no public textual decklist");
  return Object.entries(sections)
    .filter(([, cards]) => cards.length)
    .map(([name, cards]) => `${name}\n${cards.join("\n")}`)
    .join("\n");
}
export function dynamicRankingUrl(html: string, format: string) {
  if (!getFormat(format)?.commander) return null;
  const meta = html.match(/\bmeta\s*=\s*(\d+)\s*;/)?.[1];
  return meta
    ? `https://www.mtgtop8.com/cEDH_decks?f=${top8[format]}&show=pop&cid=&meta=${meta}&gamerid1=&gamerid2=&cEDH_cp=1`
    : null;
}
export async function downloadMetagame(
  feed: { format: string; provider: string; url: string; max_decks: number },
  cards: CardDataProvider,
  scheduled: boolean,
  client: Pick<SourceClient, "get" | "pages"> = new SourceClient(
    scheduled ? 6 * 3600000 : 0,
  ),
) {
  const page = await client.get(feed.url);
  const $ = load(page.body);
  let ranked = parseArchetypes(page.body, page.url, feed.provider);
  const windowLabel =
    clean(
      $(".chosen_tr")
        .filter((_, e) => $(e).closest("#metas_list").length > 0)
        .first()
        .text(),
    ) ||
    clean($("#metas_list a").first().text()) ||
    "Source default reporting window";
  if (feed.provider === "mtgtop8" && !ranked.length) {
    const fragmentUrl = dynamicRankingUrl(page.body, feed.format);
    if (fragmentUrl) {
      const fragment = await client.get(fragmentUrl);
      ranked = parseArchetypes(fragment.body, fragment.url, feed.provider);
    }
  }
  if (!ranked.length)
    throw new Error(
      "Source changed or empty: no ranked archetypes with reported shares",
    );
  const decks = [];
  const exclusions: { archetype: string; url: string; reason: string }[] = [];
  const representatives = [];
  for (const archetype of ranked.slice(0, Math.min(50, feed.max_decks * 2))) {
    if (decks.length >= feed.max_decks) break;
    try {
      const listing = await client.get(archetype.url);
      const candidates = parseDeckLinks(
        listing.body,
        listing.url,
        feed.provider,
      )
        .filter(
          (d) =>
            d.date &&
            Date.parse(d.date) >= Date.now() - 60 * 86400000 &&
            Date.parse(d.date) <= Date.now() + 86400000,
        )
        .slice(0, 3);
      if (!candidates.length)
        throw new Error("No dated decklist within the last 60 days");
      let accepted = false;
      for (const candidate of candidates) {
        try {
          const detail = await client.get(candidate.url);
          const decklist = parseSourceDeck(detail.body, feed.provider);
          const validation = validateDeck(decklist, feed.format, cards);
          if (!validation.valid)
            throw new Error(
              validation.errors
                .slice(0, 4)
                .map((e) => e.message)
                .join("; "),
            );
          decks.push({
            name: archetype.name,
            archetype: archetype.name,
            strategy: archetype.strategy,
            decklist,
            sourceUrl: candidate.url,
            metaShare: archetype.share,
          });
          representatives.push({
            archetype: archetype.name,
            sourceRank: ranked.indexOf(archetype) + 1,
            url: candidate.url,
            eventDate: candidate.date,
            sha256: detail.sha256,
          });
          accepted = true;
          break;
        } catch (error) {
          if (error instanceof SourceUnavailableError) throw error;
          exclusions.push({
            archetype: archetype.name,
            url: candidate.url,
            reason: (error as Error).message.slice(0, 600),
          });
        }
      }
      if (!accepted)
        exclusions.push({
          archetype: archetype.name,
          url: archetype.url,
          reason:
            "No compatible representative among the three newest dated lists",
        });
    } catch (error) {
      if (error instanceof SourceUnavailableError) throw error;
      exclusions.push({
        archetype: archetype.name,
        url: archetype.url,
        reason: (error as Error).message.slice(0, 600),
      });
    }
  }
  if (!decks.length)
    throw new Error(
      `No legal engine-compatible opponents from ${feed.provider}: ${exclusions
        .slice(0, 2)
        .map((e) => e.reason)
        .join("; ")}`,
    );
  const asOf = new Date().toISOString().slice(0, 10);
  const competitive =
    feed.format === "commander"
      ? " Competitive Commander/cEDH population, not a universal casual Commander metagame."
      : "";
  const input = {
    name: `${getFormat(feed.format)!.name} · Daily ${feed.provider} · ${asOf}`,
    format: feed.format,
    source: `${feed.provider} reported archetype shares; ${windowLabel}. One recent legal representative per compatible archetype.${competitive}`,
    sourceDate: asOf,
    selectionMethod: "equal_archetype",
    decks,
  };
  const metadata = {
    provider: feed.provider,
    window: windowLabel,
    asOf,
    selection:
      "highest reported shares; newest compatible dated list per archetype; up to three candidates",
    sharePrecision:
      "As printed by source; rounded shares are not reconstructed",
    requestedDecks: feed.max_decks,
    acceptedDecks: decks.length,
    rankedArchetypes: ranked.length,
    selectedMetaShare: decks.reduce((n, d) => n + d.metaShare, 0),
    coverage: exclusions.length ? "partial" : "complete_selected",
    exclusions,
    representatives,
    pages: client.pages.map(({ body: _body, ...provenance }) => provenance),
  };
  return {
    input,
    metadata,
    digest: createHash("sha256")
      .update(JSON.stringify({ input, representatives }))
      .digest("hex"),
    etag: null,
  };
}
