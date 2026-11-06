import { pool } from "./db.js";
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
export async function reviewedObservations(
  job: { id: string; state: string },
  limit: number,
  offset: number,
) {
  const rows = (
    await pool.query(
      `WITH attempts AS (
    SELECT data->>'opponentId' AS opponent, data->>'matchIndex' AS match_index,
      coalesce(data->>'attemptId',id::text) AS attempt, min(created_at) AS first_seen,min(id::text) AS first_id
    FROM simulation_events WHERE job_id=$1 AND kind='GAME_OBSERVED'
    GROUP BY 1,2,3
  ), ranked AS (
    SELECT *,row_number() OVER(PARTITION BY opponent,match_index ORDER BY first_seen,first_id) AS number,
      count(*) OVER(PARTITION BY opponent,match_index) AS total FROM attempts
  ) SELECT e.id,e.job_id AS "jobId",e.kind,e.data,e.created_at AS "createdAt",a.number,a.total,
    r.result->>'logId' AS "finalAttemptId",r.result IS NOT NULL AS "hasFinalResult",r.result->>'termination' AS "matchTermination"
  FROM simulation_events e JOIN ranked a ON a.opponent=e.data->>'opponentId' AND a.match_index=e.data->>'matchIndex' AND a.attempt=coalesce(e.data->>'attemptId',e.id::text)
  LEFT JOIN simulation_runs r ON r.job_id=e.job_id AND r.opponent_id=a.opponent AND r.batch_index::text=a.match_index
  WHERE e.job_id=$1 AND e.kind='GAME_OBSERVED' ORDER BY e.created_at,e.id LIMIT $2 OFFSET $3`,
      [job.id, limit, offset],
    )
  ).rows;
  return rows.map(
    ({
      number,
      total,
      finalAttemptId,
      hasFinalResult,
      matchTermination,
      ...event
    }) => ({
      ...event,
      review: observationReview({
        number: Number(number),
        total: Number(total),
        attemptId: event.data.attemptId,
        termination: event.data.result.termination,
        finalAttemptId,
        hasFinalResult,
        matchTermination,
        jobState: job.state,
      }),
    }),
  );
}
