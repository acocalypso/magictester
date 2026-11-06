import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseArchetypes,
  parseDeckLinks,
  parseSourceDeck,
  sourceDate,
  dailySources,
} from "../src/meta-sources.js";
import { sourceUrl } from "../src/source-http.js";
test("daily source configuration covers each format and labels the Commander competitive source", () => {
  assert.equal(dailySources.length, 9);
  assert.equal(new Set(dailySources.map((s) => s.format)).size, 9);
  assert.equal(
    dailySources.find((s) => s.format === "cedh")!.url,
    dailySources.find((s) => s.format === "commander")!.url,
  );
});
test("source shares distinguish percent and per mille and retain source strategy tags", () => {
  const html =
    '<div class="meta_arch">AGGRO 60%</div><div class="hover_tr"><div class="S14"><a href="archetype?a=1&meta=3&f=PAU">Reference aggro</a></div><div class="S14">12 %</div></div><div class="hover_tr"><div class="S14"><a href="archetype?a=2&meta=3&f=PAU">Reference commander</a></div><div class="S14">115.7 ‰</div></div>';
  const result = parseArchetypes(
    html,
    "https://www.mtgtop8.com/format?f=PAU",
    "mtgtop8",
  );
  assert.deepEqual(
    result.map((x) => x.share),
    [0.12, 0.1157],
  );
  assert.equal(result[0].strategy, "AGGRO");
});
test("only dated deck links are candidates, with newest dates first", () => {
  const html =
    '<table><tr><td><a href="/event?e=1&d=2&f=PAU">Deck A</a></td><td>04/11/26</td></tr><tr><td><a href="/event?e=2&d=3&f=PAU">Deck B</a></td><td>05/11/26</td></tr><tr><td><a href="/event?e=2&f=PAU">Event only</a></td><td>05/11/26</td></tr></table>';
  assert.deepEqual(
    parseDeckLinks(
      html,
      "https://www.mtgtop8.com/archetype?a=1",
      "mtgtop8",
    ).map((x) => x.date),
    ["2026-11-05", "2026-11-04"],
  );
  assert.equal(sourceDate("31/02/26"), null);
});
test("source section headings override misleading sideboard IDs for actual commanders", () => {
  const html =
    '<div><div class="O14">COMMANDER</div><div class="deck_line" id="sb1">1 <span class="L14">Bruvac the Grandiloquent</span></div><div class="O14">MAIN</div><div class="deck_line" id="md1">99 <span class="L14">Island</span></div></div><div><div class="O14">SIDEBOARD</div><div class="deck_line" id="sb2">1 <span class="L14">Negate</span></div></div>';
  const text = parseSourceDeck(html, "mtgtop8");
  assert.match(text, /COMMANDER\n1 Bruvac/);
  assert.match(text, /MAINBOARD\n99 Island/);
  assert.match(text, /SIDEBOARD\n1 Negate/);
  assert.throws(() => parseSourceDeck("<h1>No list</h1>", "mtgtop8"));
  assert.throws(() => sourceUrl("https://www.mtgtop8.com.evil.test/format"));
});

test("crawler policy honors prohibited exports and advertised crawl delays", async () => {
  const { sourcePolicy } = await import("../src/source-http.js");
  const policy = sourcePolicy(
    "https://www.mtgtop8.com/robots.txt",
    "User-agent: *\nDisallow: /compare\nCrawl-delay: 5",
  );
  assert.equal(
    policy.isAllowed("https://www.mtgtop8.com/compare", "MagicTester/0.1"),
    false,
  );
  assert.equal(
    policy.isAllowed("https://www.mtgtop8.com/format?f=PAU", "MagicTester/0.1"),
    true,
  );
  assert.equal(policy.getCrawlDelay("MagicTester/0.1"), 5);
  const exports = sourcePolicy(
    "https://mtgdecks.net/robots.txt",
    "User-agent: *\nDisallow: */txt\n",
  );
  assert.equal(
    exports.isAllowed(
      "https://mtgdecks.net/Pauper/list/txt",
      "MagicTester/0.1",
    ),
    false,
  );
});

test("dynamic ranking fragments preserve Duel and multiplayer format codes", async () => {
  const { dynamicRankingUrl } = await import("../src/meta-sources.js");
  assert.match(dynamicRankingUrl("meta=115;", "duel")!, /f=EDH&.*meta=115/);
  assert.match(dynamicRankingUrl("meta=327;", "cedh")!, /f=cEDH&.*meta=327/);
  assert.equal(dynamicRankingUrl("meta=1;", "pauper"), null);
  assert.throws(
    () =>
      parseSourceDeck(
        '<div class="S14">MD 60 SB 0</div><div class="deck_line" id="md1">61 <span class="L14">Mountain</span></div>',
        "mtgtop8",
      ),
    /declared/,
  );
});

test("an infrastructure failure aborts the import rather than publishing a misleading partial pool", async () => {
  const { downloadMetagame } = await import("../src/meta-sources.js");
  const { SourceUnavailableError } = await import("../src/source-http.js");
  const date = new Date().toLocaleDateString("en-GB");
  const base = "https://www.mtgtop8.com";
  const client = {
    pages: [],
    get: async (url: string) => {
      if (url.includes("a=2"))
        throw new SourceUnavailableError("Database connection interrupted");
      const body = url.includes("/format")
        ? '<div class="hover_tr"><div class="S14"><a href="archetype?a=1">First</a></div><div class="S14">60 %</div></div><div class="hover_tr"><div class="S14"><a href="archetype?a=2">Second</a></div><div class="S14">40 %</div></div>'
        : url.includes("archetype")
          ? `<table><tr><td><a href="/event?e=1&d=1">List</a></td><td>${date}</td></tr></table>`
          : '<div class="S14">MD 60 SB 0</div><div class="deck_line" id="md1">60 <span class="L14">Mountain</span></div>';
      return {
        url,
        body,
        sha256: "0".repeat(64),
        checkedAt: new Date().toISOString(),
      };
    },
  };
  const cards = {
    provenance: {},
    supports: () => true,
    find: () => ({
      name: "Mountain",
      legalities: { pauper: "legal" },
      typeLine: "Basic Land — Mountain",
      colorIdentity: ["R"],
      oracleText: "",
      faces: [],
      scryfallId: "fixture",
    }),
  };
  await assert.rejects(
    downloadMetagame(
      {
        format: "pauper",
        provider: "mtgtop8",
        url: base + "/format?f=PAU",
        max_decks: 2,
      },
      cards,
      false,
      client,
    ),
    SourceUnavailableError,
  );
});
