# Elves: four-player Commander game duration

Workload captured on 2026-11-07: [Elves / High Perfect Morcant](https://moxfield.com/decks/1Xc10ml5hEiqnmXGBjGYQg), versus Tymna/Kraum, Kinnan, and Rograkh/Thrasios. These are complete current tournament opponent lists, frozen with source URLs in the report. All 276 distinct cards resolved through Scryfall and were legal in Commander. Native Forge structural checks passed for all four decks.

## Preliminary desktop JVM reference

The real Android bridge and the same pinned Forge 2.0.15 overrides ran on OpenJDK 21, with a 512 MiB Java heap and a two-core CPU quota. Each game ran in a fresh process, one at a time. The ceiling was 1,800 seconds per game. Game duration excludes engine initialization.

| Seed | Game duration | Turns | Termination | Internal AI evaluation timeouts |
| --- | --- | --- | --- | --- |
| 24681357 | 7m 52.741s | 34 | normal | 18 |
| 24682366 | 2m 43.924s | 42 | normal | 0 |
| 24683375 | 1m 59.713s | 44 | normal | 0 |

Mean: **4m 12.126s**. Median: **2m 43.924s**. All three games completed normally; none reached the 30-minute ceiling. A five-minute limit would have interrupted one of these three games. Averaging only the two faster completed games would have misleadingly reported about 2m 22s.

Three games at one table are a preliminary sample. This does not establish a universal Commander duration or an average on a physical OnePlus 8T. Board complexity, AI evaluation, Android ART, heap constraints and heat can change timings substantially. The observed longest game supports allowing more than five minutes; it does not establish an adequate upper bound for every Commander game.

Machine-readable results: [desktop reference](commander-elves-desktop-reference.json). Full observed result evidence: `commander-elves-reference-evidence.jsonl.gz` (JSONL compressed with gzip). The first game also produced internal Forge AI evaluation timeout traces; these are distinct from the overall game timeout, and the game finished normally.

## Android experiment

The [opt-in Android workflow](https://github.com/acocalypso/magictester/actions/workflows/android-commander-timing.yml) runs five sequential games on Android ART with the same four frozen decklists, different seeds, and a 30-minute per-game ceiling. Instructions and limitations are in [android/benchmarks/README.md](../../android/benchmarks/README.md). Completed-game statistics exclude timeouts and errors; a timeout is an unknown completion time above the ceiling, not a completed observation.

The first Android experiment is running at [42410624314](https://github.com/acocalypso/magictester/actions/runs/42410624314). Its artifact will preserve partial observations and diagnostics if a later game fails.
