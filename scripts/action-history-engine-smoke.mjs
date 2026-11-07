// Real native logs, including stopped games. Requires the compiled bridge and local card cache.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { ForgeEngineAdapter, serializeDeck } from "../dist/engine.js";
import { CachedCardDataProvider, validateDeck } from "../dist/domain.js";
const cards = await new CachedCardDataProvider().load();
const checked = (text, format) => {
  const d = validateDeck(text, format, cards);
  assert.equal(d.valid, true, JSON.stringify(d.errors));
  return d.cards;
};
const burn = checked(await readFile("examples/burn.txt", "utf8"), "pauper");
const constructed = [
  serializeDeck(burn, "player-0"),
  serializeDeck(burn, "player-1"),
];
const pod = Array.from({ length: 4 }, (_, i) =>
  serializeDeck(
    checked(
      "40 Island\n59 Persistent Petitioners\nCommander\n1 Bruvac the Grandiloquent",
      "commander",
    ),
    "player-" + i,
  ),
);
const engine = new ForgeEngineAdapter();
const report = [];
function verify(game) {
  assert.ok(game.actionLog);
  const log = game.actionLog;
  assert.equal(
    log.complete,
    game.termination === "normal" || game.termination === "rule_draw",
  );
  assert.equal(log.entries.length, log.total);
  assert.deepEqual(
    log.entries.map((e) => e.sequence),
    Array.from({ length: log.entries.length }, (_, i) => i),
  );
  for (let i = 1; i < log.entries.length; i++)
    assert.ok(log.entries[i].turn >= log.entries[i - 1].turn);
  if (game.termination === "normal") {
    assert.ok(log.entries.some((e) => e.kind === "LAND"));
    assert.ok(log.entries.some((e) => e.kind === "TURN"));
    assert.ok(log.entries.some((e) => e.kind === "STACK_ADD"));
    assert.ok(log.entries.some((e) => e.kind === "GAME_OUTCOME"));
  }
  console.log(
    JSON.stringify({
      event: "native_history_checked",
      mode: game.mode,
      index: game.index,
      termination: game.termination,
      count: log.total,
      kinds: [...new Set(log.entries.map((e) => e.kind))],
    }),
  );
  report.push(game);
}
await engine.runGames(
  {
    decks: constructed,
    games: 1,
    bestOf: 3,
    maxMatchGames: 5,
    sideboarding: true,
    seed: 45678,
    clockSeconds: 120,
  },
  async (result) => {
    assert.equal(result.unit, "match");
    result.games.forEach(verify);
  },
);
await engine.runGames(
  { decks: pod, games: 1, mode: "commander", seed: 987654, clockSeconds: 120 },
  async (result) => {
    assert.equal(result.termination, "normal");
    verify(result);
    assert.ok(result.actionLog.entries.some((e) => e.text.includes("Bruvac")));
  },
);
await engine.runGames(
  { decks: pod, games: 1, mode: "commander", seed: 246810, clockSeconds: 1 },
  async (result) => {
    assert.equal(result.termination, "timeout");
    assert.equal(result.actionLog.complete, false);
    verify(result);
  },
);
await mkdir("data", { recursive: true });
await writeFile(
  "data/action-native-smoke.json",
  JSON.stringify(report, null, 2),
);
