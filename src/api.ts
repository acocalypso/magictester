import { reviewedObservations } from "./observation-review.js";
import { importDeckLink, DeckLinkError } from "./deck-links.js";
import { resolveRuntime, updateStatus } from "./runtime.mjs";
import { stopSourceImports } from "./source-http.js";
import { selectionSchema } from "./planning.js";
import {
  createFeed,
  listFeeds,
  syncFeed,
  syncDueFeeds,
  ensureDailySources,
  currentMetagame,
  invalidateDailyPools,
} from "./feeds.js";
import { referencePool } from "./reference-pools.js";
import { enabledFormatIds, validationFormatIds, getFormat } from "./formats.js";
import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { timingSafeEqual, randomUUID } from "node:crypto";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { CachedCardDataProvider, FORMATS, validateDeck } from "./domain.js";
import { config } from "./config.js";
import { db, pool } from "./db.js";
import { snapshots, runs } from "./schema.js";
import { queue } from "./queue.js";
import { JsonImportProvider, CsvImportProvider } from "./meta.js";
import {
  createSimulation,
  getJob,
  listJobs,
  resultsFor,
  cancelJob,
  retryJob,
  reconcile,
  RequestError,
  closeServices,
} from "./service.js";
const app = Fastify({
  logger: true,
  bodyLimit: 2 * 1024 * 1024,
  trustProxy: false,
});
let cards = await new CachedCardDataProvider().load();
let cacheFingerprint = "";
let cacheReloadError: string | null = null;
let reloading = false;
const cacheTimer = setInterval(() => {
  if (reloading) return;
  reloading = true;
  void (async () => {
    const { stat } = await import("node:fs/promises");
    const root = process.env.DATA_DIR || "/data";
    const runtime = await resolveRuntime();
    const { resolve } = await import("node:path");
    const fingerprint = (
      await Promise.all(
        [
          root + "/cards.json",
          runtime.home + "/magictester-bridge.json",
          resolve(runtime.home, runtime.bridge.metadataDirectory || "..") +
            "/forge-facts.json",
          (process.env.FORGE_HOME || root + "/forge") +
            "/runtime-registry.json",
        ].map(
          async (file) =>
            (
              await stat(file).catch((e) => {
                if (e.code === "ENOENT") return { mtimeMs: 0 };
                throw e;
              })
            ).mtimeMs,
        ),
      )
    ).join(":");
    if (fingerprint !== cacheFingerprint) {
      const next = await new CachedCardDataProvider().load();
      if (JSON.stringify(cards.provenance) !== JSON.stringify(next.provenance))
        await invalidateDailyPools(next);
      cards = next;
      cacheFingerprint = fingerprint;
      cacheReloadError = null;
    }
  })()
    .catch((e) => {
      cacheReloadError = (e as Error).message;
      app.log.error(e);
    })
    .finally(() => {
      reloading = false;
    });
}, 30000);
cacheTimer.unref();
await app.register(cors, {
  origin: (process.env.CORS_ORIGINS || "http://localhost:3000").split(","),
});
await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
await app.register(swagger, {
  openapi: {
    info: { title: "MagicTester API", version: "0.1.0" },
    servers: [{ url: "/" }],
  },
});
await app.register(swaggerUi, { routePrefix: "/api/docs" });
app.setErrorHandler((error, _req, reply) => {
  if (error instanceof DeckLinkError)
    return reply.code(error.statusCode).send({ error: error.message });
  if (error instanceof z.ZodError)
    return reply
      .code(400)
      .send({ error: "Invalid request", details: error.issues });
  if (error instanceof RequestError)
    return reply
      .code(error.statusCode)
      .send({ error: error.message, details: error.details });
  app.log.error(error);
  return reply.code((error as { statusCode?: number }).statusCode || 500).send({
    error:
      (error as { statusCode?: number }).statusCode === 429
        ? "Rate limit exceeded"
        : "Request could not be completed",
  });
});
const idSchema = {
  type: "object",
  properties: { id: { type: "string", format: "uuid" } },
  required: ["id"],
} as const;
const deckBody = z.object({
  decklist: z.string().min(1).max(config.MAX_DECKLIST_BYTES),
  format: z.string(),
});
const bodySchema = {
  type: "object",
  required: ["decklist", "format"],
  properties: {
    decklist: { type: "string", maxLength: config.MAX_DECKLIST_BYTES },
    format: { type: "string", enum: validationFormatIds() },
  },
} as const;
app.get(
  "/health",
  { schema: { tags: ["Operations"] } },
  async (_req, reply) => {
    try {
      await pool.query("SELECT 1");
      await queue.getJobCounts();
      return { status: "ok", cardData: cards.provenance };
    } catch {
      return reply.code(503).send({ status: "unavailable" });
    }
  },
);
app.get(
  "/api/v1/formats",
  { schema: { tags: ["Decks"] } },
  async () => FORMATS,
);
app.get<{ Params: { format: string } }>(
  "/api/v1/formats/:format/example",
  {
    schema: {
      tags: ["Decks"],
      params: {
        type: "object",
        properties: { format: { type: "string", enum: enabledFormatIds() } },
        required: ["format"],
      },
    },
  },
  async (req) => referencePool(req.params.format, cards).decks[0],
);
app.post(
  "/api/v1/decks/import-link",
  {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    schema: {
      tags: ["Decks"],
      body: {
        type: "object",
        required: ["url", "format"],
        additionalProperties: false,
        properties: {
          url: { type: "string", maxLength: 1000 },
          format: { type: "string", enum: validationFormatIds() },
        },
      },
    },
  },
  async (req) => {
    const body = z
      .object({
        url: z.string().trim().min(1).max(1000),
        format: z.enum(validationFormatIds()),
      })
      .parse(req.body);
    const imported = await importDeckLink(body.url);
    return {
      ...imported,
      validation: validateDeck(imported.decklist, body.format, cards),
    };
  },
);
app.post(
  "/api/v1/decks/validate",
  { schema: { tags: ["Decks"], body: bodySchema } },
  async (req) => {
    const body = deckBody.parse(req.body);
    return validateDeck(body.decklist, body.format, cards);
  },
);
app.post(
  "/api/v1/simulations",
  {
    config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
    schema: {
      tags: ["Simulations"],
      body: {
        ...bodySchema,
        required: ["decklist", "format", "games", "name"],
        properties: {
          ...bodySchema.properties,
          format: { type: "string", enum: enabledFormatIds() },
          name: { type: "string", minLength: 1, maxLength: 150 },
          poolMode: {
            type: "string",
            enum: ["fixed", "latest"],
            default: "fixed",
          },
          snapshotId: { type: "string", format: "uuid" },
          games: {
            type: "integer",
            minimum: 1,
            maximum: config.MAX_GAMES_PER_JOB,
          },
          seed: { type: "integer", minimum: 0, maximum: 2147483646 },
          gameMode: { type: "string", enum: ["BO1", "BO3"], default: "BO1" },
          maxMatchGames: { type: "integer", minimum: 3, maximum: 9 },
          selection: { type: "object", additionalProperties: true },
          sideboardMode: { type: "string", enum: ["none", "forge"] },
          clockSeconds: { type: "integer", minimum: 5, maximum: 120 },
        },
      },
    },
  },
  async (req, reply) => {
    const input = deckBody
      .extend({
        name: z.string().trim().min(1).max(150),
        snapshotId: z.uuid().optional(),
        poolMode: z.enum(["fixed", "latest"]).default("fixed"),
        games: z.number().int().min(1).max(config.MAX_GAMES_PER_JOB),
        seed: z.number().int().min(0).max(2147483646).default(12345),
        gameMode: z.enum(["BO1", "BO3"]).default("BO1"),
        maxMatchGames: z.number().int().min(3).max(9).optional(),
        sideboardMode: z.enum(["none", "forge"]).optional(),
        selection: selectionSchema.optional(),
        clockSeconds: z.number().int().min(5).max(120).optional(),
      })
      .parse(req.body);
    return reply.code(201).send(
      await createSimulation(
        {
          ...input,
          clockSeconds:
            input.clockSeconds ??
            (getFormat(input.format)?.commander ? 120 : 30),
        },
        req.ip,
        cards,
      ),
    );
  },
);
app.get(
  "/api/v1/simulations",
  { schema: { tags: ["Simulations"] } },
  async () => listJobs(),
);
app.get<{ Params: { id: string } }>(
  "/api/v1/simulations/:id",
  { schema: { tags: ["Simulations"], params: idSchema } },
  async (req) => getJob(req.params.id),
);
app.post<{ Params: { id: string } }>(
  "/api/v1/simulations/:id/cancel",
  { schema: { tags: ["Simulations"], params: idSchema } },
  async (req) => cancelJob(req.params.id),
);
app.post<{ Params: { id: string } }>(
  "/api/v1/simulations/:id/retry",
  { schema: { tags: ["Simulations"], params: idSchema } },
  async (req) => retryJob(req.params.id),
);
app.get<{ Params: { id: string } }>(
  "/api/v1/simulations/:id/results",
  { schema: { tags: ["Results"], params: idSchema } },
  async (req) => resultsFor(req.params.id),
);
app.get<{ Params: { id: string } }>(
  "/api/v1/simulations/:id/matchups",
  { schema: { tags: ["Results"], params: idSchema } },
  async (req) => (await resultsFor(req.params.id)).matchups,
);
app.get<{ Params: { id: string } }>(
  "/api/v1/simulations/:id/pods",
  { schema: { tags: ["Results"], params: idSchema } },
  async (req) =>
    (await resultsFor(req.params.id)).matchups.filter((m) => m.kind === "pod"),
);
app.get<{
  Params: { id: string };
  Querystring: { offset?: string; limit?: string };
}>(
  "/api/v1/simulations/:id/observations",
  {
    schema: {
      tags: ["Results"],
      params: idSchema,
      querystring: {
        type: "object",
        properties: {
          offset: { type: "integer", minimum: 0, default: 0 },
          limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
        },
      },
    },
  },
  async (req) => {
    const job = await getJob(req.params.id);
    return reviewedObservations(
      job,
      Number(req.query.limit || 50),
      Number(req.query.offset || 0),
    );
  },
);
app.get<{
  Params: { id: string };
  Querystring: { limit?: string; offset?: string };
}>(
  "/api/v1/simulations/:id/runs",
  {
    schema: {
      tags: ["Results"],
      params: idSchema,
      querystring: {
        type: "object",
        properties: {
          limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
          offset: { type: "integer", minimum: 0, default: 0 },
        },
      },
    },
  },
  async (req) => {
    await getJob(req.params.id);
    return db
      .select()
      .from(runs)
      .where(eq(runs.jobId, req.params.id))
      .orderBy(runs.opponentId, runs.batchIndex)
      .limit(Number(req.query.limit || 50))
      .offset(Number(req.query.offset || 0));
  },
);
app.get<{ Params: { id: string } }>(
  "/api/v1/simulations/:id/events",
  { schema: { tags: ["Simulations"], params: idSchema } },
  async (req, reply) => {
    await getJob(req.params.id);
    reply.hijack();
    const origin = req.headers.origin;
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      ...(origin &&
      (process.env.CORS_ORIGINS || "http://localhost:3000")
        .split(",")
        .includes(origin)
        ? { "Access-Control-Allow-Origin": origin }
        : {}),
    });
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        const job = await getJob(req.params.id);
        reply.raw.write(`event: progress\ndata: ${JSON.stringify(job)}\n\n`);
        if (
          !["QUEUED", "PREPARING", "RUNNING", "AGGREGATING"].includes(job.state)
        ) {
          clearInterval(timer);
          reply.raw.end();
        }
      } catch {
        clearInterval(timer);
        reply.raw.end();
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(() => void tick(), 2500);
    req.raw.once("close", () => clearInterval(timer));
    void tick();
  },
);
app.get<{ Params: { format: string } }>(
  "/api/v1/meta/:format/snapshots",
  {
    schema: {
      tags: ["Meta"],
      params: {
        type: "object",
        properties: { format: { type: "string" } },
        required: ["format"],
      },
    },
  },
  async (req) =>
    db
      .select()
      .from(snapshots)
      .where(eq(snapshots.format, req.params.format))
      .orderBy(desc(snapshots.createdAt))
      .limit(100),
);
app.post(
  "/api/v1/meta/import",
  {
    schema: {
      tags: ["Meta"],
      summary:
        "Import an immutable JSON or CSV snapshot; requires admin bearer token",
      body: { type: "object", additionalProperties: true },
    },
  },
  async (req, reply) => {
    const secret = process.env.ADMIN_TOKEN;
    if (!secret)
      return reply
        .code(503)
        .send({ error: "Admin import is disabled. Set ADMIN_TOKEN." });
    const token = (req.headers.authorization || "").replace(/^Bearer /, "");
    const a = Buffer.from(secret),
      b = Buffer.from(token);
    if (a.length !== b.length || !timingSafeEqual(a, b))
      return reply.code(401).send({ error: "Admin token required" });
    let normalized;
    try {
      normalized = (
        typeof req.body === "object" && req.body && "csv" in req.body
          ? new CsvImportProvider()
          : new JsonImportProvider()
      ).normalize(req.body, cards);
    } catch (e) {
      if (e instanceof z.ZodError) throw e;
      throw new RequestError(
        422,
        (e as Error).message,
        (e as { details?: unknown }).details,
      );
    }
    const [snapshot] = await db
      .insert(snapshots)
      .values({
        id: randomUUID(),
        format: normalized.format,
        name: normalized.name,
        source: normalized.source,
        sourceDate: normalized.sourceDate || null,
        selectionMethod: normalized.selectionMethod,
        decks: normalized.decks,
        metadata: {
          cardData: cards.provenance,
          weighting: "equal games per selected deck",
        },
      })
      .returning();
    return reply.code(201).send(snapshot);
  },
);
const requireAdmin = async (req: { headers: { authorization?: string } }) => {
  const secret = process.env.ADMIN_TOKEN;
  if (!secret)
    throw new RequestError(503, "Admin operations disabled; set ADMIN_TOKEN");
  const token = Buffer.from(
    (req.headers.authorization || "").replace(/^Bearer /, ""),
  );
  const expected = Buffer.from(secret);
  if (token.length !== expected.length || !timingSafeEqual(token, expected))
    throw new RequestError(401, "Admin token required");
};
app.get<{ Params: { format: string } }>(
  "/api/v1/meta/:format/current",
  async (req) => currentMetagame(req.params.format, cards.provenance),
);
app.get("/api/v1/meta/feeds", async () => listFeeds());
app.post(
  "/api/v1/meta/feeds",
  { preHandler: requireAdmin },
  async (req, reply) => {
    try {
      return reply.code(201).send(await createFeed(req.body));
    } catch (e) {
      throw new RequestError(422, (e as Error).message);
    }
  },
);
app.post<{ Params: { id: string } }>(
  "/api/v1/meta/feeds/:id/sync",
  { preHandler: requireAdmin, schema: { params: idSchema } },
  async (req, reply) => {
    try {
      const feed = (await listFeeds()).find((f) => f.id === req.params.id);
      if (!feed) throw new RequestError(404, "Feed not found");
      if (feed.provider !== "json") {
        void syncFeed(req.params.id, cards).catch((e) => app.log.error(e));
        return reply.code(202).send({ status: "accepted" });
      }
      return await syncFeed(req.params.id, cards);
    } catch (e) {
      throw new RequestError(422, (e as Error).message);
    }
  },
);
app.patch<{ Params: { id: string } }>(
  "/api/v1/meta/feeds/:id",
  { preHandler: requireAdmin, schema: { params: idSchema } },
  async (req) => {
    const input = z.object({ enabled: z.boolean() }).parse(req.body);
    const updated = await pool.query(
      "UPDATE meta_feeds SET enabled=$2 WHERE id=$1 RETURNING id",
      [req.params.id, input.enabled],
    );
    if (!updated.rowCount) throw new RequestError(404, "Feed not found");
    return { id: req.params.id, enabled: input.enabled };
  },
);
let feedBusy = false;
function refreshFeeds() {
  if (feedBusy) return;
  feedBusy = true;
  void syncDueFeeds(cards)
    .catch((e) => app.log.error(e))
    .finally(() => {
      feedBusy = false;
    });
}
const feedTimer = setInterval(refreshFeeds, 60000);
feedTimer.unref();
app.get("/api/v1/operations", async () => {
  const [states, runner, metadata] = await Promise.all([
    pool.query(
      "SELECT state,count(*)::int AS count FROM simulation_jobs GROUP BY state",
    ),
    fetch((process.env.RUNNER_URL || "http://localhost:3002") + "/health", {
      signal: AbortSignal.timeout(3000),
    })
      .then((r) => r.json())
      .catch(() => ({ status: "unavailable" })),
    import("node:fs/promises")
      .then((fs) =>
        fs.readFile(
          (process.env.DATA_DIR || "/data") + "/maintenance.json",
          "utf8",
        ),
      )
      .then(JSON.parse)
      .catch(() => ({ status: "unavailable" })),
  ]);
  return {
    jobs: states.rows,
    forgeUpdates: await updateStatus(),
    runner,
    metadata,
    cardData: cards.provenance,
    cacheReloadError,
    feeds: await listFeeds(),
  };
});
app.post(
  "/api/v1/operations/refresh-cards",
  { preHandler: requireAdmin },
  async (req, reply) => {
    const response = await fetch(
      (process.env.MAINTENANCE_URL || "http://maintenance:3004") + "/refresh",
      {
        method: "POST",
        headers: { authorization: req.headers.authorization || "" },
        signal: AbortSignal.timeout(5000),
      },
    );
    return reply.code(response.status).send(await response.json());
  },
);
app.post(
  "/api/v1/operations/check-forge",
  { preHandler: requireAdmin },
  async (req, reply) => {
    const response = await fetch(
      (process.env.MAINTENANCE_URL || "http://maintenance:3004") +
        "/refresh?engine=stable",
      {
        method: "POST",
        headers: { authorization: req.headers.authorization || "" },
        signal: AbortSignal.timeout(5000),
      },
    );
    return reply.code(response.status).send(await response.json());
  },
);
app.get("/api/v1/status", { schema: { tags: ["Operations"] } }, async () => ({
  queue: await queue.getJobCounts("waiting", "active", "failed"),
  limits: config,
  engine:
    "Forge " +
    ((cards.provenance.engineBridge as { engineVersion?: string })
      ?.engineVersion || "unavailable"),
  forgeUpdates: await updateStatus(),
  formats: enabledFormatIds(),
  model: "AI-vs-AI BO1 / BO3",
  authentication: "local/private deployment only",
}));
const reconcileTimer = setInterval(() => {
  void reconcile().catch((e) => app.log.error(e));
}, 10000);
reconcileTimer.unref();
await ensureDailySources();
await invalidateDailyPools(cards);
await reconcile();
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(
    signal,
    () =>
      void (async () => {
        stopSourceImports();
        clearInterval(reconcileTimer);
        clearInterval(feedTimer);
        clearInterval(cacheTimer);
        await app.close();
        await closeServices();
      })(),
  );
await app.listen({ port: Number(process.env.PORT || 3001), host: "0.0.0.0" });

refreshFeeds();
