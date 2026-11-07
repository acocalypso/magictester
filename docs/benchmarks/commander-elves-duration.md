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

The [Android experiment completed successfully](https://github.com/acocalypso/magictester/actions/runs/42410624314), recording five real attempts. Workflow success means the experiment collected its observations; it does not mean every game finished. The actual Android 15 emulator reported four CPU cores, 5,930 MiB physical memory and a 576 MiB large-heap class. The measurement used a debug instrumentation build and is not a measurement on a physical OnePlus 8T.

| Seed | Observed game time | Termination | Finished turns |
| --- | --- | --- | --- |
| 24681357 | 30m | timeout | unknown; action evidence reaches turn 31 |
| 24682366 | 25m 7.830s | normal | 42 |
| 24683375 | 16m 47.887s | normal | 44 |
| 24684384 | 30m | timeout | unknown; action evidence reaches turn 28 |
| 24685393 | 16m 30.540s | normal | 45 |

**Three completed, two timed out.** Completed-only mean: **19m 28.752s**; median: **16m 47.887s**; longest completed: **25m 7.830s**. The overall completion-time average is unknown because the two timeout completion times are unknown. If all five would eventually complete, their overall mean exceeds **23m 41.251s**. A five-minute limit would interrupt every observed Android attempt. These are five seeds at one table, not a general Commander or phone-performance distribution.

Resources recorded at game boundaries showed over 4,500 MiB available, low-memory false and thermal status 0. Those are boundary observations, not continuous peak measurements. The retained engine logs contain internal AI evaluation timeout traces and no `OutOfMemoryError` string; this is not proof that all performance bottlenecks have been identified. Profiling engine evaluation, allocation and runtime compilation is the next diagnostic step.

The matched desktop/Android completed seeds 24682366 and 24683375 have matching winner, final turn count and recorded action count; Android game times were about 9.2 and 8.4 times the corresponding desktop reference times. Different runtime, compilation and hardware conditions prevent attributing the difference to one cause without controlled profiling.

Machine-readable [Android observations](commander-elves-android.json) and `commander-elves-android-evidence.jsonl.gz` retain outcomes and observed action evidence. The workflow artifact also includes engine traces and logcat. Every completed action history is marked complete; the timed-out histories are explicitly incomplete. The instrumentation app version is 0.1.0 because this was a development experiment, with source and engine provenance recorded in the JSON.

