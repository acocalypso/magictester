import { test } from "node:test";
import assert from "node:assert/strict";
import { summarize, wilson } from "../src/analytics.js";
import type { GameResult } from "../src/engine.js";
const r = (
  winner: number | null,
  termination: GameResult["termination"] = "normal",
  turns = 8,
  startingPlayer: number | null = 0,
) =>
  ({
    winner,
    termination,
    turns,
    startingPlayer,
    durationMs: 1000,
  }) as GameResult;
test("analytics distinguish rule draws, timeouts and engine failures", () => {
  const s = summarize([
    r(0),
    r(0),
    r(1),
    r(null, "rule_draw"),
    r(0, "timeout"),
    r(1, "engine_error"),
  ]);
  assert.equal(s.games, 4);
  assert.equal(s.wins, 2);
  assert.equal(s.draws, 1);
  assert.equal(s.losses, 1);
  assert.equal(s.timeouts, 1);
  assert.equal(s.errors, 1);
  assert.equal(s.winRate, 0.5);
  assert.equal(s.attempted, 6);
});
test("Wilson interval matches known 50/100 example and handles zero samples", () => {
  const interval = wilson(50, 100)!;
  assert.ok(Math.abs(interval[0] - 0.4038315) < 1e-6);
  assert.ok(Math.abs(interval[1] - 0.5961685) < 1e-6);
  assert.equal(wilson(0, 0), null);
  assert.ok(wilson(0, 10)![0] < 1e-10);
  assert.ok(Math.abs(wilson(10, 10)![1] - 1) < 1e-10);
});
test("play/draw is based on observed starter, excludes unknowns, and median sorts numerically", () => {
  const s = summarize([
    r(0, "normal", 2, 0),
    r(1, "normal", 10, 1),
    r(0, "normal", 8, null),
    r(0, "normal", 12, 0),
  ]);
  assert.equal(s.onPlay.games, 2);
  assert.equal(s.onPlay.wins, 2);
  assert.equal(s.onDraw.games, 1);
  assert.equal(s.onDraw.wins, 0);
  assert.equal(s.medianTurns, 9);
  assert.equal(s.averageTurns, 8);
  assert.deepEqual(s.turnDistribution, { "2": 1, "8": 1, "10": 1, "12": 1 });
});
test("empty results remain unavailable rather than fabricated zero percent", () => {
  const s = summarize([]);
  assert.equal(s.winRate, null);
  assert.equal(s.averageTurns, null);
  assert.equal(s.confidence95, null);
});
