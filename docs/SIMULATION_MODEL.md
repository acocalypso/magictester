# Simulation model

**Forge AI benchmarks measure performance under the chosen Forge AI configuration. They are not human tournament win rates.** Upstream describes a heuristic AI strongest with aggro and midrange, weaker with control, and poor for many combo decks. Deck strategy tags are retained alongside each opponent.

## Available model

Pauper, two AI players, best of one. The submitted deck occupies seat zero. Each selected opponent receives an equal integer allocation; the first opponents in immutable snapshot order receive remainder games. If games are fewer than opponents, only the first requested number are scheduled. The interface shows this allocation. Equal archetype snapshots require one representative list per archetype; individual-list/custom pools use equal per-list allocation. Meta-share weighting is deferred rather than implied by stored metadata.

The reference pool contains project-authored lists solely for a functioning local benchmark and integration checks. It is not presented as a current competitive meta. Import authorized tournament/curated data with its provenance and date for meaningful comparisons. At most 50 normalized opponents are accepted per import.

## Outcomes and statistics

- Normal wins/losses and rule draws count as valid games.
- Rule draws count as non-wins in the binomial win-rate denominator.
- Native/external timeouts and engine errors are excluded from win rates and shown separately.
- A process failure leaves remaining runs pending for a bounded retry; final failure labels unresolved runs explicitly as errors.
- Cancellation leaves unfinished runs pending. Partial valid results remain visible and clearly retain a cancelled state.
- Sample size and Wilson 95% confidence interval accompany rates. Under 100 valid games is labeled a small sample. An empty sample produces unavailable values, not a fabricated zero percent.

The observed first player is parsed from the real turn log. Forge controls who starts; no exact 50/50 play/draw split is claimed. Separate observed rates use only games where the starter is known.

Forge's `Game Outcome: Turn` is a round counter, unlike the individual-player `Turn: Turn` log sequence. The UI calls it the end round. Game duration comes from the CLI's game stopwatch; job wall time additionally includes JVM startup, data loading, queuing and database operations.

## Limits

Native clock defaults to 30 seconds per game. The outer watchdog allows clock × games + 90 seconds for startup. Worker job runtime defaults to six hours. Global runner capacity defaults to one JVM, with configurable heap/process count and container CPU/memory bounds. Worker concurrency does not bypass runner capacity.

Seeds are stored and passed to the engine; deterministic replay across versions or concurrent internals is not guaranteed. Recovery replays incomplete batches and skips already persisted run identities. The new execution may differ, which is why this is described as recovery rather than exact replay.

## Unavailable / deferred

Commander pod generation, multiplayer placements, commander cast/recast timing, commander damage, mulligans, cards drawn/cast, elimination order, BO3, intelligent sideboarding and forced play/draw are not exposed as implemented metrics. Commander support in upstream documentation is not sufficient verification of the product. No guessed or simulated substitutes are returned for unavailable fields.
