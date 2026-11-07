import { retryOptionsSchema, type RetryOptions } from "./retry-options.js";
import {
  resolveRuntime,
  updateStatus,
  runtimeRoot,
  stableReleaseProblem,
} from "./runtime.mjs";
import { currentMetagame } from "./meta-current.js";
import { getFormat } from "./formats.js";
import { randomUUID, createHash } from "node:crypto";
import { and, eq, inArray, sql, desc } from "drizzle-orm";
import { db, pool } from "./db.js";
import { jobs, runs, snapshots, deckVersions, events } from "./schema.js";
import { config, ACTIVE } from "./config.js";
import { validateDeck, type CardDataProvider } from "./domain.js";
import {
  planBenchmark,
  storePlans,
  executionPlans,
  type BenchmarkSelection,
} from "./planning.js";
import { gameResults } from "./engine.js";
import { summarize, summarizeMatches } from "./analytics.js";
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
    snapshotId?: string;
    poolMode?: "fixed" | "latest";
    games: number;
    seed: number;
    clockSeconds: number;
    gameMode?: "BO1" | "BO3";
    maxMatchGames?: number;
    sideboardMode?: "none" | "forge";
    selection?: BenchmarkSelection;
  },
  client: string,
  provider: CardDataProvider,
) {
  if (!getFormat(input.format)?.enabled)
    throw new RequestError(422, "Simulation is not enabled for this format");
  const bestOf = input.gameMode === "BO3";
  const maxMatchGames = bestOf ? (input.maxMatchGames ?? 5) : 1;
  if (bestOf && getFormat(input.format)!.players !== 2)
    throw new RequestError(422, "BO3 requires a two-player format");
  if (
    bestOf &&
    (!Number.isInteger(maxMatchGames) || maxMatchGames < 3 || maxMatchGames > 9)
  )
    throw new RequestError(422, "Match game limit must be between 3 and 9");
  if (input.games * maxMatchGames > config.MAX_GAMES_PER_JOB)
    throw new RequestError(
      422,
      `The job is limited to ${config.MAX_GAMES_PER_JOB} actual game attempts; reduce matches or the per-match limit.`,
    );
  if (
    bestOf &&
    getFormat(input.format)!.commander &&
    input.sideboardMode === "forge"
  )
    throw new RequestError(
      422,
      "Commander-family formats have no conventional sideboard",
    );
  const sideboardMode =
    bestOf && !getFormat(input.format)!.commander
      ? (input.sideboardMode ?? "forge")
      : "none";
  const updates = await updateStatus(runtimeRoot());
  const activeBridge = provider.provenance.engineBridge as
    { engineVersion?: string; sourceHash?: string } | undefined;
  const releaseProblem = stableReleaseProblem(
    updates,
    activeBridge?.engineVersion,
  );
  if (releaseProblem) throw new RequestError(503, releaseProblem);
  const validation = validateDeck(input.decklist, input.format, provider);
  if (!validation.valid)
    throw new RequestError(422, "Deck validation failed", validation.errors);
  let resolvedSnapshotId = input.snapshotId;
  if (input.poolMode === "latest") {
    const current = await currentMetagame(input.format);
    if (
      !current.snapshot ||
      current.error ||
      ["paused", "stale", "error", "pending", "unconfigured"].includes(
        current.status,
      )
    )
      throw new RequestError(
        503,
        "The current daily metagame is not ready. Check source status or explicitly choose a saved pool.",
      );
    if (input.snapshotId && input.snapshotId !== current.snapshot.id)
      throw new RequestError(
        409,
        "The daily metagame changed. Review the refreshed opponent pool and submit again.",
      );
    const sourceData = current.snapshot.metadata.cardData as
      { sha256?: string; engineBridge?: { sourceHash?: string } } | undefined;
    const engine = provider.provenance.engineBridge as
      { sourceHash?: string } | undefined;
    if (
      sourceData?.sha256 !== provider.provenance.sha256 ||
      sourceData?.engineBridge?.sourceHash !== engine?.sourceHash
    )
      throw new RequestError(
        503,
        "Daily opponents are being revalidated against the current card data and engine. Choose a saved pool or retry after refresh.",
      );
    resolvedSnapshotId = current.snapshot.id;
  }
  if (!resolvedSnapshotId)
    throw new RequestError(
      422,
      "Choose a saved snapshot or the latest daily metagame",
    );
  const [snapshot] = await db
    .select()
    .from(snapshots)
    .where(eq(snapshots.id, resolvedSnapshotId));
  if (!snapshot || snapshot.format !== input.format)
    throw new RequestError(422, "Snapshot missing or format mismatch");
  let plans;
  try {
    plans = planBenchmark(
      input.format,
      input.games,
      snapshot.decks,
      input.seed,
      input.selection,
    );
  } catch (e) {
    throw new RequestError(422, (e as Error).message);
  }
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
        poolMode: input.poolMode || "fixed",
        gameMode: bestOf ? "BO3" : "BO1",
        unit: bestOf ? "matches" : "games",
        maxMatchGames,
        maxGameAttempts: input.games * maxMatchGames,
        sideboardMode,
        executionPlan: storePlans(plans),
        selection: input.selection || { mode: "equal" },
        players: getFormat(input.format)!.players,
        rules: {
          format: input.format,
          engineMode: getFormat(input.format)!.engineGameType,
          mulliganRule: "London",
          startingLife: getFormat(input.format)!.startingLife,
        },
        distribution: input.selection?.pods
          ? "explicit ordered pods; largest-remainder weighted allocation"
          : input.selection?.mode && input.selection.mode !== "equal"
            ? getFormat(input.format)!.players === 4
              ? "at most 50 seeded weighted roster draws; equal allocation across draws; approximate seat shares"
              : "largest-remainder allocation using selected weights; ties in snapshot order"
            : getFormat(input.format)!.players === 4
              ? "equal games per rotating pod; consecutive snapshot lists fill the three opponent seats; lists repeat when pool has fewer than three decks"
              : `equal ${bestOf ? "matches" : "games"} per selected deck; remainder assigned in snapshot order`,
        engine: "forge",
        forgeRelease: activeBridge?.engineVersion,
        bridgeVersion: "2",
        aiProfile: "Default",
        bridge: provider.provenance.engineBridge,
        seedMethod:
          "unitSeed = (matchupSeed + batchIndex * 1009) modulo 2147483647",
        gameSeedMethod: bestOf
          ? "(unitSeed + gameIndex * 307) modulo 2147483647"
          : "unitSeed",
        turnUnit:
          "individual player turns (Forge GameOutcome.getLastTurnNumber)",
        submittedSeat: 0,
      },
    });
    for (const plan of plans)
      await tx.insert(runs).values(
        Array.from({ length: plan.games }, (_, batchIndex) => ({
          id: randomUUID(),
          jobId: id,
          opponentId: plan.key,
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
      actualGames: sql<number>`coalesce(sum(case when ${runs.result} is null then 0 when ${runs.result}->>'unit'='match' then jsonb_array_length(${runs.result}->'games') else 1 end),0)::int`,
      limited: sql<number>`count(*) filter(where ${runs.result}->>'termination'='game_limit')::int`,
      timeouts: sql<number>`count(*) filter (where ${runs.result}->>'termination'='timeout')::int`,
    })
    .from(runs)
    .where(eq(runs.jobId, id));
  const [observations] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(events)
    .where(and(eq(events.jobId, id), eq(events.kind, "GAME_OBSERVED")));
  const { clientKey: _clientKey, ...job } = record.job;
  return {
    ...job,
    name: record.deck.name,
    format: record.deck.format,
    deck: record.deck,
    snapshot: record.snapshot,
    ...stats,
    observedGames:
      record.job.config.gameMode === "BO3"
        ? observations.count
        : stats.actualGames,
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
      ...summarize(gameResults(results), 0, !!getFormat(job.format)?.commander),
      errors: rows.filter((r) => r.state === "ERROR").length,
    },
    matchSummary: summarizeMatches(results),
    matchups: executionPlans(job).map((plan) => ({
      opponent:
        plan.kind === "pod"
          ? {
              cards: [],
              decklist: "",
              sourceUrl: null,
              metaShare: null,
              strategy: "UNKNOWN" as const,
              id: plan.key,
              name: plan.name,
              archetype: plan.opponents.map((o) => o.archetype).join(" / "),
            }
          : plan.opponents[0],
      kind: plan.kind,
      participants: plan.opponents,
      planned: rows.filter((r) => r.opponentId === plan.key).length,
      ...summarize(
        gameResults(
          rows
            .filter((r) => r.opponentId === plan.key)
            .flatMap((r) => (r.result ? [r.result] : [])),
        ),
        0,
        !!getFormat(job.format)?.commander,
      ),
      matchSummary: summarizeMatches(
        rows
          .filter((r) => r.opponentId === plan.key)
          .flatMap((r) => (r.result ? [r.result] : [])),
      ),
      errors: rows.filter(
        (r) => r.opponentId === plan.key && r.state === "ERROR",
      ).length,
    })),
    limitations: [
      "Forge AI uses heuristics: strongest at aggro/midrange, weaker at control and combo. These results are not human tournament win rates.",
      job.config.gameMode === "BO3"
        ? "BO3 uses native first-to-two wins. Rule draws can extend a match; reaching the saved game limit leaves it incomplete and excludes it from match win rates. Actual games remain visible."
        : "Games are BO1; no between-game sideboarding is performed.",
      job.config.sideboardMode === "forge"
        ? "Sideboarding uses Forge's generic heuristics, not human matchup knowledge. Actual changes and companion selections are recorded; a designated companion may be unavailable after sideboarding."
        : "Between-game sideboarding is disabled.",
      ...(job.config.gameMode === "BO3"
        ? [
            "Interrupted BO3 match attempts retain observed games as audit evidence. An unfinished match restarts on retry; only finalized attempts enter benchmark summaries.",
          ]
        : []),
      "Starting player is observed, not forced; equal play/draw counts are not guaranteed.",
      "Seeds are passed to Forge; exact replay across builds or concurrent engine internals is not guaranteed.",
      "Timeouts and engine errors are excluded from the win-rate denominator; rule draws are non-wins.",
      ["1", "2"].includes(String(job.config.bridgeVersion))
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
export async function retryJob(
  id: string,
  options: RetryOptions = {},
  client = "",
) {
  options = retryOptionsSchema.parse(options);
  const job = await getJob(id);
  if (job.config.bridgeVersion !== "2")
    throw new RequestError(
      409,
      "This analysis uses an older engine version. Start a new analysis instead of mixing result contracts.",
    );
  if (options.mode === "new" || options.clockSeconds !== undefined) {
    if (!["FAILED", "CANCELLED", "COMPLETED"].includes(job.state))
      throw new RequestError(
        409,
        "Wait for this run to finish or cancel it before retrying with settings",
      );
    try {
      await resolveRuntime(runtimeRoot(), job.config.bridge);
    } catch {
      throw new RequestError(
        409,
        "The saved Forge build is unavailable. Submit a new analysis instead.",
      );
    }
    if (
      job.games * Number(job.config.maxMatchGames || 1) >
      config.MAX_GAMES_PER_JOB
    )
      throw new RequestError(
        422,
        "This run exceeds the current game-attempt limit. Submit a smaller analysis.",
      );
    const nextId = randomUUID(),
      clientKey = createHash("sha256").update(client).digest("hex");
    await db.transaction(async (tx) => {
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
      await tx
        .insert(jobs)
        .values({
          id: nextId,
          deckVersionId: job.deckVersionId,
          snapshotId: job.snapshotId,
          games: job.games,
          seed: job.seed,
          clockSeconds: options.clockSeconds ?? job.clockSeconds,
          clientKey,
          config: { ...job.config, retryOf: job.id },
        });
      for (const plan of executionPlans(job))
        await tx
          .insert(runs)
          .values(
            Array.from({ length: plan.games }, (_, batchIndex) => ({
              id: randomUUID(),
              jobId: nextId,
              opponentId: plan.key,
              batchIndex,
              seed: plan.seed,
            })),
          );
      await tx
        .insert(events)
        .values({
          id: randomUUID(),
          jobId: nextId,
          kind: "QUEUED",
          data: {
            games: job.games,
            retryOf: job.id,
            clockSeconds: options.clockSeconds ?? job.clockSeconds,
          },
        });
    });
    await enqueue(nextId).catch(() => {});
    return getJob(nextId);
  }
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
