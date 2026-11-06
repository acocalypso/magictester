# Implementation report

MagicTester is a working private Docker-hosted MTG benchmark lab. Its results come from Forge games, not generated matchup estimates. The user-selected charcoal/white interface uses one restrained accent, local typography, responsive tables and evidence dialogs. Comparable-product research is recorded in [design research](design/RESEARCH.md).

| Area             | Implemented behavior                                                                                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Services         | Next.js web, Fastify API, PostgreSQL/Drizzle, Redis/BullMQ worker, bounded Forge runner, bootstrap and scheduled metadata maintenance                                      |
| Engine           | Pinned Forge 2.0.15 JAR, public-API Java bridge, exact upstream source hashes/replacements, immutable compiled builds and per-game telemetry                               |
| Formats          | Standard, Pioneer, Modern, Pauper, Legacy, Vintage, Commander, cEDH and Duel Commander                                                                                     |
| Validation       | Names/scripts, legality/bans/restrictions, sizes, copy exceptions, singleton/color identity, legal commanders/partners/backgrounds/Doctors, all ten companion requirements |
| Constructed/Duel | BO1 or native first-to-two BO3, actual game/match rates, per-game seeds, sideboard changes, companion choices and explicit incomplete matches                              |
| Commander/cEDH   | Actual four-player pods, saved ordered rosters, unique seat/deck identities, placements, elimination reasons and command-zone cast timing                                  |
| Duel rules       | 20 life, no 21-damage loss, partner first-cast lock, native commander tax/zone return and two-player London mulligans                                                      |
| Opponents        | Immutable manual JSON/CSV imports, authorized scheduled HTTPS JSON feeds, ETag/body-hash versions, provenance, dates and freshness/errors                                  |
| Allocation       | Equal, source-share/custom weights, largest remainders for two players, bounded seeded weighted pods or explicit ordered pod weights                                       |
| Queue            | Durable database plans/outbox, advisory locks, bounded concurrency/retry/deadlines, cancellation and recovery of unfinished indices only                                   |
| Audit            | Completed checkpoints retained exactly; interrupted BO3 game observations preserved separately from canonical result summaries                                             |
| Analytics        | Wins/losses/rule draws, separate timeout/errors, sample sizes, Wilson intervals, starter splits, player-turn distributions and Commander measurements                      |
| Operations       | Atomic card-cache refresh/API hot reload, health/utilization/provenance endpoints, capped/rotated engine logs and process-group termination                                |
| Verification     | Unit tests, browser acceptance, real all-format games, BO3/companion contracts, restart acceptance and clean GitHub Compose integration                                    |

The real 1,000-game workload completed 537–463–0 with zero timeouts/errors at 47.615 games/minute; see [benchmark evidence](benchmarks/1000-games.json). All 45 local tests, build, typechecking and lint passed.

See [verification](VERIFICATION.md) for commit-specific runs, actual job IDs, benchmark measurements and the managed executor qualification. [Operations](OPERATIONS.md), [deployment](DEPLOYMENT.md), [source access](sources/METAGAME.md) and [allocation](OPPONENT_SELECTION.md) document reproducible behavior and boundaries. API documentation is at `/api/docs`.

The bundled opponents are project-authored reference fixtures. They do not claim to be the current competitive metagame. Authorized source feeds can supply current lists, but source date/coverage and any reported shares must be assessed by the operator; blocked third-party download routes are not bypassed.

Forge AI uses heuristics and is weaker with control/combo. Simulated rates describe this engine, roster and configuration, not human tournament win rates. BO3 sideboarding records actual native heuristic decisions rather than promising human matchup knowledge. Exact replay across engine builds/internal threads, forced equal play/draw counts, mulligan totals and general cards-drawn/cast metrics are not claimed. Timeouts/errors/incomplete matches remain visible and are excluded from the relevant win-rate denominators.

Public multi-user authentication/authorization, billing, social features, mobile clients, Kubernetes and a human-play MTG client remain outside the requested core project. Deployment intentionally binds to localhost/private use.
