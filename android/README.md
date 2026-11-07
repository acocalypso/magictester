# MagicTester for Android

Native Kotlin / Jetpack Compose application with Forge running **on Android ART** in a disposable `:forge` process. There is no analysis server, Docker, Node, desktop Java runtime, WebView UI, telemetry, or downloaded font.

## Build

Install JDK 21, Python 3, Android command-line tools and platform `android-37.2`, build-tools `36.0.0`, and accept the Android SDK licenses. Set `ANDROID_HOME` and `JAVA_HOME`.

```sh
cd android
./gradlew assembleDebug
./gradlew testDebugUnitTest lintDebug
./gradlew connectedDebugAndroidTest
```

Windows uses `gradlew.bat`. Python must be callable as `python3` (or adjust the `prepareForge` command for your environment). The wrapper pins Gradle 9.9.0 and verifies its distribution checksum. The test harness pins AndroidX Test 1.8/1.4 and Espresso 3.8 alpha fixes for Android 17's removed input-injection API; these are test-only dependencies and are not shipped in the app. AGP 9.5.1 supplies Kotlin support; do not also apply `org.jetbrains.kotlin.android`.

The engine preparation task downloads the SHA-256-pinned official Forge archive and source overrides. It compiles the real engine bridge for Java 17 and packages its dex-compatible classes plus headless resources. Fonts, pictures, adventure assets and desktop GUI backends are not needed by the headless adapter. The APK contains engine data, so setup itself works offline. Imports, initial/current legality checks, metagame refreshes, and release checks require internet access.

Install `app/build/outputs/apk/debug/app-debug.apk` for development. Debug and production signatures differ; Android cannot upgrade a production installation with a debug APK without uninstalling it and losing private app data.

## First use

1. Open Setup and choose **Set up local engine**. The assistant checks bundled data against its checksum, extracts it with real byte progress, and initializes Forge. Failed/cancelled extraction is retried safely.
2. Choose a format under Test. Paste a list, open a text file, or import a public Moxfield/Archidekt link. An imported commander's section is retained, including legal commander pairs.
3. Add opponents under Pools. Refresh the public metagame, paste/import your own opponents, or use the explicitly labeled local reference list. Select the decks to face.
4. Check the deck and queue an analysis. Runs shows progress, both sides' complete frozen decklists, each attempt, game actions, and an export button.

```text
Commander
1 Ravos, Soultender
1 Tymna the Weaver

Deck
…98 cards…
```

A companion goes under `Companion`; it lives outside the starting deck. Sideboard cards count toward constructed sideboard and copy limits. Commander formats do not have ordinary sideboards. Printing suffixes such as `(C16) 41` are accepted.

## Engine and format compatibility

The port retains the desktop bridge's game/result/action schema, seeded games, London mulligans, native multiplayer Commander, Duel Commander (20 life, no commander-damage elimination), BO3 sideboarding, companion selections, wild-color commander choices, recorded placements and structured action evidence. The UI offers Standard, Pioneer, Modern, Pauper, Legacy, Vintage, Commander, cEDH and Duel Commander. cEDH uses Commander rules and a competitive opponent sample.

Scryfall legality is fetched in batches and cached daily. Forge independently checks card scripts and deck conformance, including pairing and combined color identity. A card that is legal but unsupported by the bundled Forge release is rejected explicitly. An AI simulation cannot establish how a human player will perform.

Android 8.0 / API 26 is the declared minimum; the CI emulator matrix defines tested versions. The Forge engine is managed Java/Kotlin without engine JNI. The universal APK includes AndroidX graphics helpers for ARM64, ARMv7, x86 and x86_64; their ELF load segments and APK entries use 16 KiB alignment. Actual deck coverage depends on Forge's card scripts, AI decisions, available memory, and test evidence; an SDK minimum is not a claim that every device and every card combination has passed acceptance.

### Resource and recovery policy

A pool of up to four isolated Forge processes runs independent matches. The saved performance setting is shared across queued analyses; each BO3 match keeps its games sequential. Each match checks free RAM and thermal state. Devices must allow a large heap of at least 384 MiB and have more than 350 MiB currently available. Android and device manufacturers may stop work under memory/battery pressure. A visible foreground-service notification and a bounded wake lock support user-started long runs.

Evidence is committed to private app storage after every match. Unfinished work can be resumed after cancellation, failure or process loss, with a 5–300 second per-game timeout. Completed matches keep their original evidence; failed attempts remain visible. A timeout or engine error never becomes an invented loss. Completed jobs are not silently rerun after an engine update.

### Opponent sampling and freshness

The phone schedules an all-format metagame refresh every 24 hours. Android may defer network jobs. The UI shows the actual fetched date; source failure preserves the previous complete snapshot. MTGTop8 access observes robots restrictions and a crawl delay. Public source access may be unavailable or change; custom text/imported pools remain usable. Commander tournament samples represent competitive play, not casual pods.

Selected opponents rotate equally. Source shares are shown as context; results are not presented as a weighted estimate of the entire format. Each run freezes opponent text, format, seed, timeout, engine version and legality-check provenance.

### Forge updates

The app checks GitHub's latest **stable** Forge release hourly when online. A successful check can be used offline for at most 26 hours. New games stop if a newer stable release exists. Compiled engine code must be delivered in a signed app update; the app does not execute downloaded desktop JARs. Updating the pinned release requires reviewing patches, passing real Android engine acceptance and publishing a matching APK. Failed patch/checksum checks stop the build. A separate daily GitHub workflow audits the pin against the latest stable release and fails with an explicit upgrade instruction when it changes.

## Production releases

The Android workflow builds the app, runs JVM and real emulator checks, and can publish `android-vX.Y.Z` releases. Push a release tag, or run the workflow manually with **publish_debug** checked and a validated **release_tag**. Publication waits for all three emulator suites. Production APK signing uses these repository secrets:

- `ANDROID_KEYSTORE_BASE64`: base64 of a dedicated PKCS#12/JKS release keystore.
- `ANDROID_KEYSTORE_PASSWORD`: keystore password.
- `ANDROID_KEY_ALIAS`: persistent signing alias.
- `ANDROID_KEY_PASSWORD`: private-key password.

Preserve an offline backup of this keystore. Every upgrade must use the same signing identity. Signing material must never be committed, printed in logs or uploaded as an artifact. Without production signing secrets, the workflow publishes the tested debug APK as a clearly labeled prerelease. Debug keys may change between CI builds; export results before reinstalling if an update cannot be installed. Tags are validated; APK version codes are derived monotonically from the semantic version. Release artifacts include APK SHA-256 checksums and certificate verification.

## Privacy and licensing

Decks/jobs/evidence remain in private app storage, with user-selected JSON export through Android's document picker. Public deck imports contact their respective hosts; Scryfall receives card names for legality checks, MTGTop8 serves public opponent data, and GitHub serves version information. Uninstalling clears private app data; export evidence first.

MagicTester and its Forge integration are GPL-3.0-only. See [LICENSE](LICENSE), the pinned source manifests under `engine/`, the repository source at the corresponding release tag, and the upstream/third-party notices embedded in the engine JAR/APK. Magic: The Gathering is owned by Wizards of the Coast; this project is independent.

## Diagnostic log export

Choose **Setup → Export diagnostic logs** for startup/setup/recent-run troubleshooting, or **Runs → select a run → Export diagnostic logs** for one analysis. Choose a destination in Android's document picker. Export remains available while setup or a simulation is running.

The ZIP opens with `README.txt` and `summary.txt`, followed by a chronological timeline, full error traces, Forge stdout/stderr, thread stacks captured on timeouts, Android process-exit reasons where supported, current device/resource details, engine version/checksums and recent attempt evidence. Normal engine process cleanup is explicitly labeled, so its expected signal exit can be distinguished from failures. Logcat collection is best effort and limited to what Android permits this app to read.

Complete decklists are excluded by default and can be included in the export dialog. Error messages and game actions may still contain card names. No device serial number, Android ID or account credentials are requested. Logs remain in private app storage until exported; streams are capped at 2 MiB, with a seven-day/24 MiB retention budget. The timeline includes the last 5,000 matching events. Export limits and omitted files are listed in `omissions.txt`. Full results can be exported separately.

New app crashes are recorded before the normal Android crash handler runs. Android 11+ can also report historical crashes, low-memory kills and other exit reasons. A new installation cannot recover private diagnostic files removed by uninstalling an older debug build.

### Live game timing

Runs and run details show the current game's elapsed time, timeout budget and remaining time. The clock starts on Forge's actual game-start event and resets between BO3 games. Initialization has its own status and does not advance the game clock. Timing uses Android's monotonic clock, survives backgrounding, and stops on completion/cancellation/failure. The visible counter updates once per second; five-second service checkpoints preserve a labeled last-known time after interruption. The database upgrade preserves existing run history. Timing is included in diagnostic exports.

## Delete runs and measure parallel capacity

Delete an analysis from its card in **Runs**, or from its detail screen. Deletion stops its engines and removes its stored decklists/results. Late engine responses cannot recreate a deleted run. Mixed app diagnostic events retain their normal rolling retention policy.

Under **Setup → Performance & parallel games**, choose a quick Pauper reference workload or your current deck/opponent selection, then run the device performance test. It is queued behind current analyses and uses real Forge games. Each level runs two games per process, with a start barrier that verifies actual overlap. The report records throughput, elapsed time, peak per-process PSS, lowest available memory, distinct process IDs and the maximum number of overlapping games. Failed/time-out games are not counted as successful measurements.

**Auto** chooses the fastest validated level with a meaningful throughput improvement. The manual slider allows a level up to the highest stable result for that workload. Constructed and Commander table sizes have separate profiles; a quick constructed result does not unlock unmeasured Commander parallelism. Profiles are invalidated when the engine/build identity changes. CPU, free-memory reservations and thermal checks are applied before every process lease, so a busy or hot phone can run fewer games than the selected limit. Settings take effect at the next group of matches. The current implementation caps the pool at four engines and reserves CPU/memory for Android and the interface.

Benchmark results describe the chosen deck workload on this device at the measured time. Card interactions and other apps can change performance; rerun the benchmark for representative Commander decks. All concurrent games keep independent live clocks and saved evidence.

Phone Back navigation returns from observed actions to the same match evidence position, then the analysis list and previous tab. Decklist/confirmation dialogs close before leaving the underlying screen.

Daily metagame refreshes target ten complete decks per format, ordered by source share. Unreadable archetypes are skipped while the importer continues down the ranking. Older six-deck caches are refreshed even inside the daily cache window. The pool screen displays the imported count and explicitly flags a source shortage.

## Updates and restoring older installations

Debug builds from 0.1.3 onward use the fixed, public development certificate described in [signing/README.md](signing/README.md). CI pins that certificate and tests an older-version APK → current APK upgrade while checking that private app data survives. Production signing remains separate.

The 0.1.0–0.1.2 CI builds used ephemeral keys that were not retained. Android cannot update those installations to a different certificate. Before uninstalling one of those versions, export each analysis through **Runs → select run → Export results and game evidence** and verify the JSON files are saved outside the app. You can also export diagnostic ZIPs for troubleshooting; they are not a complete history backup. After the one-time reinstall, use **Setup → Import exported analyses** to select one or more saved JSON files. The importer preserves decklists, opponents and recorded game actions, uses new run IDs, and does not start simulations. Exports captured while queued/running return as interrupted. An empty draft is populated from the imported settings. Setup/metadata caches and global preferences are not part of the old analysis export. Each input is limited to 32 MiB; up to 100 files can be selected together.

Two-faced card names imported from deck hosts retain both official face names. Current legality uses Scryfall's front-face collection identifier and verifies the returned whole-card name before caching its complete legality information. A different or misspelled back face is rejected.

### Resource-admission diagnostics

Setup shows live available/physical memory, Android's memory-pressure flag and threshold, per-process heap capacity and thermal status. Advisory low-memory or severe thermal status limits work to one process rather than blocking initial setup. Critical thermal status still blocks startup. A first constructed/setup process budgets at least 384 MiB plus 128 MiB headroom; measured workload budgets can be higher. Additional parallel processes retain the larger system-memory reserve and account for pending allocations. Startup errors state the actual condition and available/required memory. Diagnostics include these readings and admission decisions. RAM expansion is not counted as additional physical RAM.

Benchmark cancellation logs record the resource snapshot and retain the original stop reason. A one-process baseline continues under advisory low-memory/severe-thermal reports while actual free RAM is sufficient; critical thermal status or less than 128 MiB available stops it. Parallel stages stop under advisory pressure and retain already validated lower levels. This prevents a monitor cancellation from being misreported as an unexplained engine/memory failure.

## Saved deck library

In **Test**, enter a deck name, choose its format and paste/import its list, then choose **Save deck**. Saving is local and does not require Forge setup, an internet connection or a successful legality check. Use **Saved decks** to load, rename or delete a saved copy. Loading restores the format, complete text (including commander, companion and sideboard sections) and source link. A dirty draft requires confirmation before replacement. **Update saved deck** modifies the loaded copy; **Save as new** creates a separate named copy. Names are unique within each format. Deleting a library entry keeps the current draft and existing analyses, which already have their own frozen lists.

The library uses private SQLite storage and survives app restarts and compatible app updates. Listing reads only metadata; full card text is loaded on demand. As with other private app data, uninstalling removes the library.
