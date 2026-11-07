import test from "node:test";
import assert from "node:assert/strict";
import { actionLogSchema } from "../src/game-actions.js";
import { readFile } from "node:fs/promises";
import { BRIDGE_PREFIX, parseStructuredEvent } from "../src/engine.js";
const entry = {
  sequence: 0,
  kind: "LAND",
  text: "player-0 played Island",
  turn: 1,
  phase: "MAIN1",
  activePlayer: 0,
};
test("action histories preserve order, partial capture and UTF-8 recording budgets", () => {
  assert.equal(
    actionLogSchema.parse({
      version: 1,
      entries: [entry],
      total: 1,
      complete: true,
    }).entries[0].text,
    entry.text,
  );
  assert.equal(
    actionLogSchema.parse({
      version: 1,
      entries: [entry],
      total: 5001,
      complete: false,
    }).complete,
    false,
  );
  for (const log of [
    {
      version: 1,
      entries: [{ ...entry, sequence: 1 }],
      total: 1,
      complete: true,
    },
    { version: 1, entries: [entry], total: 0, complete: false },
    { version: 1, entries: [entry], total: 2, complete: true },
    {
      version: 1,
      entries: Array.from({ length: 100 }, (_, sequence) => ({
        ...entry,
        sequence,
        text: "界".repeat(1000),
      })),
      total: 100,
      complete: false,
    },
  ])
    assert.equal(actionLogSchema.safeParse(log).success, false);
});
test("structured games retain native actions and reject foreign player identities", async () => {
  const line = (
    await readFile(
      "services/forge-runner/fixtures/structured-constructed.log",
      "utf8",
    )
  )
    .split("\n")
    .find((l) => l.includes('"result"'))!;
  const event = JSON.parse(line.slice(BRIDGE_PREFIX.length));
  event.result.actionLog = {
    version: 1,
    entries: [entry],
    total: 1,
    complete: true,
  };
  const result = parseStructuredEvent(BRIDGE_PREFIX + JSON.stringify(event));
  assert.equal(result?.type, "result");
  assert.deepEqual(result?.result.actionLog.entries, [entry]);
  event.result.actionLog.entries[0].activePlayer = 4;
  assert.throws(
    () => parseStructuredEvent(BRIDGE_PREFIX + JSON.stringify(event)),
    /action history player/,
  );
});
