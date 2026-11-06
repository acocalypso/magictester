# Forge integration

## Verified upstream baseline

- Release: `forge-2.0.15`.
- Tag's commit: `4ec5f1a2c32fa90ecb983a72b9eb47aa5c5d7676`.
- Archive: `forge-installer-2.0.15.tar.bz2`, SHA-256 `4468f182b60f6ca62d89697baa208981085af744f116781af751c611826db600`.
- Runtime banner: `Forge v.2.0.15-SNAPSHOT-09.28`.
- Packaged `build.txt`: `2026-09-28 22:22:04`.
- Source: [SimulateMatch.java at the release](https://github.com/Card-Forge/forge/blob/forge-2.0.15/forge-gui-desktop/src/main/java/forge/view/SimulateMatch.java).
- AI documentation: [current upstream](https://github.com/Card-Forge/forge/blob/master/docs/AI.md), captured in [UPSTREAM_AI.md](UPSTREAM_AI.md).

The archive name and runtime snapshot banner differ; results preserve both the release identifier and packaged build timestamp. No Forge code is modified or embedded in the application.

## Actual invocation

```sh
java -Xmx1024m -Djava.awt.headless=true -Dfile.encoding=UTF-8 \
  -jar forge-gui-desktop-2.0.15-jar-with-dependencies.jar \
  sim -D /generated/private/directory -d player-0.dck player-1.dck \
  -n 25 -s 12345 -c 30 -f constructed
```

`-D` selects the directory and `-d` receives filenames. Passing an absolute path to `-d` alone does not work in this version because Forge concatenates its deck base directory. `-s` is implemented in the release source and command help even though the AI guide omits it. `-q` omits the turns needed by this adapter, so the runner retains full game logs.

CLI format `constructed` specifies game rules, not legality. Pauper legality is validated by the application before queueing. Commander uses `-f commander` and `RegisteredPlayer.forCommander`; documented multiplayer support is source-verified, but this release of MagicTester does not expose or claim runtime-verified Commander benchmarks.

## Result parsing

Actual stdout fixture: `services/forge-runner/fixtures/real-game.log`, captured from a Linux Docker game.

- `Turn: Turn 1 (Ai(N)-...)`: observed starting player.
- `Game Outcome: Turn N`: Forge's reported end round.
- `Game Result: Game N ended in ... ms. Ai(N)-... has won!`: winner and in-game duration.
- `Game Result: Game N ended in a Draw! Took ... ms.`: draw.
- `Stopping slow match as draw`: timeout overrides any later apparent winner.

The native clock can produce a winner-looking result after timeout; timeout wins are deliberately discarded. A nonzero exit, missing final results or exception output is an engine error. An external deadline also covers JVM/database startup and hangs outside the native clock. Child processes are killed as a process group, with a forced kill fallback.

A seed initializes `MyRandom` for a batch, not a fresh independent RNG for each game. Store the batch seed together with `batchIndex`. Exact deterministic replay is not promised: Forge initializes some state before applying the seed and may use multiple internal threads.

## Updating

Choose a release, inspect its license and `SimulateMatch.java`, update URL/checksum/JAR/build identity together, refresh the supported-card index and run the parser tests, real-game spike, timeout/cancellation tests and Compose smoke. Preserve old results and engine versions. Do not silently replace historical engine or opponent metadata.
