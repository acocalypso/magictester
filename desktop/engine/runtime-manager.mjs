import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  readFile,
  writeFile,
  mkdir,
  rename,
  rm,
  mkdtemp,
  readdir,
  link,
  copyFile,
} from "node:fs/promises";
import { join, delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { latestStable, compareVersions } from "./core/forge-releases.mjs";
import { resolveRuntime, registerRuntime } from "./core/runtime.mjs";
import { ForgeEngineAdapter, gameResults } from "./core/engine.js";
const here = fileURLToPath(new URL(".", import.meta.url));
export class RuntimeManager {
  constructor(data, emit) {
    this.data = data;
    this.root = join(data, "forge");
    this.emit = emit;
    this.operation = null;
    this.child = null;
    this.controller = null;
  }
  async run(script, args = [], env = {}) {
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [join(here, script), ...args], {
        cwd: here,
        env: {
          ...process.env,
          DATA_DIR: this.data,
          FORGE_HOME: this.root,
          ...env,
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        detached: process.platform !== "win32",
      });
      this.child = child;
      let tail = "";
      const capture = (chunk) => {
        tail = (tail + chunk.toString()).slice(-6000);
        for (const line of chunk.toString().split("\n")) {
          try {
            const e = JSON.parse(line);
            if (e.event)
              this.emit("setup", {
                message: e.event.replaceAll("_", " "),
                ...e,
              });
          } catch {}
        }
      };
      child.stdout.on("data", capture);
      child.stderr.on("data", capture);
      const abort = () => this.killCurrent();
      this.controller?.signal.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(() => {
        this.killCurrent();
        reject(Error("Engine setup exceeded its 20-minute limit"));
      }, 1200000);
      timer.unref();
      child.on("error", reject);
      child.once("close", (code) => {
        clearTimeout(timer);
        this.controller?.signal.removeEventListener("abort", abort);
        this.child = null;
        code === 0
          ? resolve()
          : reject(Error("Engine setup failed. " + tail.slice(-1800)));
      });
    });
  }
  async saveState(fields) {
    await mkdir(this.root, { recursive: true });
    const previous = await readFile(
      join(this.root, "forge-updates.json"),
      "utf8",
    )
      .then(JSON.parse)
      .catch(() => ({ channel: "stable" }));
    await writeFile(
      join(this.root, "forge-updates.json.tmp"),
      JSON.stringify({ ...previous, ...fields }),
    );
    await rename(
      join(this.root, "forge-updates.json.tmp"),
      join(this.root, "forge-updates.json"),
    );
  }
  async cloneRuntime(source, destination, rootLevel = true) {
    for (const entry of await readdir(source, { withFileTypes: true })) {
      if (
        rootLevel &&
        (entry.name.startsWith(".staging-") ||
          [
            "releases",
            "bridge-builds",
            "runtime-registry.json",
            "forge-updates.json",
            "forge-updates.json.tmp",
            "validation-logs",
            "logs",
          ].includes(entry.name))
      )
        continue;
      const from = join(source, entry.name),
        to = join(destination, entry.name);
      if (entry.isDirectory()) {
        await mkdir(to, { recursive: true });
        await this.cloneRuntime(from, to, false);
      } else if (entry.isFile()) {
        // Manifests and generated card metadata can be rewritten while staging.
        // Give them separate inodes so a rejected candidate cannot mutate the
        // active build; large, read-only Forge assets can share disk blocks.
        if (entry.name.endsWith(".json")) {
          await copyFile(from, to);
          continue;
        }
        try {
          await link(from, to);
        } catch {
          await copyFile(from, to);
        }
      }
    }
  }
  async refreshCards() {
    if (this.operation) return this.operation;
    this.controller = new AbortController();
    this.operation = this.run("bootstrap.mjs", [
      "--metadata-only",
      "--refresh-cards",
    ]).finally(() => {
      this.operation = null;
    });
    return this.operation;
  }
  async setup(refreshCards = false) {
    if (this.operation) return this.operation;
    this.controller = new AbortController();
    this.operation = this.install(refreshCards)
      .catch(async (error) => {
        await this.saveState({
          status: "error",
          error: error.message,
          checkedAt: new Date().toISOString(),
        });
        throw error;
      })
      .finally(() => {
        this.operation = null;
      });
    return this.operation;
  }
  async install(refreshCards) {
    await mkdir(this.root, { recursive: true });
    this.emit("setup", {
      message: "Checking the latest stable Forge release…",
    });
    const release = await latestStable();
    let active;
    try {
      active = await resolveRuntime(this.root);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (
      active &&
      compareVersions(release.version, active.bridge.engineVersion) < 0
    )
      throw Error("Stable-release downgrade refused");
    if (
      active?.bridge.release?.archiveSha256 &&
      release.version === active.bridge.engineVersion &&
      release.archiveSha256 !== active.bridge.release.archiveSha256
    )
      throw Error("Published Forge archive digest changed");
    await this.saveState({
      status: "validating",
      latestVersion: release.version,
      checkedAt: new Date().toISOString(),
      release,
      error: null,
    });
    const stage = await mkdtemp(join(this.root, ".staging-"));
    try {
      if (active && release.version === active.bridge.engineVersion)
        await this.cloneRuntime(active.home, stage);
      const descriptor = join(stage, "release.json");
      await writeFile(descriptor, JSON.stringify(release));
      await this.run("bootstrap.mjs", refreshCards ? ["--refresh-cards"] : [], {
        FORGE_RELEASE_FILE: descriptor,
        FORGE_CANDIDATE_HOME: stage,
      });
      const bridge = JSON.parse(
        await readFile(join(stage, "magictester-bridge.json"), "utf8"),
      );
      await this.validate({ home: stage, bridge });
      const final = join(
        this.root,
        "releases",
        release.version + "-" + bridge.sourceHash,
      );
      await mkdir(join(this.root, "releases"), { recursive: true });
      try {
        await rename(stage, final);
      } catch (error) {
        if (!["EEXIST", "ENOTEMPTY"].includes(error.code)) throw error;
        await rm(stage, { recursive: true, force: true });
      }
      await registerRuntime(this.root, final, bridge);
      active = await resolveRuntime(this.root);
    } catch (error) {
      await rm(stage, { recursive: true, force: true });
      await this.saveState({
        status: "error",
        error: error.message,
        checkedAt: new Date().toISOString(),
      });
      throw error;
    }
    const status = {
      channel: "stable",
      status: "current",
      activeVersion: release.version,
      latestVersion: release.version,
      checkedAt: new Date().toISOString(),
      release,
    };
    await writeFile(
      join(this.root, "forge-updates.json.tmp"),
      JSON.stringify(status),
    );
    await rename(
      join(this.root, "forge-updates.json.tmp"),
      join(this.root, "forge-updates.json"),
    );
    await writeFile(
      join(this.root, "desktop-bridge-source.sha256"),
      createHash("sha256")
        .update(await readFile(join(here, "bridge", "MagicTesterBridge.java")))
        .digest("hex"),
    );
    this.emit("setup", { message: "Forge is validated and ready." });
    return status;
  }
  async validate(runtime) {
    this.emit("setup", {
      message: "Checking engine contracts and playing real validation games…",
    });
    // Public-contract checks use Java source-launch mode from the bundled JDK.
    for (const name of [
      "DuelContracts",
      "MatchContracts",
      "CommanderColorContracts",
      "DeckNameContracts",
    ]) {
      await new Promise((resolve, reject) => {
        const c = spawn(
          "java",
          [
            "-Xmx1024m",
            "-Djava.awt.headless=true",
            "-cp",
            join(runtime.home, runtime.bridge.classDirectory) +
              delimiter +
              join(runtime.home, runtime.bridge.release.jarName),
            join(here, "contracts", name + ".java"),
          ],
          {
            cwd: runtime.home,
            windowsHide: true,
            detached: process.platform !== "win32",
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        this.child = c;
        let tail = "";
        c.stdout.on("data", (b) => {
          tail = (tail + b).slice(-2000);
        });
        c.stderr.on("data", (b) => {
          tail = (tail + b).slice(-2000);
        });
        const abort = () => this.killCurrent();
        this.controller?.signal.addEventListener("abort", abort, {
          once: true,
        });
        const timer = setTimeout(() => this.killCurrent(), 120000);
        c.on("error", reject);
        c.on("close", (code) => {
          clearTimeout(timer);
          this.controller?.signal.removeEventListener("abort", abort);
          this.child = null;
          code === 0 ? resolve() : reject(Error(name + " failed: " + tail));
        });
      });
    }
    const deck =
      "[metadata]\nName=Validation\n[Main]\n24 Mountain\n4 Lightning Bolt\n4 Shock\n4 Incinerate\n4 Lightning Strike\n4 Thermo-Alchemist\n4 Kessig Flamebreather\n4 Lava Spike\n4 Chain Lightning\n4 Rift Bolt\n";
    const commander =
      "[metadata]\nName=Commander validation\n[Main]\n40 Island\n59 Persistent Petitioners\n[Commander]\n1 Bruvac the Grandiloquent\n";
    for (const request of [
      { decks: [deck, deck] },
      { decks: [deck, deck], bestOf: 3, sideboarding: true, maxMatchGames: 5 },
      {
        decks: [commander, commander, commander, commander],
        mode: "commander",
      },
      { decks: [commander, commander], mode: "duel" },
    ]) {
      // Resolve directly against the candidate's standalone manifest before activation.
      const adapter = new ForgeEngineAdapter(
        runtime.home,
        join(this.data, "logs"),
      );
      await adapter.runGames(
        { ...request, games: 1, seed: 12345, clockSeconds: 300 },
        async (result) => {
          if (
            result.termination !== "normal" ||
            gameResults([result]).some(
              (g) => !g.actionLog?.complete || !g.actionLog.entries.length,
            )
          )
            throw Error("Candidate failed a real-game/history contract");
        },
        this.controller?.signal,
      );
    }
  }
  killCurrent() {
    const child = this.child;
    if (!child?.pid) return;
    try {
      if (process.platform === "win32")
        spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
          windowsHide: true,
        }).on("error", () => {});
      else process.kill(-child.pid, "SIGKILL");
    } catch {}
  }
  async close() {
    this.controller?.abort();
    this.killCurrent();
    await this.operation?.catch(() => {});
  }
  async check() {
    if (this.operation) return this.operation;
    this.controller = new AbortController();
    this.operation = this.checkCurrent()
      .catch(async (error) => {
        await this.saveState({
          status: "error",
          error: error.message,
          checkedAt: new Date().toISOString(),
        });
        throw error;
      })
      .finally(() => {
        this.operation = null;
      });
    return this.operation;
  }
  async checkCurrent() {
    let active;
    try {
      active = await resolveRuntime(this.root);
    } catch (error) {
      if (error.code === "ENOENT") return this.install(false);
      throw error;
    }
    const source = createHash("sha256")
      .update(await readFile(join(here, "bridge", "MagicTesterBridge.java")))
      .digest("hex");
    const installed = await readFile(
      join(this.root, "desktop-bridge-source.sha256"),
      "utf8",
    ).catch(() => null);
    if (source !== installed) return this.install(false);
    const release = await latestStable();
    if (release.version !== active.bridge.engineVersion)
      return this.install(false);
    const state = {
      channel: "stable",
      status: "current",
      activeVersion: release.version,
      latestVersion: release.version,
      checkedAt: new Date().toISOString(),
      release,
    };
    await writeFile(
      join(this.root, "forge-updates.json.tmp"),
      JSON.stringify(state),
    );
    await rename(
      join(this.root, "forge-updates.json.tmp"),
      join(this.root, "forge-updates.json"),
    );
    return state;
  }
}
