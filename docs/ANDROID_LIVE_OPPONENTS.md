# Live opponent names · Android 0.1.13

The Runs list and analysis detail show the opponent deck under each live match's
game number. Multiplayer Commander lists each opposing seat. Parallel matches
retain separate names and clocks. Preparation/progress messages and the ongoing
notification also identify the matchup.

Names come from the saved opponent pool using the same match-index/seat schedule
as `SimulationRequest`. They do not use the number of finished matches, the game
number within a best-of-three, or the latest downloaded metadata. Retries and
existing runs therefore keep their original assignments. Missing old metadata is
labelled as unavailable rather than inventing a deck. Long names wrap, and all
text uses the existing local fonts.

## Verified release

[Android 0.1.13](https://github.com/acocalypso/magictester/releases/tag/android-v0.1.13)
was published from `2cf7d78`.
[Release workflow](https://github.com/acocalypso/magictester/actions/runs/42531252064)
passed 26 JVM tests, lint, shared/native AI checks and 64 Android tests (8 UI +
56 engine/runtime) on each of API 26, 35 and 37.2. New checks cover frozen seat
assignments across format families and match-pool wrapping, plus two parallel
matches at indices 47/48 in both the Runs list and analysis detail. Existing
timeout/retry, chart, navigation and in-place upgrade/data retention tests passed.
Coverage is on emulators; no physical OnePlus testing is claimed.

The downloaded published APK was independently verified:

- Version: 0.1.13 / code 114.
- APK SHA-256: `7581f8c1ddd240181445ed0629926311d4050dcefacb0f6b949bc0ca8d45c1af`.
- Signing certificate SHA-256: `a12aa61ccbe6ceb0973da544ce5b09dc07a50306afe8338ca61c356fe5f68f07` (persistent debug identity).
- Engine JAR SHA-256: `137d5a8948620a7c2ebd7d9908f61b08e2d0be2e4f999dea49102c033ec60466` (unchanged Forge 2.0.15 / Strategic AI strategy-1).
