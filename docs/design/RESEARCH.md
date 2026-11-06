# MagicTester design research — 6 November 2026

The redesign is a charcoal testing workbench with white typography and one restrained blue-gray accent, as confirmed by the user. The application is a working testing desk: deck registration, chosen opponents, a queue and a record of games.

## Sources inspected

- [Archidekt landing/playtester overview](https://archidekt.com/landing): its own product description distinguishes visual card stacks, condensed text/spreadsheet modes and an actual playtester. Browser inspection showed a horizontal navigation system and separate deckbuilding/playtesting explanations. Borrow the clarity of those distinct tasks; do not copy its artwork, card presentation or orange identity.
- [Untapped Standard metagame](https://mtga.untapped.gg/constructed/standard/meta): browser inspection showed format, best-of mode, time range and rank controls placed before analytical tables/charts. Adopt the requirement to state the benchmark context before presenting a percentage. Its Arena data is human match data; MagicTester's engine results must remain clearly different.
- [MTGDecks Pauper metagame](https://mtgdecks.net/Pauper): the accessible indexed page exposes archetype filtering, date ranges and a compact data table. The direct browser request received a Cloudflare challenge, which was not bypassed. Do not infer private interface details or ingest its deck data from this design research.
- [17Lands Card Data](https://www.17lands.com/card_data): browser inspection showed explicit dataset/format/metric filters, notes on methodology and an alternative table view. Adopt visible definitions and sample context rather than ornamental charts.

These references were inspected as product/design research. They are not permission to scrape decklists or republish their assets. No source site's code, artwork, statistics, screenshots or layout is shipped in the product.

## Chosen direction: the charcoal testing workbench

- Charcoal canvas, closely related neutral surfaces, white text and one subdued blue-gray accent. Status/error colors remain subordinate to readable text labels.
- An original stacked-deck mark, compact wordmark and horizontal numbered navigation. No fake avatar or ornamental hero stamp.
- Public Sans served locally with its OFL notice; monospace text for the actual deck list and compact evidence labels. A single type family keeps controls, headings and results consistent.
- Compact headings and rectangular sections, with deck input as the main workspace and test settings alongside it. All screens use the same palette, borders, spacing and focus treatment.
- Explicit benchmark context, sample sizes and simple tables/charts instead of invented dashboard statistics.
- Native modal run evidence with explicit Tab wrapping, Escape dismissal and focus restoration; text navigation remains available on mobile.

## Verification

Production build, type and lint checks plus a real browser workflow cover deck validation, creating/completing a real Forge job, results, all navigation views, locally served fonts, keyboard evidence dialogs and mobile overflow at 390/768 px. Screenshots in `docs/screenshots` record actual running services and persisted games.
