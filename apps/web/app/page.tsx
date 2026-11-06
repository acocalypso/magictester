"use client";
import { useCallback, useEffect, useState, useRef } from "react";

type FormatInfo = {
  id: string;
  name: string;
  enabled: boolean;
  validationSupported: boolean;
  commander: boolean;
  players: number;
};
type View = "analysis" | "queue" | "results" | "meta";
type Deck = {
  id: string;
  name: string;
  archetype: string;
  strategy: string;
  decklist: string;
  metaShare: number | null;
};
type Feed = {
  id: string;
  name: string;
  format: string;
  url: string;
  enabled: boolean;
  freshness: string;
  lastSuccessAt: string | null;
  lastError: string | null;
};
type Snapshot = {
  id: string;
  name: string;
  format: string;
  source: string;
  sourceDate: string | null;
  metadata?: { feedId?: string; sha256?: string; fetchedAt?: string };
  createdAt: string;
  decks: Deck[];
  selectionMethod: string;
};
type Job = {
  config?: {
    bridgeVersion?: string;
    players?: number;
    gameMode?: "BO1" | "BO3";
    maxMatchGames?: number;
    sideboardMode?: string;
  };
  actualGames?: number;
  observedGames?: number;
  format: string;
  id: string;
  name: string;
  state: string;
  games: number;
  completed: number;
  failed: number;
  timeouts: number;
  pending: number;
  progress: number;
  createdAt: string;
  startedAt: string | null;
  error: string | null;
  snapshot: Snapshot;
  deck: { decklist: string };
  seed: number;
};
type Summary = {
  averagePlacement: number | null;
  placementGames: number;
  placementDistribution: Record<string, number>;
  commanderTiming: {
    observedGames: number;
    castGames: number;
    notCastGames: number;
    averageFirstCastPlayerTurn: number | null;
    averageCasts: number | null;
  } | null;
  games: number;
  attempted: number;
  wins: number;
  losses: number;
  draws: number;
  timeouts: number;
  errors: number;
  winRate: number | null;
  confidence95: [number, number] | null;
  averageTurns: number | null;
  medianTurns: number | null;
  averageDurationMs: number | null;
  onPlay: { games: number; wins: number; winRate: number | null };
  onDraw: { games: number; wins: number; winRate: number | null };
  lowSample: boolean;
  turnDistribution: Record<string, number>;
};
type MatchSummary = {
  matches: number;
  attempted: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number | null;
  confidence95: [number, number] | null;
  timeouts: number;
  errors: number;
  limited: number;
  gamesPlayed: number;
  sideboardedGames: number;
};
type Results = {
  matchSummary: MatchSummary | null;
  job: Job;
  summary: Summary;
  matchups: ({
    opponent: Deck;
    planned: number;
    kind?: string;
    participants?: Deck[];
    matchSummary?: MatchSummary | null;
  } & Summary)[];
  limitations: string[];
};
type Run = {
  id: string;
  opponentId: string;
  batchIndex: number;
  seed: number;
  state: string;
  error: string | null;
  result: {
    index: number;
    unit?: "game" | "match";
    games?: {
      turns: number | null;
      winner: number | null;
      termination: string;
    }[];
    gameWins?: number[];
    engineVersion: string;
    gameSeed?: number;
    winner: number | null;
    turns: number | null;
    startingPlayer: number | null;
    durationMs: number;
    termination: string;
    players: { id: string; placement: number | null }[];
  } | null;
};
type Observation = {
  id: string;
  createdAt: string;
  data: {
    matchIndex: number;
    attemptId: string;
    opponentId: string;
    result: NonNullable<Run["result"]>;
  };
};
const displayFormat = (id: string) =>
  id === "cedh"
    ? "cEDH"
    : id === "duel"
      ? "Duel Commander"
      : id.charAt(0).toUpperCase() + id.slice(1);
const active = ["QUEUED", "PREPARING", "RUNNING", "AGGREGATING"];
const pct = (n: number | null | undefined) =>
  n == null ? "—" : (n * 100).toFixed(1) + "%";
const date = (s: string) =>
  new Date(s).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
async function api<T>(
  path: string,
  body?: unknown,
  token?: string,
  method?: "POST" | "PATCH",
): Promise<T> {
  const r = await fetch("/api/v1" + path, {
    method: method || (body ? "POST" : "GET"),
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json();
  if (!r.ok)
    throw new Error(
      data.error + (data.details ? " · " + JSON.stringify(data.details) : ""),
    );
  return data;
}
function Icon({ name }: { name: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === "analysis" ? (
        <>
          <path d="M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z" />
        </>
      ) : name === "queue" ? (
        <>
          <path d="M8 6h13M8 12h13M8 18h13" />
          <path d="M3 6h.01M3 12h.01M3 18h.01" />
        </>
      ) : name === "results" ? (
        <>
          <path d="M4 20V10M10 20V4M16 20v-8M22 20H2" />
        </>
      ) : (
        <>
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </>
      )}
    </svg>
  );
}
function Badge({ state }: { state: string }) {
  return (
    <span className={"badge " + state.toLowerCase()}>
      <i />
      {state.replaceAll("_", " ")}
    </span>
  );
}
function Progress({ job }: { job: Job }) {
  return (
    <div className="progress-block">
      <div className="progress-track">
        <span style={{ width: job.progress * 100 + "%" }} />
      </div>
      <span>
        {job.completed + job.failed} / {job.games}{" "}
        {job.config?.gameMode === "BO3" ? "matches" : "games"}
        {job.config?.gameMode === "BO3" && (
          <small> · {job.observedGames ?? 0} game observations</small>
        )}
      </span>
    </div>
  );
}
export default function Home() {
  const [format, setFormat] = useState("pauper");
  const [formats, setFormats] = useState<FormatInfo[]>([]);
  const formatRef = useRef(format);
  formatRef.current = format;
  const [view, setView] = useState<View>("analysis");
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [feedUrl, setFeedUrl] = useState("");
  const [feedPermission, setFeedPermission] = useState("");
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [selected, setSelected] = useState("");
  const [result, setResult] = useState<Results | null>(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const [observations, setObservations] = useState<Observation[] | null>(null);
  useEffect(() => setObservations(null), [selected]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [runPage, setRunPage] = useState(0);
  const [detail, setDetail] = useState<Run | null>(null);
  const [busy, setBusy] = useState(false);
  const [deckName, setDeckName] = useState("My test deck");
  const [decklist, setDecklist] = useState("");
  const [snapshotId, setSnapshotId] = useState("");
  const [games, setGames] = useState(50);
  const [seed, setSeed] = useState(12345);
  const [validation, setValidation] = useState<{
    valid: boolean;
    errors: { message: string; line?: number; card?: string }[];
    counts: {
      mainboard: number;
      sideboard: number;
      commanders: number;
      companions: number;
    };
  } | null>(null);
  const [importText, setImportText] = useState("");
  const [token, setToken] = useState("");
  const [csv, setCsv] = useState(false);
  const [importName, setImportName] = useState("");
  const [importSource, setImportSource] = useState("");
  const [sort, setSort] = useState<"name" | "rate">("name");
  const refresh = useCallback(async () => {
    try {
      const [s, j, f, feeds] = await Promise.all([
        api<Snapshot[]>(`/meta/${format}/snapshots`),
        api<Job[]>("/simulations"),
        api<FormatInfo[]>("/formats"),
        api<Feed[]>("/meta/feeds"),
      ]);
      if (formatRef.current !== format) return;
      setFormats(f);
      setFeeds(feeds);
      setSnapshots(s);
      setJobs(j);
      setConnected(true);
      setSnapshotId((old) =>
        s.some((snapshot) => snapshot.id === old) ? old : s[0]?.id || "",
      );
    } catch (e) {
      if (formatRef.current !== format) return;
      setConnected(false);
      setError((e as Error).message);
    }
  }, [format]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const initial = params.get("view");
    if (["analysis", "queue", "results", "meta"].includes(initial || ""))
      setView(initial as View);
    setSelected(params.get("job") || "");
  }, []);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view, selected]);
  const navigate = (v: View, id?: string) => {
    setView(v);
    setError("");
    if (!id && v === "results") setSelected("");
    if (id) {
      setSelected(id);
      setRunPage(0);
      setResult(null);
    }
    history.replaceState(null, "", "?view=" + v + (id ? "&job=" + id : ""));
  };
  const loadResults = useCallback(async (id: string) => {
    try {
      const data = await api<Results>("/simulations/" + id + "/results");
      if (selectedRef.current === id) setResult(data);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    if (view !== "results" || !selected) return;
    void loadResults(selected);
    const events = new EventSource(
      "/api/v1/simulations/" + selected + "/events",
    );
    events.addEventListener("progress", () => void loadResults(selected));
    return () => events.close();
  }, [view, selected, loadResults]);
  useEffect(() => {
    if (view === "results" && selected)
      api<Run[]>(
        "/simulations/" + selected + "/runs?limit=25&offset=" + runPage * 25,
      )
        .then(setRuns)
        .catch((e) => setError(e.message));
  }, [view, selected, runPage, result?.job.completed, result?.job.failed]);
  const [clockSeconds, setClockSeconds] = useState(30);
  const [gameMode, setGameMode] = useState<"BO1" | "BO3">("BO1");
  const [maxMatchGames, setMaxMatchGames] = useState(5);
  const [allocationMode, setAllocationMode] = useState<
    "equal" | "meta" | "custom"
  >("equal");
  const [excludedDecks, setExcludedDecks] = useState<string[]>([]);
  const [opponentWeights, setOpponentWeights] = useState<
    Record<string, number>
  >({});
  const [allowRepeatedLists, setAllowRepeatedLists] = useState(true);
  const [customPods, setCustomPods] = useState<
    { opponentIds: string[]; weight: number }[]
  >([]);
  useEffect(() => {
    setExcludedDecks([]);
    setOpponentWeights({});
    setCustomPods([]);
    setAllocationMode("equal");
  }, [snapshotId]);
  const [sideboardMode, setSideboardMode] = useState<"none" | "forge">("forge");
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const validated = await api<NonNullable<typeof validation>>(
        "/decks/validate",
        { decklist, format },
      );
      setValidation(validated);
      if (validated.valid) {
        const job = await api<Job>("/simulations", {
          name: deckName,
          decklist,
          format,
          snapshotId,
          games,
          selection: {
            mode: allocationMode,
            opponentIds: pool?.decks
              .filter((d) => !excludedDecks.includes(d.id))
              .map((d) => d.id),
            weights:
              allocationMode === "custom"
                ? Object.fromEntries(
                    (pool?.decks || [])
                      .filter((d) => !excludedDecks.includes(d.id))
                      .map((d) => [d.id, opponentWeights[d.id] ?? 1]),
                  )
                : undefined,
            allowRepeatedLists,
            pods: isPod && customPods.length ? customPods : undefined,
          },
          seed,
          clockSeconds,
          gameMode,
          maxMatchGames: gameMode === "BO3" ? maxMatchGames : undefined,
          sideboardMode:
            gameMode === "BO3" && !selectedFormat?.commander
              ? sideboardMode
              : "none",
        });
        await refresh();
        navigate("results", job.id);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const act = async (job: Job, action: string) => {
    setBusy(true);
    setError("");
    try {
      await api("/simulations/" + job.id + "/" + action, {});
      await refresh();
      if (selected === job.id) await loadResults(job.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const turnLabel = ["1", "2"].includes(result?.job.config?.bridgeVersion || "")
    ? "Player turns"
    : "End round";
  const resultIsMatch = result?.job.config?.gameMode === "BO3";
  const maxUnits =
    gameMode === "BO3"
      ? Math.floor(1000 / Math.max(3, maxMatchGames || 5))
      : 1000;
  const unitLabel = gameMode === "BO3" ? "matches" : "games";
  const selectedFormat = formats.find((f) => f.id === format);
  const isPod = selectedFormat?.players === 4;
  const resultIsPod = result?.job.config?.players === 4;
  const resultIsCommander = !!formats.find((f) => f.id === result?.job.format)
    ?.commander;
  const pool = snapshots.find((s) => s.id === snapshotId);
  const podPreview =
    isPod && pool
      ? pool.decks
          .map((_, i) => ({
            name: `Pod ${i + 1}`,
            opponents: Array.from(
              { length: 3 },
              (_, seat) => pool.decks[(i + seat) % pool.decks.length],
            ),
            games:
              Math.floor(games / pool.decks.length) +
              (i < games % pool.decks.length ? 1 : 0),
          }))
          .filter((p) => p.games > 0)
      : [];
  const running = jobs.filter((j) => active.includes(j.state));
  return (
    <div className="app-shell">
      <header className="masthead">
        <a className="brand" href="/" aria-label="MagicTester home">
          <svg className="brand-mark" viewBox="0 0 42 44" aria-hidden="true">
            <path
              d="M6 3h25v33H6zM11 8h25v33H11"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path
              d="M17 16v12m5-12v12m5-12v12m-13-2 18-8"
              stroke="currentColor"
              strokeWidth="1.7"
            />
          </svg>
          <span>
            MagicTester<small>MAGIC: THE GATHERING · DECK TESTING</small>
          </span>
        </a>
        <nav aria-label="Main navigation">
          {(["analysis", "queue", "results", "meta"] as View[]).map(
            (v, index) => (
              <button
                key={v}
                aria-current={view === v ? "page" : undefined}
                aria-label={
                  v === "analysis"
                    ? "New analysis"
                    : v === "meta"
                      ? "Benchmark pools"
                      : v === "queue"
                        ? "Simulation queue"
                        : "Results library"
                }
                className={view === v ? "nav-item selected" : "nav-item"}
                onClick={() => navigate(v)}
              >
                <span className="nav-index">0{index + 1}</span>
                <span>
                  {v === "analysis"
                    ? "Test a deck"
                    : v === "meta"
                      ? "Opponent pools"
                      : v === "queue"
                        ? "Queue"
                        : "Results"}
                </span>
                {v === "queue" && running.length > 0 && <b>{running.length}</b>}
              </button>
            ),
          )}
        </nav>
        <div className="engine-state">
          <span className={connected ? "status-dot" : "status-dot off"} />
          <span>
            {connected ? "Workspace connected" : "Reconnecting…"}
            <small>Forge 2.0.15</small>
          </span>
        </div>
      </header>
      <div className="main-shell">
        <div className="context-bar">
          <span>THE TESTING DESK</span>
          <span>
            Rules engine simulations <i>/</i> Private workspace
          </span>
        </div>
        <main>
          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <button onClick={() => setError("")} aria-label="Dismiss error">
                ×
              </button>
            </div>
          )}
          {view === "analysis" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">DECK TESTING</span>
                  <h1>Test a deck.</h1>
                  <p>
                    Register a list, choose your opponents, and run the matchup.
                  </p>
                </div>
              </div>
              <div className="analysis-grid">
                <section className="panel deck-panel">
                  <div className="panel-heading">
                    <div>
                      <span className="step">01</span>
                      <h2>Decklist</h2>
                    </div>
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          const sample = await api<{
                            name: string;
                            decklist: string;
                          }>(`/formats/${format}/example`);
                          setDecklist(sample.decklist);
                          setDeckName(sample.name);
                          setValidation(null);
                        } catch (e) {
                          setError((e as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Load example →
                    </button>
                  </div>
                  <div className="panel-body">
                    <label htmlFor="deck-name">Deck name</label>
                    <input
                      id="deck-name"
                      value={deckName}
                      onChange={(e) => setDeckName(e.target.value)}
                      maxLength={150}
                      placeholder="e.g. Mono-red Burn"
                    />
                    <div className="label-row">
                      <label htmlFor="decklist">Decklist</label>
                      <span>Quantity + card name</span>
                    </div>
                    <div className="deck-editor">
                      <div className="editor-toolbar">
                        <span className="tiny-dot" />
                        <span>
                          {selectedFormat?.commander
                            ? "LIBRARY / COMMANDER / COMPANION"
                            : "MAINBOARD / SIDEBOARD"}
                        </span>
                        <span className="editor-count">
                          {decklist ? decklist.split("\n").length : 0} lines
                        </span>
                      </div>
                      <textarea
                        id="decklist"
                        spellCheck={false}
                        value={decklist}
                        onChange={(e) => {
                          setDecklist(e.target.value);
                          setValidation(null);
                        }}
                        placeholder={
                          "Paste your decklist here…\n\n4 Lightning Bolt\n4 Chain Lightning\n20 Mountain\n\nSideboard\n4 Red Elemental Blast"
                        }
                        maxLength={32768}
                      />
                    </div>
                    <div className="editor-note">
                      {selectedFormat?.commander
                        ? "Exactly 100 cards including commanders. Declare Commander and optional Companion sections."
                        : "Mainboard and sideboard supported. Your exact list is saved with each analysis."}
                    </div>
                    {validation && (
                      <div
                        className={
                          validation.valid
                            ? "validation success"
                            : "validation invalid"
                        }
                        role="status"
                      >
                        {validation.valid ? (
                          <>
                            <strong>✓ Deck validated</strong>
                            <span>
                              {validation.counts.mainboard} mainboard ·{" "}
                              {selectedFormat?.commander
                                ? `${validation.counts.commanders} commander(s) · ${validation.counts.companions} companion(s)`
                                : `${validation.counts.sideboard} sideboard`}
                            </span>
                          </>
                        ) : (
                          <>
                            <strong>Check your decklist</strong>
                            {validation.errors.map((e, i) => (
                              <p key={i}>
                                {e.line ? "Line " + e.line + ": " : ""}
                                {e.message}
                              </p>
                            ))}
                          </>
                        )}
                      </div>
                    )}
                    <button
                      className="secondary validate-button"
                      disabled={!decklist || busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          setValidation(
                            await api("/decks/validate", {
                              decklist,
                              format,
                            }),
                          );
                        } catch (e) {
                          setError((e as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      ✓ Validate deck
                    </button>
                  </div>
                </section>
                <div className="config-column">
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <span className="step">02</span>
                        <h2>Test settings</h2>
                      </div>
                    </div>
                    <div className="panel-body">
                      <label htmlFor="format">
                        Format <span className="muted">/ {gameMode}</span>
                      </label>
                      <select
                        id="format"
                        value={format}
                        onChange={(event) => {
                          setFormat(event.target.value);
                          if (
                            formats.find((f) => f.id === event.target.value)
                              ?.players !== 2
                          )
                            setGameMode("BO1");
                          setClockSeconds(
                            formats.find((f) => f.id === event.target.value)
                              ?.commander
                              ? 120
                              : 30,
                          );
                          setSnapshots([]);
                          setSnapshotId("");
                          setValidation(null);
                        }}
                      >
                        {formats.map((f) => (
                          <option key={f.id} value={f.id} disabled={!f.enabled}>
                            {f.name}
                            {!f.enabled ? " · not enabled yet" : ""}
                          </option>
                        ))}
                      </select>
                      <label htmlFor="game-mode">Match format</label>
                      <select
                        id="game-mode"
                        value={gameMode}
                        onChange={(e) => {
                          const mode = e.target.value as "BO1" | "BO3";
                          setGameMode(mode);
                          if (mode === "BO3")
                            setGames((n) =>
                              Math.min(
                                n,
                                Math.floor(
                                  1000 / Math.max(3, maxMatchGames || 5),
                                ),
                              ),
                            );
                        }}
                      >
                        <option value="BO1">BO1 · independent games</option>
                        <option
                          value="BO3"
                          disabled={selectedFormat?.players !== 2}
                        >
                          BO3 · first to two wins
                        </option>
                      </select>
                      {gameMode === "BO3" && (
                        <>
                          <label htmlFor="match-game-limit">
                            Game limit per match
                          </label>
                          <input
                            id="match-game-limit"
                            type="number"
                            min={3}
                            max={9}
                            value={maxMatchGames}
                            onChange={(e) => {
                              const n = Number(e.target.value);
                              setMaxMatchGames(n);
                              if (n >= 3 && n <= 9)
                                setGames((g) =>
                                  Math.min(g, Math.floor(1000 / n)),
                                );
                            }}
                          />
                          <p className="muted">
                            Rule draws can extend a match. Reaching this limit
                            leaves the match incomplete.
                          </p>
                          <label htmlFor="sideboarding">
                            Between-game sideboarding
                          </label>
                          <select
                            id="sideboarding"
                            value={
                              selectedFormat?.commander ? "none" : sideboardMode
                            }
                            disabled={selectedFormat?.commander}
                            onChange={(e) =>
                              setSideboardMode(
                                e.target.value as "none" | "forge",
                              )
                            }
                          >
                            <option value="forge">
                              Forge heuristics · record actual swaps
                            </option>
                            <option value="none">
                              Keep the submitted lists
                            </option>
                          </select>
                        </>
                      )}
                      <label htmlFor="snapshot">Benchmark pool</label>
                      <select
                        id="snapshot"
                        value={snapshotId}
                        onChange={(e) => setSnapshotId(e.target.value)}
                      >
                        {snapshots.length === 0 && (
                          <option value="">Waiting for benchmark pools…</option>
                        )}
                        {snapshots.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                      {pool && (
                        <div className="pool-note">
                          <span>◈</span>
                          <div>
                            <strong>
                              {pool.decks.length} opponent decks ·{" "}
                              {isPod
                                ? "4-player pods"
                                : `${allocationMode} allocation`}
                            </strong>
                            <p>{pool.source}</p>
                            <small>Snapshot {date(pool.createdAt)}</small>
                          </div>
                        </div>
                      )}
                      {pool && (
                        <details className="opponent-controls">
                          <summary>Choose opponents & allocation</summary>
                          <label htmlFor="allocation-mode">Allocation</label>
                          <select
                            id="allocation-mode"
                            value={allocationMode}
                            onChange={(e) =>
                              setAllocationMode(
                                e.target.value as typeof allocationMode,
                              )
                            }
                          >
                            <option value="equal">Equal allocation</option>
                            <option value="meta">
                              Source-reported meta shares
                            </option>
                            <option value="custom">Custom weights</option>
                          </select>
                          {pool.decks.map((d) => (
                            <div className="opponent-choice" key={d.id}>
                              <label>
                                <input
                                  type="checkbox"
                                  checked={!excludedDecks.includes(d.id)}
                                  onChange={(e) =>
                                    setExcludedDecks((old) =>
                                      e.target.checked
                                        ? old.filter((id) => id !== d.id)
                                        : [...old, d.id],
                                    )
                                  }
                                />
                                {d.name}
                              </label>
                              {allocationMode === "custom" && (
                                <input
                                  aria-label={`Weight for ${d.name}`}
                                  type="number"
                                  min="0"
                                  max="1000000"
                                  step="0.1"
                                  value={opponentWeights[d.id] ?? 1}
                                  onChange={(e) =>
                                    setOpponentWeights((old) => ({
                                      ...old,
                                      [d.id]: Number(e.target.value),
                                    }))
                                  }
                                />
                              )}
                              {allocationMode === "meta" && (
                                <small>
                                  {d.metaShare === null
                                    ? "Share unavailable"
                                    : pct(d.metaShare)}
                                </small>
                              )}
                            </div>
                          ))}
                          <p className="muted">
                            Zero weights exclude a list. Two-player allocation
                            uses largest remainders, with ties in snapshot
                            order. Missing source shares cannot be estimated.
                          </p>
                          {isPod && (
                            <>
                              <label className="checkbox-label">
                                <input
                                  type="checkbox"
                                  checked={allowRepeatedLists}
                                  onChange={(e) =>
                                    setAllowRepeatedLists(e.target.checked)
                                  }
                                />
                                Allow repeated lists within a pod
                              </label>
                              <p className="muted">
                                Equal mode rotates selected lists. Weighted mode
                                samples up to 50 seeded ordered rosters, then
                                divides games across those draws; seat shares
                                are approximate.
                              </p>
                              {customPods.map((pod, i) => (
                                <div className="custom-pod" key={i}>
                                  <strong>Pod {i + 1}</strong>
                                  {pod.opponentIds.map((id, seat) => (
                                    <select
                                      key={seat}
                                      aria-label={`Pod ${i + 1} seat ${seat + 2}`}
                                      value={id}
                                      onChange={(e) =>
                                        setCustomPods((old) =>
                                          old.map((p, n) =>
                                            n === i
                                              ? {
                                                  ...p,
                                                  opponentIds:
                                                    p.opponentIds.map((v, s) =>
                                                      s === seat
                                                        ? e.target.value
                                                        : v,
                                                    ),
                                                }
                                              : p,
                                          ),
                                        )
                                      }
                                    >
                                      {pool.decks
                                        .filter(
                                          (d) => !excludedDecks.includes(d.id),
                                        )
                                        .map((d) => (
                                          <option key={d.id} value={d.id}>
                                            {d.name}
                                          </option>
                                        ))}
                                    </select>
                                  ))}
                                  <label>
                                    Pod weight
                                    <input
                                      aria-label={`Pod ${i + 1} weight`}
                                      type="number"
                                      min="0.1"
                                      max="1000000"
                                      step="0.1"
                                      value={pod.weight}
                                      onChange={(e) =>
                                        setCustomPods((old) =>
                                          old.map((p, n) =>
                                            n === i
                                              ? {
                                                  ...p,
                                                  weight: Number(
                                                    e.target.value,
                                                  ),
                                                }
                                              : p,
                                          ),
                                        )
                                      }
                                    />
                                  </label>
                                  <button
                                    className="text-button"
                                    onClick={() =>
                                      setCustomPods((old) =>
                                        old.filter((_, n) => n !== i),
                                      )
                                    }
                                  >
                                    Remove pod {i + 1}
                                  </button>
                                </div>
                              ))}
                              <button
                                className="secondary"
                                disabled={
                                  customPods.length >= 50 ||
                                  pool.decks.every((d) =>
                                    excludedDecks.includes(d.id),
                                  )
                                }
                                onClick={() => {
                                  const selected = pool.decks.filter(
                                    (d) => !excludedDecks.includes(d.id),
                                  );
                                  setCustomPods((old) => [
                                    ...old,
                                    {
                                      opponentIds: Array.from(
                                        { length: 3 },
                                        (_, i) =>
                                          selected[i % selected.length].id,
                                      ),
                                      weight: 1,
                                    },
                                  ]);
                                }}
                              >
                                Add an ordered pod
                              </button>
                              {customPods.length > 0 && (
                                <p className="muted">
                                  Explicit pods override sampled rosters. Pod
                                  weights determine game counts; opponent seats
                                  stay in the order shown.
                                </p>
                              )}
                            </>
                          )}
                        </details>
                      )}
                      <label>How many {unitLabel}?</label>
                      <div className="presets">
                        {(gameMode === "BO3"
                          ? [
                              [10, "Quick"],
                              [50, "Standard"],
                              [Math.min(200, maxUnits), "Deep"],
                            ]
                          : [
                              [50, "Quick"],
                              [250, "Standard"],
                              [1000, "Deep"],
                            ]
                        ).map(([n, label]) => (
                          <button
                            key={n}
                            className={games === n ? "preset chosen" : "preset"}
                            onClick={() => setGames(Number(n))}
                          >
                            <strong>{label}</strong>
                            <span>
                              {n} {unitLabel}
                            </span>
                          </button>
                        ))}
                      </div>
                      <div className="two-fields">
                        <div>
                          <label htmlFor="games">Total {unitLabel}</label>
                          <input
                            id="games"
                            type="number"
                            min={1}
                            max={maxUnits}
                            value={games}
                            onChange={(e) => setGames(Number(e.target.value))}
                          />
                        </div>
                        <div>
                          <label htmlFor="seed">Random seed</label>
                          <input
                            id="seed"
                            type="number"
                            min={0}
                            max={2147483646}
                            value={seed}
                            onChange={(e) => setSeed(Number(e.target.value))}
                          />
                        </div>
                      </div>
                      <label htmlFor="clock">Game clock (seconds)</label>
                      <input
                        id="clock"
                        type="number"
                        min={5}
                        max={120}
                        value={clockSeconds}
                        onChange={(e) =>
                          setClockSeconds(Number(e.target.value))
                        }
                      />
                      <p className="distribution">
                        {pool
                          ? isPod
                            ? `${games} games across ${podPreview.length} rotating pods. Your deck occupies seat 1. ${pool.decks.length < 3 ? "Lists repeat to fill the three opponent seats." : "Opponent lists rotate through the other seats."}`
                            : `${games} ${unitLabel} across ${Math.min(pool.decks.length, games)} opponents. ${Math.floor(games / pool.decks.length)}–${Math.ceil(games / pool.decks.length)} ${unitLabel} per deck.`
                          : "Import a benchmark pool to begin."}
                      </p>
                      {isPod && (
                        <ol className="pod-preview" aria-label="Planned pods">
                          {podPreview.map((p) => (
                            <li key={p.name}>
                              <strong>
                                {p.name} · {p.games} games
                              </strong>
                              <span>
                                {p.opponents.map((o) => o.name).join(" / ")}
                              </span>
                            </li>
                          ))}
                        </ol>
                      )}
                      <button
                        className="primary analyze-button"
                        disabled={
                          busy ||
                          !decklist.trim() ||
                          !snapshotId ||
                          games < 1 ||
                          games > maxUnits ||
                          (gameMode === "BO3" &&
                            (maxMatchGames < 3 || maxMatchGames > 9)) ||
                          clockSeconds < 5 ||
                          clockSeconds > 120
                        }
                        onClick={() => void submit()}
                      >
                        {busy ? "Preparing analysis…" : "Analyze deck"}
                        <span aria-hidden="true">→</span>
                      </button>
                      <p className="below-button">
                        AI vs AI · Every result saved · Cancel anytime
                      </p>
                    </div>
                  </section>
                  <div className="model-note">
                    <span className="note-icon">*</span>
                    <div>
                      <strong>Simulation limits</strong>
                      <p>
                        Forge AI is strongest with aggro and midrange. Control
                        and combo results need extra care. Simulated performance
                        differs from human tournament performance.
                      </p>
                      <button
                        className="text-button"
                        onClick={() => navigate("meta")}
                      >
                        Review the benchmark pools →
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              <div className="desk-note">
                <span>WHAT GETS RECORDED</span>
                <p>
                  Wins, losses, draws, game length, and the exact opponents you
                  played. Failed games stay separate.
                </p>
              </div>
            </>
          )}
          {view === "queue" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">WORK IN PROGRESS</span>
                  <h1>Simulation queue.</h1>
                  <p>
                    Running and finished benchmarks, in the order they were
                    submitted.
                  </p>
                </div>
                <button
                  className="primary"
                  onClick={() => navigate("analysis")}
                >
                  + New analysis
                </button>
              </div>
              <div className="stat-grid">
                <Stat
                  title="Active benchmarks"
                  value={String(running.length)}
                />
                <Stat
                  title="Completed"
                  value={String(
                    jobs.filter((j) => j.state === "COMPLETED").length,
                  )}
                />
                <Stat
                  title="Games recorded"
                  value={String(
                    jobs.reduce(
                      (s, j) => s + (j.actualGames ?? j.completed),
                      0,
                    ),
                  )}
                />
                <Stat
                  title="Need attention"
                  value={String(
                    jobs.filter((j) => j.state === "FAILED").length,
                  )}
                />
              </div>
              <JobTable
                jobs={jobs}
                busy={busy}
                open={(id) => navigate("results", id)}
                action={act}
              />
            </>
          )}
          {view === "results" && !selected && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">TEST RECORDS</span>
                  <h1>Test records.</h1>
                  <p>
                    Every list. Every opponent. A reproducible record of your
                    testing.
                  </p>
                </div>
              </div>
              <JobTable
                jobs={jobs}
                busy={busy}
                open={(id) => navigate("results", id)}
                action={act}
              />
            </>
          )}
          {view === "results" &&
            selected &&
            (!result ? (
              <div className="empty panel">Loading benchmark…</div>
            ) : (
              <>
                <div className="page-heading">
                  <div>
                    <button
                      className="text-button breadcrumb"
                      onClick={() => {
                        setSelected("");
                        navigate("results");
                      }}
                    >
                      ← Results library
                    </button>
                    <h1>
                      {result.job.name}
                      <span>.</span>
                    </h1>
                    <p>
                      {displayFormat(result.job.format)}{" "}
                      {result.job.config?.gameMode || "BO1"}{" "}
                      <span className="slash">/</span>{" "}
                      {result.job.snapshot.name}{" "}
                      <span className="slash">/</span>{" "}
                      {date(result.job.createdAt)}
                    </p>
                  </div>
                  <div className="heading-actions">
                    <Badge state={result.job.state} />
                    {active.includes(result.job.state) && (
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => void act(result.job, "cancel")}
                      >
                        Cancel run
                      </button>
                    )}
                    {["FAILED", "CANCELLED"].includes(result.job.state) && (
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => void act(result.job, "retry")}
                      >
                        Resume unfinished games
                      </button>
                    )}
                  </div>
                </div>
                {active.includes(result.job.state) && (
                  <div className="panel live-progress">
                    <span className="status-dot" />
                    <strong>Simulation in progress</strong>
                    <Progress job={result.job} />
                  </div>
                )}
                {result.job.error && (
                  <div className="error-banner">{result.job.error}</div>
                )}
                <div className="stat-grid">
                  <Stat
                    title={resultIsMatch ? "Game win rate" : "Overall win rate"}
                    value={pct(result.summary.winRate)}
                    note={`${result.summary.games} valid games · ${result.summary.wins}W / ${result.summary.losses}L / ${result.summary.draws}D`}
                    accent
                  />
                  <Stat
                    title="95% confidence interval"
                    value={
                      result.summary.confidence95
                        ? result.summary.confidence95.map(pct).join(" – ")
                        : "—"
                    }
                    note={
                      result.summary.lowSample
                        ? "Small sample · interpret with care"
                        : "Wilson score interval"
                    }
                  />
                  <Stat
                    title={"Average " + turnLabel.toLowerCase()}
                    value={result.summary.averageTurns?.toFixed(1) || "—"}
                    note={
                      "Median " +
                      (result.summary.medianTurns ?? "—") +
                      " · " +
                      turnLabel.toLowerCase()
                    }
                  />
                  <Stat
                    title="Timeouts / errors"
                    value={`${result.summary.timeouts} / ${result.job.failed}`}
                    note="Excluded from the win-rate denominator"
                  />
                </div>
                {resultIsMatch && (
                  <section
                    className="panel pod-statistics match-results"
                    aria-label="Match results"
                  >
                    <div className="panel-heading">
                      <h2>BO3 match record</h2>
                      <span className="muted">First to two wins</span>
                    </div>
                    <div className="panel-body">
                      <dl>
                        <div>
                          <dt>Match win rate</dt>
                          <dd>
                            {pct(result.matchSummary?.winRate)}
                            <small>
                              {result.matchSummary?.wins ?? 0}W /{" "}
                              {result.matchSummary?.losses ?? 0}L /{" "}
                              {result.matchSummary?.draws ?? 0}D ·{" "}
                              {result.matchSummary?.matches ?? 0} valid matches
                            </small>
                            <small>
                              95% interval{" "}
                              {result.matchSummary?.confidence95
                                ?.map(pct)
                                .join(" – ") || "—"}
                            </small>
                          </dd>
                        </div>
                        <div>
                          <dt>Actual games</dt>
                          <dd>
                            {result.matchSummary?.gamesPlayed ?? 0}
                            <small>
                              {result.job.completed} match attempts processed
                            </small>
                          </dd>
                        </div>
                        <div>
                          <dt>Games with recorded swaps</dt>
                          <dd>
                            {result.matchSummary?.sideboardedGames ?? 0}
                            <small>
                              {result.job.config?.sideboardMode === "forge"
                                ? "Native Forge heuristics"
                                : "Sideboarding disabled"}
                            </small>
                          </dd>
                        </div>
                      </dl>
                      <p className="muted">
                        {result.matchSummary?.limited ?? 0} game-limit matches ·{" "}
                        {result.matchSummary?.timeouts ?? 0} timed out.
                        Incomplete matches are excluded from match win rates.
                        Limit: {result.job.config?.maxMatchGames} games per
                        match.
                      </p>
                      <button
                        className="text-button"
                        onClick={async () => {
                          try {
                            setObservations(
                              await api<Observation[]>(
                                `/simulations/${result.job.id}/observations?limit=50`,
                              ),
                            );
                          } catch (e) {
                            setError((e as Error).message);
                          }
                        }}
                      >
                        View observed games ({result.job.observedGames ?? 0}) →
                      </button>
                      <p className="muted">
                        Observations include restarted match attempts.
                        Unfinished attempts remain audit evidence and do not
                        enter benchmark summaries.
                      </p>
                    </div>
                  </section>
                )}
                <div className="results-grid">
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <h2>
                          {resultIsPod
                            ? "Pod performance"
                            : "Matchup performance"}
                        </h2>
                        <span className="muted">
                          {result.matchups.length}{" "}
                          {resultIsPod ? "pods" : "opponents"}
                        </span>
                      </div>
                      <select
                        aria-label="Sort matchups"
                        value={sort}
                        onChange={(e) =>
                          setSort(e.target.value as "rate" | "name")
                        }
                      >
                        <option value="name">By opponent</option>
                        <option value="rate">By win rate</option>
                      </select>
                    </div>
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>
                              {resultIsPod
                                ? "Pod / opponent seats"
                                : "Opponent / archetype"}
                            </th>
                            <th>Games</th>
                            <th>Record</th>
                            <th>Win rate</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...result.matchups]
                            .sort((a, b) =>
                              sort === "rate"
                                ? (b.winRate ?? -1) - (a.winRate ?? -1)
                                : a.opponent.name.localeCompare(
                                    b.opponent.name,
                                  ),
                            )
                            .map((m) => (
                              <tr key={m.opponent.id}>
                                <td>
                                  <strong>{m.opponent.name}</strong>
                                  <small>
                                    {m.kind === "pod"
                                      ? m.participants
                                          ?.map((o) => o.name)
                                          .join(" / ")
                                      : m.opponent.archetype +
                                        " · " +
                                        m.opponent.strategy}
                                  </small>
                                </td>
                                <td>
                                  {m.games}
                                  <small>
                                    {m.planned}{" "}
                                    {resultIsMatch ? "matches" : "games"}{" "}
                                    planned
                                  </small>
                                </td>
                                <td>
                                  {m.wins}–{m.losses}–{m.draws}
                                </td>
                                <td className="rate-cell">
                                  <strong>
                                    {pct(m.winRate)}{" "}
                                    {resultIsMatch ? "game" : ""}
                                  </strong>
                                  {resultIsMatch && (
                                    <small>
                                      {pct(m.matchSummary?.winRate)} match
                                    </small>
                                  )}
                                  <div className="mini-bar">
                                    <span
                                      style={{
                                        width: (m.winRate || 0) * 100 + "%",
                                      }}
                                    />
                                  </div>
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                  <section className="panel">
                    <div className="panel-heading">
                      <h2>
                        {resultIsPod ? "Starting position" : "Play / draw"}
                      </h2>
                      <span className="muted">Observed</span>
                    </div>
                    <div className="panel-body">
                      {[
                        [
                          resultIsPod ? "Started first" : "On the play",
                          result.summary.onPlay,
                        ],
                        [
                          resultIsPod ? "Started later" : "On the draw",
                          result.summary.onDraw,
                        ],
                      ].map(([label, s]) => {
                        const item = s as Summary["onPlay"];
                        return (
                          <div className="split-stat" key={label as string}>
                            <div>
                              <strong>{label as string}</strong>
                              <small>
                                {item.games} games · {item.wins} wins
                              </small>
                            </div>
                            <b>{pct(item.winRate)}</b>
                          </div>
                        );
                      })}
                      <p className="muted small">
                        Forge chooses the starting player. Seat order is fixed;
                        an equal play/draw split is not guaranteed.
                      </p>
                    </div>
                  </section>
                </div>
                {resultIsCommander && (
                  <section
                    className="panel pod-statistics"
                    aria-label="Commander results"
                  >
                    <div className="panel-heading">
                      <h2>Commander results</h2>
                      <span className="muted">Observed engine events</span>
                    </div>
                    <div className="panel-body">
                      <dl>
                        <div>
                          <dt>Average placement</dt>
                          <dd>
                            {result.summary.averagePlacement?.toFixed(2) ?? "—"}{" "}
                            / {result.job.config?.players || 2}{" "}
                            <small>
                              from {result.summary.placementGames} completed
                              placements
                            </small>
                          </dd>
                        </div>
                        <div>
                          <dt>Placement distribution</dt>
                          <dd>
                            {Object.entries(
                              result.summary.placementDistribution,
                            )
                              .map(([place, n]) => `${place}: ${n}`)
                              .join(" · ") || "—"}
                          </dd>
                        </div>
                        <div>
                          <dt>First commander cast</dt>
                          <dd>
                            {result.summary.commanderTiming?.averageFirstCastPlayerTurn?.toFixed(
                              1,
                            ) ?? "—"}{" "}
                            <small>
                              caster’s own turn ·{" "}
                              {result.summary.commanderTiming?.castGames ?? 0}{" "}
                              games with a cast;{" "}
                              {result.summary.commanderTiming?.notCastGames ??
                                0}{" "}
                              without one
                            </small>
                          </dd>
                        </div>
                      </dl>
                      <p className="muted">
                        The submitted deck stays in seat 1. Tied eliminations
                        share a placement. Commander timing measures actual
                        commander spells cast by the submitted player; games
                        without a cast have no first-cast turn.
                      </p>
                    </div>
                  </section>
                )}
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Game length distribution</h2>
                    <span className="muted">
                      {result.summary.games} valid games · {turnLabel}
                    </span>
                  </div>
                  <div
                    className="histogram"
                    role="img"
                    aria-label={
                      turnLabel +
                      " distribution: " +
                      JSON.stringify(result.summary.turnDistribution)
                    }
                  >
                    {Object.entries(result.summary.turnDistribution).length ? (
                      Object.entries(result.summary.turnDistribution).map(
                        ([turn, n]) => (
                          <div key={turn}>
                            <span>{n}</span>
                            <i
                              style={{
                                height:
                                  Math.max(
                                    5,
                                    (n /
                                      Math.max(
                                        ...Object.values(
                                          result.summary.turnDistribution,
                                        ),
                                      )) *
                                      100,
                                  ) + "px",
                              }}
                            />
                            <b>{turn}</b>
                          </div>
                        ),
                      )
                    ) : (
                      <p className="muted">
                        Turn data will appear as games complete.
                      </p>
                    )}
                  </div>
                </section>
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Run evidence</h2>
                    <button
                      className="text-button"
                      onClick={() => {
                        const blob = new Blob(
                          [JSON.stringify({ results: result, runs }, null, 2)],
                          { type: "application/json" },
                        );
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download =
                          "magictester-" +
                          selected +
                          "-page-" +
                          (runPage + 1) +
                          ".json";
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                    >
                      Export this page ↓
                    </button>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Opponent</th>
                          <th>{resultIsMatch ? "Match" : "Game"}</th>
                          <th>Outcome</th>
                          <th>{resultIsMatch ? "Turns by game" : turnLabel}</th>
                          <th>Duration</th>
                          <th>Seed</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {runs.map((r) => (
                          <tr key={r.id}>
                            <td>
                              {
                                result.matchups.find(
                                  (m) => m.opponent.id === r.opponentId,
                                )?.opponent.name
                              }
                            </td>
                            <td>{r.batchIndex + 1}</td>
                            <td>
                              {r.result
                                ? r.result.termination === "normal"
                                  ? r.result.winner === 0
                                    ? "Win"
                                    : "Loss"
                                  : r.result.termination
                                : r.state.toLowerCase()}
                              {r.result?.unit === "match" && (
                                <small>{r.result.gameWins?.join("–")}</small>
                              )}
                            </td>
                            <td>
                              {r.result?.unit === "match"
                                ? r.result.games
                                    ?.map((g) => g.turns ?? "—")
                                    .join(" / ")
                                : (r.result?.turns ?? "—")}
                            </td>
                            <td>
                              {r.result
                                ? (r.result.durationMs / 1000).toFixed(1) + "s"
                                : "—"}
                            </td>
                            <td>
                              <code>{r.result?.gameSeed ?? r.seed}</code>
                            </td>
                            <td>
                              <button
                                className="text-button"
                                onClick={() => setDetail(r)}
                              >
                                Details →
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="pagination">
                    <span>
                      {resultIsMatch ? "Matches" : "Games"} {runPage * 25 + 1}–
                      {Math.min((runPage + 1) * 25, result.job.games)} of{" "}
                      {result.job.games}
                    </span>
                    <button
                      className="secondary"
                      disabled={!runPage}
                      onClick={() => setRunPage((p) => p - 1)}
                    >
                      Previous
                    </button>
                    <button
                      className="secondary"
                      disabled={(runPage + 1) * 25 >= result.job.games}
                      onClick={() => setRunPage((p) => p + 1)}
                    >
                      Next
                    </button>
                  </div>
                </section>
                {observations && (
                  <section className="panel">
                    <div className="panel-heading">
                      <h2>Observed match games</h2>
                      <span className="muted">
                        Includes interrupted/restarted attempts
                      </span>
                    </div>
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Opponent</th>
                            <th>Match</th>
                            <th>Game</th>
                            <th>Outcome</th>
                            <th>Attempt / evidence</th>
                          </tr>
                        </thead>
                        <tbody>
                          {observations.map((o) => (
                            <tr key={o.id}>
                              <td>
                                {result.matchups.find(
                                  (m) => m.opponent.id === o.data.opponentId,
                                )?.opponent.name || "—"}
                              </td>
                              <td>{o.data.matchIndex + 1}</td>
                              <td>
                                {(o.data.result as unknown as { index: number })
                                  .index + 1}
                              </td>
                              <td>
                                {o.data.result.termination === "normal"
                                  ? o.data.result.winner === 0
                                    ? "Win"
                                    : "Loss"
                                  : o.data.result.termination}
                              </td>
                              <td>
                                <details>
                                  <summary>
                                    {o.data.attemptId.slice(-22)}
                                  </summary>
                                  <pre className="observation-json">
                                    {JSON.stringify(o, null, 2)}
                                  </pre>
                                </details>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {observations.length < (result.job.observedGames || 0) && (
                      <button
                        className="text-button"
                        onClick={async () => {
                          try {
                            const more = await api<Observation[]>(
                              `/simulations/${result.job.id}/observations?limit=50&offset=${observations.length}`,
                            );
                            setObservations([...observations, ...more]);
                          } catch (e) {
                            setError((e as Error).message);
                          }
                        }}
                      >
                        Load more observations →
                      </button>
                    )}
                  </section>
                )}
                <details className="panel methodology" open>
                  <summary>Understand this benchmark</summary>
                  <ul>
                    {result.limitations.map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                  </ul>
                  <p>Pool source: {result.job.snapshot.source}</p>
                  <p>
                    Seed: {result.job.seed} · Snapshot:{" "}
                    <code>{result.job.snapshot.id}</code>
                  </p>
                </details>
              </>
            ))}
          {view === "meta" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">THE FIELD</span>
                  <h1>Opponent pools.</h1>
                  <p>
                    Immutable snapshots keep your testing grounded in a specific
                    set of decks.
                  </p>
                </div>
              </div>
              <div className="pool-format-filter">
                <label htmlFor="pool-format-filter">Format</label>
                <select
                  id="pool-format-filter"
                  value={format}
                  onChange={(event) => {
                    setFormat(event.target.value);
                    setSnapshots([]);
                    setSnapshotId("");
                    setValidation(null);
                  }}
                >
                  {formats
                    .filter((f) => f.enabled)
                    .map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                </select>
              </div>
              <div className="info-banner">
                The bundled pool contains project-authored reference lists.
                Import sourced tournament decks to benchmark a current metagame.
                No tournament statistics are invented.
              </div>
              <div className="pool-grid">
                {snapshots.map((s) => (
                  <section className="panel pool-card" key={s.id}>
                    <div className="pool-card-top">
                      <span className="format-tag">
                        {displayFormat(s.format).toUpperCase()}
                      </span>
                      <span className="muted">{s.decks.length} decks</span>
                    </div>
                    <h2>{s.name}</h2>
                    <p>{s.source}</p>
                    <div className="pool-date">
                      Imported {date(s.createdAt)} · Source date{" "}
                      {s.sourceDate || "unavailable"} ·{" "}
                      {s.selectionMethod.replaceAll("_", " ")}
                    </div>
                    <div className="pool-decks">
                      {s.decks.map((d) => (
                        <details key={d.id}>
                          <summary>
                            {d.name}
                            <span>{d.strategy}</span>
                          </summary>
                          <p className="muted">
                            {d.archetype} · Meta share{" "}
                            {d.metaShare === null
                              ? "unavailable"
                              : pct(d.metaShare)}
                          </p>
                          <pre>{d.decklist}</pre>
                        </details>
                      ))}
                    </div>
                    <button
                      className="secondary"
                      onClick={() => {
                        setSnapshotId(s.id);
                        navigate("analysis");
                      }}
                    >
                      Use this pool →
                    </button>
                  </section>
                ))}
              </div>
              <section className="panel import-panel">
                <div className="panel-heading">
                  <h2>Scheduled feeds</h2>
                  <span className="muted">Admin access</span>
                </div>
                <p>
                  Poll JSON snapshots from a source you own or have permission
                  to use. Changed content creates a new immutable pool. Feeds
                  run hourly or less often.
                </p>
                {feeds
                  .filter((f) => f.format === format)
                  .map((f) => (
                    <div className="info-banner" key={f.id}>
                      <strong>{f.name}</strong> ·{" "}
                      {f.enabled ? f.freshness : "paused"} · Last success{" "}
                      {f.lastSuccessAt ? date(f.lastSuccessAt) : "never"}
                      {f.lastError && <p role="status">{f.lastError}</p>}
                      <button
                        className="secondary"
                        onClick={async () => {
                          try {
                            await api(`/meta/feeds/${f.id}/sync`, {}, token);
                            await refresh();
                          } catch (e) {
                            setError((e as Error).message);
                          }
                        }}
                      >
                        Refresh now
                      </button>{" "}
                      <button
                        className="secondary"
                        onClick={async () => {
                          try {
                            await api(
                              `/meta/feeds/${f.id}`,
                              { enabled: !f.enabled },
                              token,
                              "PATCH",
                            );
                            await refresh();
                          } catch (e) {
                            setError((e as Error).message);
                          }
                        }}
                      >
                        {f.enabled ? "Pause" : "Enable"}
                      </button>
                    </div>
                  ))}
                <div className="field">
                  <label htmlFor="feed-url">Authorized HTTPS JSON feed</label>
                  <input
                    id="feed-url"
                    type="url"
                    value={feedUrl}
                    onChange={(e) => setFeedUrl(e.target.value)}
                    placeholder="https://raw.githubusercontent.com/…/pool.json"
                  />
                </div>
                <div className="field">
                  <label htmlFor="feed-permission">
                    Source permission or license
                  </label>
                  <input
                    id="feed-permission"
                    value={feedPermission}
                    onChange={(e) => setFeedPermission(e.target.value)}
                    placeholder="I own this feed, or its license permits polling…"
                  />
                </div>
                <p className="muted">
                  Uses the admin token entered below. Allowed hosts are
                  configured by the server operator.
                </p>
                <button
                  className="secondary"
                  disabled={!token || !feedUrl || feedPermission.length < 10}
                  onClick={async () => {
                    try {
                      await api(
                        "/meta/feeds",
                        {
                          name: `${displayFormat(format)} feed`,
                          format,
                          url: feedUrl,
                          permission: feedPermission,
                        },
                        token,
                      );
                      setFeedUrl("");
                      await refresh();
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  Register daily feed →
                </button>
              </section>
              <section className="panel import-panel">
                <div className="panel-heading">
                  <h2>Import a sourced snapshot</h2>
                  <span className="muted">Admin access</span>
                </div>
                <div className="panel-body">
                  <p className="muted">
                    Imports create a new immutable version. All decks are
                    validated before the snapshot is accepted. See the
                    repository’s examples for the JSON format; CSV needs name,
                    archetype, strategy, and decklist columns.
                  </p>
                  <div className="two-fields">
                    <div>
                      <label htmlFor="import-format">Input format</label>
                      <select
                        id="import-format"
                        value={csv ? "csv" : "json"}
                        onChange={(e) => setCsv(e.target.value === "csv")}
                      >
                        <option value="json">JSON snapshot</option>
                        <option value="csv">CSV decks</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="admin-token">Admin token</label>
                      <input
                        id="admin-token"
                        type="password"
                        autoComplete="off"
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
                        placeholder="Deployment ADMIN_TOKEN"
                      />
                    </div>
                  </div>
                  {csv && (
                    <div className="two-fields">
                      <div>
                        <label htmlFor="pool-name">Pool name</label>
                        <input
                          id="pool-name"
                          value={importName}
                          onChange={(e) => setImportName(e.target.value)}
                        />
                      </div>
                      <div>
                        <label htmlFor="pool-source">
                          Source / methodology
                        </label>
                        <input
                          id="pool-source"
                          value={importSource}
                          onChange={(e) => setImportSource(e.target.value)}
                        />
                      </div>
                    </div>
                  )}
                  <label htmlFor="import-data">Snapshot contents</label>
                  <textarea
                    id="import-data"
                    className="import-editor"
                    value={importText}
                    onChange={(e) => setImportText(e.target.value)}
                    placeholder={
                      csv
                        ? "name,archetype,strategy,decklist"
                        : '{"name":"Pauper tournament snapshot", "format":"pauper", "source":"…", "selectionMethod":"equal_archetype", "decks":[…]}'
                    }
                  />
                  <button
                    className="primary"
                    disabled={busy || !token || !importText}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await api(
                          "/meta/import",
                          csv
                            ? {
                                name: importName,
                                source: importSource,
                                format,
                                csv: importText,
                              }
                            : JSON.parse(importText),
                          token,
                        );
                        setImportText("");
                        setToken("");
                        await refresh();
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Import & validate snapshot →
                  </button>
                </div>
              </section>
            </>
          )}
          <footer>
            <span>
              <strong>MagicTester</strong> · Independent Magic: The Gathering
              software
            </span>
            <a
              href="https://github.com/acocalypso/magictester/blob/main/docs/SIMULATION_MODEL.md"
              target="_blank"
              rel="noreferrer"
            >
              Source & methodology →
            </a>
            <span>Not affiliated with Wizards of the Coast.</span>
          </footer>
        </main>
      </div>
      {detail && <RunDialog detail={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}
function Stat({
  title,
  value,
  note,
  accent = false,
}: {
  title: string;
  value: string;
  note?: string;
  accent?: boolean;
}) {
  return (
    <div className={"panel stat " + (accent ? "accent" : "")}>
      <span>{title}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </div>
  );
}
function JobTable({
  jobs,
  busy,
  open,
  action,
}: {
  jobs: Job[];
  busy: boolean;
  open: (id: string) => void;
  action: (j: Job, a: string) => Promise<void>;
}) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Recent benchmarks</h2>
        <span className="muted">Latest 50 analyses</span>
      </div>
      {!jobs.length ? (
        <div className="empty">
          <Icon name="queue" />
          <h3>No tests recorded yet.</h3>
          <p>Your benchmarks will appear here after you start an analysis.</p>
        </div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Deck / benchmark</th>
                <th>Status</th>
                <th>Progress</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td>
                    <button className="deck-link" onClick={() => open(j.id)}>
                      {j.name}
                    </button>
                    <small>
                      {displayFormat(j.format)} · {j.snapshot.name}
                    </small>
                  </td>
                  <td>
                    <Badge state={j.state} />
                  </td>
                  <td>
                    <Progress job={j} />
                  </td>
                  <td>{date(j.createdAt)}</td>
                  <td className="row-actions">
                    {active.includes(j.state) ? (
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => void action(j, "cancel")}
                      >
                        Cancel
                      </button>
                    ) : ["FAILED", "CANCELLED"].includes(j.state) ? (
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => void action(j, "retry")}
                      >
                        Retry
                      </button>
                    ) : null}
                    <button className="text-button" onClick={() => open(j.id)}>
                      Open →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function RunDialog({ detail, onClose }: { detail: Run; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => previous?.focus();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal panel"
      aria-labelledby="run-title"
      onCancel={onClose}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const items = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
          ),
        );
        const first = items[0],
          last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="panel-heading">
        <h2 id="run-title">Run details</h2>
        <button
          autoFocus
          className="text-button"
          onClick={onClose}
          aria-label="Close run details"
        >
          Close ×
        </button>
      </div>
      <div className="panel-body">
        <p>
          {detail.result?.gameSeed !== undefined
            ? `${detail.result.unit === "match" ? "Match" : "Game"} seed ${detail.result.gameSeed}. Player entries identify each seat and its deck version.`
            : "The legacy seed applies to the opponent batch; the game index locates this game in that batch."}
        </p>
        <pre>{JSON.stringify(detail, null, 2)}</pre>
      </div>
    </dialog>
  );
}
