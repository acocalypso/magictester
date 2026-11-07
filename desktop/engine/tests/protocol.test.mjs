import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
test("packaged worker opens a private SQLite workspace and never needs a server", async () => {
  const data = await mkdtemp(join(tmpdir(), "desktop-protocol-"));
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("../dist/worker.mjs", import.meta.url))],
    {
      env: { ...process.env, DATA_DIR: data, FORGE_HOME: join(data, "forge") },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const lines = createInterface({ input: child.stdout });
  const replies = new Map();
  lines.on("line", (line) => {
    const value = JSON.parse(line);
    if (value.id) replies.get(value.id)?.(value);
  });
  let stderr = "";
  child.stderr.on("data", (b) => (stderr += b));
  let id = 0;
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const key = ++id;
      const timer = setTimeout(
        () => reject(Error("Worker timeout: " + stderr)),
        15000,
      );
      replies.set(key, (value) => {
        clearTimeout(timer);
        resolve(value);
      });
      child.stdin.write(JSON.stringify({ id: key, method, params }) + "\n");
    });
  try {
    const status = (await call("status")).result;
    assert.equal(status.formats.length, 9);
    assert.equal(status.ready, false);
    assert.equal(status.jobs.length, 0);
    assert.equal(
      (await call("unknown")).error.message,
      "Unknown desktop command",
    );
    await call("shutdown");
    await new Promise((resolve) => child.once("exit", resolve));
  } finally {
    child.kill();
    lines.close();
    await rm(data, { recursive: true, force: true });
  }
});
