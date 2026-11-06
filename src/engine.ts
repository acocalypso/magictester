import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm, mkdir, readFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

export type Termination =
  | "normal"
  | "rule_draw"
  | "timeout"
  | "engine_error"
  | "cancelled";
export interface GameResult {
  logId?: string;
  index: number;
  engine: "forge";
  engineVersion: string;
  seed: number;
  batchIndex: number;
  winner: number | null;
  players: { id: string; placement: number | null }[];
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
  mode?: "constructed" | "commander";
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
    COMPANION: "Companion",
  };
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
          cards
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
      termination: this.error
        ? "engine_error"
        : this.timeout
          ? "timeout"
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
export class ForgeEngineAdapter implements CardGameEngine {
  constructor(
    public home = process.env.FORGE_HOME || "/opt/forge",
    public logDir = process.env.LOG_DIR || "/data/logs",
  ) {}
  getCapabilities() {
    return {
      engine: "forge",
      version: "2.0.15",
      bo1: true,
      commander: "experimental",
      seed: true,
      startingPlayerObserved: true,
      startingPlayerControl: false,
      commanderCastTiming: false,
      multiplayerPlacements: false,
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
    let child: ReturnType<typeof spawn> | undefined;
    try {
      await Promise.all(
        req.decks.map((deck, i) =>
          writeFile(join(dir, `player-${i}.dck`), deck),
        ),
      );
      const version = (
        await readFile(join(this.home, "build.txt"), "utf8")
      ).trim();
      const parser = new ForgeResultParser(
        "2.0.15 / " + version,
        req.seed,
        req.decks.length,
      );
      const args = [
        "-Xmx" + (process.env.FORGE_HEAP || "1024m"),
        "-Djava.awt.headless=true",
        "-Dfile.encoding=UTF-8",
        "-jar",
        "forge-gui-desktop-2.0.15-jar-with-dependencies.jar",
        "sim",
        "-D",
        dir,
        "-d",
        ...req.decks.map((_, i) => `player-${i}.dck`),
        "-n",
        String(req.games),
        "-s",
        String(req.seed),
        "-c",
        String(req.clockSeconds),
        "-f",
        req.mode || "constructed",
      ];
      child = spawn("java", args, {
        cwd: this.home,
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      });
      const proc = child;
      let killed = false;
      let forceTimer: NodeJS.Timeout | undefined;
      const kill = () => {
        killed = true;
        if (proc.pid) {
          try {
            process.kill(-proc.pid, "SIGTERM");
          } catch {
            /* already exited */
          }
          forceTimer = setTimeout(() => {
            try {
              process.kill(-proc.pid!, "SIGKILL");
            } catch {
              /* already exited */
            }
          }, 3000);
          forceTimer.unref();
        }
      };
      if (signal?.aborted) kill();
      signal?.addEventListener("abort", kill, { once: true });
      // The CLI clock starts after card initialization; the outer deadline also bounds JVM startup.
      const deadline = setTimeout(
        kill,
        (req.clockSeconds * req.games + 90) * 1000,
      );
      deadline.unref();
      const exited = new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
      }>((resolve, reject) => {
        proc.once("error", reject);
        proc.once("close", (code, signal) => resolve({ code, signal }));
      });
      // Attach a rejection handler immediately so spawn failures cannot become unhandled.
      void exited.catch(() => {});
      proc.stderr!.on("data", (b) => {
        log.write(b);
        if (/Exception|StackOverflowError/.test(b.toString()))
          parser.error = true;
      });
      const lines = createInterface({ input: proc.stdout! });
      let count = 0;
      try {
        for await (const line of lines) {
          log.write(line + "\n");
          const result = parser.line(line);
          if (result) {
            result.logId = logId;
            await onResult(result);
            count++;
          }
        }
        const end = await exited;
        if (killed)
          throw new Error(
            signal?.aborted ? "CANCELLED" : "FORGE_PROCESS_TIMEOUT",
          );
        if (end.code !== 0 || count !== req.games)
          throw new Error(
            `FORGE_ERROR exit=${end.code} signal=${end.signal} results=${count}/${req.games}`,
          );
      } catch (error) {
        kill();
        await exited.catch(() => {});
        throw error;
      } finally {
        clearTimeout(deadline);
        if (forceTimer) clearTimeout(forceTimer);
        signal?.removeEventListener("abort", kill);
      }
    } finally {
      log.end();
      await rm(dir, { recursive: true, force: true });
    }
  }
}
