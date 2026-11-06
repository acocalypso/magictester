import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  parseStructuredEvent,
  BRIDGE_PREFIX,
  gameResults,
  type EngineResult,
  type MatchResult,
} from "../src/engine.js";
import { summarize, summarizeMatches } from "../src/analytics.js";
async function fixture() {
  return (
    await readFile(
      "services/forge-runner/fixtures/structured-matches.log",
      "utf8",
    )
  )
    .trim()
    .split("\n")
    .map(parseStructuredEvent)
    .filter((e) => e?.type === "result")
    .map((e) => e!.result) as EngineResult[];
}
test("real matches stop at two wins, include deciding games and retain actual native sideboard changes", async () => {
  const results = await fixture();
  assert.equal(results.length, 6);
  const games = gameResults(results);
  assert.equal(games.length, 13);
  const match = summarizeMatches(results)!;
  const game = summarize(games);
  assert.equal(match.wins, 4);
  assert.equal(match.matches, 6);
  assert.equal(match.winRate, 4 / 6);
  assert.equal(game.wins, 8);
  assert.equal(game.winRate, 8 / 13);
  assert.notEqual(match.winRate, game.winRate);
  assert.ok(results.some((r) => r.unit === "match" && r.games.length === 3));
  assert.ok(
    games.some((g) =>
      g.sideboardChanges?.some((p) =>
        p.added.some((c) => c.name === "Runeclaw Bear"),
      ),
    ),
  );
});
test("match parser rejects a score unsupported by actual games", async () => {
  const result = (await fixture())[0] as MatchResult;
  assert.throws(() =>
    parseStructuredEvent(
      BRIDGE_PREFIX +
        JSON.stringify({
          type: "result",
          result: { ...result, gameWins: [99, 0] },
        }),
    ),
  );
});
test("a game-limit match is incomplete, while its observed rule draw remains a game draw", async () => {
  // Contract-only hypothetical outcome, not a recorded or claimed played game.
  const result = structuredClone(
    (await fixture()).find((r) => r.unit === "match" && r.games.length === 3),
  ) as MatchResult;
  result.winner = null;
  result.players.forEach((p) => (p.placement = null));
  result.termination = "game_limit";
  result.gameWins = [1, 1];
  const last = result.games[2];
  last.winner = null;
  last.termination = "rule_draw";
  last.players.forEach((p) => (p.placement = null));
  last.eliminations = [];
  const event = parseStructuredEvent(
    BRIDGE_PREFIX + JSON.stringify({ type: "result", result }),
  );
  assert.equal(event?.type, "result");
  const summary = summarizeMatches([result])!;
  assert.equal(summary.matches, 0);
  assert.equal(summary.limited, 1);
  assert.equal(summary.draws, 0);
  assert.equal(summary.winRate, null);
  assert.equal(summarize(gameResults([result])).draws, 1);
});
