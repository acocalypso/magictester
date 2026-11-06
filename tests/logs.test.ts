import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  readdir,
  writeFile,
  utimes,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { boundedLog, retainLogs } from "../src/logs.js";
test("logs bound bytes, keep active work and remove expired completed files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mtg-logs-test-"));
  process.env.LOG_FILE_MB = "1";
  process.env.LOG_MAX_FILES = "2";
  try {
    const log = await boundedLog(dir, "actual.log");
    log.write(Buffer.alloc(2 * 1024 * 1024, 65));
    await log.close();
    const data = await readFile(join(dir, "actual.log"));
    assert.ok(data.length < 1024 * 1024 + 150);
    assert.match(data.toString().slice(-150), /log byte limit reached/);
    await writeFile(join(dir, "old.log"), "old");
    await utimes(join(dir, "old.log"), new Date(0), new Date(0));
    await writeFile(join(dir, "live.log.active"), "current work");
    await retainLogs(dir);
    assert.deepEqual((await readdir(dir)).sort(), [
      "actual.log",
      "live.log.active",
    ]);
  } finally {
    delete process.env.LOG_FILE_MB;
    delete process.env.LOG_MAX_FILES;
    await rm(dir, { recursive: true, force: true });
  }
});
