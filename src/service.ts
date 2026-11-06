import { getFormat } from "./formats.js";
import { randomUUID, createHash } from "node:crypto";
import { and, eq, inArray, sql, desc } from "drizzle-orm";
import { db, pool } from "./db.js";
import { jobs, runs, snapshots, deckVersions, events } from "./schema.js";
import { config, ACTIVE } from "./config.js";
import { planGames, validateDeck, type CardDataProvider } from "./domain.js";
import { summarize } from "./analytics.js";
import { queue, enqueue } from "./queue.js";
export class RequestError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export async function createSimulation(
  input: {
    name: string;
    decklist: string;
    format: string;
    snapshotId: string;
    games: number;
    seed: number;
    clockSeconds: number;
  },
  client: string,
  provider: CardDataProvider,
) {
  if (!getFormat(input.format)?.enabled)
    throw new RequestError(422, "Simulation is not enabled for this format");
  const validation = validateDeck(input.decklist, input.format, provider);
  if (!validation.valid)
    throw new RequestError(422, "Deck validation failed", validation.errors);
  const [snapshot] = await db
    .select()
    .from(snapshots)
    .where(eq(snapshots.id, input.snapshotId));
  if (!snapshot || snapshot.format !== input.format)
    throw new RequestError(422, "Snapshot missing or format mismatch");
  const clientKey = createHash("sha256").update(client).digest("hex");
  const id = randomUUID();
  const versionId = randomUUID();
  await db.transaction(async (tx) => {
    // Serialize quota checks and creation across API replicas.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(713917)`);
    const active = await tx
      .select({ clientKey: jobs.clientKey })
      .from(jobs)
      .where(inArray(jobs.state, ACTIVE));
    if (
      active.length >= config.MAX_QUEUED_JOBS ||
      active.filter((j) => j.clientKey === clientKey).length >=
        config.MAX_ACTIVE_JOBS_PER_CLIENT
    )
      throw new RequestError(
        429,
        "Active job limit reached. Wait for an existing job to finish.",
      );
    await tx.insert(deckVersions).values({
      id: versionId,
      name: input.name,
      format: input.format,
      decklist: input.decklist,
      cards: validation.cards,
      cardData: validation.cardData,
    });
    await tx.insert(jobs).values({
      id,
      deckVersionId: versionId,
      snapshotId: snapshot.id,
      games: input.games,
      seed: input.seed,
      clockSeconds: input.clockSeconds,
      clientKey,
      config: {
        benchmarkMode: snapshot.selectionMethod,
        gameMode: "BO1",
        distribution:
          "equal games per selected deck; remainder assigned in snapshot order",
        engine: "forge",
        forgeRelease: "2.0.15",
        bridgeVersion: "1",
        aiProfile: "Default",
        bridge: provider.provenance.engineBridge,
        seedMethod: "(matchupSeed + batchIndex * 1009) modulo 2147483647",
        turnUnit:
          "individual player turns (Forge GameOutcome.getLastTurnNumber)",
        submittedSeat: 0,
      },
    });
    for (const plan of planGames(input.games, snapshot.decks, input.seed))
      await tx.insert(runs).values(
        Array.from({ length: plan.games }, (_, batchIndex) => ({
          id: randomUUID(),
          jobId: id,
          opponentId: plan.opponent.id,
          batchIndex,
          seed: plan.seed,
        })),
      );
    await tx.insert(events).values({
      id: randomUUID(),
      jobId: id,
      kind: "QUEUED",
      data: { games: input.games },
    });
  });
  // The database row is the durable outbox. Reconciliation retries enqueue if Redis is unavailable.
  await enqueue(id).catch(() => {});
  return getJob(id);
}
export async function getJob(id: string) {
  const [record] = await db
    .select({ job: jobs, deck: deckVersions, snapshot: snapshots })
    .from(jobs)
    .innerJoin(deckVersions, eq(jobs.deckVersionId, deckVersions.id))
    .innerJoin(snapshots, eq(jobs.snapshotId, snapshots.id))
    .where(eq(jobs.id, id));
  if (!record) throw new RequestError(404, "Simulation not found");
  const [stats] = await db
    .select({
      completed: sql<number>`count(*) filter (where ${runs.state}='DONE')::int`,
      failed: sql<number>`count(*) filter (where ${runs.state}='ERROR')::int`,
      pending: sql<number>`count(*) filter (where ${runs.state}='PENDING')::int`,
      timeouts: sql<number>`count(*) filter (where ${runs.result}->>'termination'='timeout')::int`,
    })
    .from(runs)
    .where(eq(runs.jobId, id));
  const { clientKey: _clientKey, ...job } = record.job;
  return {
    ...job,
    name: record.deck.name,
    format: record.deck.format,
    deck: record.deck,
    snapshot: record.snapshot,
    ...stats,
    progress: (stats.completed + stats.failed) / record.job.games,
  };
}
export async function listJobs(limit = 50) {
  const rows = await db
    .select({ id: jobs.id })
    .from(jobs)
    .orderBy(desc(jobs.createdAt))
    .limit(limit);
  return Promise.all(rows.map((j) => getJob(j.id)));
}
export async function resultsFor(id: string) {
  const job = await getJob(id);
  const rows = await db.select().from(runs).where(eq(runs.jobId, id));
  const results = rows.flatMap((r) => (r.result ? [r.result] : []));
  return {
    job,
    summary: {
      ...summarize(results),
      errors: rows.filter((r) => r.state === "ERROR").length,
    },
    matchups: job.snapshot.decks.map((opponent) => ({
      opponent,
      planned: rows.filter((r) => r.opponentId === opponent.id).length,
      ...summarize(
        rows
          .filter((r) => r.opponentId === opponent.id)
          .flatMap((r) => (r.result ? [r.result] : [])),
      ),
      errors: rows.filter(
        (r) => r.opponentId === opponent.id && r.state === "ERROR",
      ).length,
    })),
    limitations: [
      "Forge AI uses heuristics: strongest at aggro/midrange, weaker at control and combo. These results are not human tournament win rates.",
      "Games are BO1; sideboards are validated and stored but no BO3 sideboarding is performed.",
      "Starting player is observed, not forced; equal play/draw counts are not guaranteed.",
      "Seeds are passed to Forge; exact replay across builds or concurrent engine internals is not guaranteed.",
      "Timeouts and engine errors are excluded from the win-rate denominator; rule draws are non-wins.",
      job.config.bridgeVersion === "1"
        ? "Turn count is the number of individual player turns reported by Forge GameOutcome; commander casts also carry the caster’s own turn number."
        : "Legacy turn count is Forge’s reported end round, not individual player turns.",
    ],
  };
}
export async function cancelJob(id: string) {
  const job = await getJob(id);
  if (!ACTIVE.includes(job.state)) return job;
  await db
    .update(jobs)
    .set({
      cancelRequested: true,
      state: "CANCELLED",
      finishedAt: new Date().toISOString(),
    })
    .where(and(eq(jobs.id, id), inArray(jobs.state, ACTIVE)));
  return getJob(id);
}
export async function retryJob(id: string) {
  const job = await getJob(id);
  if (!["FAILED", "CANCELLED"].includes(job.state))
    throw new RequestError(409, "Only failed or cancelled jobs can be retried");
  const queued = await queue.getJob(id);
  if (queued) {
    if (await queued.isActive())
      throw new RequestError(
        409,
        "Previous worker is still stopping. Retry shortly.",
      );
    await queued.remove();
  }
  await db.transaction(async (tx) => {
    const changed = await tx
      .update(jobs)
      .set({
        state: "QUEUED",
        cancelRequested: false,
        error: null,
        finishedAt: null,
        startedAt: null,
      })
      .where(and(eq(jobs.id, id), inArray(jobs.state, ["FAILED", "CANCELLED"])))
      .returning();
    if (!changed.length) throw new RequestError(409, "Job state changed");
    await tx
      .update(runs)
      .set({ state: "PENDING", result: null, error: null, finishedAt: null })
      .where(and(eq(runs.jobId, id), eq(runs.state, "ERROR")));
  });
  await enqueue(id);
  return getJob(id);
}
export async function reconcile() {
  const candidates = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(inArray(jobs.state, ACTIVE));
  for (const row of candidates) {
    const queued = await queue.getJob(row.id);
    if (!queued) await enqueue(row.id);
    else if (["failed", "completed"].includes(await queued.getState())) {
      const message =
        "Queue exhausted its retry/stall budget without a terminal database status. Explicit retry is required.";
      await db.transaction(async (tx) => {
        const changed = await tx
          .update(jobs)
          .set({
            state: "FAILED",
            error: message,
            finishedAt: new Date().toISOString(),
          })
          .where(and(eq(jobs.id, row.id), inArray(jobs.state, ACTIVE)))
          .returning();
        if (changed.length)
          await tx
            .update(runs)
            .set({
              state: "ERROR",
              error: message,
              finishedAt: new Date().toISOString(),
            })
            .where(and(eq(runs.jobId, row.id), eq(runs.state, "PENDING")));
      });
    }
  }
}
export async function closeServices() {
  await queue.close();
  await pool.end();
}
