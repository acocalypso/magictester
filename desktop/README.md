# MagicTester Desktop

A standalone Windows and Linux application for real Forge deck simulations. The native interface is C# on **.NET 10 LTS and Avalonia 12.1.5**. A bundled Node 24 worker runs the independently included TypeScript domain and engine code. SQLite replaces PostgreSQL and Redis. There is no browser, web server, Docker requirement or cloud account.

## Run a release

Download the package matching your operating system from the repository’s desktop release. Extract the entire folder; run `MagicTester.exe` on Windows or `./MagicTester` on Linux. The .NET runtime, Node runtime and compiler-enabled Java 21 runtime are included. Keep the `engine` and `tools` folders beside the executable.

Use a machine with at least 4 GB RAM; 6–8 GB is recommended for Forge and concurrent analyses.

On first launch, open **Setup & information → Download / update and validate Forge**. This downloads a checksummed stable Forge release and Scryfall card data and plays real validation games before activating the build. Internet and approximately 4–6 GB free space are needed for the initial download, installation and caches. No game results are fabricated.

Linux requires a graphical desktop with X11/XWayland, glibc, OpenSSL 3, ICU, fontconfig, FreeType, libX11/libICE/libSM and working graphics libraries. Ubuntu 22.04/24.04 and comparable x64 distributions are the build targets. This is a portable application folder, not a Linux container. Windows 10/11 x64 is supported. ARM and macOS packages are not currently produced. Releases are unsigned; the workflow does not claim code signing.

## What is local

- Nine formats: Standard, Pioneer, Modern, Pauper, Legacy, Vintage, Commander, cEDH and Duel Commander.
- Card/commander/companion and format validation; local deck files and public Moxfield/Archidekt links.
- Immutable imported/reference/daily meta pools; reported shares, selected opponents, custom weights and explicit ordered Commander pods.
- Real BO1 and native BO3 with actual sideboard changes. Commander uses four players, Duel two.
- Parallel analyses and match batches bounded by allocated CPUs and available RAM. Sequential games inside a BO3 retain match state.
- SQLite WAL checkpoints with transactional progress counters, restart recovery, cancellation, same-settings resume and separate retries with 5–300 second clocks. Commander defaults to 300 seconds.
- Results, Wilson intervals, per-opponent rates, actual placements/casts, saved starting decklists, recorded games and paginated action histories including earlier attempts.
- JSON/CSV results export and pool import; daily meta refresh and hourly stable Forge checks and daily card-metadata refresh while idle. Missed refreshes resume on launch. Source robots rules, request spacing and retry/backoff are retained.
- Local system fonts only. No Google Fonts or remote typography requests.

The shared core is checked into `engine/core` with its upstream source hashes. It is independent of the parent application at build/run time. It reuses tested game rules instead of reimplementing them in a second language. Desktop-specific Windows process-tree/classpath changes and SQLite HTTP caching are documented in `engine/core/UPSTREAM.json`.

## Build from this folder

Install **.NET SDK 10.0.403**, Node **24.22.1** and npm. Java is not needed just to compile the UI. The complete packaging command downloads and verifies Node/Temurin distributions. It uses jlink to retain all Java modules, including the compiler, while removing build-only jmods, source archives, debug symbols and manuals from the delivered image.

```sh
cd desktop
node scripts/build.mjs --rid linux-x64 --version 0.1.0
# On Windows:
node scripts/build.mjs --rid win-x64 --version 0.1.0
```

Build each target on its matching operating system. Output is under `artifacts/`, including SHA-256 files. The packager performs a private-worker handshake using the packaged executable and bundled Node runtime before archiving.

For a development UI:

```sh
cd desktop/engine
npm ci
npm run build
npm test
cd ..
# Set these to absolute paths on your machine:
export MAGICTESTER_ENGINE="$PWD/engine/dist/worker.mjs"
export MAGICTESTER_NODE="$(command -v node)"
dotnet run --project MagicTester.Desktop
```

Development setup needs Java 21 JDK on PATH. Release packages supply the compiler-enabled Java runtime and a native C# streaming archive extractor. They do not need an external archive utility. Running the raw worker bootstrap without the desktop host still uses system tar. First setup verifies every downloaded Forge archive and pinned patch source hash. A release can be tested without downloading Forge using `MagicTester --worker-check`.

## Storage and operation

Per-user state is in `%LOCALAPPDATA%\MagicTester` on Windows and the .NET local application data directory (`~/.local/share/MagicTester`) on Linux. `desktop.sqlite` holds jobs, inputs, pools, histories and HTTP cache. `forge/` holds retained immutable engine builds and metadata; `logs/` holds bounded diagnostic logs; `setup.log` records the latest download/compile stages. Back up the complete directory with the application closed. Updating the application folder does not replace user data.

Only one worker can own a data directory. Closing the UI drains/cancels running processes and preserves unfinished checkpoints for next launch. An unfinished BO3 restarts from its first game; completed matches and prior observed games remain. Retry with a different clock creates a new run; it does not alter earlier results or their recorded actions. No CPU or memory limit can guarantee that every complex Forge game finishes before the clock.

Daily metagames are fetched only when the app is running and source access is available. The last good pool remains with its source date when refresh fails. Commander sourcing is the competitive cEDH population, not an exhaustive casual Commander field. A stable-version check must be less than 26 hours old before a new analysis starts. Engine upgrades activate only after native contract and played-game validation. Already queued runs retain their original engine pin and frozen opponents.

## Verification and releases

`dotnet run --project MagicTester.Desktop.Checks` runs the native headless renderer and clean-close check. `engine/tests/native-smoke.mjs` requires an actual Forge/card cache and tests real games, histories, cancellation and retry. See `docs/VERIFICATION.md` for measured results and limitations.

`.github/workflows/desktop.yml` builds and checks Windows/Linux packages. Tags `desktop-vX.Y.Z` produce GitHub releases containing both archives, checksums and the corresponding source tag. Ordinary desktop changes produce workflow artifacts without publishing a release. No signing keys or service credentials are embedded.
