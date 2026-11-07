export function observationReview(input: {
  attemptId?: string;
  finalAttemptId?: string | null;
  hasFinalResult: boolean;
  number: number;
  total: number;
  termination: string;
  matchTermination?: string | null;
  jobState: string;
}) {
  const matched = !!input.attemptId && input.attemptId === input.finalAttemptId;
  const valid = ["normal", "rule_draw"].includes(input.termination);
  const status =
    !input.attemptId || (input.hasFinalResult && !input.finalAttemptId)
      ? "unknown"
      : matched
        ? valid
          ? "included"
          : "excluded"
        : input.finalAttemptId || input.number < input.total
          ? "previous"
          : ["QUEUED", "PREPARING", "RUNNING", "AGGREGATING"].includes(
                input.jobState,
              )
            ? "pending"
            : "unfinished";
  return {
    number: input.number,
    total: input.total,
    status,
    matchCounted:
      matched && ["normal", "rule_draw"].includes(input.matchTermination || ""),
    matchTermination: matched ? input.matchTermination : null,
  };
}
