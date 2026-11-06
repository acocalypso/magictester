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
