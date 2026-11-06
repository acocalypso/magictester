# Maintained engine bridge

The original Forge release JAR remains unchanged. `MagicTesterBridge.java` uses its public API for games and telemetry.

Duel Commander requires two opt-in overrides absent from Forge 2.0.15. `patches.json` pins the exact upstream commit, URL and SHA-256 for each source file, and one exact replacement per file. Bootstrap rejects hash/match differences, compiles the patched classes into the separate bridge directory, and includes the patch manifest in the bridge source hash. No unpinned source is compiled.

- `Player.checkLoseCondition`: bypass only the 21-point commander-damage loss check when `magictester.duel=true`. Commander zone-return state-based actions, tax, color identity and ordinary life/poison/decking losses remain native.
- `StaticAbilityCantBeCast.cantBeCastAbility`: after one commander has been cast from the command zone, reject casting a different designated commander from that zone. The native per-commander tax counters supply the cast history; recasts of the selected commander and casts from other zones remain legal.

The property is set by the bridge only for `mode: duel`; all other modes execute the upstream branches. Duel registered players start at 20 life. `services/forge-runner/tests/DuelContracts.java` tests the actual compiled overrides separately from real-game acceptance. Contract checks are not reported as played games.

The upstream source retains its Forge Team copyright and GPL-3.0-or-later notices; see `../FORGE_LICENSE.txt`. The MagicTester bridge and patch specifications are GPL-3.0-only, compatible with that distribution. Full corresponding upstream source is available at the pinned URLs/commit in the manifest. Apply the manifest to reproduce the compiled overrides; inspect its narrow replacements before updating the pinned release.
