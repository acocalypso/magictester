# Statistics

Let `n` be normal games plus rule draws, and `w` be submitted-deck wins. Win rate is `w/n`. Rule draws are non-wins. Errors and timeouts are counted separately and excluded. Empty samples return null for rates, intervals and averages.

The Wilson score 95% interval uses `z = 1.959963984540054`:

```
center = (w/n + z²/(2n)) / (1 + z²/n)
margin = z * sqrt(p(1-p)/n + z²/(4n²)) / (1 + z²/n)
interval = [max(0, center-margin), min(1, center+margin)]
```

This interval expresses binomial sampling uncertainty under the model. Games share engine heuristics, opponent lists and batch RNG streams; the interval cannot measure model bias or guarantee independent trials. Aggregated equal-per-list rates differ from population meta-share-weighted estimates.

Each opponent summary uses its own valid sample and denominator. Average/median end round and average game duration use valid games only; unavailable turns are omitted. Play/draw splits require an observed starting player. The deterministic tests include known Wilson values and datasets mixing wins, losses, rule draws, timeouts, errors and unknown starters.
