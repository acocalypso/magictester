# Implementation report

| Area                    | Status / implementation                                                                                                                                                     |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Architecture            | IMPLEMENTED; RUNTIME VERIFIED — separate web, API, PostgreSQL, Redis/BullMQ, worker and Forge runner services                                                               |
| Frontend                | IMPLEMENTED; RUNTIME VERIFIED — Next.js, React, TypeScript, responsive CSS; analysis, queue, results, pools and run details                                                 |
| API                     | IMPLEMENTED; RUNTIME VERIFIED — Fastify/TypeScript, versioned schemas, OpenAPI, rate/body/job limits, SSE                                                                   |
| Queue                   | IMPLEMENTED; RUNTIME VERIFIED — BullMQ, durable database planning/outbox, idempotent run identities, bounded retry                                                          |
| Database                | IMPLEMENTED; RUNTIME VERIFIED — PostgreSQL, Drizzle, versioned transactional migration, immutable records                                                                   |
| Forge version           | RUNTIME VERIFIED — release 2.0.15, tag commit 4ec5f1a2c32fa90ecb983a72b9eb47aa5c5d7676, build 2026-09-28 22:22:04                                                           |
| Forge integration       | RUNTIME VERIFIED — unmodified headless Java CLI in a separate process/runner, stdout parser, NDJSON stream, raw logs                                                        |
| Formats                 | RUNTIME VERIFIED — Pauper BO1; other format definitions are prepared but disabled                                                                                           |
| Deck validation         | UNIT TESTED; RUNTIME VERIFIED — syntax, names, quantities, deck/sideboard sizes, legality/bans, copy exceptions including snow basics, script availability                  |
| Meta providers          | RUNTIME VERIFIED — authorized manual JSON and CSV import; automatic website ingestion DEFERRED                                                                              |
| Meta snapshots          | RUNTIME VERIFIED — immutable, provenance/date/methodology, up to 50 decks; bundled pool is explicitly reference data                                                        |
| 1v1 simulation          | RUNTIME VERIFIED — real AI games against two distinct lists, both single-game and large batch workloads                                                                     |
| Commander / cEDH        | DEFERRED — upstream CLI support researched; no unverified multiplayer UI or analytics exposed                                                                               |
| BO3 / sideboarding      | DEFERRED — sideboards validated/stored, BO1 only                                                                                                                            |
| Metrics                 | RUNTIME VERIFIED — wins/losses/rule draws, timeout/error counts, sample sizes, Wilson intervals, per-opponent rates, observed play/draw, end rounds and durations           |
| Unavailable metrics     | DEFERRED — commander casting, placements, mulligans, cards drawn/cast, intelligent sideboarding, forced first player                                                        |
| Queue concurrency       | RUNTIME VERIFIED — default one job worker and one globally bounded JVM; configurable caps; single runner replica                                                            |
| Timeout                 | RUNTIME VERIFIED; UNIT TESTED — native game clock plus outer process/startup watchdog; timeout-looking winners discarded                                                    |
| Cancellation            | RUNTIME VERIFIED — durable flag, request abort, Java process-group termination; completed results retained                                                                  |
| Recovery                | RUNTIME VERIFIED — abrupt worker kill after six saves, all retained exactly, 50 unique completions; bounded exhausted retries and explicit resume                           |
| Persistence             | RUNTIME VERIFIED — database/Redis/API/worker restart preserved 250 completed games and exact aggregates                                                                     |
| Automated tests         | UNIT TESTED — 18 local tests passed; separate HTTP/Docker smoke verifies API and queue behavior                                                                             |
| Forge integration tests | RUNTIME VERIFIED — actual Linux Docker game, native clock test, six-game cancel/resume smoke, 50/250-game workloads                                                         |
| Docker smoke            | RUNTIME VERIFIED — clean Compose build/start and real-game smoke passed on GitHub Actions; local executor used equivalent flattened runtime images due VFS disk constraints |
| 50-game benchmark       | RUNTIME VERIFIED — 50 valid, zero timeout/error, 204.5 s including deliberate recovery/queue wait; 14.7 games/min is not clean throughput                                   |
| 250-game benchmark      | RUNTIME VERIFIED — 250 valid, zero timeout/error, 301.1 s, 49.8 games/min; two reference lists, 125 games each                                                              |
| 1000-game benchmark     | NOT VERIFIED — preset and capacity limits implemented; workload not executed in this session                                                                                |
| CPU                     | NOT VERIFIED — two executor CPUs; shared parent-cgroup statistics prevent reliable per-service attribution                                                                  |
| Memory                  | PARTIALLY VERIFIED — sampled Java RSS approximately 369–887 MiB, API about 415 MiB, idle worker about 99 MiB; peaks not measured                                            |
| Forge AI limitations    | DOCUMENTED — heuristic, stronger aggro/midrange, weaker control/combo; model results differ from tournament results                                                         |
| Card limitations        | DOCUMENTED — snapshot legality and script presence do not guarantee perfect rules or AI support; runtime failures remain explicit                                           |
| Security boundary       | IMPLEMENTED; RUNTIME VERIFIED — private localhost deployment, no end-user identity/ownership enforcement; admin token required for imports                                  |
| Licensing               | DOCUMENTED — GPL-3.0 application/Forge notices, pinned source and archive checksum, no custom Forge code; third-party content rights retained                               |
| Known issues            | DOCUMENTED — no deterministic replay guarantee, no forced play/draw, operational log retention, dated metadata until operator refresh                                       |
| Deferred work           | Commander, more enabled formats, BO3/sideboarding, authorized automated meta providers, multi-user authentication/authorization, autoscaling                                |
| Next milestone          | Validate a source-backed current Pauper metagame snapshot, then implement and runtime-verify four-player Commander and structured event instrumentation                     |

See [verification evidence](VERIFICATION.md) for measurements, commit-specific GitHub run links and environment qualifications. [Architecture](ARCHITECTURE.md), [Forge integration](FORGE_INTEGRATION.md), [simulation model](SIMULATION_MODEL.md), [statistics](STATISTICS.md), [licensing](LICENSING.md) and [deployment](DEPLOYMENT.md) document the implementation boundaries.
