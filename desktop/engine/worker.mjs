// Private NDJSON transport over inherited pipes. No HTTP port, Redis or database server.
import { createInterface } from "node:readline";
import {
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  closeSync,
} from "node:fs";
import { join } from "node:path";
import { DesktopApplication } from "./application.mjs";
const data = process.env.DATA_DIR;
if (!data) throw Error("DATA_DIR must point to a writable per-user directory");
mkdirSync(data, { recursive: true });
const lock = join(data, "desktop-worker.lock");
function acquire() {
  try {
    return openSync(lock, "wx");
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    let pid;
    try {
      pid = JSON.parse(readFileSync(lock, "utf8")).pid;
    } catch {
      throw Error(
        "Desktop lock is invalid. Close other instances before removing " +
          lock,
      );
    }
    try {
      process.kill(pid, 0);
    } catch (probe) {
      if (probe.code === "ESRCH") {
        unlinkSync(lock);
        return openSync(lock, "wx");
      }
      throw probe;
    }
    throw Error("MagicTester is already using this data directory");
  }
}
const fd = acquire();
writeFileSync(fd, JSON.stringify({ pid: process.pid }));
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const app = new DesktopApplication(data, (event, payload) =>
  send({ event, payload }),
);
let exiting = false;
async function stop() {
  if (exiting) return;
  exiting = true;
  await app
    .close()
    .catch((error) => process.stderr.write(error.message + "\n"));
  closeSync(fd);
  try {
    unlinkSync(lock);
  } catch {}
}
process.on("SIGTERM", () => void stop().then(() => process.exit(0)));
process.on("SIGINT", () => void stop().then(() => process.exit(0)));
const ready = app.initialize().then((payload) => {
  send({ event: "ready", payload });
  if (process.env.MAGICTESTER_AUTO_MAINTENANCE !== "0")
    setImmediate(() => void app.maintenance());
});
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", (line) => {
  void (async () => {
    let request;
    try {
      if (line.length > 8 * 1024 * 1024)
        throw Error("Desktop command exceeds 8 MiB");
      request = JSON.parse(line);
      if (
        !Number.isSafeInteger(request.id) ||
        typeof request.method !== "string"
      )
        throw Error("Invalid desktop request");
      await ready;
      const result = await app.dispatch(request.method, request.params || {});
      send({ id: request.id, result });
      if (request.method === "shutdown") {
        exiting = true;
        closeSync(fd);
        try {
          unlinkSync(lock);
        } catch {}
        process.exitCode = 0;
        lines.close();
        process.stdin.destroy();
      }
    } catch (error) {
      send({
        id: request?.id ?? null,
        error: {
          message: error.issues
            ? error.issues
                .map(
                  (issue) =>
                    `${issue.path.join(" ") || "Settings"}: ${issue.message}`,
                )
                .join("\n")
            : error.message,
          details: error.issues || error.details || null,
        },
      });
    }
  })();
});
lines.on("close", () => {
  if (!exiting)
    void stop().then(() => {
      process.exitCode = 0;
    });
});
