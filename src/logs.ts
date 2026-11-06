import { createWriteStream } from "node:fs";
import { readdir, stat, unlink, rename, mkdir } from "node:fs/promises";
import { join } from "node:path";
const positive = (name: string, fallback: number) => {
  const value = Number(process.env[name] || fallback);
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`Invalid ${name}`);
  return value;
};
export async function retainLogs(dir: string) {
  await mkdir(dir, { recursive: true });
  const maxBytes = positive("LOG_TOTAL_MB", 512) * 1024 * 1024;
  const maxFiles = positive("LOG_MAX_FILES", 500);
  const maxAge = positive("LOG_RETENTION_DAYS", 7) * 86400000;
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".log")) continue;
    const path = join(dir, entry.name);
    const info = await stat(path).catch(() => null);
    if (info) files.push({ path, size: info.size, time: info.mtimeMs });
  }
  files.sort((a, b) => b.time - a.time);
  let bytes = 0;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    bytes += file.size;
    if (i >= maxFiles || bytes > maxBytes || Date.now() - file.time > maxAge)
      await unlink(file.path).catch(() => {});
  }
  // Incomplete logs from terminated processes age out; live writers update mtime.
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".active")) continue;
    const path = join(dir, entry.name);
    const info = await stat(path).catch(() => null);
    if (info && Date.now() - info.mtimeMs > 86400000)
      await unlink(path).catch(() => {});
  }
}
export async function boundedLog(dir: string, id: string) {
  await retainLogs(dir);
  const path = join(dir, id + ".active");
  const stream = createWriteStream(path);
  let error: Error | undefined;
  stream.on("error", (e) => {
    error = e;
  });
  const max = positive("LOG_FILE_MB", 8) * 1024 * 1024;
  let bytes = 0;
  let truncated = false;
  return {
    write(value: string | Buffer) {
      if (error || truncated) return;
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      const available = max - bytes;
      if (chunk.length > available) {
        if (available > 0) stream.write(chunk.subarray(0, available));
        stream.write(
          "\n[MagicTester: log byte limit reached; result measurements remain in PostgreSQL]\n",
        );
        truncated = true;
      } else {
        stream.write(chunk);
        bytes += chunk.length;
      }
    },
    async close() {
      await new Promise<void>((resolve) => {
        if (stream.closed) return resolve();
        stream.once("close", resolve);
        stream.end();
      });
      if (error)
        console.error(
          JSON.stringify({
            event: "engine_log_error",
            logId: id,
            error: error.message,
          }),
        );
      else await rename(path, join(dir, id));
      await retainLogs(dir);
    },
  };
}
