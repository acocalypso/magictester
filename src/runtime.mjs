import { access, readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { resolve, relative } from "node:path";
export const baseline = JSON.parse(
  await readFile(
    new URL("../services/forge-runner/release.json", import.meta.url),
    "utf8",
  ),
);
export function runtimeRoot() {
  return process.env.FORGE_HOME || (process.env.DATA_DIR || "/data") + "/forge";
}
export async function resolveRuntime(root = runtimeRoot(), expected) {
  let registry;
  try {
    registry = JSON.parse(
      await readFile(root + "/runtime-registry.json", "utf8"),
    );
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  if (registry) {
    const entry = expected
      ? registry.entries.find(
          (e) =>
            e.bridge.sourceHash === expected.sourceHash &&
            e.bridge.engineVersion === expected.engineVersion,
        )
      : registry.entries.find((e) => e.key === registry.active);
    if (entry) {
      const home = resolve(root, entry.home);
      if (relative(root, home).startsWith(".."))
        throw Error("Invalid runtime path");
      return { ...entry, home };
    }
    if (expected) {
      if (/^[a-f0-9]{64}$/.test(expected.sourceHash))
        for (const archived of registry.entries) {
          if (archived.bridge.engineVersion !== expected.engineVersion)
            continue;
          const home = resolve(root, archived.home),
            classDirectory = "bridge-builds/" + expected.sourceHash;
          try {
            await access(
              home + "/" + classDirectory + "/MagicTesterBridge.class",
            );
            return {
              ...archived,
              home,
              bridge: {
                ...archived.bridge,
                sourceHash: expected.sourceHash,
                classDirectory,
              },
            };
          } catch (e) {
            if (e.code !== "ENOENT") throw e;
          }
        }
      throw Error("Pinned Forge runtime is unavailable");
    }
    throw Error("Active Forge runtime is unavailable");
  }
  const bridge = JSON.parse(
    await readFile(root + "/magictester-bridge.json", "utf8"),
  );
  if (
    expected &&
    (expected.engineVersion !== bridge.engineVersion ||
      expected.sourceHash !== bridge.sourceHash)
  ) {
    if (
      expected.engineVersion !== bridge.engineVersion ||
      !/^[a-f0-9]{64}$/.test(expected.sourceHash)
    )
      throw Error("Pinned Forge runtime is unavailable");
    bridge.sourceHash = expected.sourceHash;
    bridge.classDirectory = "bridge-builds/" + expected.sourceHash;
  }
  return {
    key: bridge.engineVersion + "-" + bridge.sourceHash,
    home: root,
    bridge,
  };
}
export async function registerRuntime(root, home, bridge, activate = true) {
  let registry = { entries: [], active: null };
  try {
    registry = JSON.parse(
      await readFile(root + "/runtime-registry.json", "utf8"),
    );
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const key = bridge.engineVersion + "-" + bridge.sourceHash;
  const entry = { key, home: relative(root, home) || ".", bridge };
  if (entry.home.startsWith(".."))
    throw Error("Runtime must be inside runtime root");
  registry.entries = registry.entries.filter((e) => e.key !== key);
  registry.entries.push(entry);
  if (activate) registry.active = key;
  await mkdir(root, { recursive: true });
  const tmp = root + "/runtime-registry.json." + process.pid + ".tmp";
  await writeFile(tmp, JSON.stringify(registry));
  await rename(tmp, root + "/runtime-registry.json");
  return entry;
}
export async function updateStatus(root = runtimeRoot()) {
  try {
    return JSON.parse(await readFile(root + "/forge-updates.json", "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    return { channel: "stable", status: "unchecked" };
  }
}
export function stableReleaseProblem(updates, engineVersion, now = Date.now()) {
  const checked = Date.parse(updates.checkedAt || "");
  if (
    updates.status === "error" ||
    !updates.latestVersion ||
    !Number.isFinite(checked) ||
    now - checked > 26 * 3600000
  )
    return "Stable Forge release check is unavailable; see engine update status";
  if (updates.latestVersion !== engineVersion)
    return "Latest stable Forge release is awaiting validation; see engine update status";
  return null;
}
