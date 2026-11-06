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
