import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "./db.js";
import { actionHistories } from "./schema.js";
import type { GameResult } from "./engine.js";
import type { ActionHistoryRef } from "./game-actions.js";
// Persist once per game and native attempt. BO3 observations and final match results
// must point to the same immutable history, even if the worker retries a write.
export async function storeActionHistory(
  game: GameResult,
  jobId: string,
  opponentId: string,
  unitIndex: number,
  gameIndex: number,
) {
  if (!game.actionLog) return;
  if (!game.logId) throw Error("Action history has no engine attempt identity");
  const data = game.actionLog;
  const digest = createHash("sha256")
    .update(JSON.stringify(data))
    .digest("hex");
  const identity = and(
    eq(actionHistories.jobId, jobId),
    eq(actionHistories.opponentId, opponentId),
    eq(actionHistories.unitIndex, unitIndex),
    eq(actionHistories.gameIndex, gameIndex),
    eq(actionHistories.attemptId, game.logId),
  );
  let [saved] = await db
    .insert(actionHistories)
    .values({
      id: randomUUID(),
      jobId,
      opponentId,
      unitIndex,
      gameIndex,
      attemptId: game.logId,
      digest,
      data,
    })
    .onConflictDoNothing()
    .returning({ id: actionHistories.id, digest: actionHistories.digest });
  if (!saved)
    [saved] = await db
      .select({ id: actionHistories.id, digest: actionHistories.digest })
      .from(actionHistories)
      .where(identity);
  if (!saved || saved.digest !== digest)
    throw Error("Inconsistent history for the same game attempt");
  game.actionHistory = {
    id: saved.id,
    count: data.entries.length,
    total: data.total,
    complete: data.complete,
  } satisfies ActionHistoryRef;
  delete game.actionLog;
}
