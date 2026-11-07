"use client";
import { useEffect, useId, useRef, useState } from "react";
export type HistoryRef = {
  id: string;
  count: number;
  total: number;
  complete: boolean;
};
type Action = {
  sequence: number;
  kind: string;
  text: string;
  turn: number;
  phase: string | null;
  activePlayer: number | null;
};
type Page = HistoryRef & { entries: Action[]; nextOffset: number | null };
const labels: Record<string, string> = {
  STACK_ADD: "Spell / ability",
  STACK_RESOLVE: "Resolution",
  LAND: "Land",
  COMBAT: "Combat",
  DAMAGE: "Damage",
  LIFE: "Life",
  MULLIGAN: "Opening hand",
  ZONE_CHANGE: "Zone change",
  GAME_OUTCOME: "Outcome",
  MATCH_RESULTS: "Result",
  EFFECT_REPLACED: "Replacement effect",
  INFORMATION: "Information",
  PHASE: "Phase",
  MANA: "Mana",
  DISCARD: "Discard",
};
export function GameActionHistory({
  history,
  jobId,
  player,
}: {
  history?: HistoryRef;
  jobId?: string;
  player: (seat: number) => string;
}) {
  const regionId = useId();
  const [open, setOpen] = useState(false),
    [entries, setEntries] = useState<Action[]>([]),
    [next, setNext] = useState<number | null>(0),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const [details, setDetails] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function load(offset: number) {
    if (!history || !jobId) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/v1/simulations/${jobId}/games/${history.id}/actions?offset=${offset}&limit=100`,
        { signal: controller.signal },
      );
      if (!response.ok)
        throw Error(
          response.status === 404
            ? "This game's saved action history is unavailable."
            : "The action history could not be loaded. Please try again.",
        );
      const page: Page = await response.json();
      if (controller.signal.aborted) return;
      setEntries((previous) =>
        offset === 0 ? page.entries : [...previous, ...page.entries],
      );
      setNext(page.nextOffset);
    } catch (cause) {
      if (!controller.signal.aborted) setError((cause as Error).message);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  const text = (value: string) =>
    value.replace(/Ai\(\d+\)-player-(\d+)|\bplayer-(\d+)\b/g, (_match, a, b) =>
      player(Number(a ?? b)),
    );
  const groups = new Map<
    number,
    { activePlayer: number | null; entries: Action[] }
  >();
  for (const entry of entries) {
    if (!groups.has(entry.turn))
      groups.set(entry.turn, { activePlayer: entry.activePlayer, entries: [] });
    if (
      entry.kind !== "TURN" &&
      (details || !["PHASE", "MANA"].includes(entry.kind))
    )
      groups.get(entry.turn)!.entries.push(entry);
  }
  return (
    <section className="game-action-history" aria-label="Game action history">
      <h3>Action history</h3>
      {!history || !jobId ? (
        <p>
          Action history was not saved for this game. New analyses record the
          actions reported by Forge.
        </p>
      ) : (
        <>
          <p>
            Follow the recorded plays in order, including spells, combat, damage
            and life changes. This is an action log, not a visual replay or an
            explanation of the AI’s reasoning.
          </p>
          {!history.complete && (
            <p className="history-incomplete">
              Partial history: the game stopped early or some actions or long
              descriptions could not be recorded.
            </p>
          )}
          <button
            className="secondary"
            aria-expanded={open}
            aria-controls={regionId}
            onClick={() => {
              setOpen(!open);
              if (!open && !entries.length && !loading) void load(0);
            }}
          >
            {open
              ? "Hide action history"
              : `View action history · ${history.count.toLocaleString()} entries`}
          </button>
          {open && (
            <div id={regionId}>
              <label className="history-detail-toggle">
                <input
                  type="checkbox"
                  checked={details}
                  onChange={(event) => setDetails(event.target.checked)}
                />{" "}
                Show phase and mana details
              </label>
              {!!entries.length && (
                <p className="muted">
                  {entries.length.toLocaleString()} of{" "}
                  {history.count.toLocaleString()} saved entries loaded.
                  {!details && " Phase and mana details are hidden."}
                </p>
              )}
              {!!entries.length && (
                <div
                  className="action-timeline"
                  role="region"
                  tabIndex={0}
                  aria-label="Recorded actions in chronological order"
                >
                  {[...groups].map(([turn, group]) => (
                    <section className="action-turn" key={turn}>
                      <h4>
                        {turn === 0 ? "Pregame" : `Turn ${turn}`}
                        {turn > 0 && group.activePlayer !== null
                          ? ` · ${player(group.activePlayer)}`
                          : ""}
                      </h4>
                      {group.entries.length ? (
                        <ol>
                          {group.entries.map((entry) => (
                            <li key={entry.sequence}>
                              <span className="action-kind">
                                {labels[entry.kind] ||
                                  entry.kind.toLowerCase().replaceAll("_", " ")}
                              </span>
                              <p>{text(entry.text)}</p>
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <p className="muted">
                          Only turn or phase markers are loaded for this turn.
                        </p>
                      )}
                    </section>
                  ))}
                </div>
              )}
              {loading && <p role="status">Loading recorded actions…</p>}
              {error && (
                <p role="alert">
                  {error}{" "}
                  <button
                    className="text-button"
                    onClick={() => void load(next ?? 0)}
                  >
                    Retry loading actions
                  </button>
                </p>
              )}
              {!loading && !error && entries.length === 0 && (
                <p>No action entries were recorded for this game.</p>
              )}
              {entries.length > 0 && next !== null && !error && (
                <button
                  className="secondary"
                  disabled={loading}
                  onClick={() => void load(next)}
                >
                  Load more actions
                </button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
