// Real engine acceptance. No simulation results are synthesized by this script.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { CachedCardDataProvider, validateDeck } from "../dist/domain.js";
import { ForgeEngineAdapter, serializeDeck } from "../dist/engine.js";
const provider = await new CachedCardDataProvider().load();
const makeDeck = (commander) => {
  const text = `40 Island\n59 Persistent Petitioners\nCommander\n1 ${commander}`;
  const result = validateDeck(text, "commander", provider);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  return result.cards;
};
const decks = [
  "Bruvac the Grandiloquent",
  "Bruvac the Grandiloquent",
  "Bruvac the Grandiloquent",
  "Bruvac the Grandiloquent",
].map((name, i) => serializeDeck(makeDeck(name), "player-" + i));
const engine = new ForgeEngineAdapter();
const results = [];
await engine.runGames(
  { decks, games: 2, mode: "commander", seed: 987654, clockSeconds: 120 },
  async (r) => {
    results.push(r);
    console.log(
      JSON.stringify({
        event: "four_player_game",
        index: r.index,
        winner: r.winner,
        termination: r.termination,
        casts: r.commanderCasts.length,
        placements: r.players.map((p) => p.placement),
      }),
    );
  },
);
for (const r of results) {
  assert.equal(r.termination, "normal");
  assert.equal(r.players.length, 4);
  assert.deepEqual(r.startingLife, [40, 40, 40, 40]);
  assert.equal(r.players[r.winner].placement, 1);
  assert.ok(r.players.every((p) => p.placement >= 1 && p.placement <= 4));
  assert.ok(
    r.commanderCasts.some((c) => c.from === "Command" && c.playerTurn >= 1),
  );
  assert.equal(r.eliminations.flatMap((e) => e.players).length, 3);
  assert.ok(r.bridgeSourceHash);
}
// A one-second game clock expires during real play. The adapter restarts the
// timed-out JVM and continues the next stable game identity in the same request.
const timeouts = [];
await engine.runGames(
  { decks, games: 2, mode: "commander", seed: 246810, clockSeconds: 1 },
  async (r) => {
    timeouts.push(r);
    console.log(
      JSON.stringify({
        event: "game_clock_acceptance",
        index: r.index,
        termination: r.termination,
      }),
    );
  },
);
assert.equal(timeouts.length, 2);
assert.ok(timeouts.some((r) => r.termination === "timeout"));
for (const r of timeouts.filter((r) => r.termination === "timeout")) {
  assert.equal(r.winner, null);
  assert.ok(r.players.every((p) => p.placement === null));
}
assert.deepEqual(
  timeouts.map((r) => r.index),
  [0, 1],
);
assert.deepEqual(
  timeouts.map((r) => r.gameSeed),
  [246810, 247819],
);
const report = {
  engine: "Forge 2.0.15",
  results,
  timeouts,
  verifiedAt: new Date().toISOString(),
};
await writeFile(
  process.env.BRIDGE_REPORT || "/tmp/bridge-report.json",
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({
    event: "bridge_smoke_passed",
    games: results.length,
    clockGames: timeouts.length,
  }),
);
