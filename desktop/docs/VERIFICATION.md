# Desktop verification

Verified locally on Linux x64 on 7 November 2026. Windows checks run on the Windows 2022 GitHub runner; a successful Linux build alone does not establish Windows compatibility.

## Local results

- Native .NET 10 / Avalonia 12.1.5 compilation: zero errors and zero warnings.
- Genuine Skia headless rendering of the native window and asynchronous clean shutdown: passed. The build workflow retains a screenshot.
- C# executable → private Node worker → SQLite initialization/command handshake: passed with all nine formats. No HTTP listener, PostgreSQL or Redis is involved.
- Engine contracts: all 84 passed against real cached card data, without skips, including persistence, frozen inputs, resource admission, runtime activation failure, checkpoints, deck rules and game history. On an empty cache, metadata-dependent tests skip explicitly.
- Real native-worker acceptance with the Docker services stopped: four Pauper games completed normally with saved action histories. A separate 240-second retry preserved the original results, was cancelled, resumed with the same identifier and completed.
- Real BO3 acceptance: two Modern matches completed with five actual games and inspectable observed-game evidence.
- Real multiplayer acceptance: one four-player Commander game completed normally with recorded actions and an actual fourth-place finish.
- Packaged Linux executable with bundled Node and linked Java: verified Forge staging, all native contracts, real games, action histories, process-tree cancellation and same-ID resume passed.
- Complete self-contained Linux packaging: passed, including the bundled executable, Node, linked Java runtime and Java compiler checks. The initial compressed archive was approximately 169 MB; final sizes vary with runtime updates.

These game outcomes are integration checks, not statistical claims about deck strength. Contracts using fixtures do not count as real simulated games.

## Release gates

The desktop workflow compiles and packages on both Windows x64 and Linux x64. Each target runs engine contracts, a bundled-worker handshake and a native UI render/shutdown check. Desktop release tags additionally run the packaged application with `--engine-check`: initial verified Forge setup, native Java contracts, actual games, action-history checks, cancellation and checkpoint resume. The release job depends on both platform jobs succeeding.

The release packages contain their runtime source URLs/checksums and SHA-256 archive files. Packaging does not sign executables. First setup and daily source refresh require network access; playing against downloaded pools uses local Forge processes.

Packaging collects license and component notices from all resolved NuGet dependencies and .NET runtime packs. A local audit verified 29 package entries, including complete Avalonia/MicroCom/D-Bus MIT grants and .NET's third-party notices. Node, npm dependencies and linked Java retain their own notice files.

## Efficiency and scope

The UI is native, with no browser engine. One long-lived private worker uses SQLite WAL transactions. Queue polling reads cached counters and compact summaries; action histories are fetched in pages of 100 entries. Forge jobs share a CPU/RAM admission budget instead of starting an unbounded JVM per request. Closing the application drains child processes and saves unfinished work for recovery.

The shared development machine also held SDK/build caches, so its timings are not a performance benchmark. Release defaults use a 1 GB heap and two CPUs per JVM, reserve memory for the OS and calculate the process cap from detected CPU/memory resources. Parallelism and timeout settings do not guarantee a complex Commander game finishes.

Windows 10/11 x64 and graphical Linux x64 are the supported package targets. No ARM, macOS, installer integration or code signing is claimed. No claim of bit-for-bit reproducible builds is made: official stable Java and Forge updates are intentionally discovered and verified at build/setup time.
