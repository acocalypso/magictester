import { test } from "node:test";
import assert from "node:assert/strict";
import { planBenchmark, storePlans, executionPlans } from "../src/planning.js";
import type { Opponent } from "../src/domain.js";
import { summarize } from "../src/analytics.js";
import { parseStructuredEvent } from "../src/engine.js";
import { readFile } from "node:fs/promises";
const opponents = ["a", "b", "c", "d"].map((id) => ({
  id,
  name: id,
  archetype: id,
})) as Opponent[];
test("rotating pods conserve requested games and balance opponent seat appearances", () => {
  const plan = planBenchmark("commander", 10, opponents, 12345);
  assert.deepEqual(
    plan.map((p) => p.games),
    [3, 3, 2, 2],
  );
  assert.deepEqual(
    plan.map((p) => p.opponents.map((d) => d.id)),
    [
      ["a", "b", "c"],
      ["b", "c", "d"],
      ["c", "d", "a"],
      ["d", "a", "b"],
    ],
  );
  assert.equal(new Set(plan.map((p) => p.key)).size, 4);
  assert.deepEqual(planBenchmark("commander", 10, opponents, 12345), plan);
  assert.equal(planBenchmark("commander", 1, opponents, 12345).length, 1);
  const small = planBenchmark("cedh", 2, opponents.slice(0, 2), 12345);
  assert.deepEqual(
    small[0].opponents.map((d) => d.id),
    ["a", "b", "a"],
  );
});
test("persisted plans retain the exact roster and reject missing participants or wrong totals", () => {
  const plans = planBenchmark("commander", 10, opponents, 12345);
  const job = {
    format: "commander",
    games: 10,
    seed: 12345,
    config: { executionPlan: storePlans(plans) },
    snapshot: { decks: opponents },
  };
  assert.deepEqual(executionPlans(job), plans);
  assert.throws(() => executionPlans({ ...job, games: 9 }));
  assert.throws(() =>
    executionPlans({ ...job, snapshot: { decks: opponents.slice(0, 2) } }),
  );
  const duel = planBenchmark("pauper", 2, opponents, 12);
  assert.equal(duel[0].key, "a");
  assert.equal(duel[0].opponents.length, 1);
});
test("multiplayer summaries use actual placements and omit uncast commander timing", async () => {
  const results = (
    await readFile(
      "services/forge-runner/fixtures/structured-commander.log",
      "utf8",
    )
  )
    .trim()
    .split("\n")
    .map(parseStructuredEvent)
    .filter((e) => e?.type === "result")
    .map((e) => e!.result);
  const summary = summarize(results, 0, true);
  assert.equal(summary.averagePlacement, 4);
  assert.deepEqual(summary.placementDistribution, { 4: 2 });
  assert.equal(summary.commanderTiming!.observedGames, 2);
  assert.equal(summary.commanderTiming!.castGames, 1);
  assert.equal(summary.commanderTiming!.notCastGames, 1);
  assert.equal(summary.commanderTiming!.averageFirstCastPlayerTurn, 5);
  assert.equal(
    summarize([], 0, true).commanderTiming!.averageFirstCastPlayerTurn,
    null,
  );
});

test("weighted selection conserves units, excludes zero weights and freezes deterministic rosters", async () => {
  const { allocateWeighted } = await import("../src/planning.js");
  assert.deepEqual(allocateWeighted(7, [3, 1, 0]), [5, 2, 0]);
  assert.deepEqual(allocateWeighted(2, [1, 1, 1]), [1, 1, 0]);
  assert.throws(() => allocateWeighted(2, [0, 0]));
  const selection = {
    mode: "custom" as const,
    weights: { a: 3, b: 1, c: 0, d: 0 },
  };
  const plan = planBenchmark("modern", 7, opponents, 12, selection);
  assert.deepEqual(
    plan.map((p) => [p.key, p.games]),
    [
      ["a", 5],
      ["b", 2],
    ],
  );
  assert.throws(() =>
    planBenchmark("modern", 7, opponents, 12, { mode: "meta" }),
  );
  const pods = planBenchmark("commander", 1000, opponents, 12, {
    ...selection,
    allowRepeatedLists: true,
  });
  assert.equal(
    pods.reduce((n, p) => n + p.games, 0),
    1000,
  );
  assert.ok(pods.length <= 50);
  assert.ok(
    pods.every((p) => p.opponents.every((d) => ["a", "b"].includes(d.id))),
  );
  assert.deepEqual(
    planBenchmark("commander", 1000, opponents, 12, {
      ...selection,
      allowRepeatedLists: true,
    }),
    pods,
  );
  assert.throws(() =>
    planBenchmark("commander", 10, opponents, 12, {
      ...selection,
      allowRepeatedLists: false,
    }),
  );
  const explicit = planBenchmark("commander", 7, opponents, 12, {
    mode: "equal",
    allowRepeatedLists: false,
    pods: [
      { opponentIds: ["a", "b", "c"], weight: 3 },
      { opponentIds: ["d", "c", "b"], weight: 1 },
    ],
  });
  assert.deepEqual(
    explicit.map((p) => p.games),
    [5, 2],
  );
  assert.deepEqual(
    explicit[1].opponents.map((d) => d.id),
    ["d", "c", "b"],
  );
  assert.throws(() =>
    planBenchmark("modern", 2, opponents, 12, {
      mode: "equal",
      opponentIds: ["unknown"],
    }),
  );
});

test("actual Commander pregame color telemetry preserves the deck-required Piper choice", async () => {
  const event = parseStructuredEvent(
    (
      await readFile(
        "services/forge-runner/fixtures/commander-colors.log",
        "utf8",
      )
    ).trim(),
  );
  assert.equal(event?.type, "result");
  if (event?.type !== "result" || event.result.unit === "match")
    throw Error("Expected actual game fixture");
  assert.deepEqual(event.result.commanderColors, [
    { player: 0, card: "The Prismatic Piper", colors: ["green"] },
  ]);
  assert.equal(event.result.players.length, 4);
  assert.equal(event.result.termination, "normal");
});
