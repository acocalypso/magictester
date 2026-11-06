import { z } from "zod";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm, mkdir, readFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

export type Termination =
  "normal" | "rule_draw" | "timeout" | "engine_error" | "cancelled";
export interface GameResult {
  logId?: string;
  mulliganRule?: "London";
  mode?: "constructed" | "commander" | "duel";
  bridgeVersion?: string;
  bridgeSourceHash?: string;
  gameSeed?: number;
  startingLife?: number[];
  commanderCasts?: {
    player: number;
    card: string;
    turn: number;
    playerTurn: number;
    from: string;
  }[];
  eliminations?: {
    players: number[];
    placement: number;
    turn: number;
    reasons: Record<string, string>;
  }[];
  index: number;
  engine: "forge";
  engineVersion: string;
  seed: number;
  batchIndex: number;
  winner: number | null;
  players: {
    id: string;
    deckId?: string;
    seat?: number;
    placement: number | null;
  }[];
  turns: number | null;
  startingPlayer: number | null;
  durationMs: number;
  termination: Termination;
}
export interface EngineRequest {
  decks: string[];
  games: number;
  seed: number;
  clockSeconds: number;
  mode?: "constructed" | "commander" | "duel";
  traceId?: string;
}
export interface CardGameEngine {
  getCapabilities(): Record<string, unknown>;
  runGames(
    request: EngineRequest,
    onResult: (result: GameResult) => Promise<void>,
    signal?: AbortSignal,
  ): Promise<void>;
}
export function serializeDeck(
  cards: { name: string; quantity: number; section: string }[],
  name: string,
) {
  const mapping: Record<string, string> = {
    MAINBOARD: "Main",
    SIDEBOARD: "Sideboard",
    COMMANDER: "Commander",
  };
  const physical = cards
    .filter((c) => c.section !== "COMPANION")
    .map((c) => ({ ...c }));
  for (const companion of cards.filter((c) => c.section === "COMPANION")) {
    const existing = physical.find(
      (c) => c.section === "SIDEBOARD" && c.name === companion.name,
    );
    if (existing)
      existing.quantity = Math.max(existing.quantity, companion.quantity);
    else physical.push({ ...companion, section: "SIDEBOARD" });
  }
  return (
    "[metadata]\nName=" +
    name +
    "\n" +
    Object.entries(mapping)
      .map(
        ([key, section]) =>
          "[" +
          section +
          "]\n" +
          physical
            .filter((c) => c.section === key)
            .map((c) => `${c.quantity} ${c.name}`)
            .join("\n"),
      )
      .join("\n") +
    "\n"
  );
}
export class ForgeResultParser {
  turns: number | null = null;
  startingPlayer: number | null = null;
  timeout = false;
  error = false;
  constructor(
    public engineVersion: string,
    public seed: number,
    public playerCount = 2,
  ) {}
  line(line: string): GameResult | null {
    if (line.includes("Stopping slow match as draw")) this.timeout = true;
    if (
      /Exception|StackOverflowError|Could not load deck|No deck found/.test(
        line,
      )
    )
      this.error = true;
    const start = line.match(/^Turn: Turn 1 \(Ai\((\d+)\)/);
    if (start) this.startingPlayer = Number(start[1]) - 1;
    const turn = line.match(/^Game Outcome: Turn (\d+)/);
    if (turn) this.turns = Number(turn[1]);
    const win = line.match(
      /^Game Result: Game (\d+) ended in (\d+) ms\. Ai\((\d+)\)-.* has won!$/,
    );
    const draw = line.match(
      /^Game Result: Game (\d+) ended in a Draw! Took (\d+) ms\.$/,
    );
    if (!win && !draw) return null;
    const match = (win || draw)!;
    const winner =
      win && !this.timeout && !this.error ? Number(win[3]) - 1 : null;
    const result: GameResult = {
      index: Number(match[1]) - 1,
      batchIndex: Number(match[1]) - 1,
      engine: "forge",
      engineVersion: this.engineVersion,
      seed: this.seed,
      winner,
      players: Array.from({ length: this.playerCount }, (_, i) => ({
        id: `player-${i}`,
        placement:
          winner === null
            ? null
            : i === winner
              ? 1
              : this.playerCount === 2
                ? 2
                : null,
      })),
      turns: this.turns,
      startingPlayer: this.startingPlayer,
      durationMs: Number(match[2]),
      termination: this.timeout
        ? "timeout"
        : this.error
          ? "engine_error"
          : draw
            ? "rule_draw"
            : "normal",
    };
    this.turns = null;
    this.startingPlayer = null;
    this.timeout = false;
    this.error = false;
    return result;
  }
}
const structuredResult = z.object({
  index: z.number().int().nonnegative(),
  batchIndex: z.number().int().nonnegative(),
  mode: z.enum(["constructed", "commander", "duel"]).optional(),
  mulliganRule: z.literal("London").optional(),
  engine: z.literal("forge"),
  engineVersion: z.literal("2.0.15"),
  bridgeVersion: z.literal("1"),
  seed: z.number().int().nonnegative(),
  gameSeed: z.number().int().nonnegative(),
  winner: z.number().int().nonnegative().nullable(),
  players: z
    .array(
      z.object({
        id: z.string(),
        placement: z.number().int().min(1).max(4).nullable(),
      }),
    )
    .min(2)
    .max(4),
  turns: z.number().int().nonnegative().nullable(),
  startingPlayer: z.number().int().nonnegative().nullable(),
  startingLife: z.array(z.number().int()).max(4),
  durationMs: z.number().nonnegative(),
  termination: z.enum(["normal", "rule_draw", "timeout", "engine_error"]),
  commanderCasts: z.array(
    z.object({
      player: z.number().int().nonnegative(),
      card: z.string(),
      turn: z.number().int().nonnegative(),
      playerTurn: z.number().int().nonnegative(),
      from: z.string(),
    }),
  ),
  eliminations: z.array(
    z.object({
      players: z.array(z.number().int().nonnegative()),
      placement: z.number().int().min(1).max(4),
      turn: z.number().int().nonnegative(),
      reasons: z.record(z.string(), z.string()),
    }),
  ),
});
export const BRIDGE_PREFIX = "@@MAGICTESTER ";
export function parseStructuredEvent(line: string) {
  if (!line.startsWith(BRIDGE_PREFIX)) return null;
  const event = JSON.parse(line.slice(BRIDGE_PREFIX.length));
  if (event.type === "result") {
    const result = structuredResult.parse(event.result);
    const n = result.players.length;
    if (
      (result.winner !== null && result.winner >= n) ||
      (result.startingPlayer !== null && result.startingPlayer >= n) ||
      result.commanderCasts.some((c) => c.player >= n) ||
      result.eliminations.some((e) => e.players.some((p) => p >= n))
    )
      throw new Error("Invalid bridge player identity");
    if (
      result.termination !== "normal" &&
      (result.winner !== null ||
        result.players.some((p) => p.placement !== null))
    )
      throw new Error("Incomplete games cannot have winners or placements");
    if (
      result.termination === "normal" &&
      (result.winner === null ||
        result.players.some((p) => p.placement === null))
    )
      throw new Error("Completed games require observed placements");
    return { type: "result" as const, result };
  }
  if (event.type === "game_started")
    return {
      type: "game_started" as const,
      index: z.number().int().nonnegative().parse(event.index),
    };
  throw new Error("Unknown bridge event");
}
export class ForgeEngineAdapter implements CardGameEngine {
  constructor(
    public home = process.env.FORGE_HOME || "/opt/forge",
    public logDir = process.env.LOG_DIR || "/data/logs",
  ) {}
  getCapabilities() {
    return {
      engine: "forge",
      version: "2.0.15",
      bridgeVersion: "1",
      bo1: true,
      commander: true,
      duel: true,
      seed: true,
      perGameSeed: true,
      startingPlayerObserved: true,
      startingPlayerControl: false,
      commanderCastTiming: true,
      multiplayerPlacements: true,
      maximumPlayers: 4,
    };
  }
  async runGames(
    req: EngineRequest,
    onResult: (r: GameResult) => Promise<void>,
    signal?: AbortSignal,
  ) {
    const dir = await mkdtemp(join(tmpdir(), "magictester-"));
    await mkdir(this.logDir, { recursive: true });
    const logId =
      (req.traceId && /^[a-f0-9_-]{1,80}$/.test(req.traceId)
        ? req.traceId + "-"
        : "") +
      dir.split("/").pop()! +
      ".log";
    const log = createWriteStream(join(this.logDir, logId));
    try {
      await Promise.all(
        req.decks.map((deck, i) =>
          writeFile(join(dir, `player-${i}.dck`), deck),
        ),
      );
      const version = (
        await readFile(join(this.home, "build.txt"), "utf8")
      ).trim();
      const bridge = JSON.parse(
        await readFile(join(this.home, "magictester-bridge.json"), "utf8"),
      );
      if (bridge.version !== "1" || !/^[a-f0-9]{64}$/.test(bridge.sourceHash))
        throw new Error(
          "Forge bridge missing or incompatible; rerun bootstrap",
        );
      let count = 0;
      while (count < req.games) {
        if (signal?.aborted) throw new Error("CANCELLED");
        const startIndex = count;
        const configFile = join(dir, "request.json");
        await writeFile(
          configFile,
          JSON.stringify({
            ...req,
            mode: req.mode || "constructed",
            startIndex,
            decks: req.decks.map((_, i) => join(dir, `player-${i}.dck`)),
          }),
        );
        const proc = spawn(
          "java",
          [
            "-Xmx" + (process.env.FORGE_HEAP || "1024m"),
            "-Djava.awt.headless=true",
            "-Dfile.encoding=UTF-8",
            "-cp",
            join(this.home, "magictester-bridge") +
              ":" +
              join(
                this.home,
                "forge-gui-desktop-2.0.15-jar-with-dependencies.jar",
              ),
            "MagicTesterBridge",
            configFile,
          ],
          { cwd: this.home, stdio: ["ignore", "pipe", "pipe"], detached: true },
        );
        let killed = false;
        let forceTimer: NodeJS.Timeout | undefined;
        const kill = () => {
          killed = true;
          if (proc.pid) {
            try {
              process.kill(-proc.pid, "SIGTERM");
            } catch {
              /* exited */
            }
            forceTimer = setTimeout(() => {
              try {
                process.kill(-proc.pid!, "SIGKILL");
              } catch {
                /* exited */
              }
            }, 3000);
            forceTimer.unref();
          }
        };
        signal?.addEventListener("abort", kill, { once: true });
        if (signal?.aborted) kill();
        let watchdog = setTimeout(kill, 90000);
        watchdog.unref();
        const resetWatchdog = (ms: number) => {
          clearTimeout(watchdog);
          watchdog = setTimeout(kill, ms);
          watchdog.unref();
        };
        const exited = new Promise<{
          code: number | null;
          signal: NodeJS.Signals | null;
        }>((resolve, reject) => {
          proc.once("error", reject);
          proc.once("close", (code, signal) => resolve({ code, signal }));
        });
        void exited.catch(() => {});
        proc.stderr!.on("data", (b) => log.write(b));
        const lines = createInterface({ input: proc.stdout! });
        let lastTermination: string | undefined;
        try {
          for await (const line of lines) {
            log.write(line + "\n");
            const event = parseStructuredEvent(line);
            if (event?.type === "game_started") {
              if (event.index !== count)
                throw new Error("Invalid bridge game start identity");
              resetWatchdog((req.clockSeconds + 5) * 1000);
            }
            if (event?.type !== "result") continue;
            const result: GameResult = event.result;
            if (
              result.index !== count ||
              result.batchIndex !== count ||
              result.seed !== req.seed ||
              result.players.length !== req.decks.length ||
              result.gameSeed !== (req.seed + count * 1009) % 2147483647
            )
              throw new Error("Invalid bridge result identity");
            result.engineVersion = "2.0.15 / " + version;
            result.bridgeSourceHash = bridge.sourceHash;
            result.logId = logId;
            lastTermination = result.termination;
            await onResult(result);
            count++;
            resetWatchdog(90000);
          }
          const end = await exited;
          if (killed)
            throw new Error(
              signal?.aborted ? "CANCELLED" : "FORGE_PROCESS_TIMEOUT",
            );
          const interruptedGame =
            end.code === 75 &&
            count > startIndex &&
            ["timeout", "engine_error"].includes(lastTermination || "");
          if (!interruptedGame && (end.code !== 0 || count !== req.games))
            throw new Error(
              `FORGE_ERROR exit=${end.code} signal=${end.signal} results=${count}/${req.games}`,
            );
          // Timeouts/errors terminate their JVM. Start the next independent BO1 game
          // with its own stable seed, keeping already streamed results unchanged.
        } catch (error) {
          kill();
          await exited.catch(() => {});
          throw error;
        } finally {
          clearTimeout(watchdog);
          if (forceTimer) clearTimeout(forceTimer);
          signal?.removeEventListener("abort", kill);
        }
      }
    } finally {
      log.end();
      await rm(dir, { recursive: true, force: true });
    }
  }
}
