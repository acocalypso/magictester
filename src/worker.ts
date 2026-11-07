import { storeActionHistory } from "./action-history.js";
import { partitionIndices, runParallel, interleave } from "./parallel.js";
import Fastify from "fastify";
import { setMaxListeners } from "node:events";
import { Worker } from "bullmq";
import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, pool } from "./db.js";
import { jobs, runs, events } from "./schema.js";
import { config, redisOptions } from "./config.js";
import { getJob } from "./service.js";
import { queue } from "./queue.js";
import { serializeDeck, type GameResult, type EngineResult } from "./engine.js";
import { executionPlans } from "./planning.js";
import { getFormat } from "./formats.js";
const log = (event: string, data: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ event, ...data }));
// Each active analysis installs a shutdown listener; allow the supported 16 slots.
process.setMaxListeners(Math.max(process.getMaxListeners(), 20));
const activeControllers = new Map<string, AbortController>();
let parallelSlots = 1;
let workerStopping = false;
const worker = new Worker(
  "simulations",
  async (task) => {
    const id = task.data.id as string;
    const lock = await pool.connect();
    let locked = false;
    try {
      locked = (
        await lock.query(
          "SELECT pg_try_advisory_lock(hashtext($1)) AS acquired",
          [id],
        )
      ).rows[0].acquired;
      if (!locked) throw new Error("Job is already owned by another worker");
      let job = await getJob(id);
      if (["COMPLETED", "CANCELLED"].includes(job.state)) return;
      const controller = new AbortController();
      setMaxListeners(32, controller.signal);
      let shuttingDown = false;
      let deadlineReached = false;
      const elapsed = job.startedAt
        ? Date.now() - Date.parse(job.startedAt)
        : 0;
      const remaining = config.MAX_JOB_RUNTIME_SECONDS * 1000 - elapsed;
      if (remaining <= 0) {
        await db
          .update(runs)
          .set({
            state: "ERROR",
            error: "Maximum job runtime exceeded",
            finishedAt: new Date().toISOString(),
          })
          .where(and(eq(runs.jobId, id), eq(runs.state, "PENDING")));
        await db
          .update(jobs)
          .set({
            state: "FAILED",
            error: "Maximum job runtime exceeded",
            finishedAt: new Date().toISOString(),
          })
          .where(eq(jobs.id, id));
        return;
      }
      activeControllers.set(id, controller);
      const deadline = setTimeout(() => {
        deadlineReached = true;
        controller.abort();
      }, remaining);
      deadline.unref();
      const poll = setInterval(() => {
        void (async () => {
          const [state] = await db
            .select({ cancel: jobs.cancelRequested, state: jobs.state })
            .from(jobs)
            .where(eq(jobs.id, id));
          if (state?.cancel || state?.state === "CANCELLED") controller.abort();
        })().catch(() => controller.abort());
      }, 1000);
      poll.unref();
      const onShutdown = () => {
        shuttingDown = true;
        controller.abort();
      };
      process.once("SIGTERM", onShutdown);
      process.once("SIGINT", onShutdown);
      try {
        await db
          .update(jobs)
          .set({
            state: "PREPARING",
            startedAt: job.startedAt || new Date().toISOString(),
            error: null,
          })
          .where(and(eq(jobs.id, id), eq(jobs.cancelRequested, false)));
        if (job.config.bridgeVersion !== "2")
          throw new Error(
            "This analysis uses an older engine version. Start a new analysis instead of mixing result contracts.",
          );
        const prepared = [];
        for (const plan of executionPlans(job)) {
          const allPending = await db
            .select()
            .from(runs)
            .where(
              and(
                eq(runs.jobId, id),
                eq(runs.opponentId, plan.key),
                eq(runs.state, "PENDING"),
              ),
            );
          if (allPending.length) prepared.push({ plan, allPending });
        }
        const groups: (() => Promise<void>)[][] = [];
        const lanesPerPlan = Math.max(
          1,
          Math.ceil(parallelSlots / Math.max(1, prepared.length)),
        );
        for (const { plan, allPending } of prepared) {
          const group: (() => Promise<void>)[] = [];
          groups.push(group);
          const sorted = allPending
            .map((r) => r.batchIndex)
            .sort((a, b) => a - b);
          for (const batch of partitionIndices(
            sorted,
            lanesPerPlan,
            config.FORGE_BATCH_SIZE,
          )) {
            const indices = new Set(batch);
            const pending = allPending.filter((r) => indices.has(r.batchIndex));
            group.push(async () => {
              if (controller.signal.aborted) throw Error("Job interrupted");
              await db.insert(events).values({
                id: randomUUID(),
                jobId: id,
                kind: plan.kind === "pod" ? "POD_STARTED" : "MATCHUP_STARTED",
                data: {
                  opponentId: plan.key,
                  name: plan.name,
                  seed: plan.seed,
                },
              });
              log(plan.kind === "pod" ? "pod_started" : "matchup_started", {
                jobId: id,
                opponentId: plan.key,
                games: pending.length,
                totalGames: plan.games,
              });
              let response: Response | undefined;
              // Capacity is global in the single runner service. Queue here, without creating another JVM.
              while (!response) {
                const r = await fetch(
                  (process.env.RUNNER_URL || "http://localhost:3002") +
                    "/games",
                  {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      jobId: id,
                      decks: [
                        serializeDeck(job.deck.cards, "player-0"),
                        ...plan.opponents.map((opponent, i) =>
                          serializeDeck(opponent.cards, `player-${i + 1}`),
                        ),
                      ],
                      mode: getFormat(job.format)!.engineGameType,
                      bestOf: job.config.gameMode === "BO3" ? 3 : 1,
                      maxMatchGames:
                        job.config.gameMode === "BO3"
                          ? Number(job.config.maxMatchGames)
                          : 5,
                      sideboarding: job.config.sideboardMode === "forge",
                      companions: [
                        job.deck.cards,
                        ...plan.opponents.map((o) => o.cards),
                      ].map(
                        (cards) =>
                          cards.find((c) => c.section === "COMPANION")?.name ??
                          null,
                      ),
                      games: plan.games,
                      indices: pending
                        .map((r) => r.batchIndex)
                        .sort((a, b) => a - b),
                      seed: plan.seed,
                      clockSeconds: job.clockSeconds,
                      traceId: id + "_" + plan.key,
                      runtime: job.config.bridge,
                    }),
                    signal: controller.signal,
                  },
                );
                if (r.status === 429) {
                  await r.body?.cancel();
                  await new Promise<void>((resolve) => {
                    const timer = setTimeout(resolve, 1000);
                    controller.signal.addEventListener(
                      "abort",
                      () => {
                        clearTimeout(timer);
                        resolve();
                      },
                      { once: true },
                    );
                  });
                  if (controller.signal.aborted)
                    throw new Error("Job interrupted");
                  continue;
                }
                if (!r.ok) throw new Error(`Runner HTTP ${r.status}`);
                response = r;
              }
              const reader = response.body!.getReader();
              const decoder = new TextDecoder();
              let buffer = "";
              let complete = false;
              try {
                while (true) {
                  const chunk = await reader.read();
                  if (chunk.done) break;
                  buffer += decoder.decode(chunk.value, { stream: true });
                  let newline;
                  while ((newline = buffer.indexOf("\n")) !== -1) {
                    const line = buffer.slice(0, newline);
                    buffer = buffer.slice(newline + 1);
                    if (!line.trim()) continue;
                    const message = JSON.parse(line);
                    if (message.type === "started")
                      await db
                        .update(jobs)
                        .set({ state: "RUNNING" })
                        .where(
                          and(eq(jobs.id, id), eq(jobs.cancelRequested, false)),
                        );
                    if (message.type === "error")
                      throw new Error(message.error);
                    if (message.type === "complete") complete = true;
                    if (message.type === "game") {
                      const game = message.result as GameResult;
                      const matchIndex = message.matchIndex;
                      const expectedBridge = job.config.bridge as {
                        sourceHash?: string;
                      };
                      if (
                        job.config.gameMode !== "BO3" ||
                        !Number.isInteger(matchIndex) ||
                        matchIndex < 0 ||
                        matchIndex >= plan.games ||
                        !indices.has(matchIndex) ||
                        game.seed !==
                          (plan.seed + matchIndex * 1009) % 2147483647 ||
                        game.bridgeSourceHash !== expectedBridge.sourceHash
                      )
                        throw new Error("Invalid match observation");
                      game.players = game.players.map((p, i) => ({
                        ...p,
                        id: i === 0 ? job.deck.id : `${plan.key}:seat-${i}`,
                        deckId:
                          i === 0 ? job.deck.id : plan.opponents[i - 1].id,
                        seat: i,
                      }));
                      await storeActionHistory(
                        game,
                        id,
                        plan.key,
                        matchIndex,
                        game.index,
                      );
                      await db.insert(events).values({
                        id: randomUUID(),
                        jobId: id,
                        kind: "GAME_OBSERVED",
                        data: {
                          opponentId: plan.key,
                          matchIndex,
                          attemptId: game.logId,
                          result: game,
                        },
                      });
                      continue;
                    }
                    if (message.type !== "result") continue;
                    const result = message.result as EngineResult;
                    if (
                      result.index < 0 ||
                      result.index >= plan.games ||
                      !indices.has(result.index) ||
                      result.seed !== plan.seed
                    )
                      throw new Error(
                        "Runner returned invalid result identity",
                      );
                    const expectedBridge = job.config.bridge as
                      { sourceHash?: string } | undefined;
                    if (
                      expectedBridge?.sourceHash &&
                      result.bridgeSourceHash !== expectedBridge.sourceHash
                    )
                      throw new Error(
                        "Forge bridge changed since submission; resubmit rather than mixing engine versions.",
                      );
                    result.players = result.players.map((p, i) => ({
                      ...p,
                      id: i === 0 ? job.deck.id : `${plan.key}:seat-${i}`,
                      deckId: i === 0 ? job.deck.id : plan.opponents[i - 1].id,
                      seat: i,
                    }));
                    if (result.unit === "match")
                      result.games = result.games.map((game) => ({
                        ...game,
                        players: game.players.map((p, i) => ({
                          ...p,
                          id: i === 0 ? job.deck.id : `${plan.key}:seat-${i}`,
                          deckId:
                            i === 0 ? job.deck.id : plan.opponents[i - 1].id,
                          seat: i,
                        })),
                      }));
                    if (result.unit === "match") {
                      for (const game of result.games)
                        await storeActionHistory(
                          game,
                          id,
                          plan.key,
                          result.index,
                          game.index,
                        );
                    } else
                      await storeActionHistory(
                        result,
                        id,
                        plan.key,
                        result.index,
                        0,
                      );
                    await db
                      .update(runs)
                      .set({
                        state:
                          result.termination === "engine_error"
                            ? "ERROR"
                            : "DONE",
                        result,
                        finishedAt: new Date().toISOString(),
                      })
                      .where(
                        and(
                          eq(runs.jobId, id),
                          eq(runs.opponentId, plan.key),
                          eq(runs.batchIndex, result.index),
                          eq(runs.state, "PENDING"),
                        ),
                      );
                  }
                }
                if (!complete)
                  throw new Error("Runner disconnected before completion");
              } finally {
                await reader.cancel().catch(() => {});
                reader.releaseLock();
              }
            });
          }
        }
        await runParallel(interleave(groups), () => parallelSlots, controller);
        job = await getJob(id);
        if (job.cancelRequested) throw new Error("Job cancelled");
        await db
          .update(jobs)
          .set({ state: "AGGREGATING" })
          .where(and(eq(jobs.id, id), eq(jobs.cancelRequested, false)));
        const [counts] = await db
          .select({
            pending: sql<number>`count(*) filter (where ${runs.state}='PENDING')::int`,
            errors: sql<number>`count(*) filter (where ${runs.state}='ERROR')::int`,
          })
          .from(runs)
          .where(eq(runs.jobId, id));
        if (counts.pending || counts.errors)
          throw new Error("Benchmark has incomplete or failed engine games");
        await db
          .update(jobs)
          .set({ state: "COMPLETED", finishedAt: new Date().toISOString() })
          .where(and(eq(jobs.id, id), eq(jobs.cancelRequested, false)));
        log("job_completed", { jobId: id });
      } catch (error) {
        const latest = await getJob(id);
        if (latest.cancelRequested) {
          await db
            .update(jobs)
            .set({ state: "CANCELLED", finishedAt: new Date().toISOString() })
            .where(eq(jobs.id, id));
          log("job_cancelled", { jobId: id });
          return;
        }
        if (shuttingDown) {
          log("job_interrupted", { jobId: id });
          throw error;
        }
        const message = deadlineReached
          ? "Maximum job runtime exceeded"
          : (error as Error).message;
        // Keep pending runs pending on transient failure so BullMQ can resume them. On final failure
        // expose explicit errors. Completed run identities never change during recovery.
        const final =
          task.attemptsMade + 1 >= Number(task.opts.attempts || 1) ||
          deadlineReached;
        if (final)
          await db
            .update(runs)
            .set({
              state: "ERROR",
              error: message,
              finishedAt: new Date().toISOString(),
            })
            .where(and(eq(runs.jobId, id), eq(runs.state, "PENDING")));
        await db
          .update(jobs)
          .set({
            state: final ? "FAILED" : "QUEUED",
            error: message,
            finishedAt: final ? new Date().toISOString() : null,
          })
          .where(and(eq(jobs.id, id), eq(jobs.cancelRequested, false)));
        log("job_failed", { jobId: id, error: message, final });
        if (!final) throw error;
      } finally {
        clearInterval(poll);
        clearTimeout(deadline);
        process.removeListener("SIGTERM", onShutdown);
        process.removeListener("SIGINT", onShutdown);
        activeControllers.delete(id);
      }
    } finally {
      if (locked)
        await lock.query("SELECT pg_advisory_unlock(hashtext($1))", [id]);
      lock.release();
    }
  },
  {
    connection: redisOptions,
    concurrency: config.SIMULATION_CONCURRENCY || 1,
    lockDuration: 60000,
    autorun: false,
  },
);
let checkingCapacity = false;
async function refreshCapacity() {
  if (checkingCapacity) return;
  checkingCapacity = true;
  try {
    const response = await fetch(
      (process.env.RUNNER_URL || "http://localhost:3002") + "/health",
      { signal: AbortSignal.timeout(3000) },
    );
    if (!response.ok) throw Error("Engine health is unavailable");
    const health = (await response.json()) as { max?: number };
    parallelSlots = Math.max(1, Math.min(16, Number(health.max) || 1));
    if (workerStopping) return;
    const next = config.SIMULATION_CONCURRENCY || parallelSlots;
    const wake = next > worker.concurrency && worker.isRunning();
    // BullMQ's concurrency setter does not wake a loop waiting on active jobs.
    // Public pause/resume keeps active jobs and their locks while waking the fetch loop.
    if (wake) await worker.pause(true);
    worker.concurrency = next;
    if (wake && !workerStopping) await worker.resume();
  } catch (error) {
    log("capacity_check_failed", { error: (error as Error).message });
  } finally {
    checkingCapacity = false;
  }
}
await refreshCapacity();
const capacityTimer = setInterval(() => void refreshCapacity(), 5000);
capacityTimer.unref();
worker.on("error", (error) => log("worker_error", { error: error.message }));
worker.on("failed", (task, error) =>
  log("queue_attempt_failed", { jobId: task?.id, error: error.message }),
);
void worker
  .run()
  .catch((error) => log("worker_error", { error: error.message }));
const health = Fastify();
health.get("/health", async (_req, reply) => {
  try {
    await pool.query("SELECT 1");
    await queue.getJobCounts();
    if (!worker.isRunning())
      return reply.code(503).send({ status: "stopping" });
    return {
      status: "ok",
      active: activeControllers.size,
      maxAnalyses: worker.concurrency,
      parallelRequestsPerAnalysis: parallelSlots,
    };
  } catch {
    return reply.code(503).send({ status: "unavailable" });
  }
});
await health.listen({ port: 3003, host: "0.0.0.0" });
let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(
    signal,
    () =>
      void (async () => {
        if (stopping) return;
        stopping = true;
        workerStopping = true;
        clearInterval(capacityTimer);
        for (const c of activeControllers.values()) c.abort();
        await worker.close();
        await health.close();
        await queue.close();
        await pool.end();
      })(),
  );
