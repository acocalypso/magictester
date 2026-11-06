import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseStructuredEvent, BRIDGE_PREFIX } from "../src/engine.js";
const fixture = () =>
  readFile("services/forge-runner/fixtures/structured-constructed.log", "utf8");
test("structured results preserve observed start, actual turn count, game seeds and elimination reasons", async () => {
  const events = (await fixture()).trim().split("\n").map(parseStructuredEvent);
  const results = events
    .filter((e) => e?.type === "result")
    .map((e) => e!.result);
  assert.equal(results.length, 2);
  assert.deepEqual(
    results.map((r) => r.gameSeed),
    [12345, 13354],
  );
  assert.deepEqual(
    results.map((r) => r.startingPlayer),
    [0, 1],
  );
  assert.deepEqual(
    results[0].players.map((p) => p.placement),
    [2, 1],
  );
  assert.deepEqual(results[0].startingLife, [20, 20]);
  assert.equal(results[0].turns, 14);
  assert.equal(results[0].eliminations[0].reasons["0"], "LifeReachedZero");
  assert.equal(
    parseStructuredEvent("Game Result: untrusted native text"),
    null,
  );
});
test("structured parser rejects incomplete winners, invalid players and missing fields", async () => {
  const result = JSON.parse(
    (await fixture())
      .split("\n")
      .find((l) => l.includes('"result"'))!
      .slice(BRIDGE_PREFIX.length),
  );
  const encode = (r: unknown) =>
    BRIDGE_PREFIX + JSON.stringify({ type: "result", result: r });
  assert.throws(() =>
    parseStructuredEvent(encode({ ...result.result, winner: 4 })),
  );
  assert.throws(() =>
    parseStructuredEvent(encode({ ...result.result, termination: "timeout" })),
  );
  assert.throws(() =>
    parseStructuredEvent(
      encode({
        ...result.result,
        players: [
          { id: "player-0", placement: null },
          { id: "player-1", placement: 1 },
        ],
      }),
    ),
  );
  assert.throws(() => parseStructuredEvent(encode({ index: 0 })));
});

test("real four-player telemetry includes 40 life, complete elimination order and command-zone casts", async () => {
  const events = (
    await readFile(
      "services/forge-runner/fixtures/structured-commander.log",
      "utf8",
    )
  )
    .trim()
    .split("\n")
    .map(parseStructuredEvent);
  const results = events
    .filter((e) => e?.type === "result")
    .map((e) => e!.result);
  assert.equal(results.length, 2);
  for (const result of results) {
    assert.deepEqual(result.startingLife, [40, 40, 40, 40]);
    assert.deepEqual(
      result.players.map((p) => p.placement),
      [4, 3, 2, 1],
    );
    assert.equal(result.winner, 3);
    assert.deepEqual(
      result.eliminations.map((e) => e.placement),
      [4, 3, 2],
    );
    assert.ok(
      result.commanderCasts.some(
        (c) =>
          c.card === "Bruvac the Grandiloquent" &&
          c.from === "Command" &&
          c.playerTurn >= 3,
      ),
    );
  }
});

test("real Duel telemetry preserves the distinct mode and 20-life start", async () => {
  const results = (
    await readFile("services/forge-runner/fixtures/structured-duel.log", "utf8")
  )
    .trim()
    .split("\n")
    .map(parseStructuredEvent)
    .filter((e) => e?.type === "result")
    .map((e) => e!.result);
  assert.equal(results.length, 2);
  for (const result of results) {
    assert.equal(result.mode, "duel");
    assert.equal(result.mulliganRule, "London");
    assert.deepEqual(result.startingLife, [20, 20]);
    assert.equal(result.players.length, 2);
    assert.equal(result.termination, "normal");
    assert.ok(result.commanderCasts.length);
  }
});
