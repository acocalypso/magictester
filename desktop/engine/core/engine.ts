import {
  actionLogSchema,
  type ActionLog,
  type ActionHistoryRef,
} from "./game-actions.js";
import { config } from "./config.js";
import { resolveRuntime } from "./runtime.mjs";
import { boundedLog } from "./logs.js";
import { z } from "zod";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, basename, delimiter } from "node:path";
import { createInterface } from "node:readline";

export type Termination =
  "normal" | "rule_draw" | "timeout" | "engine_error" | "cancelled";
export interface GameResult {
  actionLog?: ActionLog;
  actionHistory?: ActionHistoryRef;
  unit?: "game";
  commanderColors?: { player: number; card: string; colors: string[] }[] | null;
  sideboardChanges?:
    | {
        player: number;
        added: { name: string; quantity: number }[];
        removed: { name: string; quantity: number }[];
        mainboardSize: number;
        sideboardSize: number;
      }[]
    | null;
  companionSelections?:
    | { player: number; declared: string | null; selected: string | null }[]
    | null;
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
export interface MatchResult extends Omit<
  GameResult,
  | "actionLog"
  | "actionHistory"
  | "unit"
  | "termination"
  | "startingLife"
  | "commanderCasts"
  | "eliminations"
  | "sideboardChanges"
  | "companionSelections"
  | "commanderColors"
> {
  unit: "match";
  bestOf: 3;
  termination: Termination | "game_limit";
  games: GameResult[];
  gameWins: number[];
  sideboarding: boolean;
}
export type EngineResult = GameResult | MatchResult;
export interface GameObservation {
  matchIndex: number;
  result: GameResult;
}
export const gameResults = (results: EngineResult[]) =>
  results.flatMap((result) =>
    result.unit === "match" ? result.games : [result],
  );
export interface EngineRequest {
  runtime?: { engineVersion: string; sourceHash: string };
  decks: string[];
  bestOf?: 1 | 3;
  maxMatchGames?: number;
  sideboarding?: boolean;
  companions?: (string | null)[];
  games: number;
  indices?: number[];
  seed: number;
  clockSeconds: number;
  mode?: "constructed" | "commander" | "duel";
  traceId?: string;
}
export interface CardGameEngine {
  getCapabilities(): Record<string, unknown>;
  runGames(
    request: EngineRequest,
    onResult: (result: EngineResult) => Promise<void>,
    signal?: AbortSignal,
    onGame?: (observation: GameObservation) => Promise<void>,
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
// Forge stores transform/adventure cards under their front-face name; true split
// cards have a complete rules entry and must retain both halves.
export function canonicalizeForgeDeck(
  deck: string,
  facts: Record<string, { name: string }>,
  aliases: Record<string, string> = {},
) {
  const normalizeName = (value: string) =>
    value
      .normalize("NFKC")
      .replace(/’/g, "'")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  const names = new Map(
    Object.entries(facts).map(([key, value]) => [
      normalizeName(key),
      value.name,
    ]),
  );
  for (const [alias, canonical] of Object.entries(aliases)) {
    const native = names.get(normalizeName(canonical));
    if (native) names.set(normalizeName(alias), native);
  }
  let physical = false;
  return deck
    .split(/\r?\n/)
    .map((line) => {
      if (/^\[.*\]$/.test(line.trim())) {
        physical = /^\[(Main|Sideboard|Commander)\]$/i.test(line.trim());
        return line;
      }
      if (!physical) return line;
      const match = /^(\d+)\s+(.+?)\s*$/.exec(line);
      if (!match) return line;
      const name = match[2];
      const canonical =
        names.get(normalizeName(name)) ||
        (name.includes(" // ")
          ? names.get(normalizeName(name.split(" // ")[0]))
          : undefined);
      return canonical ? match[1] + " " + canonical : line;
    })
    .join("\n");
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
    line = line.replace(/\r$/, "");
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
  actionLog: actionLogSchema.optional(),
  unit: z.literal("game").optional(),
  sideboardChanges: z
    .array(
      z.object({
        player: z.number().int().nonnegative(),
        added: z.array(
          z.object({ name: z.string(), quantity: z.number().int().positive() }),
        ),
        removed: z.array(
          z.object({ name: z.string(), quantity: z.number().int().positive() }),
        ),
        mainboardSize: z.number().int().nonnegative(),
        sideboardSize: z.number().int().nonnegative(),
      }),
    )
    .nullable()
    .optional(),
  commanderColors: z
    .array(
      z.object({
        player: z.number().int().nonnegative(),
        card: z.string(),
        colors: z.array(z.string()).length(1),
      }),
    )
    .nullable()
    .optional(),
  companionSelections: z
    .array(
      z.object({
        player: z.number().int().nonnegative(),
        declared: z.string().nullable(),
        selected: z.string().nullable(),
      }),
    )
    .nullable()
    .optional(),
  index: z.number().int().nonnegative(),
  batchIndex: z.number().int().nonnegative(),
  mode: z.enum(["constructed", "commander", "duel"]).optional(),
  mulliganRule: z.literal("London").optional(),
  engine: z.literal("forge"),
  engineVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  bridgeVersion: z.enum(["1", "2"]),
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
const structuredMatch = structuredResult
  .omit({
    actionLog: true,
    startingLife: true,
    commanderCasts: true,
    eliminations: true,
    sideboardChanges: true,
    companionSelections: true,
    commanderColors: true,
  })
  .extend({
    unit: z.literal("match"),
    bestOf: z.literal(3),
    termination: z.enum([
      "normal",
      "rule_draw",
      "timeout",
      "engine_error",
      "game_limit",
    ]),
    games: z.array(structuredResult).min(1).max(9),
    gameWins: z.array(z.number().int().nonnegative()).length(2),
    sideboarding: z.boolean(),
    turns: z.null(),
    startingPlayer: z.null(),
    players: structuredResult.shape.players.length(2),
  });
export const BRIDGE_PREFIX = "@@MAGICTESTER ";
function validateGame(result: GameResult) {
  const n = result.players.length;
  if (
    result.actionLog?.entries.some(
      (a) => a.activePlayer !== null && a.activePlayer >= n,
    )
  )
    throw Error("Invalid action history player identity");
  if (
    (result.winner !== null && result.winner >= n) ||
    (result.startingPlayer !== null && result.startingPlayer >= n) ||
    result.commanderCasts?.some((c) => c.player >= n) ||
    result.eliminations?.some((e) => e.players.some((p) => p >= n))
  )
    throw new Error("Invalid bridge player identity");
  if (
    result.termination !== "normal" &&
    (result.winner !== null || result.players.some((p) => p.placement !== null))
  )
    throw new Error("Incomplete games cannot have winners or placements");
  if (
    result.termination === "normal" &&
    (result.winner === null || result.players.some((p) => p.placement === null))
  )
    throw new Error("Completed games require observed placements");
}
export function parseStructuredEvent(line: string) {
  if (!line.startsWith(BRIDGE_PREFIX)) return null;
  const event = JSON.parse(line.slice(BRIDGE_PREFIX.length));
  if (event.type === "game_started")
    return {
      type: "game_started" as const,
      index: z.number().int().nonnegative().parse(event.index),
      gameIndex: z
        .number()
        .int()
        .nonnegative()
        .parse(event.gameIndex ?? 0),
    };
  if (event.type === "match_game") {
    const result = structuredResult.parse(event.result);
    validateGame(result);
    return {
      type: "match_game" as const,
      matchIndex: z.number().int().nonnegative().parse(event.matchIndex),
      result,
    };
  }
  if (event.type !== "result") throw new Error("Unknown bridge event");
  if (event.result.unit !== "match") {
    const result = structuredResult.parse(event.result);
    validateGame(result);
    return { type: "result" as const, result };
  }
  const result = structuredMatch.parse(event.result);
  result.games.forEach(validateGame);
  const wins = [0, 0];
  result.games.forEach((g, i) => {
    if (g.index !== i || g.players.length !== 2)
      throw new Error("Invalid match game identity");
    if (g.termination === "normal" && g.winner !== null) wins[g.winner]++;
  });
  if (
    result.termination === "game_limit" &&
    (result.games.length < 3 || wins.some((w) => w >= 2))
  )
    throw new Error("A resource-limited match cannot already have a winner");
  if (wins.some((w, i) => w !== result.gameWins[i]))
    throw new Error("Match score differs from actual game outcomes");
  if (
    result.termination === "normal" &&
    (result.winner === null ||
      result.winner > 1 ||
      wins[result.winner] < 2 ||
      result.players[result.winner].placement !== 1)
  )
    throw new Error("A BO3 match requires two observed wins");
  if (
    result.termination !== "normal" &&
    (result.winner !== null || result.players.some((p) => p.placement !== null))
  )
    throw new Error("Incomplete matches cannot have winners or placements");
  return { type: "result" as const, result };
}
export class ForgeEngineAdapter implements CardGameEngine {
  constructor(
    public home = process.env.FORGE_HOME || "/opt/forge",
    public logDir = process.env.LOG_DIR || "/data/logs",
  ) {}
  getCapabilities() {
    return {
      engine: "forge",
      version: "stable",
      bridgeVersion: "2",
      bo3: true,
      sideboarding: "native heuristics; actual changes reported",
      bo1: true,
      commander: true,
      duel: true,
      seed: true,
      perGameSeed: true,
      startingPlayerObserved: true,
      startingPlayerControl: false,
      commanderCastTiming: true,
      actionHistory: "native per-game log, with bounded partial capture",
      multiplayerPlacements: true,
      maximumPlayers: 4,
    };
  }
  async runGames(
    req: EngineRequest,
    onResult: (r: EngineResult) => Promise<void>,
    signal?: AbortSignal,
    onGame?: (observation: GameObservation) => Promise<void>,
    onProcess?: (pid: number | null) => void,
  ) {
    const runtime = await resolveRuntime(this.home, req.runtime);
    const home = runtime.home;
    const dir = await mkdtemp(join(tmpdir(), "magictester-"));
    await mkdir(this.logDir, { recursive: true });
    const logId =
      (req.traceId && /^[a-f0-9_-]{1,80}$/.test(req.traceId)
        ? req.traceId + "-"
        : "") +
      basename(dir) +
      ".log";
    const log = await boundedLog(this.logDir, logId);
    try {
      const metadataRoot = runtime.bridge.metadataDirectory
        ? resolve(home, runtime.bridge.metadataDirectory)
        : process.env.DATA_DIR || resolve(home, "..");
      const facts = JSON.parse(
        await readFile(join(metadataRoot, "forge-facts.json"), "utf8"),
      );
      if (facts.engineVersion !== runtime.bridge.engineVersion)
        throw new Error(
          "Forge card names do not match the pinned engine release",
        );
      const aliases = JSON.parse(
        await readFile(
          join(
            process.env.DATA_DIR || resolve(home, ".."),
            "card-aliases.json",
          ),
          "utf8",
        ).catch((e) => {
          if (e.code === "ENOENT") return "{}";
          throw e;
        }),
      );
      await Promise.all(
        req.decks.map((deck, i) =>
          writeFile(
            join(dir, `player-${i}.dck`),
            canonicalizeForgeDeck(deck, facts.cards, aliases),
          ),
        ),
      );
      const version = (await readFile(join(home, "build.txt"), "utf8")).trim();
      const bridge = runtime.bridge;
      if (bridge.version !== "2" || !/^[a-f0-9]{64}$/.test(bridge.sourceHash))
        throw new Error(
          "Forge bridge missing or incompatible; rerun bootstrap",
        );
      const indices =
        req.indices || Array.from({ length: req.games }, (_, i) => i);
      if (
        !indices.length ||
        indices.some(
          (n, i) =>
            !Number.isInteger(n) ||
            n < 0 ||
            n >= req.games ||
            (i > 0 && n <= indices[i - 1]),
        )
      )
        throw new Error("Invalid unit indices");
      let count = 0;
      while (count < indices.length) {
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
            "-XX:ActiveProcessorCount=" + config.FORGE_CPUS_PER_PROCESS,
            "-Djava.awt.headless=true",
            "-Dmagictester.engineVersion=" + bridge.engineVersion,
            "-Dfile.encoding=UTF-8",
            "-cp",
            join(home, bridge.classDirectory || "magictester-bridge") +
              delimiter +
              join(
                home,
                bridge.release?.jarName ||
                  `forge-gui-desktop-${bridge.engineVersion}-jar-with-dependencies.jar`,
              ),
            "MagicTesterBridge",
            configFile,
          ],
          {
            cwd: home,
            stdio: ["ignore", "pipe", "pipe"],
            detached: true,
            windowsHide: true,
          },
        );
        onProcess?.(proc.pid || null);
        proc.once("close", () => onProcess?.(null));
        let killed = false;
        let forceTimer: NodeJS.Timeout | undefined;
        const kill = () => {
          killed = true;
          if (proc.pid) {
            try {
              if (process.platform === "win32")
                spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"], {
                  windowsHide: true,
                }).on("error", () => {});
              else process.kill(-proc.pid, "SIGTERM");
            } catch {
              /* exited */
            }
            forceTimer = setTimeout(() => {
              try {
                if (process.platform !== "win32")
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
        let stderrTail = "";
        proc.stderr!.on("data", (b: Buffer) => {
          log.write(b);
          stderrTail = (stderrTail + b.toString("utf8")).slice(-8192);
        });
        const lines = createInterface({ input: proc.stdout! });
        let lastTermination: string | undefined;
        let expectedGame = 0;
        try {
          for await (const line of lines) {
            log.write(line + "\n");
            const event = parseStructuredEvent(line);
            if (event?.type === "game_started") {
              if (
                event.index !== indices[count] ||
                event.gameIndex !== expectedGame
              )
                throw new Error("Invalid bridge game start identity");
              resetWatchdog((req.clockSeconds + 5) * 1000);
            }
            if (event?.type === "match_game") {
              const game: GameResult = event.result;
              if (
                req.bestOf !== 3 ||
                game.index !== expectedGame ||
                game.players.length !== req.decks.length ||
                game.index >= (req.maxMatchGames ?? 5) ||
                event.matchIndex !== indices[count] ||
                game.seed !== (req.seed + indices[count] * 1009) % 2147483647 ||
                game.gameSeed !== (game.seed + game.index * 307) % 2147483647 ||
                game.bridgeVersion !== "2"
              )
                throw new Error("Invalid match observation identity");
              expectedGame++;
              if (game.engineVersion !== bridge.engineVersion)
                throw new Error("Engine version mismatch");
              game.engineVersion = bridge.engineVersion + " / " + version;
              game.bridgeSourceHash = bridge.sourceHash;
              game.logId = logId;
              resetWatchdog(90000);
              await onGame?.({ matchIndex: event.matchIndex, result: game });
            }
            if (event?.type !== "result") continue;
            const result: EngineResult = event.result;
            if (
              (req.bestOf === 3) !== (result.unit === "match") ||
              result.bridgeVersion !== "2"
            )
              throw new Error("Runner returned the wrong result unit");
            if (
              result.index !== indices[count] ||
              result.batchIndex !== indices[count] ||
              result.seed !== req.seed ||
              result.players.length !== req.decks.length ||
              result.gameSeed !==
                (req.seed + indices[count] * 1009) % 2147483647
            )
              throw new Error("Invalid bridge result identity");
            if (
              result.unit === "match" &&
              (result.games.length !== expectedGame ||
                (result.termination === "game_limit" &&
                  result.games.length !== (req.maxMatchGames ?? 5)))
            )
              throw new Error(
                "Match observation count or resource limit mismatch",
              );
            if (result.engineVersion !== bridge.engineVersion)
              throw new Error("Engine version mismatch");
            result.engineVersion = bridge.engineVersion + " / " + version;
            result.bridgeSourceHash = bridge.sourceHash;
            result.logId = logId;
            if (result.unit === "match")
              for (const game of result.games) {
                game.engineVersion = result.engineVersion;
                game.bridgeSourceHash = bridge.sourceHash;
                game.logId = logId;
              }
            lastTermination = result.termination;
            await onResult(result);
            count++;
            expectedGame = 0;
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
          if (!interruptedGame && (end.code !== 0 || count !== indices.length))
            throw new Error(
              `FORGE_ERROR exit=${end.code} signal=${end.signal} results=${count}/${indices.length}; log=${logId}` +
                (stderrTail.trim()
                  ? "; " + stderrTail.trim().slice(0, 2000)
                  : ""),
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
      await log.close();
      await rm(dir, { recursive: true, force: true });
    }
  }
}
