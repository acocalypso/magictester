# Expanded AI test build: Android 0.1.8

This preview adds an opt-in **Expanded v2** policy while retaining Native Forge and Tactical v1. Forge still runs independently on the phone. Windows/Linux/Docker native bridges accept the same policy ID, but their product interfaces do not yet expose this selector.

## Run your test

1. Install the 0.1.8 debug preview over a recent debug installation. Its application ID and persistent development certificate are unchanged; version code is 109. Official release publication goes through the existing engine/UI/upgrade acceptance workflow.
2. In **Test**, choose the correct format and load a saved deck or import its public link. In **Pools**, refresh/select the opponents you want. Validate your deck. AI selection is retained when visiting other tabs and formats.
3. Under **Analysis settings → Choose AI policy**, choose **Expanded v2 · experimental**. A normal analysis uses this policy for your deck and every opponent.
4. To compare it with native Forge, enable **Also queue a native comparison**. This creates two linked analyses with the same frozen decklists, opponents, seed, format, match count, initial clock and engine build. The baseline uses native AI everywhere; the candidate uses Expanded v2 for **your deck only**, against the same native opponents. Your deck remains in seat 0. The comparison doubles the selected match count.
5. Set a useful whole-game limit. Commander/cEDH/Duel support up to **1,800 seconds (30 minutes)**; other formats support up to 300 seconds. These are limits, not completion-time guarantees. For parallel testing, run device calibration with a deck matching the selected format first. Calibration stays on Native Forge and the app still checks memory and heat before starting processes.
6. Open either analysis in **Runs**. Its comparison links open the peer; phone Back returns to the previous run. Game evidence identifies each seat's actual policy, planning-suggestion counts, internal AI evaluation timeouts and engine build. Planning checks can repeat before a spell is cast and are not a count of actions taken.
7. Export **both analyses** to keep the paired settings and results. For a failure, export that run's diagnostic ZIP as well. Full decklists remain an explicit diagnostic-export option.

Keep unfinished attempts in your review. A timeout or engine error is not a game loss. The pair is a practical fixed-seat deck test, not a balanced seat-rotation strength league. Seeds do not guarantee identical play across builds or wall-clock cutoffs. Changing a clock on retry is marked in the comparison; inspect each game's recorded limit. New runs are pinned to the engine build, so an app update cannot silently resume them under different AI code. Older saved evidence remains viewable.

## What changed

- Burn: legal lethal-opponent ranking, including supported paid-X and own-board Metalcraft amounts.
- Life loss: prefer an eligible lethal opponent for simple effects.
- Discard: maximize effective cards discarded, respect immunity/targeting, and support ordinary printed discard modes while retaining native RNG consumption.
- Mill: check public draw-to-win/recycling protection and rank eligible library depletion without inspecting hidden cards.
- Draw: distinguish drawing exactly the library from attempting to draw beyond it; avoid visible draw-to-win replacements.
- Poison: avoid pointless immune targets, retain useful counter setup through loss protection, and recognize Vraska-style poison goals without wasting an activation on players already at the goal.
- Cancellation: interrupt checks in amount, mana and replacement evaluation; no unsupported forced thread stop. An evaluator that cannot stop aborts the isolated attempt instead of continuing beside the game loop. Internal evaluation timeouts are recorded separately from the game clock.

## Verification and limits

The expanded native suite passes **32 scenarios in four actor seats: 128 positions and 412 assertions**, with hidden-card identity permutations and legacy-policy parity checks. **26 scenarios use actual printed Forge card abilities**. The original 13-position Tactical v1 suite and cancellation/visibility/transport contracts also pass. Local app/test APK compilation, **19 Android JVM tests** and lint pass. The separate request/comparison logic checks pass on the JVM as well.

These are curated checks, not a broad win-rate result. Android emulator acceptance runs in the release workflow. Physical-device acceptance still requires a test on your phone; it was not performed in this local environment. Combat, mulligans, counterspell strategy, mana sequencing and combo search remain native Forge. No external training corpus or learned model is bundled. See the [implementation details](../engine-ai/README.md) and [archived tactical evidence](benchmarks/expanded-v2-summary.json).

## Reading the comparison summary (Android 0.1.9)

Open either linked analysis to see **Experimental vs default**. It reports each
policy's match win rate, the experimental policy's extra/fewer wins, and the
**percentage-point difference**. For example, 4/10 default wins and 6/10
experimental wins means two extra wins and +20 percentage points. It does not
mean the AI is proven 20% stronger overall.

Only the same match indices finished on both sides contribute. Draws count as
finished matches but not wins; timeouts and unfinished attempts count as neither
wins nor losses. Each pair must have matching recorded seeds, clocks and engine
builds, with native opponents and the expected per-seat policies. Changed frozen
decks/settings block the comparison; incompatible evidence is counted as excluded.
The summary remains provisional while either analysis is unfinished or pairs are
missing. Small samples, fixed seats and selected opponents limit interpretation;
repeat across more seeds and opponents before claiming a consistent improvement.
A normal all-seats experimental run cannot establish improvement over default.
