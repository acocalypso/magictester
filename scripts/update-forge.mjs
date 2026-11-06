// Stable releases only. Build/test candidates before atomic activation; retain old runtimes.
import {
  readFile,
  writeFile,
  rename,
  mkdir,
  rm,
  mkdtemp,
  chmod,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import pg from "pg";
import { latestStable, compareVersions } from "../src/forge-releases.mjs";
import {
  resolveRuntime,
  registerRuntime,
  runtimeRoot,
  updateStatus,
} from "../src/runtime.mjs";
const root = runtimeRoot();
await mkdir(root, { recursive: true });
let state = await updateStatus(root);
async function save(fields) {
  state = { ...state, ...fields, channel: "stable" };
  const temp = root + "/forge-updates.json." + process.pid + ".tmp";
  await writeFile(temp, JSON.stringify(state));
  await rename(temp, root + "/forge-updates.json");
}
let child;
function kill(signal) {
  if (child?.pid)
    try {
      process.kill(-child.pid, signal);
    } catch {
      /* exited */
    }
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    kill("SIGKILL");
    process.exit(1);
  });
async function run(args, env = process.env, timeout = 900000) {
  await new Promise((ok, fail) => {
    child = spawn(process.execPath, args, {
      stdio: "inherit",
      env,
      detached: true,
    });
    const timer = setTimeout(() => kill("SIGKILL"), timeout);
    timer.unref();
    child.once("error", (e) => {
      clearTimeout(timer);
      fail(e);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      child = undefined;
      if (code === 0) ok();
      else fail(Error("Forge validation subprocess exited " + code));
    });
  });
}
const database = new pg.Client({
  connectionString:
    process.env.DATABASE_URL ||
    "postgres://magictester:magictester@localhost:5432/magictester",
});
let locked = false,
  stage;
try {
  if (database) {
    await database.connect();
    locked = (
      await database.query("SELECT pg_try_advisory_lock(7193199) AS locked")
    ).rows[0].locked;
    if (!locked) {
      console.log(JSON.stringify({ event: "forge_update_busy" }));
      process.exitCode = 0;
    }
  }
  if (database && !locked) {
    await database.end();
    process.exit(0);
  }
  const active = await resolveRuntime(root);
  await registerRuntime(root, active.home, active.bridge);
  await save({
    status: "checking",
    activeVersion: active.bridge.engineVersion,
    error: null,
  });
  const release = await latestStable();
  await save({
    latestVersion: release.version,
    checkedAt: new Date().toISOString(),
    release,
  });
  const comparison = compareVersions(
    release.version,
    active.bridge.engineVersion,
  );
  if (comparison < 0)
    throw Error(
      "Latest stable endpoint returned an older release; downgrade refused",
    );
  const force = process.argv.includes("--verify-current");
  if (comparison === 0 && !force) {
    if (
      active.bridge.release &&
      (active.bridge.release.archiveSha256 !== release.archiveSha256 ||
        active.bridge.release.sourceCommit !== release.sourceCommit)
    )
      throw Error("Stable release archive digest changed unexpectedly");
    await save({ status: "current", error: null });
    console.log(
      JSON.stringify({
        event: "forge_stable_current",
        version: release.version,
      }),
    );
  } else {
    await save({ status: "validating", candidateVersion: release.version });
    await mkdir(root + "/releases", { recursive: true });
    stage = await mkdtemp(root + "/releases/.staging-");
    const descriptor = stage + "/release.json";
    await writeFile(descriptor, JSON.stringify(release));
    const env = {
      ...process.env,
      FORGE_RELEASE_FILE: descriptor,
      FORGE_CANDIDATE_HOME: stage,
    };
    await run(["scripts/bootstrap.mjs"], env);
    await run(["scripts/validate-forge.mjs", stage], process.env, 600000);
    await chmod(stage, 0o755);
    const bridge = JSON.parse(
      await readFile(stage + "/magictester-bridge.json", "utf8"),
    );
    const final =
      root + "/releases/" + release.version + "-" + bridge.sourceHash;
    try {
      await rename(stage, final);
    } catch (e) {
      if (!["EEXIST", "ENOTEMPTY"].includes(e.code)) throw e;
      await rm(stage, { recursive: true, force: true });
    }
    stage = undefined;
    // Verify the lock connection is still alive before publishing an active pointer.
    if (database) await database.query("SELECT 1");
    await registerRuntime(root, final, bridge);
    await save({
      status: "current",
      activeVersion: release.version,
      candidateVersion: null,
      activatedAt: new Date().toISOString(),
      error: null,
      validation: JSON.parse(
        await readFile(final + "/validation.json", "utf8"),
      ),
    });
    console.log(
      JSON.stringify({
        event: "forge_stable_activated",
        version: release.version,
        sourceHash: bridge.sourceHash,
      }),
    );
  }
} catch (e) {
  await save({ status: "error", error: e.message });
  console.error(
    JSON.stringify({ event: "forge_stable_update_failed", error: e.message }),
  );
  process.exitCode = 1;
} finally {
  if (stage) await rm(stage, { recursive: true, force: true });
  if (database) {
    if (locked)
      await database
        .query("SELECT pg_advisory_unlock(7193199)")
        .catch(() => {});
    await database.end();
  }
}
