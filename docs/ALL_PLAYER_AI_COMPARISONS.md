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
