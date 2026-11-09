# All-player AI comparisons · Android 0.1.14

Choose **Strategic v1 · experimental** under Test → Analysis settings and enable
**Also queue a native comparison**. New comparisons now use:

| Run | Your deck | Every opponent |
| --- | --- | --- |
| Native baseline | Native Forge | Native Forge |
| Strategic candidate | Strategic v1 | Strategic v1 |

This applies to two-player formats and every seat in multiplayer Commander.
Tactical v1 and Expanded v2 comparisons likewise use the selected policy for
every candidate seat. Normal analyses already applied the policy to all players.

Both runs preserve the same frozen decks, opponent schedule, initial seed, clock,
match count, format and engine build. Evidence validation checks the actual
policy in every seat and every game of a best-of-three. A candidate game that
unexpectedly used native opponents is excluded from an all-player comparison.
Timeouts, missing outcomes and mismatched clocks/builds remain excluded.

Results describe **your deck's matchup win rate under each configuration**.
Because opponents also improve, a lower or unchanged win rate does not show that
Strategic AI is weaker. This comparison does not isolate your pilot's strength or
establish general AI strength. More seeds and opponents improve the assessment.

## Existing runs

Start a **new comparison** to use this mode. Saved comparisons created before
0.1.14 retain their original `your-deck-only` scope and native opponents,
including when resumed. They are labelled legacy in the result description and
chart/PDF provenance. Old results remain readable and comparable under their
original per-seat rules; no saved settings or game evidence are rewritten.

The verifier supports both recorded scopes and rejects unknown/mismatched AI
settings. The native AI implementation and engine build are unchanged; this
release changes which existing policy is assigned to each player.

## Verified release

[Android 0.1.14](https://github.com/acocalypso/magictester/releases/tag/android-v0.1.14)
was published from `90704ba`.
[Release workflow](https://github.com/acocalypso/magictester/actions/runs/42571935912)
passed 26 JVM tests, lint, shared/native AI checks, and 66 Android tests (8 UI +
58 engine/runtime) on each of API 26, 35 and 37.2. The real-game test builds its
request through `AiComparison.prepare` and `SimulationRequest.unit`, completes a
Forge game, and asserts Strategic v1 / `strategy-1` evidence for **both seats**.
Scope checks also cover Commander seats, every BO3 game, mixed-policy exclusion,
legacy evidence preservation, and chart/PDF provenance from either linked run.
UI, in-place update/private-data retention and existing timeout/retry tests passed.
The actual Android PDF rendering was visually checked. This is emulator coverage;
no physical OnePlus testing is claimed.

The downloaded published APK was independently verified:

- Version: 0.1.14 / code 115.
- APK SHA-256: `14a31f60fa9ebb0cd0d50d071b885288d630b2b00b180cf86c12c7fa20ca0e7b`.
- Signing certificate SHA-256: `a12aa61ccbe6ceb0973da544ce5b09dc07a50306afe8338ca61c356fe5f68f07` (persistent debug identity).
- Engine JAR SHA-256: `137d5a8948620a7c2ebd7d9908f61b08e2d0be2e4f999dea49102c033ec60466` (unchanged).
