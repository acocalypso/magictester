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

One Forge process runs at a time, shared across queued analyses. Each match checks free RAM and thermal state. Devices must allow a large heap of at least 384 MiB and have more than 350 MiB currently available. Android and device manufacturers may stop work under memory/battery pressure. A visible foreground-service notification and a bounded wake lock support user-started long runs.

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
