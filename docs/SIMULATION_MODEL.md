# Simulation model

**Forge AI benchmarks measure performance under the chosen Forge AI configuration. They are not human tournament win rates.** Upstream describes a heuristic AI strongest with aggro and midrange, weaker with control, and poor for many combo decks. Deck strategy tags are retained alongside each opponent.

## Available model

Standard, Pioneer, Modern, Pauper, Legacy and Vintage; two AI players, best of one. The submitted deck occupies seat zero. Each selected opponent receives an equal integer allocation; the first opponents in immutable snapshot order receive remainder games. If games are fewer than opponents, only the first requested number are scheduled. The interface shows this allocation. Equal archetype snapshots require one representative list per archetype; individual-list/custom pools use equal per-list allocation. Meta-share weighting is deferred rather than implied by stored metadata.

The reference pool contains project-authored lists solely for a functioning local benchmark and integration checks. It is not presented as a current competitive meta. Import authorized tournament/curated data with its provenance and date for meaningful comparisons. At most 50 normalized opponents are accepted per import.

## Outcomes and statistics

- Normal wins/losses and rule draws count as valid games.
- Rule draws count as non-wins in the binomial win-rate denominator.
- Native/external timeouts and engine errors are excluded from win rates and shown separately.
- A process failure leaves remaining runs pending for a bounded retry; final failure labels unresolved runs explicitly as errors.
- Cancellation leaves unfinished runs pending. Partial valid results remain visible and clearly retain a cancelled state.
- Sample size and Wilson 95% confidence interval accompany rates. Under 100 valid games is labeled a small sample. An empty sample produces unavailable values, not a fabricated zero percent.

The observed first player comes from the real game-start event. Forge controls who starts; no exact 50/50 play/draw split is claimed. Separate observed rates use only games where the starter is known.

The structured bridge measures individual player turns using Forge's GameOutcome. Historical native-parser jobs retain their end-round interpretation; the job configuration records the turn unit. Game duration wraps the actual engine call; job wall time additionally includes JVM startup, data loading, queuing and database operations.

## Limits

The game clock defaults to 30 seconds for constructed games. The bridge also enforces a separate 90-second startup deadline and an outer per-game watchdog five seconds longer than the game clock. A timed-out JVM exits before another game is started. Worker job runtime defaults to six hours. Global runner capacity defaults to one JVM, with configurable heap/process count and container CPU/memory bounds. Worker concurrency does not bypass runner capacity.

Seeds are stored and passed to the engine; deterministic replay across versions or concurrent internals is not guaranteed. Recovery uses stable per-game seeds and skips already persisted run identities. The new execution may differ, which is why this is described as recovery rather than exact replay.

## Unavailable / deferred

The internal bridge supports four-player games, tied elimination placements and actual commander cast/recast timing. Public Commander pod planning is a separate pending milestone. Commander damage totals, mulligans, cards drawn/cast, BO3, intelligent sideboarding and forced play/draw remain unavailable. Commander support in upstream documentation is not sufficient verification of the product. No guessed or simulated substitutes are returned for unavailable fields.
