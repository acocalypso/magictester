# Opponent allocation

Analysis → Choose opponents & allocation exposes deck inclusion, equal/source-share/custom weights and explicit ordered four-player pods. The API accepts `selection` alongside simulation creation:

```json
{"mode":"custom","opponentIds":["snapshot-deck-a","snapshot-deck-b"],"weights":{"snapshot-deck-a":3,"snapshot-deck-b":1},"allowRepeatedLists":true}
```

IDs must belong to the selected immutable snapshot; omissions select all decks. Zero weight excludes a deck; at least one must be positive. Custom weights are required for every selected deck. Meta mode requires a non-null source-reported share for every selected deck; shares are normalized over the selected population, never inferred.

Two-player jobs allocate integers with the largest-remainder method. Seven units at weights 3:1 give 5:2. Equal fractional ties follow snapshot order. A unit is a game for BO1 or a match for BO3. Every unit still has an independent deterministic seed.

Equal four-player mode rotates consecutive selected lists through three opponent seats. Repetition is controlled explicitly; fewer than three lists require allowing repeats. Weighted mode deterministically draws up to 50 ordered three-opponent rosters from positive-weight decks, using a seeded Park–Miller generator and sampling with or without replacement according to the repetition setting. Requested units are divided equally across these draws; duplicate rosters are combined. This bounds JVM startup cost. Seat shares are an approximation and small samples may differ substantially from source shares. It does not claim exact tournament pod composition or an exact weighted expected win rate.

For exact roster control, pass `pods:[{opponentIds:["a","b","c"],weight:3},{opponentIds:["d","c","b"],weight:1}]` (four-player formats only, at most 50). Seats remain ordered; pod weights use largest remainders. Duplicate ordered pods are rejected rather than accidentally altering their allocation. Explicit pods override sampled roster generation. All participants must be selected from the snapshot. Repetition restrictions still apply.

The complete plan, selection settings, allocation method and seeds are persisted with the immutable job configuration. Excluded/zero-allocation decks create no engine work. A retry uses that stored plan.
