import Fastify from "fastify";
import { spawn } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import { stat, writeFile, rename, readFile } from "node:fs/promises";
import type { PoolClient } from "pg";
import { pool } from "./db.js";
const app = Fastify({ logger: true });
const root = process.env.DATA_DIR || "/data";
let active = false;
let child: ReturnType<typeof spawn> | undefined;
let state: Record<string, unknown> = { status: "idle", lastSuccessAt: null };
try {
  state = JSON.parse(await readFile(root + "/maintenance.json", "utf8"));
} catch {
  /*first start*/
}
function killRefresh(signal: NodeJS.Signals) {
  if (child?.pid)
    try {
      process.kill(-child.pid, signal);
    } catch {
      /* already exited */
    }
}
async function save() {
  const path = root + "/maintenance.json." + process.pid + ".tmp";
  await writeFile(path, JSON.stringify(state));
  await rename(path, root + "/maintenance.json");
}
async function refresh() {
  if (active) return false;
  active = true;
  let lock: PoolClient | undefined;
  let locked = false;
  try {
    lock = await pool.connect();
    locked = (
      await lock.query("SELECT pg_try_advisory_lock(7193199) AS locked")
    ).rows[0].locked;
    if (!locked) return false;
    state = {
      ...state,
      status: "refreshing",
      startedAt: new Date().toISOString(),
      error: null,
    };
    await save();
    await new Promise<void>((resolve, reject) => {
      child = spawn(
        process.execPath,
        ["scripts/bootstrap.mjs", "--refresh-cards"],
        { stdio: "inherit", env: process.env, detached: true },
      );
      const timer = setTimeout(() => killRefresh("SIGKILL"), 15 * 60 * 1000);
      timer.unref();
      child.once("error", reject);
      child.once("close", (code) => {
        clearTimeout(timer);
        child = undefined;
        if (code === 0) resolve();
        else reject(new Error(`Metadata refresh exited ${code}`));
      });
    });
    state = {
      ...state,
      status: "idle",
      lastSuccessAt: new Date().toISOString(),
      error: null,
    };
    await save();
    return true;
  } catch (error) {
    state = { ...state, status: "error", error: (error as Error).message };
    await save();
    app.log.error(error);
    return false;
  } finally {
    if (locked) await lock!.query("SELECT pg_advisory_unlock(7193199)");
    lock?.release();
    active = false;
  }
}
app.get("/health", async () => ({ status: "ok", active, refresh: state }));
app.post("/refresh", async (req, reply) => {
  const secret = Buffer.from(process.env.ADMIN_TOKEN || "");
  const token = Buffer.from(
    (req.headers.authorization || "").replace(/^Bearer /, ""),
  );
  if (
    !secret.length ||
    token.length !== secret.length ||
    !timingSafeEqual(secret, token)
  )
    return reply.code(401).send({ error: "Admin token required" });
  if (active) return reply.code(409).send({ error: "Refresh already running" });
  void refresh();
  return reply.code(202).send({ status: "accepted" });
});
const hours = Number(process.env.CARD_REFRESH_HOURS || 24);
if (!Number.isFinite(hours) || hours < 1)
  throw new Error("CARD_REFRESH_HOURS must be at least one");
const timer = setInterval(() => {
  if (active) return;
  void stat(root + "/cards.json")
    .then((info) => {
      if (Date.now() - info.mtimeMs > hours * 3600000) return refresh();
    })
    .catch((e) => app.log.error(e));
}, 60000);
timer.unref();
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, () => {
    clearInterval(timer);
    killRefresh("SIGTERM");
    void app.close().then(() => pool.end());
  });
await app.listen({ port: 3004, host: "0.0.0.0" });
