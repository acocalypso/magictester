import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { Store } from "./store.mjs";
import { RuntimeManager } from "./runtime-manager.mjs";
import { CachedCardDataProvider, validateDeck } from "./core/domain.js";
import { FORMATS, getFormat } from "./core/formats.js";
import {
  ForgeEngineAdapter,
  serializeDeck,
  gameResults,
} from "./core/engine.js";
import {
  resolveRuntime,
  updateStatus,
  stableReleaseProblem,
} from "./core/runtime.mjs";
import { referencePool } from "./core/reference-pools.js";
import { normalizeSnapshot, CsvImportProvider } from "./core/meta.js";
import { dailySources, downloadMetagame } from "./core/meta-sources.js";
import { configureSourceCache, stopSourceImports } from "./core/source-http.js";
import { importDeckLink } from "./core/deck-links.js";
import {
  planBenchmark,
  storePlans,
  executionPlans,
  selectionSchema,
} from "./core/planning.js";
import { summarize, summarizeMatches } from "./core/analytics.js";
import { retryOptionsSchema } from "./core/retry-options.js";
import { observationReview } from "./core/observation-review.js";
import { EngineScheduler, memoryMiB } from "./core/resources.js";
import { partitionIndices, runParallel, interleave } from "./core/parallel.js";
const now = () => new Date().toISOString();
const inputSchema = z.object({
  name: z.string().trim().min(1).max(150),
  format: z.enum(FORMATS.map((f) => f.id)),
  decklist: z.string().min(1).max(32768),
  snapshotId: z.string().uuid(),
  games: z.number().int().min(1).max(1000),
  seed: z.number().int().min(0).max(2147483646),
  clockSeconds: z.number().int().min(5).max(300),
  gameMode: z.enum(["BO1", "BO3"]).default("BO1"),
  maxMatchGames: z.number().int().min(3).max(9).default(5),
  sideboardMode: z.enum(["none", "forge"]).default("forge"),
  selection: selectionSchema.optional(),
});
export class DesktopApplication {
  constructor(data, emit = () => {}) {
    this.data = data;
    this.emit = emit;
    this.store = new Store(join(data, "desktop.sqlite"));
    configureSourceCache(this.store);
    this.runtime = new RuntimeManager(data, emit);
    this.cards = null;
    this.active = new Map();
    this.closing = false;
    this.refreshing = false;
    this.setupError = null;
    this.scheduler = new EngineScheduler({
      heapMiB: memoryMiB(process.env.FORGE_HEAP || "1024m"),
      overheadMiB: 512,
      cpuPerProcess: Number(process.env.FORGE_CPUS_PER_PROCESS || 2),
      reserveMiB: Number(process.env.FORGE_MEMORY_RESERVE_MB || 0),
      processCap: Number(process.env.MAX_FORGE_PROCESSES || 0),
    });
  }
  async initialize() {
    try {
      await this.loadCards();
    } catch (error) {
      this.setupError =
        error.code === "ENOENT"
          ? "Open Setup & information to download and validate Forge and card data."
          : "Initial setup is required: " + error.message;
    }
    await this.scheduler.refresh();
    this.timer = setInterval(
      () =>
        void this.tick().catch((e) =>
          this.emit("warning", { message: e.message }),
        ),
      1000,
    );
    this.maintenanceTimer = setInterval(() => void this.maintenance(), 600000);
    this.timer.unref();
    this.maintenanceTimer.unref();
    return this.status();
  }
  async loadCards() {
    this.cards = await new CachedCardDataProvider().load(this.data);
    const epoch = createHash("sha256")
      .update(
        JSON.stringify({
          cards: this.cards.provenance.sha256,
          bridge: this.cards.provenance.engineBridge,
        }),
      )
      .digest("hex");
    for (const f of FORMATS) {
      const saved = this.store.get(
        "SELECT document FROM snapshots WHERE format=? AND json_extract(document,'$.reference')=1 ORDER BY created_at DESC LIMIT 1",
        f.id,
      );
      if (!saved || JSON.parse(saved.document).metadata?.epoch !== epoch)
        this.saveSnapshot({
          ...normalizeSnapshot(referencePool(f.id, this.cards), this.cards),
          reference: true,
          metadata: { kind: "reference", epoch },
        });
    }
    this.setupError = null;
  }
  saveSnapshot(value) {
    const id = randomUUID(),
      snapshot = { ...value, id, createdAt: now() };
    this.store.run(
      "INSERT INTO snapshots VALUES(?,?,?,?)",
      id,
      snapshot.format,
      JSON.stringify(snapshot),
      snapshot.createdAt,
    );
    return snapshot;
  }
  snapshot(id) {
    const row = this.store.get("SELECT document FROM snapshots WHERE id=?", id);
    if (!row) throw Error("Opponent pool not found");
    return JSON.parse(row.document);
  }
  job(id) {
    const row = this.store.get("SELECT * FROM jobs WHERE id=?", id);
    if (!row) throw Error("Run not found");
    const document = JSON.parse(row.document);
    const stats = {
      total: row.completed + row.failed + row.pending,
      completed: row.completed,
      failed: row.failed,
      pending: row.pending,
      timeouts: row.timeouts,
    };
    return {
      ...document,
      id,
      state: row.state,
      createdAt: row.created_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      error: row.error,
      cancelRequested: !!row.cancel_requested,
      attempts: row.attempts,
      ...stats,
    };
  }
  listJobs() {
    return this.store
      .all(
        "SELECT id,state,created_at,started_at,error,completed,failed,pending,timeouts,summary_json FROM jobs ORDER BY created_at DESC LIMIT 200",
      )
      .map((row) => {
        const brief = JSON.parse(row.summary_json);
        return {
          id: row.id,
          state: row.state,
          createdAt: row.created_at,
          startedAt: row.started_at,
          error: row.error,
          completed: row.completed,
          failed: row.failed,
          pending: row.pending,
          timeouts: row.timeouts,
          input: {
            name: brief.name,
            format: brief.format,
            games: brief.games,
            clockSeconds: brief.clockSeconds,
          },
          config: {
            gameMode: brief.gameMode,
            players: brief.players,
            retryOf: brief.retryOf,
          },
          snapshotName: brief.snapshotName,
        };
      });
  }
  listSnapshots(format) {
    return this.store
      .all(
        "SELECT document FROM snapshots WHERE format=? ORDER BY created_at DESC LIMIT 30",
        format,
      )
      .map((r) => {
        const value = JSON.parse(r.document);
        return {
          ...value,
          decks: value.decks.map(({ cards, ...deck }) => deck),
        };
      });
  }
  async status() {
    const resources = await this.scheduler.refresh();
    let runtime = null;
    try {
      runtime = await resolveRuntime();
    } catch {}
    return {
      ready: !!this.cards,
      setupBusy: !!this.runtime.operation,
      setupProgress: this.runtime.progress.snapshot(),
      setupError: this.setupError,
      forge: runtime?.bridge || null,
      updates: await updateStatus().catch(() => null),
      resources,
      formats: FORMATS,
      dataDirectory: this.data,
      refreshing: this.refreshing,
      meta: this.store.setting("meta", {}),
      jobs: this.listJobs(),
      preferences: this.store.setting("preferences", { autoMeta: true }),
    };
  }
  requireReady() {
    if (!this.cards) throw Error("Complete engine and card setup first");
    if (this.runtime.operation) throw Error("Engine setup is in progress");
  }
  async create(input) {
    this.requireReady();
    input = inputSchema.parse(input);
    const format = getFormat(input.format);
    if (input.gameMode === "BO3" && format.players !== 2)
      throw Error("Four-player Commander uses BO1 pods");
    if (
      input.gameMode === "BO3" &&
      format.commander &&
      input.sideboardMode === "forge"
    )
      throw Error("Commander formats do not use conventional sideboards");
    const limit = input.gameMode === "BO3" ? input.maxMatchGames : 1;
    if (input.games * limit > 1000)
      throw Error("Reduce depth: at most 1,000 actual game attempts per run");
    const validation = validateDeck(input.decklist, input.format, this.cards);
    if (!validation.valid)
      throw Error(validation.errors.map((e) => e.message).join("\n"));
    const snapshot = this.snapshot(input.snapshotId);
    if (snapshot.format !== input.format)
      throw Error("Pool and deck format differ");
    const plans = planBenchmark(
      input.format,
      input.games,
      snapshot.decks,
      input.seed,
      input.selection,
    );
    for (const opponent of new Map(
      plans.flatMap((p) => p.opponents).map((d) => [d.id, d]),
    ).values()) {
      const check = validateDeck(opponent.decklist, input.format, this.cards);
      if (!check.valid)
        throw Error(
          "Saved opponent " +
            opponent.name +
            " no longer validates: " +
            check.errors.map((e) => e.message).join("; "),
        );
    }
    const runtime = await resolveRuntime();
    const problem = stableReleaseProblem(
      await updateStatus(),
      runtime.bridge.engineVersion,
    );
    if (problem) throw Error(problem);
    return this.insertJob({
      input,
      deck: {
        id: randomUUID(),
        name: input.name,
        decklist: input.decklist,
        cards: validation.cards,
        cardData: validation.cardData,
      },
      snapshot,
      config: {
        bridgeVersion: "2",
        bridge: runtime.bridge,
        gameMode: input.gameMode,
        sideboardMode: input.sideboardMode,
        maxMatchGames: limit,
        executionPlan: storePlans(plans),
        players: format.players,
        rules: {
          format: input.format,
          engineMode: format.engineGameType,
          startingLife: format.startingLife,
          mulliganRule: "London",
        },
      },
    });
  }
  insertJob(document) {
    if (
      this.store.get(
        "SELECT count(*) AS n FROM jobs WHERE state IN ('QUEUED','PREPARING','RUNNING','AGGREGATING')",
      ).n >= 100
    )
      throw Error("The queue is full");
    const id = randomUUID();
    this.store.transaction(() => {
      this.store.run(
        "INSERT INTO jobs(id,name,format,state,document,created_at,summary_json) VALUES(?,?,?,?,?,?,?)",
        id,
        document.input.name,
        document.input.format,
        "QUEUED",
        JSON.stringify(document),
        now(),
        JSON.stringify({
          name: document.input.name,
          format: document.input.format,
          games: document.input.games,
          clockSeconds: document.input.clockSeconds,
          gameMode: document.config.gameMode,
          players: document.config.players,
          retryOf: document.config.retryOf,
          snapshotName: document.snapshot.name,
        }),
      );
      for (const plan of executionPlans(this.expand(document)))
        for (let i = 0; i < plan.games; i++)
          this.store.run(
            "INSERT INTO runs(id,job_id,plan_key,unit_index) VALUES(?,?,?,?)",
            randomUUID(),
            id,
            plan.key,
            i,
          );
    });
    this.emit("jobs", {});
    void this.tick();
    return this.job(id);
  }
  expand(document) {
    return {
      ...document,
      format: document.input.format,
      games: document.input.games,
      seed: document.input.seed,
    };
  }
  async retry({ id, mode, clockSeconds }) {
    retryOptionsSchema.parse({ mode, clockSeconds });
    mode ??= clockSeconds === undefined ? "resume" : "new";
    const job = this.job(id);
    if (!["FAILED", "CANCELLED", "COMPLETED"].includes(job.state))
      throw Error("Finish or cancel the run first");
    if (mode === "new" || clockSeconds !== undefined) {
      if (
        clockSeconds !== undefined &&
        (!Number.isInteger(clockSeconds) ||
          clockSeconds < 5 ||
          clockSeconds > 300)
      )
        throw Error("Game time must be 5–300 whole seconds");
      await resolveRuntime(undefined, job.config.bridge);
      return this.insertJob({
        input: {
          ...job.input,
          clockSeconds: clockSeconds ?? job.input.clockSeconds,
        },
        deck: job.deck,
        snapshot: job.snapshot,
        config: { ...job.config, retryOf: id },
      });
    }
    if (job.state === "COMPLETED")
      throw Error("Choose a new run to replay completed games");
    if (this.active.has(id))
      throw Error("Previous work is still stopping; retry shortly");
    this.store.transaction(() => {
      this.store.run(
        "UPDATE runs SET state='PENDING',result=NULL,error=NULL WHERE job_id=? AND state='ERROR'",
        id,
      );
      this.store.run(
        "UPDATE jobs SET state='QUEUED',cancel_requested=0,error=NULL,started_at=NULL,finished_at=NULL,attempts=0 WHERE id=?",
        id,
      );
    });
    void this.tick();
    return this.job(id);
  }
  cancel(id) {
    const job = this.job(id);
    if (["QUEUED", "PREPARING", "RUNNING", "AGGREGATING"].includes(job.state)) {
      this.store.run(
        "UPDATE jobs SET state='CANCELLED',cancel_requested=1,finished_at=? WHERE id=?",
        now(),
        id,
      );
      this.active.get(id)?.controller.abort();
    }
    return this.job(id);
  }
  history(game, id, planKey, unitIndex, gameIndex) {
    if (!game.actionLog) return;
    const data = JSON.stringify(game.actionLog),
      digest = createHash("sha256").update(data).digest("hex");
    this.store.run(
      "INSERT INTO histories VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(job_id,plan_key,unit_index,game_index,attempt_id) DO NOTHING",
      randomUUID(),
      id,
      planKey,
      unitIndex,
      gameIndex,
      game.logId,
      digest,
      data,
    );
    const row = this.store.get(
      "SELECT id,digest FROM histories WHERE job_id=? AND plan_key=? AND unit_index=? AND game_index=? AND attempt_id=?",
      id,
      planKey,
      unitIndex,
      gameIndex,
      game.logId,
    );
    if (row.digest !== digest)
      throw Error("Game history changed within one attempt");
    game.actionHistory = {
      id: row.id,
      count: game.actionLog.entries.length,
      total: game.actionLog.total,
      complete: game.actionLog.complete,
    };
    delete game.actionLog;
  }
  mapPlayers(game, job, plan) {
    game.players = game.players.map((p, i) => ({
      ...p,
      id: i === 0 ? job.deck.id : plan.key + ":seat-" + i,
      deckId: i === 0 ? job.deck.id : plan.opponents[i - 1].id,
      seat: i,
    }));
  }
  async tick() {
    if (this.closing || !this.cards || this.runtime.operation) return;
    await this.scheduler.refresh();
    if (this.closing || this.runtime.operation) return;
    const max = Math.max(1, this.scheduler.status().max || 0);
    for (const row of this.store.all(
      "SELECT id FROM jobs WHERE state='QUEUED' ORDER BY created_at",
    )) {
      if (this.active.size >= max) break;
      if (this.active.has(row.id)) continue;
      const controller = new AbortController();
      const operation = this.execute(row.id, controller).finally(() => {
        this.active.delete(row.id);
        this.emit("jobs", {});
      });
      this.active.set(row.id, { controller, operation });
    }
  }
  async execute(id, controller) {
    let deadline,
      deadlineReached = false;
    try {
      const job = this.expand(this.job(id));
      const remaining =
        21600000 - (job.startedAt ? Date.now() - Date.parse(job.startedAt) : 0);
      if (remaining <= 0) throw Error("Maximum six-hour run time exceeded");
      deadline = setTimeout(() => {
        deadlineReached = true;
        controller.abort();
      }, remaining);
      deadline.unref();
      this.store.run(
        "UPDATE jobs SET state='PREPARING',started_at=coalesce(started_at,?),attempts=attempts+1,error=NULL WHERE id=? AND cancel_requested=0",
        now(),
        id,
      );
      const plans = executionPlans(job);
      const capacity = Math.max(1, this.scheduler.status().max || 1),
        groups = [];
      for (const plan of plans) {
        const pending = this.store
          .all(
            "SELECT unit_index FROM runs WHERE job_id=? AND plan_key=? AND state='PENDING' ORDER BY unit_index",
            id,
            plan.key,
          )
          .map((r) => r.unit_index);
        const tasks = [];
        for (const indices of partitionIndices(
          pending,
          Math.max(1, Math.ceil(capacity / plans.length)),
          50,
        ))
          tasks.push(async () => {
            const lease = await this.scheduler.acquire(id, controller.signal);
            try {
              this.store.run(
                "UPDATE jobs SET state='RUNNING' WHERE id=? AND cancel_requested=0",
                id,
              );
              await new ForgeEngineAdapter(
                process.env.FORGE_HOME,
                join(this.data, "logs"),
              ).runGames(
                {
                  jobId: id,
                  runtime: job.config.bridge,
                  decks: [
                    serializeDeck(job.deck.cards, "player-0"),
                    ...plan.opponents.map((d, i) =>
                      serializeDeck(d.cards, "player-" + (i + 1)),
                    ),
                  ],
                  mode: getFormat(job.input.format).engineGameType,
                  bestOf: job.config.gameMode === "BO3" ? 3 : 1,
                  maxMatchGames: job.config.maxMatchGames,
                  sideboarding: job.config.sideboardMode === "forge",
                  companions: [job.deck, ...plan.opponents].map(
                    (d) =>
                      d.cards.find((c) => c.section === "COMPANION")?.name ??
                      null,
                  ),
                  games: plan.games,
                  indices,
                  seed: plan.seed,
                  clockSeconds: job.input.clockSeconds,
                  traceId: id + "_" + plan.key,
                },
                async (result) => {
                  if (!indices.includes(result.index))
                    throw Error("Unexpected run identity");
                  if (result.unit === "match")
                    for (const game of result.games) {
                      this.mapPlayers(game, job, plan);
                      this.history(
                        game,
                        id,
                        plan.key,
                        result.index,
                        game.index,
                      );
                    }
                  else this.history(result, id, plan.key, result.index, 0);
                  this.mapPlayers(result, job, plan);
                  this.store.run(
                    "UPDATE runs SET state=?,result=?,error=NULL WHERE job_id=? AND plan_key=? AND unit_index=? AND state='PENDING'",
                    result.termination === "engine_error" ? "ERROR" : "DONE",
                    JSON.stringify(result),
                    id,
                    plan.key,
                    result.index,
                  );
                  this.emit("progress", { id });
                },
                controller.signal,
                async (observation) => {
                  const game = observation.result;
                  this.mapPlayers(game, job, plan);
                  this.history(
                    game,
                    id,
                    plan.key,
                    observation.matchIndex,
                    game.index,
                  );
                  this.store.run(
                    "INSERT INTO observations VALUES(?,?,?,?,?,?,?)",
                    randomUUID(),
                    id,
                    plan.key,
                    observation.matchIndex,
                    game.logId,
                    JSON.stringify(game),
                    now(),
                  );
                  this.emit("progress", { id });
                },
                (pid) => lease.track(pid),
              );
            } finally {
              lease.release();
            }
          });
        groups.push(tasks);
      }
      await runParallel(
        interleave(groups),
        () => Math.max(1, this.scheduler.status().max || 0),
        controller,
      );
      const latest = this.job(id);
      if (latest.cancelRequested) throw Error("Run cancelled");
      if (latest.pending || latest.failed)
        throw Error("Run has incomplete or failed engine games");
      this.store.run(
        "UPDATE jobs SET state='COMPLETED',finished_at=? WHERE id=? AND cancel_requested=0",
        now(),
        id,
      );
    } catch (error) {
      const message = deadlineReached
        ? "Maximum six-hour run time exceeded"
        : error.message;
      const job = this.job(id);
      if (job.cancelRequested)
        this.store.run(
          "UPDATE jobs SET state='CANCELLED',finished_at=? WHERE id=?",
          now(),
          id,
        );
      else if (this.closing)
        this.store.run("UPDATE jobs SET state='QUEUED' WHERE id=?", id);
      else if (job.attempts < 2 && !controller.signal.aborted)
        this.store.run(
          "UPDATE jobs SET state='QUEUED',error=? WHERE id=?",
          message,
          id,
        );
      else {
        this.store.run(
          "UPDATE runs SET state='ERROR',error=? WHERE job_id=? AND state='PENDING'",
          message,
          id,
        );
        this.store.run(
          "UPDATE jobs SET state='FAILED',error=?,finished_at=? WHERE id=?",
          message,
          now(),
          id,
        );
      }
    } finally {
      clearTimeout(deadline);
    }
  }
  results(id) {
    const job = this.job(id),
      rows = this.store.all(
        "SELECT * FROM runs WHERE job_id=? ORDER BY plan_key,unit_index",
        id,
      );
    const results = rows.flatMap((r) =>
      r.result ? [JSON.parse(r.result)] : [],
    );
    const plans = executionPlans(this.expand(job));
    return {
      job,
      summary: summarize(
        gameResults(results),
        0,
        getFormat(job.input.format).players === 4,
      ),
      matchSummary:
        job.config.gameMode === "BO3" ? summarizeMatches(results) : null,
      matchups: plans.map((plan) => ({
        ...plan,
        summary: summarize(
          gameResults(
            rows
              .filter((r) => r.plan_key === plan.key && r.result)
              .map((r) => JSON.parse(r.result)),
          ),
          0,
          plan.kind === "pod",
        ),
      })),
    };
  }
  runs(id, offset = 0, limit = 100) {
    this.job(id);
    return this.store
      .all(
        "SELECT * FROM runs WHERE job_id=? ORDER BY plan_key,unit_index LIMIT ? OFFSET ?",
        id,
        Math.min(200, limit),
        offset,
      )
      .map((r) => ({ ...r, result: r.result ? JSON.parse(r.result) : null }));
  }
  observations(id, offset = 0) {
    const job = this.job(id),
      all = this.store.all(
        "SELECT * FROM observations WHERE job_id=? ORDER BY created_at,id",
        id,
      );
    return all.slice(offset, offset + 100).map((row) => {
      const game = JSON.parse(row.result),
        siblings = all.filter(
          (o) => o.plan_key === row.plan_key && o.unit_index === row.unit_index,
        );
      const attempts = [...new Set(siblings.map((o) => o.attempt_id))];
      const final = this.store.get(
        "SELECT result FROM runs WHERE job_id=? AND plan_key=? AND unit_index=?",
        id,
        row.plan_key,
        row.unit_index,
      );
      const result = final?.result ? JSON.parse(final.result) : null;
      return {
        ...row,
        result: game,
        review: observationReview({
          attemptId: row.attempt_id,
          finalAttemptId: result?.logId,
          hasFinalResult: !!result,
          number: attempts.indexOf(row.attempt_id) + 1,
          total: attempts.length,
          termination: game.termination,
          matchTermination: result?.termination,
          jobState: job.state,
        }),
      };
    });
  }
  actions(jobId, historyId, offset = 0) {
    const row = this.store.get(
      "SELECT data FROM histories WHERE job_id=? AND id=?",
      jobId,
      historyId,
    );
    if (!row) throw Error("Game history not found");
    const log = JSON.parse(row.data);
    return {
      ...log,
      entries: log.entries.slice(offset, offset + 100),
      count: log.entries.length,
      nextOffset: offset + 100 < log.entries.length ? offset + 100 : null,
    };
  }
  async refreshMeta(format) {
    this.requireReady();
    if (this.refreshing) throw Error("A metagame refresh is already running");
    this.refreshing = true;
    try {
      const source = dailySources.find((s) => s.format === format);
      if (!source) throw Error("Unknown format");
      const downloaded = await downloadMetagame(
        { ...source, max_decks: 10 },
        this.cards,
        true,
      );
      const snapshot = this.saveSnapshot({
        ...normalizeSnapshot(downloaded.input, this.cards),
        metadata: downloaded.metadata,
        digest: downloaded.digest,
        reference: false,
      });
      const meta = this.store.setting("meta", {});
      meta[format] = {
        lastSuccess: now(),
        snapshotId: snapshot.id,
        error: null,
      };
      this.store.set("meta", meta);
      return snapshot;
    } catch (error) {
      const meta = this.store.setting("meta", {});
      meta[format] = {
        ...meta[format],
        lastAttempt: now(),
        error: error.message,
      };
      this.store.set("meta", meta);
      throw error;
    } finally {
      this.refreshing = false;
      this.emit("pools", {});
    }
  }
  async maintenance() {
    if (this.closing || !this.cards || this.runtime.operation) return;
    try {
      const updates = await updateStatus();
      if (
        this.active.size === 0 &&
        (!updates.checkedAt ||
          Date.now() - Date.parse(updates.checkedAt) > 3600000)
      ) {
        await this.runtime.check();
        await this.loadCards();
      }
    } catch (error) {
      this.emit("warning", { message: "Forge update check: " + error.message });
    }
    if (
      this.active.size === 0 &&
      !this.runtime.operation &&
      Date.now() - Date.parse(this.cards.provenance.fetchedAt || 0) > 86400000
    ) {
      try {
        await this.runtime.refreshCards();
        await this.loadCards();
      } catch (error) {
        this.emit("warning", {
          message: "Card metadata refresh: " + error.message,
        });
      }
    }
    if (
      this.store.setting("preferences", { autoMeta: true }).autoMeta &&
      !this.refreshing
    ) {
      const meta = this.store.setting("meta", {});
      for (const f of FORMATS) {
        if (this.closing) break;
        const state = meta[f.id];
        if (
          (!state?.lastSuccess ||
            Date.now() - Date.parse(state.lastSuccess) > 86400000) &&
          (!state?.lastAttempt ||
            Date.now() - Date.parse(state.lastAttempt) > 3600000)
        ) {
          try {
            await this.refreshMeta(f.id);
          } catch (error) {
            this.emit("warning", {
              message: f.name + " metagame: " + error.message,
            });
          }
        }
      }
    }
  }
  async dispatch(method, p = {}) {
    if (this.closing && method !== "shutdown")
      throw Error("The desktop engine is shutting down");
    switch (method) {
      case "status":
        return this.status();
      case "setup":
        if (this.active.size)
          throw Error("Finish or cancel active runs before engine setup");
        try {
          await this.runtime.setup(!!p.refreshCards);
          await this.loadCards();
        } catch (error) {
          const cancelled = this.runtime.controller?.signal.aborted;
          this.setupError = error.message;
          this.runtime.progress.finish(cancelled ? "cancelled" : "error", cancelled ? "Setup cancelled. Restart when you are ready." : error.message);
          throw error;
        }
        return this.status();
      case "cancelSetup":
        await this.runtime.cancel();
        return this.status();
      case "validate":
        this.requireReady();
        return validateDeck(p.decklist, p.format, this.cards);
      case "importDeck":
        return importDeckLink(p.url);
      case "snapshots":
        return this.listSnapshots(p.format);
      case "importPool":
        this.requireReady();
        return this.saveSnapshot({
          ...(p.csv
            ? new CsvImportProvider().normalize(
                {
                  name: p.name || "Imported CSV",
                  source: p.source || "Local CSV file",
                  format: p.format,
                  csv: p.text,
                },
                this.cards,
              )
            : normalizeSnapshot(JSON.parse(p.text), this.cards)),
          reference: false,
        });
      case "refreshMeta":
        return this.refreshMeta(p.format);
      case "create":
        return this.create(p);
      case "jobs":
        return this.listJobs();
      case "job":
        return this.job(p.id);
      case "results":
        return this.results(p.id);
      case "runs":
        return this.runs(p.id, p.offset || 0, p.limit || 100);
      case "observations":
        return this.observations(p.id, p.offset || 0);
      case "actions":
        return this.actions(p.jobId, p.historyId, p.offset || 0);
      case "cancel":
        return this.cancel(p.id);
      case "retry":
        return this.retry(p);
      case "preferences":
        this.store.set("preferences", { autoMeta: !!p.autoMeta });
        return this.store.setting("preferences");
      case "shutdown":
        return this.close();
      default:
        throw Error("Unknown desktop command");
    }
  }
  async close() {
    this.closing = true;
    clearInterval(this.timer);
    clearInterval(this.maintenanceTimer);
    stopSourceImports();
    await this.runtime.close();
    for (const job of this.active.values()) job.controller.abort();
    await Promise.allSettled([...this.active.values()].map((j) => j.operation));
    this.scheduler.stop();
    this.store.close();
    return { stopped: true };
  }
}
