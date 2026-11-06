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
export const selectionSchema = z.object({
  mode: z.enum(["equal", "meta", "custom"]).default("equal"),
  opponentIds: z.array(z.string().min(1).max(80)).min(1).max(50).optional(),
  weights: z
    .record(z.string(), z.number().finite().min(0).max(1000000))
    .optional(),
  allowRepeatedLists: z.boolean().optional(),
  pods: z
    .array(
      z.object({
        opponentIds: z.array(z.string()).length(3),
        weight: z.number().finite().positive().max(1000000),
      }),
    )
    .min(1)
    .max(50)
    .optional(),
});
export type BenchmarkSelection = z.infer<typeof selectionSchema>;
export function allocateWeighted(total: number, weights: number[]) {
  if (
    !Number.isInteger(total) ||
    total < 1 ||
    !weights.length ||
    weights.some((w) => !Number.isFinite(w) || w < 0)
  )
    throw new Error("Invalid weighted allocation");
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0)
    throw new Error("At least one selected weight must be positive");
  const exact = weights.map((w) => (total * w) / sum);
  const result = exact.map(Math.floor);
  const order = exact
    .map((value, index) => ({ index, remainder: value - result[index] }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  const remainder = total - result.reduce((a, b) => a + b, 0);
  for (let i = 0; i < remainder; i++) result[order[i].index]++;
  return result;
}
export function planBenchmark(
  format: string,
  games: number,
  opponents: Opponent[],
  seed: number,
  selection?: BenchmarkSelection,
): BenchmarkPlan[] {
  if (selection) {
    selection = selectionSchema.parse(selection);
    const ids = selection.opponentIds;
    if (
      ids &&
      (new Set(ids).size !== ids.length ||
        ids.some((id) => !opponents.some((d) => d.id === id)))
    )
      throw new Error(
        "Selected opponent IDs must be unique members of this snapshot",
      );
    opponents = opponents.filter((d) => !ids || ids.includes(d.id));
    if (
      Object.keys(selection.weights || {}).some(
        (id) => !opponents.some((d) => d.id === id),
      )
    )
      throw new Error("Weights reference an unselected opponent");
    if (
      selection.mode === "meta" &&
      opponents.some((d) => d.metaShare === null || d.metaShare === undefined)
    )
      throw new Error("Every selected deck needs a source-reported meta share");
    if (
      selection.mode === "custom" &&
      opponents.some((d) => selection!.weights?.[d.id] === undefined)
    )
      throw new Error("Provide a weight for every selected deck");
  }
  const players = getFormat(format)?.players || 2;
  if (selection && (selection.mode !== "equal" || selection.pods)) {
    const weights = opponents.map((d) =>
      selection.mode === "meta"
        ? d.metaShare!
        : selection.mode === "custom"
          ? selection.weights![d.id]
          : 1,
    );
    const make = (rosters: Opponent[][], allocation: number[]) =>
      rosters
        .map((roster, i) => ({
          key:
            players === 2
              ? roster[0].id
              : createHash("sha256")
                  .update(JSON.stringify(roster.map((d) => d.id)))
                  .digest("hex")
                  .slice(0, 24),
          name: players === 2 ? roster[0].name : `Pod ${i + 1}`,
          kind: players === 2 ? ("matchup" as const) : ("pod" as const),
          opponents: roster,
          games: allocation[i],
          seed: (seed + i * 100003) % 2147483647,
        }))
        .filter((p) => p.games > 0);
    if (players === 2) {
      if (selection.pods)
        throw new Error("Explicit pods require a four-player format");
      return make(
        opponents.map((d) => [d]),
        allocateWeighted(games, weights),
      );
    }
    const repeat = selection.allowRepeatedLists ?? opponents.length < 3;
    if (selection.pods) {
      const rosters = selection.pods.map((p) =>
        p.opponentIds.map((id) => {
          const deck = opponents.find((d) => d.id === id);
          if (!deck) throw new Error("Pod participant is not selected");
          return deck;
        }),
      );
      const keys = rosters.map((r) => JSON.stringify(r.map((d) => d.id)));
      if (new Set(keys).size !== keys.length)
        throw new Error("Duplicate ordered pods; combine their weights");
      if (!repeat && rosters.some((r) => new Set(r.map((d) => d.id)).size < 3))
        throw new Error("Repeated lists are disabled");
      return make(
        rosters,
        allocateWeighted(
          games,
          selection.pods.map((p) => p.weight),
        ),
      );
    }
    const eligible = opponents.filter((_, i) => weights[i] > 0);
    if (!eligible.length || (!repeat && eligible.length < 3))
      throw new Error(
        "Too few positive-weight opponents for the repetition setting",
      );
    // Sample at most 50 ordered rosters, then distribute requested units over those
    // draws. This deliberately approximates seat shares instead of claiming exact shares.
    let state = (seed % 2147483646) + 1;
    const random = () => {
      state = (state * 16807) % 2147483647;
      return (state - 1) / 2147483646;
    };
    const sampled: Opponent[][] = [];
    for (let i = 0; i < Math.min(50, games); i++) {
      let available = eligible.slice();
      const roster: Opponent[] = [];
      for (let seat = 0; seat < 3; seat++) {
        const sum = available.reduce(
          (n, d) => n + weights[opponents.indexOf(d)],
          0,
        );
        let target = random() * sum;
        const chosen =
          available.find(
            (d) => (target -= weights[opponents.indexOf(d)]) < 0,
          ) || available[available.length - 1];
        roster.push(chosen);
        if (!repeat) available = available.filter((d) => d.id !== chosen.id);
      }
      sampled.push(roster);
    }
    const counts = allocateWeighted(
      games,
      sampled.map(() => 1),
    );
    const combined = new Map<string, { roster: Opponent[]; games: number }>();
    sampled.forEach((roster, i) => {
      const key = JSON.stringify(roster.map((d) => d.id));
      const old = combined.get(key);
      if (old) old.games += counts[i];
      else combined.set(key, { roster, games: counts[i] });
    });
    return make(
      [...combined.values()].map((p) => p.roster),
      [...combined.values()].map((p) => p.games),
    );
  }
  if (
    players === 4 &&
    selection?.allowRepeatedLists === false &&
    opponents.length < 3
  )
    throw new Error(
      "At least three selected decks are required when repeated lists are disabled",
    );
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
