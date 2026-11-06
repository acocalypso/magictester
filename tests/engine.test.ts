import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ForgeResultParser, serializeDeck } from "../src/engine.js";
test("parses a real Forge Docker game including observed play and reported round", async () => {
  const parser = new ForgeResultParser("2.0.15", 12345);
  const results = (
    await readFile("services/forge-runner/fixtures/real-game.log", "utf8")
  )
    .split("\n")
    .map((l) => parser.line(l))
    .filter(Boolean);
  assert.equal(results.length, 1);
  assert.equal(results[0]!.winner, 1);
  assert.equal(results[0]!.turns, 7);
  assert.equal(results[0]!.startingPlayer, 0);
  assert.equal(results[0]!.termination, "normal");
});
test("separates timeout from rule draw and resets between games", () => {
  const p = new ForgeResultParser("test", 1);
  p.line("Stopping slow match as draw");
  assert.equal(
    p.line("Game Result: Game 1 ended in a Draw! Took 1000 ms.")!.termination,
    "timeout",
  );
  assert.equal(
    p.line("Game Result: Game 2 ended in a Draw! Took 20 ms.")!.termination,
    "rule_draw",
  );
});
test("exceptions cannot be reported as valid games", () => {
  const p = new ForgeResultParser("test", 1);
  p.line("java.lang.IllegalStateException");
  assert.equal(
    p.line("Game Result: Game 1 ended in a Draw! Took 20 ms.")!.termination,
    "engine_error",
  );
});
test("serializer has a separate mainboard and does not include maybeboard", () => {
  const text = serializeDeck(
    [
      { name: "Forest", quantity: 60, section: "MAINBOARD" },
      { name: "Bad", quantity: 1, section: "MAYBEBOARD" },
    ],
    "player-0",
  );
  assert.match(text, /\[Main\]\n60 Forest/);
  assert.doesNotMatch(text, /Bad/);
});

test("timeout overrides an apparent Forge win", () => {
  const p = new ForgeResultParser("test", 1);
  p.line("Stopping slow match as draw");
  const r = p.line(
    "Game Result: Game 1 ended in 1000 ms. Ai(1)-player-0 has won!",
  )!;
  assert.equal(r.termination, "timeout");
  assert.equal(r.winner, null);
  assert.ok(r.players.every((p) => p.placement === null));
});
