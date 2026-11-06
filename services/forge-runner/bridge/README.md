# Maintained engine bridge

The original Forge release JAR remains unchanged. `MagicTesterBridge.java` uses its public API for games and telemetry.

Duel Commander requires two opt-in rule overrides absent from Forge 2.0.15. BO3/companion execution also needs the following small native bug/selection fixes. `patches.json` pins the exact upstream commit, URL and SHA-256 for each source file, and exact replacements (each required to match once). Bootstrap rejects hash/match differences, compiles the patched classes into the separate bridge directory, and includes the patch manifest in the bridge source hash. No unpinned source is compiled.

- `Player.checkLoseCondition`: bypass only the 21-point commander-damage loss check when `magictester.duel=true`. Commander zone-return state-based actions, tax, color identity and ordinary life/poison/decking losses remain native.
- `StaticAbilityCantBeCast.cantBeCastAbility`: after one commander has been cast from the command zone, reject casting a different designated commander from that zone. The native per-commander tax counters supply the cast history; recasts of the selected commander and casts from other zones remain legal.

- `Player.assignCompanion`: an optional declined choice returns normally instead of dereferencing a null card.
- `ChooseCompanionAi`: honor the declared companion candidate; decline instead of substituting another eligible card. Actual selections are observed each game.
- `PlayerControllerAi.sideboard`: handle a prior rule draw with no winning player.

The Duel property is set only for `mode: duel`; all other modes retain the normal Commander rules. Duel registered players start at 20 life. `services/forge-runner/tests/DuelContracts.java` tests the actual compiled overrides separately from real-game acceptance. Contract checks are not reported as played games.

The upstream source retains its Forge Team copyright and GPL-3.0-or-later notices; see `../FORGE_LICENSE.txt`. The MagicTester bridge and patch specifications are GPL-3.0-only, compatible with that distribution. Full corresponding upstream source is available at the pinned URLs/commit in the manifest. Apply the manifest to reproduce the compiled overrides; inspect its narrow replacements before updating the pinned release.

Protocol 2 distinguishes games from first-to-two BO3 matches and streams real game observations before match completion. Game-limit matches have no winner; child rule draws remain draws. Interrupted match attempts retain audit observations, while retry rebuilds the native match from its start. No outcomes or sideboard swaps are synthesized.
