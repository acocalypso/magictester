# Strategic v2 and the head-to-head league

Strategic v2 (`strategic-v2`) is an opt-in policy that remembers what an opponent
has publicly played and uses it between and during games. It ships with a new way
to compare two AIs. **Measured against the older policies it has not shown a
reliable strength gain yet**; the numbers are below. Native Forge stays the default.

## What it does

- **Remembers what was played.** Every card a player shows in a match is recorded:
  spells and abilities put on the stack, lands played, and face-up cards on the
  battlefield, in graveyards, in exile and in the command zone. Hands, libraries,
  sideboards, face-down cards and decklists are never read.
- **Sideboards against the opponent it saw.** Native Forge swaps same-cost cards
  at random, and only after losing. Strategic v2 checks whether each card's
  interaction can hit what the opponent showed. Removal with no targets, graveyard
  hate against a deck that never used its graveyard, and counterspells that cannot
  stop what was cast go out; sideboard cards that line up come in. Lands and mana
  sources are never touched. With fewer than five opposing nonland cards seen,
  nothing changes.
- **Holds creatures back from a known board wipe.** If the opponent has shown a
  sweeper, can cast it by their next turn, and the current board already wins
  within three attacks, a further ordinary creature stays in hand. At most two.
- Everything in Strategic v1 (opening hands, sequencing, simple combat search).

Two-player games only for sideboarding and the sweeper rule. Commander pods get
the memory and the Strategic v1 behavior.

## How the league compares two AIs

The in-app comparison switches the AI for every seat and reports how your deck's
matchup changes. That is a statement about the matchup, not about which AI plays
better. The league answers the second question:

- Every pairing of two decks is played twice with one seed. The candidate pilots
  deck A against the baseline on deck B, then they exchange decks. An AI that was
  simply handed the better deck wins one leg and loses the other.
- The report gives the candidate's share of decided matches with a 95% interval,
  and an exact sign test over the pairs (both legs won against both legs lost).
- For best-of-three, game one and the games after sideboarding are counted
  separately.
- Unfinished legs are counted and their pair is left out. Nothing is guessed.

The gauntlet is nine project-authored decks with sideboards: burn, creature aggro,
tempo, black control, blue-white control with counterspells and board wipes,
artifacts, go-wide white, graveyard and ramp. They exercise different play styles.
They are not a metagame and are not checked for format legality.

Run it with `engine-ai/tools/league.py`; see [the engine-ai README](../engine-ai/README.md).

## Results, 13 November 2026

Forge 2.0.15, desktop JVM, best-of-three, 300-second game clock, seed 20261111,
8 mirrored pairs for each of the 36 pairings (576 matches per league).

| Candidate vs baseline | Decided matches | Candidate share | 95% interval | Pairs: both / split / neither | Sign test p |
| --- | --- | --- | --- | --- | --- |
| Strategic v2 vs Strategic v1 | 291–285 | 50.5% | 46.5–54.6% | 48 / 195 / 45 | 0.84 |
| Strategic v2 vs native Forge | 300–272 | 52.4% | 48.4–56.5% | 49 / 202 / 35 | 0.16 |

| Candidate game share | Game one | After sideboarding |
| --- | --- | --- |
| vs Strategic v1 | 286/576 = 49.7% | 416/815 = 51.0% (47.6–54.5%) |
| vs native Forge | 287/572 = 50.2% | 423/806 = 52.5% (49.0–55.9%) |

Every leg against Strategic v1 finished. Against native Forge two legs did
not finish and their two pairs are excluded.

**Reading these numbers.** Both intervals include 50%. Against Strategic v1 there
is no measurable difference. Against native Forge the candidate is ahead by 2.4
points, which a coin would produce about one time in six; that is a lead worth
re-testing, not a result. The after-sideboarding share is slightly higher than
game one in both leagues but its interval also includes 50%.

**What the game data shows.**

- The sideboard choices are mostly the expected ones: artifact removal against
  Affinity, red hosers against Burn, graveyard hate against the graveyard deck,
  discard against blue-white control.
- They did not convert into wins. Burn won 62% of game ones and 50% of
  post-sideboard games against Strategic v1: it trades direct damage for narrow
  answers (one-damage sweepers against decks with a few one-toughness creatures),
  which weakens its own plan. The planner values "can hit something" but not how
  much that is worth compared with the card it replaces.
- The sweeper rule fired 330 times in 576 matches and game-one share stayed at
  50%, so it is neither clearly helping nor hurting.
- Per deck, the candidate did better with Burn, White Weenie, Faeries, Ramp and
  Stompy against native Forge (5 to 11 points each on 64 matches) and worse with
  both control decks (3 to 6 points). None of these per-deck differences is
  large enough to trust on 64 matches.

The archived reports are
[vs Strategic v1](benchmarks/strategic-v2-league-vs-strategic-v1.json) and
[vs native](benchmarks/strategic-v2-league-vs-native.json). Host durations in
them are not a phone measurement.

## Forge 2.0.16

The engine pin moved to Forge 2.0.16 (published 11 November 2026) after these
leagues ran. Its native AI changed: opening hands and London bottoms now follow a
deck plan by default, there is a land planner and a shared evaluation deadline,
and an optional Monte Carlo search exists but is off unless a match enables it.
Four of the seventeen source patches had to be re-anchored; the upstream fix for
sideboarding after a drawn game replaced one of ours. Strategic policies now apply
their two opening-hand overrides on top of Forge's new decision instead of the old
one. All contract suites pass on 2.0.16. **The league numbers above are for 2.0.15
and have not been repeated on 2.0.16.**

## Contracts

`engine-ai/tests/AdaptiveContracts.java` checks 73 positions with 185 assertions on
printed cards from both seats: what memory may and may not see, plans against
artifact, graveyard, creatureless and single-colour opponents, deck-size and land
invariants, independence from hidden cards, earlier policies keeping native
sideboarding, and the limits of the sweeper rule.

## Next steps suggested by the data

1. Make the sideboard planner weigh what a swap costs: protect a proactive deck's
   core cards, and value removal by what it removes rather than only whether it
   has a target. Re-run the league.
2. Add an in-app head-to-head mode (candidate on your deck against native
   opponents, and the reverse) so the phone can measure pilot strength the way
   the league does.
3. Re-run both leagues on Forge 2.0.16, and evaluate its Monte Carlo search as a
   policy of its own with the league before exposing it.
