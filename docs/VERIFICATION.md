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
| Commander, cEDH, Duel, BO3            | RUNTIME VERIFIED              | Real four-player pods, Duel rules contracts/played games, native BO3/sideboarding; continuation evidence below                                          |
| Scheduled source feeds                | RUNTIME VERIFIED              | Authorized HTTPS JSON polling, immutable SHA-256 versions, admin/UI refresh and freshness; no tournament data invented                                  |
| Deterministic replay                  | NOT VERIFIED                  | Seed passed and recorded; exact replay is not promised                                                                                                  |

## 50-game recovery benchmark

Job `6e8c217c-a112-4795-8693-92580379f93a`, fixed two-deck reference pool, seed 12345. All 50 games completed with no duplicate run IDs. Six already persisted results were compared after worker recovery and remained exactly unchanged. The wall time includes queue wait, deliberate worker termination and stalled-lock recovery, so it must not be treated as a clean throughput measurement.

## Measured benchmark results

| Workload              | Valid games | Timeouts / errors | Wall time | Games/min | Record    |
| --------------------- | ----------: | ----------------: | --------: | --------: | --------- |
| 50-game recovery test |          50 |             0 / 0 |   204.5 s |      14.7 | 24–26–0   |
| 250-game baseline     |         250 |             0 / 0 |   301.1 s |      49.8 | 116–134–0 |

The 250-game run used 125 real games against each of the two reference lists. Its observed win rate was 46.4% with Wilson 95% interval 40.3%–52.6%. Mean engine game duration was 1.140 seconds. These are measurements of the reference pool under Forge AI, not tournament predictions. This was the historical baseline before the structured bridge and continuation work; see the final acceptance section for the current benchmark.

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

## Companion metadata edge cases

Follow-up checks reproduced two false rejections: Mistform Ultimus with Kaheera and Arcanum Wings with Zirda. The pinned Forge scripts explicitly define Mistform's outside-battlefield all-creature-types characteristic and Aura swap's activated keyword. Bootstrap now exports that characteristic, recognizes Aura swap/Specialize, and combines both faces' activated abilities for split cards while preserving front-face behavior for transforming/adventure cards. All 37 local tests and 14 live validation cases passed after regenerating the real facts cache. The Forge bridge/source hash did not change.

## Duel execution (continuation task 5b)

Two narrowly scoped source overrides are pinned by exact upstream commit/URL/SHA-256 and exact replacement strings. The original JAR stays unchanged. Bootstrap compiled both overrides successfully and fingerprints the complete patch manifest with the bridge. Normal Commander rules/zone-return flags remain active.

`DuelContracts.java` passed 14 direct engine assertions: 20 life, retained Commander variants, pinned London/no free first mulligan, either initial partner, other-partner lock after the first command-zone cast, selected-commander recasts with native +2 tax, casting the other commander from hand, no 21-damage loss in Duel, ordinary zero-life loss, and unchanged normal Commander partner/21-damage rules. These are rule contract checks, not claimed played games.

Two direct real Duel games completed normally at `[20,20]` starting life, observed command-zone casts and actual decking losses; durations were 8.9/4.2 seconds and 17/15 player turns. The API/queue path also completed two games; after explicitly pinning London the final acceptance job was `dfba45b3-354e-432e-b13e-1728e41fd122`, with observed `mode: duel`, `mulliganRule: London`, the exact override source hash, two-player identities and Commander timing. The UI tests cover all three Commander-family examples, clocks, pod previews where applicable, and Duel results with `/ 2` placements at desktop/mobile sizes. All 38 local tests passed; build, lint and typecheck passed.

The prior clean GitHub engine acceptance passed again; Docker's report-copy API could not read the mounted `/tmp` artifact. Separate fix `d362d97` reads it through `docker compose exec ... cat`, verified locally against the mounted tmpfs. The report directory fix remains in place.

## BO3 execution (continuation task 6)

Protocol 2 executes native first-to-two-wins matches, preserving actual child games, per-game seeds, sideboard changes and declared companion selections. The independent game-attempt cap reports incomplete matches rather than invented draws. Six direct Modern matches produced 13 actual games, including a deciding third game. Explicit native sideboarding hints in this integration fixture exercise real swaps; ordinary decks use Forge’s own heuristics. MatchContracts passed five engine assertions, including draw handling; these assertions are not claimed played games.

Live API acceptance passed two matches/six actual games (`4b43ac05-c198-44dd-92cb-bf9e2afb9a76`). Cancel/retry acceptance (`218d945b-5216-43ad-985c-9eaa7292e52c`) retained the interrupted observation: ten observed attempts and nine canonical games, with completed checkpoints unchanged. Duel BO3 (`9f7918cb-5ba6-47d1-a0cb-120ab1a8d0b4`) completed three actual games at 20 life. Browser acceptance (`37acea7a-0b26-40ef-abf1-6fdeb2726c1a`) passed desktop/mobile overflow and JavaScript checks, separate game/match summaries and audit evidence.

Actual companion checks verified declining undeclared candidates and declining a declared Gyruda after sideboarding made it ineligible, without substituting Jegantha. Native null-choice and drawn-game sideboarding bugs have pinned source guards. Unsupported loaded cards fail before play. Duel’s 14 engine assertions still pass. All 41 local tests, production build, typechecking and lint passed. Final bridge source fingerprint: `c532a1011fb8e664de75961cd411513bc3bfcad32f356f9bcceb40a66d758088`. The prior clean GitHub integration at `711cb87` passed; task 6 adds its acceptance scripts to that workflow.

## Scheduled feeds (continuation task 7)

Authorized remote JSON ingestion passed against the public project-authored reference feed, publishing snapshot `e7840c3f-5b6c-4fc8-b832-98e56e2e5837` with body SHA-256 `9123bc0017707710dcce18c5792036c51d2dfd803bd83b2f44c69fcf60f95fd7`. A repeat refresh created no new snapshot. Admin authorization, rejected unauthorized hosts and pause/re-enable passed. Browser controls passed actual refresh/pause/re-enable at desktop/mobile widths. All 42 local tests, build and lint passed; general browser acceptance completed two actual games with no overflow, font or JavaScript errors. This executor's API required its session proxy/CA and proxy hostname mapping; these are untracked runtime adaptations, not repository credentials. See [source research and feed contract](sources/METAGAME.md) for source access findings and exact boundaries.

## Opponent selection (continuation task 8)

Seven real Pauper games (`fde23dbd-6bc4-4297-88be-1bde7a50ba0e`) completed with a saved 3:1 custom weighting, producing exactly five and two games per opponent. Live API rejected all-zero weights and unavailable source shares. Unit checks cover exact totals, deterministic tie breaking, selected-member validation, bounded seeded rosters, zero-weight exclusions, repetition restrictions and explicit ordered pod allocations. All 43 local tests, build and lint passed. Browser checks exercise custom weights, ordered pod seat controls and mobile overflow. See [allocation contract](OPPONENT_SELECTION.md) for the approximation used by weighted multiplayer sampling.

## Operations (continuation task 9)

The new immutable source build `a6b75c4bb8248bdda19d3efd827bfcba7bd4bcfabf20cd2bfcc4b21e719558da` compiled successfully. A direct real-engine request executed only absolute indices `[2,5]`, preserving seeds `[14363,17390]`. BO3 API/cancellation acceptance passed again (`28a594a7-6879-461d-b1af-8405d4f14354`, resumed `096e6fa3-937c-400b-886a-a328261c69d6`).

Restart acceptance killed the worker after one completed match, restarted PostgreSQL and Redis, and let BullMQ recover job `a4b4a5cb-3441-4d7a-b517-e237bb5322bc`. All four matches/nine actual games finished normally, and the previously saved checkpoint was identical. No manual job retry was required. Real Scryfall refresh succeeded through the admin API; the API hot-loaded the cache fetched at `2026-11-06T20:34:37.052Z`, with no cache reload error or engine-source change. The log test writes over its cap and confirms truncation, expired-log removal and active-file protection. All 44 local tests, production build and lint passed. General browser acceptance passed again at 1440/768/390 px. See [operations](OPERATIONS.md).

## Pregame commander colors

A direct native probe reproduced an illegal Prismatic Piper color guess: white with an empty hand, despite a Forest outside Tymna's fixed white/black identity. The bridge now assigns legal required colors from the complete registered deck before play, with a pinned native override honoring that assignment. Five actual engine contract assertions passed for required green, an already-covered identity, Umori's companion identity, Faceless One and insufficient choices. These are setup assertions, not claimed played games.

A separate four-player game completed normally with actual Piper choice green, 30 player turns and observed placements. The checked-in structured fixture preserves that result. Final source fingerprint: `2bb8884b8702f8aa8059abb854fcf7a46ad33628288a80f6a6821dd2ec1f6ae5`. This acceptance used an isolated immutable engine home; the ongoing constructed benchmark retained its original `a6b75c4...` source and was not silently upgraded. All 45 unit tests and lint passed.

## Final all-format and 1,000-game acceptance

Six constructed formats completed 12 actual games with zero failures in the final continuation sweep. Commander (`1fc64ede-d3c4-481d-9ea3-b46482b0311b`) completed two four-player games with cancellation/resume; cEDH (`0497c6f8-0e4c-4da9-9bbc-84806c8872ac`) completed one, and Duel (`c2dd66d5-4fe5-4dba-9ac4-afafdc88eca3`) completed two. Browser format/example/validation checks passed for all nine formats. Native BO3 and sideboarding acceptance, companion choices, direct rule contracts and worker/database/Redis recovery are documented above.

The actual 1,000-game Pauper run completed **537–463–0**, with **zero timeouts and zero engine errors**, in **1,260.103 seconds (47.615 games/minute)**. Peak sampled Java high-water RSS was **936.9 MiB**, and observed CPU was a lower bound of **1,236.6 CPU-seconds**. The [benchmark evidence](benchmarks/1000-games.json) records configuration, exact seeds, source fingerprint, opponent allocation and resource qualifications. All 1,000 unique identities, seeds and fingerprints were verified after the final runtime upgrade, and the summary was unchanged. The benchmark source was retained throughout; the subsequent Commander-only pregame-color correction is verified separately.

The final source `2bb8884b8702f8aa8059abb854fcf7a46ad33628288a80f6a6821dd2ec1f6ae5` is deployed locally. Public API job `0a5ac5fe-fb7e-4b7d-a680-f16e49237a1f` completed a real ordered four-player pod using explicit pod weights with unavailable source shares, recording Piper's required green choice and four unique seats. Post-upgrade BO3 browser job `71cb9a0c-d657-451f-b87b-99ef7b930fb6` passed. Card refresh/hot reload passed at `2026-11-06T21:06:03.020Z` without changing the engine fingerprint. Reference seeding created new immutable recipe versions, and a second seed invocation made no changes. The 1,000-game result page passed 1440/768/390 px overflow and JavaScript checks. Production build, typechecking, lint and all **45** local tests passed.

Clean GitHub Compose integration at `3a6c2db` passed every step, including native games, all-format/API/browser checks, scheduled feeds, metadata refresh and worker/PostgreSQL/Redis restart acceptance: [run 42290461887](https://github.com/acocalypso/magictester/actions/runs/42290461887). Its preceding failure exposed root-owned temporary-directory permissions; `3a6c2db` fixes publication permissions. A later raw-fixture mismatch was corrected in `2c121f7`; current local unit checks pass. The subsequent engine-color integration also passed every step: [run 42292108072 at 9048309](https://github.com/acocalypso/magictester/actions/runs/42292108072). It verifies the final `2bb8884...` engine build, including the pregame-color contracts and real four-player color acceptance. Later allocation/sample-label changes passed local build/typecheck/lint/45 tests and the public API/browser acceptance described above.

## Daily sources and stable Forge updates — 6 November 2026

The live source import produced ten legal, Forge-compatible representatives for each of all nine formats (90 pool entries; Commander and cEDH share the explicitly labelled competitive population). Reported selected coverage was Pauper 69%, Standard 80%, Pioneer 64%, Modern 65%, Legacy 56%, Vintage 86%, Commander/cEDH 53.7%, and Duel 43.89%. Vintage's source window was two months; the others were two weeks. Unsupported/illegal candidate lists were excluded with recorded reasons. No deck corpus is committed.

Latest-pool acceptance passed with actual sourced opponents: `53feef70-8714-4c81-a0fa-c6d49d22b658`. It also checked immutable version pinning, changed-selection rejection and paused-source rejection. An interrupted source import cannot publish a misleading partial pool; the transport-failure regression is covered by a unit test. Engine/card-data changes trigger revalidation and expose that state in the UI.

The official stable release API reported Forge 2.0.15. `update-forge.mjs --verify-current` downloaded and checksum-verified a fresh official archive, generated release-specific card facts, compiled bridge `046a531b81c45aac063d6b16d0ac0f1920c879273a9fe46b22a9438ff57593c3`, passed 14 Duel, five match and five Commander-color native assertions, and played normal BO1, BO3, four-player Commander and Duel Commander checks before atomic activation. This exercises the real update pipeline against the current release; it does not claim compatibility with an untested future release.

Real runtime-pinning games completed on both the active build above and archived build `2bb8884b8702f8aa8059abb854fcf7a46ad33628288a80f6a6821dd2ec1f6ae5`, with matching observed identities. API acceptance passed six real games plus cancellation/resume (`9b444d9c-ec12-49ae-9d22-551e965b9999`, cancellation job `dfca8f05-16a5-4701-8359-bf8bd9a17b6c`). Metadata refresh hot-loaded successfully while preserving the active engine hash.

Browser acceptance passed at 1440, 768 and 390 pixels with two real games (`e66dde8e-bb55-4dde-a57e-dff3f01368cb`), zero uncaught/font errors, local fonts only and keyboard dialog checks. Daily-pool and opponent-allocation browser checks also passed. Production build, type checks, lint and 56 tests passed with the real cached card data and no skipped tests. Stable release discovery, official digest requirements, annotated tags, retained runtime identities, unavailable pins and stale/failed release checks have dedicated unit coverage.

## Meta deck loader failure and alternate printed names — 6 November 2026

A BO3 matrix reproduced process exits before any final result against current Pauper Affinity, Balustrade Spy, Weenie White and Elves lists. Raw Java logs identified unsupported combined face names, including `Tithing Blade // Consuming Sepulcher` and `Sagu Wildling // Roost Seek`. The source lists were legal; Forge's loader requires the front-face rules name for these transform/adventure cards.

The adapter now derives names from the requested runtime's card facts before native deck loading. Full split-card rules names are retained; unknown names remain explicit loader failures. Native loader assertions confirm that quantities, main/side/commander sections and `Fire // Ice` remain intact. Fatal process errors include the log filename and a bounded stderr excerpt.

The user's Red Rally export also uses `Thrum of the Vestige`, an alternate printed name for Lightning Bolt (confirmed through Scryfall's exact-name and FCA/40 endpoints). Bootstrap caches 587 distinct printed aliases from five Scryfall search pages. Validation resolves canonical identity before legality/copy checks, including aliases combined with the canonical card name. The original deck text remains saved; engine requests use the same card's native identity. A compact alias cache also supports older resumable jobs. No user decklist or downloaded opponent corpus is committed.

After the fix, the supplied Red Rally list completed **30 real BO3 matches, 73 games, against all ten sourced Pauper archetypes**, with sideboarding enabled and only normal terminations. The alternate printed name was normalized to its verified Lightning Bolt identity for this direct engine matrix; the original unmodified export separately passes the live validation endpoint with cached aliases. Regression coverage includes transform/adventure names, true split cards, preserved sections/quantities, pagination restrictions and canonical copy limits. The scheduled integration workflow now includes a real BO3 match against each sourced Pauper archetype.
