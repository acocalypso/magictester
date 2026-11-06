# Simulation model

**Forge AI benchmarks measure performance under the chosen Forge AI configuration. They are not human tournament win rates.** Upstream describes a heuristic AI strongest with aggro and midrange, weaker with control, and poor for many combo decks. Deck strategy tags are retained alongside each opponent.

## Available model

Standard, Pioneer, Modern, Pauper, Legacy and Vintage; two AI players, best of one. The submitted deck occupies seat zero. Each selected opponent receives an equal integer allocation; the first opponents in immutable snapshot order receive remainder games. If games are fewer than opponents, only the first requested number are scheduled. The interface shows this allocation. Equal archetype snapshots require one representative list per archetype; individual-list/custom pools use equal per-list allocation. Meta-share weighting is deferred rather than implied by stored metadata.

The reference pool contains project-authored lists solely for a functioning local benchmark and integration checks. It is not presented as a current competitive meta. Import authorized tournament/curated data with its provenance and date for meaningful comparisons. At most 50 normalized opponents are accepted per import.

## Commander and cEDH pods

Commander and cEDH add the submitted deck to three opponent seats at 40 life. Consecutive lists from immutable snapshot order fill those seats; the next pod rotates the starting list by one. Games are allocated equally across these ordered pods, with the remainder in snapshot order. Pools smaller than three repeat lists across seats; the preview explicitly shows the repeated names. A pod's ordered roster determines a stable key. The saved execution plan, seeds, clock and deck/snapshot references cannot be edited after submission.

Each player has a unique seat identity plus a deck identity, even when lists repeat. Recovery reads the saved roster and leaves completed results untouched. Per-pod rates describe that entire roster, not an independent one-on-one matchup with any single opponent. `GET /api/v1/simulations/:id/pods` returns these pod summaries; `results.matchups` retains a display-compatible pod label and full `participants`.

Average placement and placement distributions use only actual completed placements. Simultaneous losses share a competition rank. Commander timing uses observed spells cast by the submitted player and the caster's own turn number; games without a cast have no first-cast turn and are counted separately. Constructed reports do not display Commander metrics. The submitted deck stays in the first displayed seat; Forge chooses the actual first player. This is not randomized or balanced seating.

The default game clock is 120 seconds for Commander-family API jobs, 30 for constructed, configurable from 5–120 seconds. Commander AI can exceed the clock on complex or stalled boards. Reference Commander/cEDH lists are explicitly integration fixtures and are not a competitive cEDH field.

## Duel Commander

Duel uses two AI players at 20 life, its own cached legality/commander-role ban list, no commander-damage victory, and native Commander zone returns/tax. After the first command-zone commander cast, a different designated commander cannot be cast from that zone in the same game; the selected commander may be recast, and either can be cast from another zone. Two-player London mulligans have no free first mulligan. The bridge explicitly pins London for every format and records the rule rather than inheriting a user's Forge GUI preference.

The two Duel-only source overrides are pinned and hash-checked; see `services/forge-runner/bridge/patches.json`. They remain disabled for normal Commander and constructed games. Deck declarations stay fixed for these BO1 benchmarks; no commander-swapping or sideboarding intelligence is implied.

## BO3 and sideboarding

Two-player constructed and Duel benchmarks can use BO3. The requested quantity counts **matches**, while BO1 counts games. Native Forge Match continues until one player has two wins; rule draws can extend it beyond three games. A saved per-match game limit (3–9, default 5) bounds attempts. Hitting it produces `game_limit`, with no match winner: it is not relabeled a rule draw. The total reserved attempts (`matches × per-match limit`) cannot exceed the job's game budget.

Game win rates use actual valid child games; match rates use finalized normal/rule-draw match outcomes. Resource-limited, timed-out and errored matches are excluded from match rates and counted separately. Each actual child outcome, seed, starter, turns, duration, sideboard changes and companion selection is retained. The match score is checked against those outcomes. Root match turns/starter are null rather than inventing a single starter or turn count across several games.

`forge` sideboarding enables Forge's real generic AI routine; `none` keeps submitted lists. Duel has no conventional sideboard and keeps declared commanders. The native routine uses type/color/mana-cost heuristics, random choices and sometimes a predefined deck hint; it is not human matchup-aware sideboarding. Observed additions/removals and resulting main/side sizes report what it actually did. Deterministic acceptance fixtures use native predefined hints; ordinary imported lists do not gain invented plans.

A declared companion candidate is chosen exactly when eligible; another candidate is never silently substituted. Without a Companion declaration the engine declines optional companions, even if a sideboard card would qualify. After native sideboarding a previously eligible candidate may no longer be selected; the actual selection is recorded. If the validated initial candidate cannot be selected by pinned Forge, the attempt fails explicitly. The pinned optional-choice null guard and sideboarding-after-draw guard prevent native exceptions.

Every BO3 child game is also stored as an observation with its attempt identity. Cancelling/retrying an unfinished match retains those observations, then restarts that match; only the finalized attempt enters benchmark summaries. Completed matches do not change. `GET /api/v1/simulations/:id/observations` exposes the audit data with pagination. The UI distinguishes planned match units, actual game counts, match scores and the two win rates.

Bridge protocol 2 introduces these result units and observation events. Older results remain readable with their saved engine metadata; unfinished jobs from an older protocol require a new analysis rather than mixing contracts.

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

The internal bridge supports four-player games, tied elimination placements and actual commander cast/recast timing. Commander and cEDH pod planning, queue execution and these measurements are exposed in the UI/API. Commander damage totals, mulligan counts, cards drawn/cast, human-level matchup-aware sideboarding and forced play/draw remain unavailable. Commander support in upstream documentation is not sufficient verification of the product. No guessed or simulated substitutes are returned for unavailable fields.

## Reading game history

Each recorded game opens a readable summary: its outcome, who played first, turn count, playing time, sideboard moves and any companion or commander decisions that were recorded. Missing measurements are labelled as unavailable; a game summary is not a turn-by-turn replay.

A restarted match can leave more than one attempt in its history. The history gives attempts a readable number and explains whether each game contributes to the results. Earlier attempts remain visible and never count toward win rates. Games from a match still in progress wait for its final result. Normal games and rule draws in the finalized attempt enter game statistics; timed-out or failed games do not. A completed game can count even when the overall match reaches its game limit and is excluded from match statistics. Refresh the history to update the status of a running match.

The observation API adds a derived `review` field based on the complete attempt history and saved final result. Attempt numbering stays consistent across pages. Original recorded events remain unchanged; the review status can change as a match finishes or restarts. JSON exports remain available separately for diagnostics.
