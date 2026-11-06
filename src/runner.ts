import Fastify from "fastify";
import { z } from "zod";
import { access } from "node:fs/promises";
import { ForgeEngineAdapter } from "./engine.js";
import { config } from "./config.js";
const app = Fastify({ logger: true, bodyLimit: 1024 * 1024 });
const engine = new ForgeEngineAdapter();
let active = 0;
const controllers = new Set<AbortController>();
app.get("/health", async (_req, reply) => {
  try {
    await access(
      engine.home + "/forge-gui-desktop-2.0.15-jar-with-dependencies.jar",
    );
    await access(engine.home + "/magictester-bridge.json");
    await access(engine.home + "/magictester-bridge/MagicTesterBridge.class");
    return {
      status: "ok",
      active,
      max: config.MAX_FORGE_PROCESSES,
      capabilities: engine.getCapabilities(),
    };
  } catch {
    return reply.code(503).send({ status: "engine_missing" });
  }
});
app.post("/games", async (req, reply) => {
  const parsed = z
    .object({
      decks: z.array(z.string().min(1).max(65536)).min(2).max(4),
      games: z.number().int().min(1).max(config.MAX_GAMES_PER_JOB),
      seed: z.number().int().min(0).max(2147483646),
      clockSeconds: z.number().int().min(1).max(120),
      mode: z.enum(["constructed", "commander", "duel"]).optional(),
      traceId: z
        .string()
        .regex(/^[a-f0-9_-]{1,80}$/)
        .optional(),
    })
    .refine(
      (data) => data.mode === "commander" || data.decks.length === 2,
      "Constructed games require two players",
    )
    .safeParse(req.body);
  if (!parsed.success)
    return reply.code(400).send({ error: "Invalid engine request" });
  if (active >= config.MAX_FORGE_PROCESSES)
    return reply.code(429).send({ error: "Engine capacity reached" });
  active++;
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
  try {
    await engine.runGames(
      parsed.data,
      async (result) => {
        if (!reply.raw.destroyed)
          reply.raw.write(JSON.stringify({ type: "result", result }) + "\n");
      },
      abort.signal,
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
    active--;
    controllers.delete(abort);
    reply.raw.end();
  }
});
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, () => {
    for (const c of controllers) c.abort();
    void app.close();
  });
await app.listen({ port: 3002, host: "0.0.0.0" });
