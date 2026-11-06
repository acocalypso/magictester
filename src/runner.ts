import { EngineScheduler, memoryMiB } from "./resources.js";
import { randomUUID } from "node:crypto";
import { resolveRuntime } from "./runtime.mjs";
import Fastify from "fastify";
import { z } from "zod";
import { access } from "node:fs/promises";
import { ForgeEngineAdapter } from "./engine.js";
import { config } from "./config.js";
const app = Fastify({ logger: true, bodyLimit: 1024 * 1024 });
const engine = new ForgeEngineAdapter();
const scheduler = new EngineScheduler({
  heapMiB: memoryMiB(process.env.FORGE_HEAP || "1024m"),
  overheadMiB: config.FORGE_MEMORY_OVERHEAD_MB,
  cpuPerProcess: config.FORGE_CPUS_PER_PROCESS,
  reserveMiB: config.FORGE_MEMORY_RESERVE_MB,
  processCap: config.MAX_FORGE_PROCESSES,
});
await scheduler.refresh();
const controllers = new Set<AbortController>();
app.get("/health", async (_req, reply) => {
  try {
    const runtime = await resolveRuntime(engine.home);
    const bridge = runtime.bridge;
    await access(
      runtime.home +
        "/" +
        (bridge.release?.jarName ||
          `forge-gui-desktop-${bridge.engineVersion}-jar-with-dependencies.jar`),
    );
    await access(
      runtime.home +
        "/" +
        (bridge.classDirectory || "magictester-bridge") +
        "/MagicTesterBridge.class",
    );
    if (bridge.version !== "2") throw new Error("Incompatible bridge");
    const resources = await scheduler.refresh();
    return {
      bridgeSourceHash: bridge.sourceHash,
      status: "ok",
      active: resources.active,
      max: resources.max,
      resources,
      capabilities: {
        ...engine.getCapabilities(),
        version: bridge.engineVersion,
      },
    };
  } catch {
    return reply.code(503).send({ status: "engine_missing" });
  }
});
app.post("/games", async (req, reply) => {
  const parsed = z
    .object({
      jobId: z.uuid().optional(),
      runtime: z
        .object({
          engineVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
          sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .optional(),
      bestOf: z.union([z.literal(1), z.literal(3)]).default(1),
      maxMatchGames: z.number().int().min(3).max(9).default(5),
      sideboarding: z.boolean().default(false),
      companions: z.array(z.string().min(1).max(150).nullable()).optional(),
      decks: z.array(z.string().min(1).max(65536)).min(2).max(4),
      games: z.number().int().min(1).max(config.MAX_GAMES_PER_JOB),
      indices: z
        .array(z.number().int().nonnegative())
        .min(1)
        .max(config.MAX_GAMES_PER_JOB)
        .optional(),
      seed: z.number().int().min(0).max(2147483646),
      clockSeconds: z.number().int().min(1).max(120),
      mode: z.enum(["constructed", "commander", "duel"]).optional(),
      traceId: z
        .string()
        .regex(/^[a-f0-9_-]{1,80}$/)
        .optional(),
    })
    .refine(
      (data) =>
        !data.indices ||
        data.indices.every(
          (n, i) => n < data.games && (i === 0 || n > data.indices![i - 1]),
        ),
      "Invalid unit indices",
    )
    .refine(
      (data) => data.mode === "commander" || data.decks.length === 2,
      "Constructed games require two players",
    )
    .refine(
      (data) => data.bestOf !== 3 || data.decks.length === 2,
      "BO3 requires two players",
    )
    .refine(
      (data) =>
        !data.companions || data.companions.length === data.decks.length,
      "Companion roster mismatch",
    )
    .safeParse(req.body);
  if (!parsed.success)
    return reply.code(400).send({ error: "Invalid engine request" });
  if (scheduler.status().waiting >= 256)
    return reply.code(429).send({ error: "Engine wait queue is full" });
  const abort = new AbortController();
  controllers.add(abort);
  reply.hijack();
  reply.raw.writeHead(200, {
    "Content-Type": "application/x-ndjson",
    "Cache-Control": "no-store",
  });
  reply.raw.once("close", () => abort.abort());
  // Heartbeats keep connections alive during the expensive Forge database startup.
  const heartbeat = setInterval(() => {
    if (!reply.raw.destroyed) reply.raw.write('{"type":"heartbeat"}\n');
  }, 5000);
  let lease: Awaited<ReturnType<EngineScheduler["acquire"]>> | undefined;
  try {
    lease = await scheduler.acquire(
      parsed.data.jobId || randomUUID(),
      abort.signal,
    );
    if (!reply.raw.destroyed) reply.raw.write('{"type":"started"}\n');
    await engine.runGames(
      parsed.data,
      async (result) => {
        if (!reply.raw.destroyed)
          reply.raw.write(JSON.stringify({ type: "result", result }) + "\n");
      },
      abort.signal,
      async (observation) => {
        if (!reply.raw.destroyed)
          reply.raw.write(
            JSON.stringify({ type: "game", ...observation }) + "\n",
          );
      },
      (pid) => lease?.track(pid),
    );
    if (!reply.raw.destroyed) reply.raw.write('{"type":"complete"}\n');
  } catch (error) {
    app.log.error(error);
    if (!reply.raw.destroyed)
      reply.raw.write(
        JSON.stringify({ type: "error", error: (error as Error).message }) +
          "\n",
      );
  } finally {
    clearInterval(heartbeat);
    lease?.release();
    controllers.delete(abort);
    reply.raw.end();
  }
});
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, () => {
    scheduler.stop();
    for (const c of controllers) c.abort();
    void app.close();
  });
await app.listen({ port: 3002, host: "0.0.0.0" });
