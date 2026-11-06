# Forge integration

## Verified upstream baseline

- Release: `forge-2.0.15`.
- Tag's commit: `4ec5f1a2c32fa90ecb983a72b9eb47aa5c5d7676`.
- Archive: `forge-installer-2.0.15.tar.bz2`, SHA-256 `4468f182b60f6ca62d89697baa208981085af744f116781af751c611826db600`.
- Runtime banner: `Forge v.2.0.15-SNAPSHOT-09.28`.
- Packaged `build.txt`: `2026-09-28 22:22:04`.
- Source: [SimulateMatch.java at the release](https://github.com/Card-Forge/forge/blob/forge-2.0.15/forge-gui-desktop/src/main/java/forge/view/SimulateMatch.java).
- AI documentation: [current upstream](https://github.com/Card-Forge/forge/blob/master/docs/AI.md), captured in [UPSTREAM_AI.md](UPSTREAM_AI.md).

The archive name and runtime snapshot banner differ; results preserve both the release identifier and packaged build timestamp. The downloaded Forge archive remains intact; the application and bridge are GPL-3.0-only.

## Structured bridge

Production now invokes the maintained `services/forge-runner/bridge/MagicTesterBridge.java` through the pinned release's public engine API. Bootstrap compiles it with the full JDK against the exact release JAR; runtime uses a JRE. The JAR is unchanged. Pinned separately compiled overrides are documented in `services/forge-runner/bridge/README.md` and pinned by source URL/SHA-256 plus exact replacements in `patches.json`. Two Duel-only replacements disable commander-damage loss and lock other designated commanders after the first command-zone cast. Additional small guards permit declining optional companions, honor the declared candidate, and avoid a missing-winner exception during sideboarding after a draw, and honor deck-required pregame wild-color choices. All normal Commander zone-return/tax behavior remains enabled; other modes execute the original branches. Bootstrap rejects changed upstream source or ambiguous patches and includes the manifest in the bridge source hash.

```sh
java -Xmx1024m -Djava.awt.headless=true -Dfile.encoding=UTF-8 \
  -cp /data/forge/magictester-bridge:/data/forge/forge-gui-desktop-2.0.15-jar-with-dependencies.jar \
  MagicTesterBridge /generated/private/directory/request.json
```

The private JSON request gives deck filenames, mode, batch seed, first game index, game count and clock seconds. Constructed uses `GameType.Constructed`; Commander uses `RegisteredPlayer.forCommander` and 40 starting life. Duel retains native Commander rules with 20 life, the two opt-in overrides, and the normal two-player London mulligan (no free first mulligan). Each BO1 creates a fresh Match; no sideboarding across independent games is implied. BO3 sets native games-per-match to three (first to two wins), retains the Match across games, and explicitly enables/disables native AI sideboarding. Actual drawn games do not count as wins, and a separate resource limit can leave the match incomplete.

Lines prefixed `@@MAGICTESTER ` carry schema-checked JSON. Native logs are retained for auditing, but their prose is not the production source of winners or measurements. Protocol 2 emits `game_started`, `match_game` observations and final `result` events. BO3 final results have `unit: match` and actual child games; BO1 results retain `unit: game`. Game results include the engine/bridge version, bridge source SHA-256, batch/game seeds, observed starter/life totals, actual individual player turns, duration, termination, commander casts and elimination groups. The original native-parser fixtures/tests remain for historical data and timeout-regression documentation.

`GameEventGameStarted` supplies the observed first player. `GameEventSpellAbilityCast` supplies real commander casts, caster, origin zone, global turn and caster's own turn. A small `Game` subclass observes `onPlayerLost` before removals. Forge marks the complete simultaneous-loss group before calling that hook; all members receive the same competition placement. An alternate win eliminating three remaining opponents gives those opponents tied second place. Draws, timeouts and engine errors have no winner/placements.

The game clock wraps the actual `Match.startGame` call. On timeout/error the bridge emits that game's result and exits its JVM with code 75. The adapter starts a clean JVM at the next game index, preserving completed results. An external 90-second startup deadline and clock-plus-five-second per-game watchdog kill hung process groups with SIGTERM/SIGKILL. A timed-out engine thread is never reused for another game. Normal game logs are emitted after completion; timeout results retain observed cast/elimination evidence without concurrently traversing the engine's mutable log.

Each unit gets `(batchSeed + batchIndex * 1009) modulo 2147483647`. A BO3 child game gets `(unitSeed + gameIndex * 307) modulo 2147483647`; BO1 uses its unit seed. `MyRandom` is explicitly reset before actual game preparation. Independent BO1 recovery no longer depends on replaying the prior game's RNG consumption. Exact deterministic replay across engine builds or concurrent internals remains unpromised. Jobs retain their bridge source hash; workers reject a different bridge hash rather than mixing results. Jobs submitted before this result/seed contract require resubmission.

## Historical CLI baseline

The initial spike used `java -jar ... sim -D directory -d player-0.dck player-1.dck -n N -s seed -c seconds -f constructed`. `-D` supplies the directory, and `-d` filenames. `-q` omits the turn log. Its `Game Outcome: Turn` value is an end round rather than individual player turns. Native clock expiry can print an apparent win and interruption trace; the preserved legacy parser gives explicit clock expiry precedence over both. These historical measurements are not silently reinterpreted as bridge measurements.

## Updating

Choose a release, inspect its license and `SimulateMatch.java`, update URL/checksum/JAR/build identity together, refresh the supported-card index and run the parser tests, real-game spike, timeout/cancellation tests and Compose smoke. Preserve old results and engine versions. Do not silently replace historical engine or opponent metadata.

Recovery can request sorted absolute unit indices; seeds retain their original indices. Compiled classes live in immutable source-hash directories captured by each runner request. Actual wild-commander color choices appear in `commanderColors`; required colors include a declared companion’s identity. See the bridge README for the exact pinned native replacements.
