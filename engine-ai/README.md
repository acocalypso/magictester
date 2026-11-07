# Forge AI improvement foundation

Shared Java instrumentation for Android, desktop and Docker Forge bridges. This first milestone collects observations of native AI choices; it does not change the AI policy or establish improved playing strength.

## Current coverage

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

Use `--java /path/to/jdk/bin/java` if needed. `tests/ForgeTraceContracts.java` additionally exercises real Forge visibility and opt-in behavior using the Android bridge on a desktop JVM. Compile it against the prepared Android bridge, shared sources and Forge dependencies, then pass the Forge home as its only argument. These local contracts do not substitute for Android device acceptance tests.

## Initial local verification

Against the pinned Forge 2.0.15 dependency JAR on November 7, 2026:

- Shared adapter and both native bridge variants compile at Java 17 language level with the pinned Forge overrides.
- Journal contracts pass snapshot immutability, exactly-once completion, byte/record/in-flight bounds, invalid labels, failure accounting and frozen timeout evidence.
- Actual Forge objects pass own-hand visibility, opponent-hand masking (also when present among options), library exclusion and opt-in checks. A direct call through the patched native controller returns the same entity with recording disabled and enabled for the seeded fixture.
- A real constructed fixture records six native choices, zero drops and zero pending callbacks before its 60-second timeout. Its trace correctly reports incomplete coverage; disabled output omits the trace. Both full-game trials timed out, so this experiment does **not** establish full-game equivalence or measure playing strength.

These are desktop JVM checks of the shared/native implementation, not a claim of device acceptance or exhaustive information-security coverage. Face-down/reveal mechanics and additional decision families still require dedicated fixtures.

## Next milestones

1. Add explicit tactical fixtures and per-decision contracts for combat, mana, mulligans and sequencing, then expand recorder coverage. Validate visibility for face-down cards and temporary reveals before using those observations for learning.
2. Profile expensive AI decisions and implement cooperative deadlines in hot paths. Measure completion and playing strength separately; a faster timeout is not stronger play.
3. Evaluate individual upstream AI changes behind an experimental policy with frozen opponents, paired seats/seeds, held-out archetypes and format-specific tactical tests. Keep stable Forge as the reference.
4. Train off-device only after dataset provenance, schema validation and actor-visible decision context pass review. Evaluate learned policies against that reference before shipping them.

The [dataset review](../docs/research/MTG_GAME_DATA_REVIEW.md) and [AI improvement plan](../docs/FORGE_AI_IMPROVEMENT_PLAN.md) explain source limitations and the evaluation strategy. No external gameplay corpus or model weights are bundled in this module. Code is GPL-3.0-only, consistent with the Forge integration.
