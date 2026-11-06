import { createHash } from "node:crypto";
import { z } from "zod";
import { getFormat } from "./formats.js";
import { planGames, type Opponent } from "./domain.js";
export interface BenchmarkPlan {
  key: string;
  name: string;
  kind: "matchup" | "pod";
  opponents: Opponent[];
  games: number;
  seed: number;
}
export function planBenchmark(
  format: string,
  games: number,
  opponents: Opponent[],
  seed: number,
): BenchmarkPlan[] {
  const players = getFormat(format)?.players || 2;
  if (players === 2)
    return planGames(games, opponents, seed).map((p) => ({
      key: p.opponent.id,
      name: p.opponent.name,
      kind: "matchup",
      opponents: [p.opponent],
      games: p.games,
      seed: p.seed,
    }));
  if (!Number.isInteger(games) || games < 1 || !opponents.length)
    throw new Error("Invalid pod plan");
  return opponents
    .map((_, index) => {
      const roster = Array.from(
        { length: players - 1 },
        (_, seat) => opponents[(index + seat) % opponents.length],
      );
      return {
        key: createHash("sha256")
          .update(JSON.stringify(roster.map((d) => d.id)))
          .digest("hex")
          .slice(0, 24),
        name: `Pod ${index + 1}`,
        kind: "pod" as const,
        opponents: roster,
        games:
          Math.floor(games / opponents.length) +
          (index < games % opponents.length ? 1 : 0),
        seed: (seed + index * 100003) % 2147483647,
      };
    })
    .filter((p) => p.games > 0);
}
export const storePlans = (plans: BenchmarkPlan[]) =>
  plans.map(({ opponents, ...plan }) => ({
    ...plan,
    opponentIds: opponents.map((o) => o.id),
  }));
const planSchema = z
  .array(
    z.object({
      key: z.string().min(1).max(80),
      name: z.string(),
      kind: z.enum(["matchup", "pod"]),
      opponentIds: z.array(z.string()).min(1).max(3),
      games: z.number().int().positive(),
      seed: z.number().int().nonnegative(),
    }),
  )
  .min(1)
  .max(50);
export function executionPlans(job: {
  format: string;
  games: number;
  seed: number;
  config: Record<string, unknown>;
  snapshot: { decks: Opponent[] };
}): BenchmarkPlan[] {
  if (!job.config.executionPlan)
    return planBenchmark(job.format, job.games, job.snapshot.decks, job.seed);
  const stored = planSchema.parse(job.config.executionPlan);
  if (
    stored.reduce((n, p) => n + p.games, 0) !== job.games ||
    new Set(stored.map((p) => p.key)).size !== stored.length
  )
    throw new Error("Invalid stored execution plan");
  return stored.map((p) => {
    const opponents = p.opponentIds.map((id) => {
      const deck = job.snapshot.decks.find((d) => d.id === id);
      if (!deck)
        throw new Error("Stored pod participant is absent from snapshot");
      return deck;
    });
    if (opponents.length !== (getFormat(job.format)?.players || 2) - 1)
      throw new Error("Invalid stored pod size");
    return {
      key: p.key,
      name: p.name,
      kind: p.kind,
      opponents,
      games: p.games,
      seed: p.seed,
    };
  });
}
