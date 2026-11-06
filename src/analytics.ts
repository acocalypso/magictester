import type { GameResult } from "./engine.js";
export function wilson(wins: number, n: number): [number, number] | null {
  if (!n) return null;
  const z = 1.959963984540054;
  const p = wins / n;
  const denominator = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denominator;
  const margin =
    (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}
const mean = (a: number[]) =>
  a.length ? a.reduce((s, n) => s + n, 0) / a.length : null;
function median(a: number[]) {
  if (!a.length) return null;
  const b = [...a].sort((x, y) => x - y);
  return (b[Math.floor((b.length - 1) / 2)] + b[Math.floor(b.length / 2)]) / 2;
}
export function summarize(
  results: GameResult[],
  submittedSeat = 0,
  commander = false,
) {
  const valid = results.filter(
    (r) => r.termination === "normal" || r.termination === "rule_draw",
  );
  const wins = valid.filter((r) => r.winner === submittedSeat).length;
  const draws = valid.filter((r) => r.winner === null).length;
  const n = valid.length;
  const split = (seat: boolean) => {
    const r = valid.filter(
      (r) =>
        r.startingPlayer !== null &&
        (r.startingPlayer === submittedSeat) === seat,
    );
    const wins = r.filter((x) => x.winner === submittedSeat).length;
    return {
      games: r.length,
      wins,
      winRate: r.length ? wins / r.length : null,
    };
  };
  const turns = valid.flatMap((r) => (r.turns === null ? [] : [r.turns]));
  const placements = valid.flatMap((r) =>
    r.players?.[submittedSeat]?.placement == null
      ? []
      : [r.players[submittedSeat].placement!],
  );
  const withCasts = valid.filter((r) => Array.isArray(r.commanderCasts));
  const castLists = withCasts.map((r) =>
    r.commanderCasts!.filter((c) => c.player === submittedSeat),
  );
  const firstCasts = castLists.flatMap((c) => (c.length ? [c[0]] : []));
  return {
    averagePlacement: mean(placements),
    placementGames: placements.length,
    placementDistribution: Object.fromEntries(
      [...new Set(placements)]
        .sort((a, b) => a - b)
        .map((p) => [p, placements.filter((x) => x === p).length]),
    ),
    commanderTiming: commander
      ? {
          observedGames: withCasts.length,
          castGames: firstCasts.length,
          notCastGames: withCasts.length - firstCasts.length,
          averageFirstCastPlayerTurn: mean(firstCasts.map((c) => c.playerTurn)),
          averageFirstCastGlobalTurn: mean(firstCasts.map((c) => c.turn)),
          averageCasts: mean(castLists.map((c) => c.length)),
        }
      : null,
    games: n,
    attempted: results.length,
    wins,
    losses: n - wins - draws,
    draws,
    timeouts: results.filter((r) => r.termination === "timeout").length,
    errors: results.filter((r) => r.termination === "engine_error").length,
    cancelled: results.filter((r) => r.termination === "cancelled").length,
    winRate: n ? wins / n : null,
    confidence95: wilson(wins, n),
    averageTurns: mean(turns),
    medianTurns: median(turns),
    averageDurationMs: mean(valid.map((r) => r.durationMs)),
    onPlay: split(true),
    onDraw: split(false),
    lowSample: n < 100,
    turnDistribution: Object.fromEntries(
      [...new Set(turns)]
        .sort((a, b) => a - b)
        .map((t) => [t, turns.filter((x) => x === t).length]),
    ),
  };
}
