import test from "node:test";
import assert from "node:assert/strict";
import { retryOptionsSchema } from "../src/retry-options.js";
test("retry settings support a five-minute new run while resume remains immutable", () => {
  assert.deepEqual(retryOptionsSchema.parse({}), {});
  assert.deepEqual(retryOptionsSchema.parse({ mode: "resume" }), {
    mode: "resume",
  });
  assert.equal(
    retryOptionsSchema.parse({ mode: "new", clockSeconds: 300 }).clockSeconds,
    300,
  );
  assert.equal(
    retryOptionsSchema.parse({ clockSeconds: 240 }).clockSeconds,
    240,
  );
  for (const value of [4, 301, 120.5])
    assert.equal(
      retryOptionsSchema.safeParse({ mode: "new", clockSeconds: value })
        .success,
      false,
    );
  assert.equal(
    retryOptionsSchema.safeParse({ mode: "resume", clockSeconds: 300 }).success,
    false,
  );
  assert.equal(
    retryOptionsSchema.safeParse({ mode: "new", seed: 1 }).success,
    false,
  );
});
