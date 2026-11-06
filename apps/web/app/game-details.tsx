export type ObservationReview = {
  number: number;
  total: number;
  status:
    "included" | "excluded" | "previous" | "pending" | "unfinished" | "unknown";
  matchCounted: boolean;
  matchTermination?: string | null;
};
export type RecordedGame = {
  index: number;
  unit?: "game" | "match";
  gameWins?: number[];
  games?: RecordedGame[];
  engineVersion: string;
  gameSeed?: number;
  logId?: string;
  winner: number | null;
  turns: number | null;
  startingPlayer: number | null;
  durationMs: number;
  termination: string;
  startingLife?: number[];
  players: { id: string; placement: number | null }[];
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
};
export function gameOutcome(
  game: Pick<RecordedGame, "termination" | "winner">,
) {
  if (game.termination === "normal")
    return game.winner === 0
      ? "Win"
      : game.winner === null
        ? "No winner recorded"
        : "Loss";
  return (
    (
      {
        rule_draw: "Draw",
        timeout: "Time limit reached",
        engine_error: "Engine problem",
        cancelled: "Cancelled",
        game_limit: "Game limit reached",
      } as Record<string, string>
    )[game.termination] || "Result unavailable"
  );
}
export function reviewLabel(review?: ObservationReview) {
  return review
    ? {
        included: "Counts toward results",
        excluded: "Not counted",
        previous: "Earlier attempt",
        pending: "Match in progress",
        unfinished: "Unfinished match",
        unknown: "Status unavailable",
      }[review.status]
    : "Recorded game";
}
function duration(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return "Not recorded";
  if (ms < 1000) return "Less than a second";
  const seconds = Math.round(ms / 1000);
  return seconds < 60
    ? `${seconds} seconds`
    : `${Math.floor(seconds / 60)} min ${seconds % 60} sec`;
}
export function GameDetails({
  game,
  opponentNames = [],
  review,
  recordedAt,
}: {
  game: RecordedGame;
  opponentNames?: string[];
  review?: ObservationReview;
  recordedAt?: string;
}) {
  const player = (seat: number) =>
    seat === 0 ? "Your deck" : opponentNames[seat - 1] || `Opponent ${seat}`;
  const normal = game.termination === "normal";
  const outcome = normal
    ? game.winner === 0
      ? "Your deck won this game."
      : game.winner === null
        ? "No winner was recorded."
        : `${player(game.winner)} won this game.`
    : (
        {
          rule_draw: "The game ended in a draw. Neither deck won.",
          timeout:
            "The game reached its time limit before a result could be confirmed.",
          engine_error:
            "Forge could not finish this game. This is not treated as a win or a loss.",
          cancelled: "The test was stopped before this game finished.",
        } as Record<string, string>
      )[game.termination] || "A completed game result is not available.";
  const reviewText = review
    ? {
        included: "This game is included in the game win rate.",
        excluded:
          "This game did not finish normally and is excluded from win rates.",
        previous:
          "This game belongs to an earlier attempt. The match was restarted, so this game is kept as history and does not affect win rates.",
        pending:
          "This match is still being processed. Its recorded games have not been added to the results yet.",
        unfinished:
          "This match stopped before a final result was saved. This game does not affect the current win rates and remains in the history if you resume the test.",
        unknown:
          "The game was recorded, but its contribution to the results could not be verified.",
      }[review.status]
    : null;
  const changes = game.sideboardChanges;
  const changed = changes?.some((p) => p.added.length || p.removed.length);
  const reasons: Record<string, string> = {
    LifeReachedZero: "its life reached zero",
    Milled: "it ran out of cards",
    Poisoned: "it lost to poison",
    CommanderDamage: "it took lethal commander damage",
  };
  return (
    <div className="game-details">
      <p className="game-outcome">{outcome}</p>
      {normal &&
        game.eliminations?.flatMap((group) =>
          group.players.map((seat) =>
            reasons[group.reasons[String(seat)]] ? (
              <p key={seat} className="muted">
                {player(seat)} lost because{" "}
                {reasons[group.reasons[String(seat)]]}.
              </p>
            ) : null,
          ),
        )}
      {reviewText && (
        <div className="game-counting">
          <strong>{reviewLabel(review)}</strong>
          <p>{reviewText}</p>
          {review?.status === "included" && !review.matchCounted && (
            <p>
              The match did not finish normally, so it is excluded from the
              match win rate.
            </p>
          )}
        </div>
      )}
      <dl className="game-facts">
        <div>
          <dt>First to play</dt>
          <dd>
            {game.startingPlayer == null
              ? "Not recorded"
              : player(game.startingPlayer)}
          </dd>
        </div>
        <div>
          <dt>Game length</dt>
          <dd>
            {game.turns == null ? "Not recorded" : `${game.turns} player turns`}
          </dd>
        </div>
        <div>
          <dt>Playing time</dt>
          <dd>{duration(game.durationMs)}</dd>
        </div>
        {recordedAt && (
          <div>
            <dt>Recorded</dt>
            <dd>{new Date(recordedAt).toLocaleString()}</dd>
          </div>
        )}
      </dl>
      <h3>Sideboard decisions</h3>
      {!changes?.length ? (
        <p>Sideboard changes were not recorded for this game.</p>
      ) : !changed ? (
        <p>No sideboard changes were recorded.</p>
      ) : (
        <div className="sideboard-decisions">
          {changes.map((change) => (
            <section
              key={change.player}
              aria-label={`${player(change.player)} sideboard decisions`}
            >
              <h4>{player(change.player)}</h4>
              {!change.added.length && !change.removed.length ? (
                <p>Kept the same mainboard.</p>
              ) : (
                <>
                  {!!change.added.length && (
                    <>
                      <p className="card-change-label">
                        Moved into the mainboard
                      </p>
                      <ul>
                        {change.added.map((card) => (
                          <li key={card.name}>
                            {card.quantity} × {card.name}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {!!change.removed.length && (
                    <>
                      <p className="card-change-label">
                        Moved to the sideboard
                      </p>
                      <ul>
                        {change.removed.map((card) => (
                          <li key={card.name}>
                            {card.quantity} × {card.name}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </>
              )}
              <p className="muted">
                {change.mainboardSize} cards in the mainboard ·{" "}
                {change.sideboardSize} in the sideboard
              </p>
            </section>
          ))}
        </div>
      )}
      {game.companionSelections?.some((p) => p.declared || p.selected) && (
        <>
          <h3>Companions</h3>
          <ul>
            {game.companionSelections
              .filter((p) => p.declared || p.selected)
              .map((p) => (
                <li key={p.player}>
                  {player(p.player)}:{" "}
                  {p.selected
                    ? `Selected ${p.selected}.`
                    : `Declared ${p.declared}, but no companion was selected for this game.`}
                </li>
              ))}
          </ul>
        </>
      )}
      {!!game.commanderCasts?.length && (
        <>
          <h3>Commander casts</h3>
          <ul>
            {game.commanderCasts.map((cast, i) => (
              <li key={i}>
                {player(cast.player)} cast {cast.card} on their turn{" "}
                {cast.playerTurn} (game turn {cast.turn}).
              </li>
            ))}
          </ul>
        </>
      )}
      {game.players.length > 2 && (
        <>
          <h3>Finishing positions</h3>
          <ul>
            {game.players.map((p, i) => (
              <li key={p.id}>
                {player(i)}:{" "}
                {p.placement == null
                  ? "No confirmed placement"
                  : `place ${p.placement}`}
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="muted game-summary-note">
        This summary shows recorded results and decisions, not a turn-by-turn
        replay.
      </p>
    </div>
  );
}
