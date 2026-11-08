# Android analysis timeouts · 0.1.12

The diagnostic report from MagicTester 0.1.10 showed two 50-match Pauper analyses
stopping after match 45 and match 5, each during game two of a best-of-three.
Their configured limit was 120 seconds **per game**. Completed earlier games
explain why the entire match attempt took more than 120 seconds.

The engine returned and saved `termination: timeout`. The queue then threw on
every result other than a normal finish or rule draw. That changed the entire
analysis to failed and abandoned its remaining scheduled matches. The recorded
process retirements after each request are deliberate isolated-engine cleanup;
this report does not show an out-of-memory kill causing these two stops.

## Behavior from 0.1.12

- A timed-out match retains its partial games, actions and diagnostic evidence.
  The isolated engine is retired and the next scheduled match uses a fresh
  process. Existing hardware admission and parallelism limits still apply.
- Every pending match is attempted once per pass. Timeouts are not automatically
  retried forever, and the configured clock is not silently increased.
- Later matches and later queued analyses continue after a timeout.
- If every match has an outcome, the analysis is **complete**. If any attempted
  matches timed out, it ends **incomplete**, with finished/unfinished counts.
  An incomplete analysis still has its matchup chart and export options.
- Timeouts are neither wins nor losses. A partial best-of-three is not recorded
  as a finished match even if its first game finished. AI comparisons include
  only verified completed matching outcomes.
- Open an incomplete analysis and select **Resume unfinished matches**. Choose a
  longer per-game clock, then press **Resume with these settings**. Completed
  matches are preserved; only unfinished indices are retried. Changed clocks
  remain visible and can exclude a result from a paired AI comparison.
- Existing failed runs can use the same resume control after updating. Their
  earlier evidence and finished matches are preserved.
- Cancellation, resource admission errors, missing evidence and engine failures
  retain their existing stop/review behavior. Calibration is unchanged: a timeout
  still invalidates that benchmark trial instead of claiming stable throughput.

## Regression coverage

The production analysis runner is exercised against Android SQLite and actual
JSONL evidence files with a deterministic engine-result provider. Checks include
the 45-of-50 interruption, serial and parallel scheduling, all-timeout pools,
continuing to another queued analysis, export/import of incomplete state,
longer-clock retry without repeating finished matches, cancellation and retained
engine-error evidence. The native UI check verifies that incomplete analyses
expand their chart and offer the timeout settings/retry controls. The full
release suite also runs real isolated Forge games and in-place update checks.

This fixes analysis scheduling after a timeout. It does not claim to eliminate
slow or stalled Forge AI evaluations inside an individual game.
