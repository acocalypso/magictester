import test from "node:test";
import assert from "node:assert/strict";
import { observationReview } from "../src/observation-review.js";
const base = {
  attemptId: "final",
  finalAttemptId: "final",
  hasFinalResult: true,
  number: 2,
  total: 2,
  termination: "normal",
  matchTermination: "normal",
  jobState: "COMPLETED",
};
test("only observations from the finalized attempt count; restarted games remain history", () => {
  assert.equal(observationReview(base).status, "included");
  assert.equal(observationReview(base).matchCounted, true);
  assert.equal(
    observationReview({ ...base, attemptId: "old", number: 1 }).status,
    "previous",
  );
  assert.equal(
    observationReview({ ...base, attemptId: "old", number: 1 }).matchCounted,
    false,
  );
});
test("normal games can count when a match hit its limit, while failed games are excluded", () => {
  assert.equal(
    observationReview({ ...base, matchTermination: "game_limit" }).status,
    "included",
  );
  assert.equal(
    observationReview({ ...base, matchTermination: "game_limit" }).matchCounted,
    false,
  );
  assert.equal(
    observationReview({
      ...base,
      termination: "timeout",
      matchTermination: "timeout",
    }).status,
    "excluded",
  );
  assert.equal(
    observationReview({
      ...base,
      termination: "engine_error",
      matchTermination: "engine_error",
    }).status,
    "excluded",
  );
});
test("unfinished, running and unverified records are distinguished without inventing a completed result", () => {
  const pending = {
    ...base,
    finalAttemptId: null,
    hasFinalResult: false,
    number: 1,
    total: 1,
  };
  assert.equal(
    observationReview({ ...pending, jobState: "RUNNING" }).status,
    "pending",
  );
  assert.equal(
    observationReview({ ...pending, jobState: "CANCELLED" }).status,
    "unfinished",
  );
  assert.equal(
    observationReview({ ...pending, jobState: "FAILED" }).status,
    "unfinished",
  );
  assert.equal(
    observationReview({ ...pending, number: 1, total: 2, jobState: "RUNNING" })
      .status,
    "previous",
  );
  assert.equal(
    observationReview({ ...base, attemptId: undefined }).status,
    "unknown",
  );
});
