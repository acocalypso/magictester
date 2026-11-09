# Strategic AI test build: Android 0.1.10

**Current comparison mode:** Android 0.1.14 applies Strategic v1 to your deck and
every opponent in new candidate runs. See the [all-player comparison guide](ALL_PLAYER_AI_COMPARISONS.md).
The results and setup below describe the original 0.1.10 own-deck-only experiment.

Select **Test → Analysis settings → Choose AI policy → Strategic v1 · experimental**.
Enable **Also queue a native comparison** to get a linked default/experimental
pair. Existing preferred policies are retained on update: Expanded v2 remains
Expanded v2 until you explicitly choose Strategic v1.

Both analyses keep the same frozen decklists, opponents, initial seed, clock and
engine build. The candidate pilots your deck only; its opponents stay native.
Open either run to see wins, gained/lost wins and the percentage-point difference
for matching finished outcomes. Timeouts and unfinished pairs are excluded and
labelled. New runs are required after an engine-code update; old completed history
remains readable, but results from different engine builds are not combined.

## What to look for

- Goblin Tomb Raider can be cast before combat when an artifact already grants
  its conditional haste. Your supplied game log exposed a missed attack here.
- Burning-Tree Emissary and other creatures with Forge's mana-refund hint can
  start a precombat sequence. Affordable setup creatures can precede a team-haste
  finisher rather than missing its benefit.
- Opening-hand evaluation checks ordinary land colors and colored pips instead
  of counting two lands as sufficient for every spell. London bottom selection
  searches the small set of retained hands. Low-card and complex-resource hands
  keep native handling.
- Basic two-player combat has a bounded public-board search. Complex combat and
  Commander combat continue through native Forge; Commander can use the new
  hand and sequencing logic. No opponent hidden hand or library order is used.

Game AI evidence names each policy and lists the relevant decision/planning checks.
Those counters are not the number of spells cast; checks can repeat. Use observed
actions and paired outcomes to establish behavioral changes.

## Verification

Native printed-card contracts cover old-policy behavior, two actor seats, the
conditional-haste timing error, mana colors and double pips, colorless costs,
London bottom selection, low-card and cycling fallbacks, team-haste budgets,
public-board combat legality and hidden-hand isolation. Four-player Commander
positions check policy scoping and the applicable hand/sequencing hooks.

The Red rally benchmark uses the frozen deck and ten opponents from your supplied
0.1.9 diagnostics, with seeds 12345, 42 and 20261108. Full decklists and diagnostic
archives are not committed. Reports retain public matchup names, action signatures
and policy evidence. The reference traces for seed 12345 match the phone export
when duration summaries and card-instance IDs are excluded.

The final packaged-engine 30-pair sample finished all matches: Native 21/30, Strategic 24/30,
with changed action sequences in 26 pairs. This is +10 percentage points in this
selected sample. It is not a confidence-backed general AI strength result, a
seat-balanced league or a Commander win-rate benchmark. Host durations are not a
phone performance measurement. Repeat with other decks, opponents and seeds.

Reproduce a local benchmark by compiling `engine-ai/tests/StrategicDeckBenchmark.java`
against the prepared native bridge classes and pinned Forge jar, then running:

```text
StrategicDeckBenchmark FORGE_HOME CONFIG_JSON REPORT_JSON
```

The local config contains `deck` (Forge .dck path), `opponents` (objects with `name`
and `deck` paths), `games`, `seed` and `clockSeconds`. The driver compares native
against Strategic on your seat, with native opponents, and writes no raw deck
text to the report. The shared native contract suite runs through
`python3 engine-ai/tools/check.py`; use its documented native-home/bridge-class
arguments as in the Android workflow.

The native suite passed **50 positions and 78 assertions** against the packaged
engine, in addition to the existing target, visibility, cancellation and transport
contracts. Local Android compilation, 21 JVM tests and lint passed. See the
[archived summary](benchmarks/strategic-v1-summary.json) and per-seed compressed
reports beside it.

CI runs real engine/UI/upgrade acceptance on Android emulators. Physical OnePlus
acceptance and broad strength testing still require device/user testing.
