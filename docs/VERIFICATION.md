# Verification record

Verification is tied to the code and engine configuration in this repository. Statuses distinguish implementation, automated tests and real execution.

| Area                                  | Status                        | Evidence                                                                                                                                                |
| ------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pauper BO1                            | RUNTIME VERIFIED              | Linux Docker Forge games through browser → web proxy → API → Redis/BullMQ → worker → runner → PostgreSQL                                                |
| Deck parsing / validation             | UNIT TESTED; RUNTIME VERIFIED | Line errors, sections, copy limits, legality, engine card availability; bundled lists validated against real cached bulk data                           |
| JSON/CSV normalization                | RUNTIME VERIFIED              | Authenticated JSON/CSV imports accepted; invalid bearer token rejected; immutable imported models                                                       |
| Queue and progress                    | RUNTIME VERIFIED              | SSE read by smoke client and browser; complete jobs persisted                                                                                           |
| Cancellation / resume                 | RUNTIME VERIFIED              | Running four-game benchmark cancelled, active JVM stopped, retry completed four unique runs                                                             |
| Abrupt worker recovery                | RUNTIME VERIFIED              | Worker SIGKILL after six saved games in a 50-game job; BullMQ recovered; six result objects unchanged; exactly 50 distinct completed run IDs            |
| Desktop/mobile UI                     | RUNTIME VERIFIED              | Chromium browser validation, real analysis creation/results, details dialog; 390 px viewport without horizontal overflow; no uncaught JavaScript errors |
| Engine timeout                        | RUNTIME VERIFIED; UNIT TESTED | Actual one-second Forge clock; regression for winner-looking output after timeout                                                                       |
| Lint / type checks / production build | VERIFIED                      | Local checks and Next.js production compilation passed                                                                                                  |
| Dependency audit                      | VERIFIED                      | Production dependency audit reported zero known vulnerabilities at implementation time                                                                  |
| Commander, cEDH, BO3                  | DEFERRED                      | Not exposed as supported simulation modes                                                                                                               |
| Automatic current-meta ingestion      | DEFERRED                      | Authorized JSON/CSV import is the supported path                                                                                                        |
| Deterministic replay                  | NOT VERIFIED                  | Seed passed and recorded; exact replay is not promised                                                                                                  |

## 50-game recovery benchmark

Job `6e8c217c-a112-4795-8693-92580379f93a`, fixed two-deck reference pool, seed 12345. All 50 games completed with no duplicate run IDs. Six already persisted results were compared after worker recovery and remained exactly unchanged. The wall time includes queue wait, deliberate worker termination and stalled-lock recovery, so it must not be treated as a clean throughput measurement.

## Measured benchmark results

| Workload              | Valid games | Timeouts / errors | Wall time | Games/min | Record    |
| --------------------- | ----------: | ----------------: | --------: | --------: | --------- |
| 50-game recovery test |          50 |             0 / 0 |   204.5 s |      14.7 | 24–26–0   |
| 250-game baseline     |         250 |             0 / 0 |   301.1 s |      49.8 | 116–134–0 |

The 250-game run used 125 real games against each of the two reference lists. Its observed win rate was 46.4% with Wilson 95% interval 40.3%–52.6%. Mean engine game duration was 1.140 seconds. These are measurements of the reference pool under Forge AI, not tournament predictions. The 1000-game preset is implemented but a 1000-game workload was not run in this session.

## Additional acceptance checks

- **RUNTIME VERIFIED:** PostgreSQL and Redis restarted; API and worker restarted; the 250 completed games and exact aggregate summary survived.
- **RUNTIME VERIFIED:** snapshot and deck-version SQL updates were rejected by immutable-record triggers.
- **RUNTIME VERIFIED:** controlled BullMQ failure exhausted its attempt budget, reconciliation marked the run failed, it stayed failed across another reconciliation interval, and an explicit retry completed one real game.
- **UNIT TESTED / RUNTIME VERIFIED:** snow basic lands are exempt from copy limits; the live API accepted 60 Snow-Covered Mountain.
- **UNIT TESTED:** 19 local tests passed, including real cached card-data validation. Standard CI omits the optional local data test when no runtime cache exists.

## GitHub verification

- [CI at 4098cd9](https://github.com/acocalypso/magictester/actions/runs/42256159926): **PASSED** lint, production build, type checks, unit tests, backend Docker build and web Docker build.
- [Real Forge integration at 4098cd9](https://github.com/acocalypso/magictester/actions/runs/42256165509): **PASSED** clean `docker compose up --build -d --wait`, real six-game smoke, cancellation and resume.
- Subsequent hardening adds the snow-basic regression, idle database connection error handling, raw failed-run counts and the controlled queue-failure test. Local verification covers those changes; check the latest repository CI for its own commit-specific status.

## Environment and Docker qualification

The managed executor has an 8 GB root disk and the VFS Docker storage driver, which duplicates image layers. Backend, runner and bootstrap images were built from the Dockerfile. The web production output was built with the same pinned Node/Next dependencies. Runtime image layers were flattened locally to fit the storage limit; warmed Forge/card caches were bound from temporary memory storage. All six long-running services were then healthy under Compose and real workflows ran through them.

This verifies the containerized service path. A clean, unmodified cold `docker compose up --build` on this exact constrained executor was not verified. It **was verified on GitHub Actions**, where the actual cold Compose startup and real-game smoke both passed; the linked run preserves the commit-specific evidence.

Container-wide `docker stats` in this executor reports shared parent-cgroup totals for different services; those values are not reliable per-service measurements. Process RSS is sampled directly inside the runner instead. Default runner heap is 1024 MB, maximum active Forge processes one.

## Performance qualification

Observed Java process RSS samples inside the runner ranged approximately 369–887 MiB during the workload, with a configured 1024 MB Java heap. These are samples, not a measured peak. API RSS after loading the full Oracle metadata cache was about 415 MiB; an idle worker sample was about 99 MiB. The executor has two CPUs. Per-service CPU utilization, isolated JVM startup cost and peak memory remain **NOT VERIFIED**; no unsupported values are reported.

## Interface redesign acceptance

The user-selected charcoal/white interface was researched against Archidekt, Untapped, MTGDecks and 17Lands; see [design research](design/RESEARCH.md). Browser acceptance on 6 November 2026 created and completed two actual Forge games (job `a3a1aebb-034a-4fc2-99d6-be369162b971`), traversed all four screens at desktop/768/390 px, verified no horizontal overflow, local font availability, native evidence-dialog Tab containment/Escape and zero uncaught JavaScript errors. Production build, lint and type checks passed. The real-engine CI workflow now includes this browser acceptance.

## Six-format acceptance

Standard, Pioneer, Modern, Pauper, Legacy and Vintage each passed two actual Forge games via a format-matched imported reference snapshot: 12 valid games and zero engine failures. Modern CSV import and Vintage single-copy restricted-card validation were also verified through the live API. Browser checks verified all six selectors, validated examples, banned-card feedback and format-filtered pools. All 23 local tests, lint, type checks and the production build passed. See [format rules](FORMAT_RULES.md) for primary sources and precise boundaries.

## Commander-family validation (continuation task 3)

The metadata cache now carries mana costs/values, keywords, front-face characteristics and a versioned Forge rules-facts cache. The helper parsed 34,160 named/Universes Within entries from the pinned release; two CopyFaceFrom-only split scripts are recorded as unavailable rather than guessed. It initializes Forge language and type tables, including the multiword Time Lord subtype needed for Doctor's companion.

`DATA_DIR=/dev/shm/magictester-data npm test` passed all 30 tests with the real cache. Coverage includes exact size, singleton/card exceptions, color identity/wild-color choices, generic/named/grouped partners, Backgrounds, Doctors, Vehicles, Grist, Duel role bans and all ten companion restrictions. `node scripts/commander-smoke.mjs` passed 12 live API cases, including Universes Within pairs, a legal restricted-in-library Duel card, an illegal restricted commander, companion role bans and Arena companion/sideboard deduplication. Lint and typechecking passed. Simulation capability remains disabled for the three Commander formats pending structured engine acceptance.

## Structured Forge bridge (continuation task 4)

The maintained bridge uses the public API of the unchanged Forge 2.0.15 JAR. Two constructed games completed with actual starter, independent game seed, player-turn count and elimination reasons. The original six-game live API cancellation/resume smoke passed using the bridge (`cf57f447-76b7-4964-a353-8fafb75f2aec`, resumed `42122fa6-f5cf-47c7-9893-71764f15a22b`). Browser acceptance passed at 1440/768/390 pixels with zero uncaught/font errors and keyboard dialog checks; result labels now distinguish individual player turns from historical end rounds.

`node scripts/bridge-smoke.mjs` completed two real four-player Commander games with validated project-authored Bruvac/Persistent Petitioners lists, 40 life each, four and two actual command-zone commander casts, and complete placements `[4,3,2,1]`. Outcomes took 26/29 individual player turns and 23.3/20.1 seconds of engine play in this executor. Two additional one-second games both timed out; each had null winner/placements, independent indexes/seeds, and a clean JVM restart before continuing. The local report is `data/bridge-smoke.json` (runtime artifact, ignored); checked-in structured fixtures preserve the observed events. Scheduled/manual integration runs this acceptance against the real compiled bridge.

Exploratory creature-heavy and Dragon's Approach pods exceeded 60 seconds; a burn pod also exceeded 120 seconds. These were actual clock expiries, never wins/draws. Deck choice and Forge's multiplayer heuristics materially affect runtime. The repeatable acceptance lists are integration fixtures, not a competitive metagame claim. Simultaneous-loss grouping follows the pinned engine's `checkGameOverCondition`/`onPlayerLost` order; the two completed runtime fixtures had sequential eliminations, so they do not claim a naturally observed tied elimination.

## Commander/cEDH queue and UI (continuation task 5a)

`node scripts/pods-smoke.mjs` passed three real API/queue/worker games: two Commander pods (`78875bde-793c-4b88-93a6-08c8e64fda7d`) and one cEDH pod (`9f4c50b8-5cbb-4ded-a687-ab7a085183d2`). All had four unique player identities, correctly linked deck identities even when lists repeated, 40 starting life, normal termination and observed placements/cast measurements. The Commander job was cancelled after its first checkpoint and retried; the first stored result remained byte-for-byte equal and the remaining pod completed. Default clocks were 120 seconds.

The database rejected a transactional attempt to edit the job's execution plan/configuration. The new migration permits normal state/progress changes while preserving immutable deck/pool/seed/clock/configuration fields. A dedicated pod-summary API is available alongside the compatible results endpoint.

All 36 local tests passed with the real cached card data. `node scripts/pods-browser.mjs` passed Commander/cEDH example loading, validation, explicit repeated-list roster previews, default clocks, pod/Commander results, and 1440/390-pixel overflow/error checks. The stats-row spacing leak from the generic adjacent-panel rule was corrected. `docs/screenshots/commander.png` shows real results in the requested charcoal-and-white palette. Duel simulation remains gated for its separate rules milestone.

A clean GitHub Compose run for `e8c07fc` built/bootstrapped the source and passed the real bridge acceptance; its next report-copy step failed because the checkout had no `data` directory. Separate fix `12afa3c` creates that directory. The full current integration workflow will be rerun after the pod changes are pushed.
