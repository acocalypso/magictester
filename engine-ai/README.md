# Forge AI improvement foundation

Shared Java instrumentation for Android, desktop and Docker Forge bridges. The default policy remains native Forge. An opt-in experimental policy now corrects one tested class of multiplayer burn-target errors; this does not establish a general playing-strength gain.

## Experimental policy: tactical-v1

Native requests accept `"aiPolicies": ["tactical-v1", "stable", "stable", "stable"]`, with exactly one entry per seat. Omitting the field retains `stable` for every seat; unknown policies and incorrect seat counts are rejected before games start. These developer requests work in all three native bridges. Android exposes the policy under Test → Analysis settings and applies one policy equally to every seat. Existing and retried runs preserve their selected policy. The desktop/web product API schemas are not yet expanded for policy selection.

`tactical-v1` ranks legal, predicted-lethal opponents consistently in the two native burn targeting paths. Stable Forge can use one targetable opponent in its damage chooser while its “should hit a player” check examines the lowest-life opponent regardless of targetability. It can also favor a player whose life cannot change, whose damage is prevented, or who cannot lose. The candidate uses Forge's own targetability, prevention/replacement prediction, loss restrictions and infect rules to prefer another opponent who would die from that damage.

The current implementation revision is `damage-lethal-2`. Scope is deliberately limited to positive, constant, simple, single-target player-capable `DealDamage` abilities. Dynamic/X damage, special AI logic, chained abilities, divided/multi-target damage and alternate damage sources fall back to native behavior. Visible active `LifeReduced` replacements and non-`CantHappen` `GameLoss` replacements on the battlefield/command zone conservatively disable the priority rule for that evaluation. Forge's damage predictor does not model these effects reliably. This can retain a native mistake even when a different opponent could be killed; the policy does not execute replacement effects or guess their outcome while planning. No hidden cards, extra search, new threads or random samples are used. Four-player elimination priority is a heuristic, not proof of the best table strategy. If no eligible lethal opponent exists, native behavior is preserved, including existing weaknesses. Simulation copies without a policy registration use stable behavior.

Each native game result includes `ai` provenance: per-seat policy ID/revision, native `Default` profile, experimental flag and evaluation suggestion count. Counts describe heuristic evaluations, **not applied actions**. Existing engine version and compiled bridge/engine hashes identify the actual executable; do not treat the policy name alone as a complete build fingerprint. BO3 stores this provenance separately in each game.

## Current recorder coverage

Set `"captureDecisions": true` in a **native bridge JSON request** to attach `decisionTrace` to each game result (inside each game for BO3). Recording defaults to off. This developer interface is not yet exposed in the app UI or public analysis API; those result schemas do not retain this additional field. Save native output directly when collecting diagnostics.

The pinned `PlayerControllerAi.chooseSingleEntityForEffect` hook records the options supplied by Forge, actor-visible features before the call, and the entity returned by its existing policy. Native delayed revelation occurs before this hook. It does not record all targeting, spell sequencing, combat, mulligans or other controller methods. Internal queries on the registered live game may also invoke it: a returned selection is **not proof that an action was applied to the game**. Simulated game copies are not registered.

Each trace identifies its schema, seed and coverage. Each record contains:

- Actor seat, turn, phase, ability API and visible source descriptor.
- Life and hand/library counts, the actor's own hand, and visible battlefield descriptors.
- Supplied entity option IDs and visibility-filtered names, selected ID, optionality and membership validation.
- Native call duration, excluding observation preparation.

Opponent hidden names remain masked, including hidden options. Library order is never captured. IDs are local to one game, not portable training labels. Battlefield snapshots have an explicit truncation flag after 80 entities per player. This is a partial feature representation, not a replayable state, legal-action generator or engine-independent action encoding.

Retention is capped at 128 records, 256 KiB of encoded records, and 128 options per choice. Oversized option sets are skipped in full; dropped and in-flight records are counted. The first close freezes evidence, including timeouts. `completeForCoveredChoices` concerns capture of this one hook only; it does not certify complete game state or valid training labels. Reject `selectionValid: false` records. Store engine version, source commit, patch manifest, bridge hash, deck fixtures and seat assignment alongside traces.

## Build and checks

Android's engine preparation compiles these sources into its engine JAR. Docker and desktop bootstrap include them in the bridge source hash and compilation. Desktop packaging copies the shared sources into its distribution; building from source uses this repository's `engine-ai/` directory. Android and desktop CI path filters include this directory.

Run the bounded journal contracts with a full JDK (17 or later) and an installed Forge dependency JAR:

```sh
python3 engine-ai/tools/check.py --forge-jar /path/to/forge-gui-desktop-2.0.15-jar-with-dependencies.jar
```

Use `--java /path/to/jdk/bin/java` if needed. To run all native contracts after engine preparation:

```sh
python3 engine-ai/tools/check.py \
  --forge-jar android/engine/build/upstream.jar \
  --native-home android/engine/build/data \
  --bridge-classes android/engine/build/classes \
  --report android/artifacts/ai-tactical-report.json
```

Android CI runs this command and uploads the report with its artifacts. Gradle declares the shared Java directory as an engine-preparation input, so incremental builds cannot reuse an engine compiled before a shared policy edit.

 `tests/ForgeTraceContracts.java` additionally exercises real Forge visibility and opt-in behavior using the Android bridge on a desktop JVM. Compile it against the prepared Android bridge, shared sources and Forge dependencies, then pass the Forge home as its only argument. These local contracts do not substitute for Android device acceptance tests.

## Initial local verification

Against the pinned Forge 2.0.15 dependency JAR on November 7, 2026:

- Shared adapter and both native bridge variants compile at Java 17 language level with the pinned Forge overrides.
- Journal contracts pass snapshot immutability, exactly-once completion, byte/record/in-flight bounds, invalid labels, failure accounting and frozen timeout evidence.
- Actual Forge objects pass own-hand visibility, opponent-hand masking (also when present among options), library exclusion and opt-in checks. A direct call through the patched native controller returns the same entity with recording disabled and enabled for the seeded fixture.
- A real constructed fixture records six native choices, zero drops and zero pending callbacks before its 60-second timeout. Its trace correctly reports incomplete coverage; disabled output omits the trace. Both full-game trials timed out, so this experiment does **not** establish full-game equivalence or measure playing strength.

These are desktop JVM checks of the shared/native implementation, not a claim of device acceptance or exhaustive information-security coverage. Face-down/reveal mechanics and additional decision families still require dedicated fixtures.

## Tactical verification: November 8, 2026

The [versioned fixtures](fixtures/damage-tactics-v2.json) exercise actual Forge 2.0.15 card scripts, static effects and native `DamageDealAi` targeting. Thirteen positions pass 27 assertions; the [current archived report](../docs/benchmarks/damage-tactics-v2-jvm.json) records both policies' choices. In four multiplayer regressions, the candidate selects the other legal lethal opponent instead of a protected lowest-life player or a creature. Other fixtures verify native fallbacks, existing two-player lethal, loss protection, infect and scope boundaries. Added Worship and Lich's Mirror positions verify the conservative replacement fallback; the Worship case also resolves real damage-related life loss through Forge to confirm that the target survives. The [initial revision report](../docs/benchmarks/damage-tactics-v1-jvm.json) remains archived separately. Source-level Java 17 compilation, both bridge implementations, the Android engine packaging build, journal/visibility contracts and two completed native bridge games also pass locally on a Java 21 desktop JVM. Those two games use tiny 12-card, basic-land-only engine fixtures to verify request transport and provenance; they bypass product deck validation and are neither format-legal deck tests nor strength tests.

These checks do not establish full-format coverage, Android device performance, a match win-rate improvement or exhaustive prevention/replacement correctness. Stable remains the default. Further adoption needs held-out tactical positions and a balanced league, not promotion from these thirteen fixtures alone.

## Next milestones

1. Add explicit tactical fixtures and per-decision contracts for combat, mana, mulligans and sequencing, then expand recorder coverage. Validate visibility for face-down cards and temporary reveals before using those observations for learning.
2. Profile expensive AI decisions and implement cooperative deadlines in hot paths. Measure completion and playing strength separately; a faster timeout is not stronger play.
3. Evaluate individual upstream AI changes behind an experimental policy with frozen opponents, paired seats/seeds, held-out archetypes and format-specific tactical tests. Keep stable Forge as the reference.
4. Train off-device only after dataset provenance, schema validation and actor-visible decision context pass review. Evaluate learned policies against that reference before shipping them.

The [dataset review](../docs/research/MTG_GAME_DATA_REVIEW.md) and [AI improvement plan](../docs/FORGE_AI_IMPROVEMENT_PLAN.md) explain source limitations and the evaluation strategy. No external gameplay corpus or model weights are bundled in this module. Code is GPL-3.0-only, consistent with the Forge integration.

## Expanded test policy: tactical-v2

The `tactical-v2` native policy (revision `expanded-2`) includes Tactical v1 and adds these independently gated corrections:

| Decision | Expanded behavior | Boundaries |
| --- | --- | --- |
| Life loss | Prefer an eligible opponent within range of a simple lethal life-loss effect. | Constant, single-target, unchained effects; unsupported public loss replacements delegate to native. |
| Discard | Prefer a player who can actually discard the greatest number of cards. | Public hand counts only; respect targetability and discard restrictions. Restricted card types, nonstandard modes and complex scripts delegate. Ordinary `TgtChoose` and random discard are supported. Native shuffle RNG consumption is preserved. |
| Mill | Avoid visible draw-to-win replacements and public graveyard-to-library recycling; prefer eligible libraries nearest depletion. | Library sizes only. Hidden reshufflers are not inspected. Complex scripts delegate; mandatory effects retain native fallbacks. Emptying a library is not described as an immediate win. |
| Targeted draw | Drawing exactly the remaining library is not treated as decking; avoid giving a visible draw-to-win replacement its win. | Simple, single-target draw. No speculative modeling of complex replacement chains. |
| Poison | Decline an optional simple poison spell only if no legal opponent can receive counters; preserve counter setup through loss protection. Recognize the printed “raise poison to a goal” pattern used by Vraska’s ultimate and avoid zero-effect activations. | Mandatory targets still use the native required-target fallback. |
| Burn | Extend the lethal-opponent correction to already-computed paid X and own-board Metalcraft amounts. | Arbitrary dynamic damage and target-dependent damage formulas still delegate. |

The policy does not alter native combat, mulligan, counterspell, mana sequencing or combo search. It is a broader heuristic test candidate, not a learned model or a claim of stronger play in every format. Existing `stable` and `tactical-v1` requests remain valid. Native result metadata lists enabled features and counts planning suggestions; those counts are not spells cast or verified applied actions.

The expanded native suite contains 32 authored scenarios (26 using printed native card abilities), each rotated through four actor seats (128 positions). It also swaps hidden card identities at fixed counts and checks legacy-policy parity. Exact assertions and changed-choice totals are archived in the benchmark evidence. The original 13-position Tactical v1 suite remains a separate regression check.

## Evaluation cancellation safeguards

All policies share cooperative interrupt checks in native amount calculation, mana-source grouping and replacement scanning. The existing native AI evaluation deadline is retained. On cancellation the caller waits up to two seconds for the evaluator to exit; unsupported `Thread.stop()` is no longer called. If the evaluator remains alive or the game caller is interrupted, the isolated attempt aborts instead of letting the game continue with a concurrent evaluator. A stalled evaluation yields `engineFailure.code=ai_evaluation_aborted`, with no inferred winner. Existing process isolation disposes of that attempt.

Native metadata counts internal `evaluationTimeouts` per seat separately from the whole-game clock. These are deadline events, not fabricated game losses. Cancellation checks do not provide transactional rollback of all speculative AI state or guarantee that every native loop is interruptible; a noncooperative evaluation still ends the isolated attempt. No general speedup is claimed.

Contracts exercise a cooperative mutating worker, a worker that ignores interruption, preservation of interrupt status, and the actual patched native amount/mana/replacement entry points. The 13-position legacy and 128-position expanded decision suites also pass with these safeguards compiled.

## Strategic v1

`strategic-v1` retains Expanded v2 target corrections and adds decision hooks in
`PlayerControllerAi`, `AiController` and `ComputerUtil`. Native, Tactical v1 and
Expanded v2 retain their existing behavior. Shared pinned patches are maintained
for Android, desktop and the Docker runner; the Android UI exposes the selector.

- Opening hands: distinguish real color/pip access from land count. Permit a
  basic-land, four-one-drop hand; reject a six/seven-card hand that has lands but
  no playable early spells. Preserve native decisions at five cards or fewer.
  Search up to 128 kept subsets for London bottom selection. Conditional mana,
  restricted mana, cycling, alternate faces, X, snow and Phyrexian costs fall back
  to native hand logic. No opponent hand or library order is inspected.
- Sequencing: recognize simple self-only conditional haste (including Goblin
  Tomb Raider with an artifact), use Forge's `FreeSpellAI` mana-refund hint before
  combat, and put affordable creature setup ahead of applicable team haste.
  Forge still decides whether a spell is legal, affordable and worth playing.
- Combat: search basic two-player constructed combat for guaranteed lethal
  attacks and better single-block assignments. At most six attackers/four
  blockers for attack search and five attackers/four blockers for block search.
  Combat with triggers, nonbasic effects, special damage keywords, marked damage,
  prevention/regeneration/shields, Commander rules or complex blocks falls back
  to native Forge. Search considers public board state, life preservation and
  creature trades. It does not predict hidden tricks or future draws.

This is an opt-in heuristic policy, not a trained model or a universal strength
claim. Planning counters may repeat; public action signatures and paired outcomes
are the evidence that a game actually changed. See
[the Strategic test guide](../docs/STRATEGIC_AI_TEST_GUIDE.md).
