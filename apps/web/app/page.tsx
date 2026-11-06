"use client";
import { useCallback, useEffect, useState, useRef } from "react";

type View = "analysis" | "queue" | "results" | "meta";
type Deck = {
  id: string;
  name: string;
  archetype: string;
  strategy: string;
  decklist: string;
  metaShare: number | null;
};
type Snapshot = {
  id: string;
  name: string;
  format: string;
  source: string;
  sourceDate: string | null;
  createdAt: string;
  decks: Deck[];
  selectionMethod: string;
};
type Job = {
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
type Results = {
  job: Job;
  summary: Summary;
  matchups: ({ opponent: Deck; planned: number } & Summary)[];
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
    engineVersion: string;
    winner: number | null;
    turns: number | null;
    startingPlayer: number | null;
    durationMs: number;
    termination: string;
    players: { id: string; placement: number | null }[];
  } | null;
};
const starter =
  "20 Mountain\n4 Lightning Bolt\n4 Chain Lightning\n4 Lava Spike\n4 Rift Bolt\n4 Shock\n4 Incinerate\n4 Lightning Strike\n4 Searing Blaze\n4 Thermo-Alchemist\n4 Kessig Flamebreather";
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
): Promise<T> {
  const r = await fetch("/api/v1" + path, {
    method: body ? "POST" : "GET",
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
        {job.completed + job.failed} / {job.games}
      </span>
    </div>
  );
}
export default function Home() {
  const [view, setView] = useState<View>("analysis");
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [selected, setSelected] = useState("");
  const [result, setResult] = useState<Results | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [runPage, setRunPage] = useState(0);
  const [detail, setDetail] = useState<Run | null>(null);
  const [busy, setBusy] = useState(false);
  const [deckName, setDeckName] = useState("My Pauper deck");
  const [decklist, setDecklist] = useState("");
  const [snapshotId, setSnapshotId] = useState("");
  const [games, setGames] = useState(50);
  const [seed, setSeed] = useState(12345);
  const [validation, setValidation] = useState<{
    valid: boolean;
    errors: { message: string; line?: number; card?: string }[];
    counts: { mainboard: number; sideboard: number };
  } | null>(null);
  const [importText, setImportText] = useState("");
  const [token, setToken] = useState("");
  const [csv, setCsv] = useState(false);
  const [importName, setImportName] = useState("");
  const [importSource, setImportSource] = useState("");
  const [sort, setSort] = useState<"name" | "rate">("name");
  const refresh = useCallback(async () => {
    try {
      const [s, j] = await Promise.all([
        api<Snapshot[]>("/meta/pauper/snapshots"),
        api<Job[]>("/simulations"),
      ]);
      setSnapshots(s);
      setJobs(j);
      setConnected(true);
      setSnapshotId((old) => old || s[0]?.id || "");
    } catch (e) {
      setConnected(false);
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    const params = new URLSearchParams(location.search);
    const initial = params.get("view");
    if (["analysis", "queue", "results", "meta"].includes(initial || ""))
      setView(initial as View);
    setSelected(params.get("job") || "");
    return () => clearInterval(timer);
  }, [refresh]);
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
      setResult(data);
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
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const validated = await api<NonNullable<typeof validation>>(
        "/decks/validate",
        { decklist, format: "pauper" },
      );
      setValidation(validated);
      if (validated.valid) {
        const job = await api<Job>("/simulations", {
          name: deckName,
          decklist,
          format: "pauper",
          snapshotId,
          games,
          seed,
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
  const pool = snapshots.find((s) => s.id === snapshotId);
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
                      onClick={() => {
                        setDecklist(starter);
                        setDeckName("Mono-red Burn");
                        setValidation(null);
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
                        <span>MAINBOARD / SIDEBOARD</span>
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
                      Mainboard and sideboard supported. Your exact list is
                      saved with each analysis.
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
                              {validation.counts.sideboard} sideboard
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
                              format: "pauper",
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
                        Format <span className="muted">/ BO1</span>
                      </label>
                      <select id="format" defaultValue="pauper">
                        <option value="pauper">Pauper</option>
                        <option disabled>Modern · coming later</option>
                        <option disabled>Commander · coming later</option>
                      </select>
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
                              {pool.decks.length} opponent decks · Equal
                              allocation
                            </strong>
                            <p>{pool.source}</p>
                            <small>Snapshot {date(pool.createdAt)}</small>
                          </div>
                        </div>
                      )}
                      <label>How many games?</label>
                      <div className="presets">
                        {[
                          [50, "Quick"],
                          [250, "Standard"],
                          [1000, "Deep"],
                        ].map(([n, label]) => (
                          <button
                            key={n}
                            className={games === n ? "preset chosen" : "preset"}
                            onClick={() => setGames(Number(n))}
                          >
                            <strong>{label}</strong>
                            <span>{n} games</span>
                          </button>
                        ))}
                      </div>
                      <div className="two-fields">
                        <div>
                          <label htmlFor="games">Total games</label>
                          <input
                            id="games"
                            type="number"
                            min={1}
                            max={1000}
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
                      <p className="distribution">
                        {pool
                          ? `${games} games across ${Math.min(pool.decks.length, games)} opponents. ${Math.floor(games / pool.decks.length)}–${Math.ceil(games / pool.decks.length)} games per deck.`
                          : "Import a benchmark pool to begin."}
                      </p>
                      <button
                        className="primary analyze-button"
                        disabled={
                          busy ||
                          !decklist.trim() ||
                          !snapshotId ||
                          games < 1 ||
                          games > 1000
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
                  value={String(jobs.reduce((s, j) => s + j.completed, 0))}
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
                      Pauper BO1 <span className="slash">/</span>{" "}
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
                    title="Overall win rate"
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
                    title="Average end round"
                    value={result.summary.averageTurns?.toFixed(1) || "—"}
                    note={
                      "Median " +
                      (result.summary.medianTurns ?? "—") +
                      " · Forge round counter"
                    }
                  />
                  <Stat
                    title="Timeouts / errors"
                    value={`${result.summary.timeouts} / ${result.job.failed}`}
                    note="Excluded from the win-rate denominator"
                  />
                </div>
                <div className="results-grid">
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <h2>Matchup performance</h2>
                        <span className="muted">
                          {result.matchups.length} opponents
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
                            <th>Opponent / archetype</th>
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
                                    {m.opponent.archetype} ·{" "}
                                    {m.opponent.strategy}
                                  </small>
                                </td>
                                <td>
                                  {m.games}
                                  <small>{m.planned} planned</small>
                                </td>
                                <td>
                                  {m.wins}–{m.losses}–{m.draws}
                                </td>
                                <td className="rate-cell">
                                  <strong>{pct(m.winRate)}</strong>
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
                      <h2>Play / draw</h2>
                      <span className="muted">Observed</span>
                    </div>
                    <div className="panel-body">
                      {[
                        ["On the play", result.summary.onPlay],
                        ["On the draw", result.summary.onDraw],
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
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Game length distribution</h2>
                    <span className="muted">
                      {result.summary.games} valid games · End round
                    </span>
                  </div>
                  <div
                    className="histogram"
                    role="img"
                    aria-label={
                      "End round distribution: " +
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
                        Round data will appear as games complete.
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
                          <th>Game</th>
                          <th>Outcome</th>
                          <th>Round</th>
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
                            </td>
                            <td>{r.result?.turns ?? "—"}</td>
                            <td>
                              {r.result
                                ? (r.result.durationMs / 1000).toFixed(1) + "s"
                                : "—"}
                            </td>
                            <td>
                              <code>{r.seed}</code>
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
                      Games {runPage * 25 + 1}–
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
              <div className="info-banner">
                The bundled pool contains project-authored reference lists.
                Import sourced tournament decks to benchmark a current metagame.
                No tournament statistics are invented.
              </div>
              <div className="pool-grid">
                {snapshots.map((s) => (
                  <section className="panel pool-card" key={s.id}>
                    <div className="pool-card-top">
                      <span className="format-tag">PAUPER</span>
                      <span className="muted">{s.decks.length} decks</span>
                    </div>
                    <h2>{s.name}</h2>
                    <p>{s.source}</p>
                    <div className="pool-date">
                      {date(s.createdAt)} ·{" "}
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
                                format: "pauper",
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
                    <small>Pauper · {j.snapshot.name}</small>
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
          The seed applies to the opponent batch. The game index locates this
          game in that batch.
        </p>
        <pre>{JSON.stringify(detail, null, 2)}</pre>
      </div>
    </dialog>
  );
}
