# Matchup charts · Android 0.1.11

Open an analysis in **Runs**. Its **matchup chart** expands when the run completes.
Existing saved analyses also work; no simulation rerun or database migration is
needed. A live/incomplete snapshot can be expanded while a run is in progress.

The chart uses opponent rows and your AI-policy columns, so it fits a phone.
Every cell shows a match win rate, W–L–D counts, sample size and 95% Wilson interval.
Tint uses the win rate and sample size: muted teal for more wins, rose for fewer,
and neutral cells when there are no finished results. Tap a cell to inspect the
counts, unfinished work, unpaired results and earlier unsuccessful attempts.

- Rates are wins divided by finished matches. Draws are finished matches but not
  wins. Timeouts and invalid/incomplete attempts are not losses.
- Each scheduled match index contributes once. A successful retry replaces the
  earlier unfinished outcome; best-of-three evidence counts as one match.
- Opponent assignment uses the same frozen-pool schedule as the simulation
  request. Unscheduled opponents have no invented rate.
- Linked Native/Experimental charts use only the same verified matched indices
  as the comparison summary. Different clocks, engines, seeds or AI evidence are
  excluded. The chart says when it can show only one analysis.
- Multiplayer Commander rows represent whole opponent pods in their actual seat
  order. A pod win is not counted as a separate head-to-head win against each
  deck. Tap its cell for the full opponent roster.

**Save matchup chart (PDF)** opens Android's file picker. The export uses a light
paper layout, includes every matchup across as many pages as required, and adds
full pod/long-name rosters when needed. It records the snapshot time and analysis
settings. Fonts are installed Android fonts; the chart and export fetch no fonts,
images or chart data from external services. No charting dependency was added.

The chart measures your deck against its recorded opponents. It does not fill in
unplayed pool-versus-pool matches or represent a complete metagame round robin.
Small samples can have very wide intervals even when a cell says 0% or 100%.

Verification covers retry/draw handling, missing and malformed outcomes, schedule
wrapping, multiplayer pods, matching-pair exclusions, confidence intervals,
best-of-three counts, paginated PDF rendering and phone Back from cell details.
The release workflow retains chart/PDF previews with its Android acceptance
artifacts. Screenshot previews use clearly labelled synthetic test data.
