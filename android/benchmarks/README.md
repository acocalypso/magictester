# Four-player Commander duration experiment

Run **Actions → Android · Commander game duration → Run workflow**. The default is five sequential games with different reproducible seeds and a 1,800-second diagnostic ceiling per game. This is an opt-in experiment, separate from the short release acceptance suite. One isolated Forge process runs at a time, so parallel games do not distort the measurement.

The frozen workload is in `app/src/androidTest/assets/commander-timing.json`: the user's [Elves / High Perfect Morcant deck](https://moxfield.com/decks/1Xc10ml5hEiqnmXGBjGYQg), against Tymna/Kraum, Kinnan, and Rograkh/Thrasios. Opponents were fetched from the competitive Commander tournament pool; each complete deck retains its source URL and the snapshot date. This is a particular competitive table, not a sample of all Commander decks or casual play.

The workflow runs the actual Android integration on an Android 15 x86_64 emulator. It saves `android-commander-duration` even when a trial fails:

- `commander-duration.json`: device/resources, exact lists, seeds, individual outcomes, game time and wall time including engine initialization, completed-game mean/median/maximum, and timeout count. Updated after each game so completed observations survive later failures.
- `game-evidence.tar`: raw observed game evidence for each completed attempt, including incomplete timeout evidence.
- `engine-diagnostics.tar`, `instrumentation.txt`, `logcat.txt`: failures, process metrics and engine traces.

A timeout is a censored observation: the real completion time is unknown and exceeds the limit. It is never treated as a completed game or included in the completed-game average. If games time out, the completed-only mean is biased downward and cannot establish the workload's overall average. Five games are a preliminary sample, not a reliable estimate of a population percentile.

Emulator and desktop JVM timings are reference measurements. They do not establish an average for a physical OnePlus 8T; Android ART, heat, heap size and CPU scheduling differ. To measure a connected phone with an Android SDK, build `assembleDebug assembleDebugAndroidTest`, put the two APKs in an artifact directory, then run:

```sh
python3 android/tools/run_commander_timing.py /path/to/apks /path/to/results 5 1800
```

The runner installs the debug APK and matching test APK. Use a disposable test installation or export your data first if its signing identity differs. The diagnostic ceiling belongs to this experiment; it does not silently change saved analyses or the production app's limits.
