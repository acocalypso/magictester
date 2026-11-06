# Verification record

Verification is tied to the code and engine configuration in this repository. Statuses distinguish implementation, automated tests and real execution.

| Area                                  | Status                        | Evidence                                                                                                                                                |
| ------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pauper BO1                            | RUNTIME VERIFIED              | Linux Docker Forge games through browser → web proxy → API → Redis/BullMQ → worker → runner → PostgreSQL                                                |
| Deck parsing / validation             | UNIT TESTED; RUNTIME VERIFIED | Line errors, sections, copy limits, legality, engine card availability; bundled lists validated against real cached bulk data                           |
| JSON/CSV normalization                | IMPLEMENTED; UNIT TESTED      | Shared validation; immutable imported models                                                                                                            |
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

Larger benchmark measurements and final acceptance evidence are recorded as execution completes.

## Environment and Docker qualification

The managed executor has an 8 GB root disk and the VFS Docker storage driver, which duplicates image layers. Backend, runner and bootstrap images were built from the Dockerfile. The web production output was built with the same pinned Node/Next dependencies. Runtime image layers were flattened locally to fit the storage limit; warmed Forge/card caches were bound from temporary memory storage. All six long-running services were then healthy under Compose and real workflows ran through them.

This verifies the containerized service path. A clean, unmodified cold `docker compose up --build` on this exact constrained executor was not verified; the separate GitHub Actions real-engine workflow exercises that path on a normal runner. Do not confuse the presence of a CI workflow with a passing CI execution.

Container-wide `docker stats` in this executor reports shared parent-cgroup totals for different services; those values are not reliable per-service measurements. Process RSS is sampled directly inside the runner instead. Default runner heap is 1024 MB, maximum active Forge processes one.
