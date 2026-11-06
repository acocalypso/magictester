# Format validation and execution

## Constructed formats

Standard, Pioneer, Modern, Pauper, Legacy and Vintage are enabled for real Forge AI-vs-AI best-of-one games. `src/formats.ts` is the single source for names, deck sizes, sideboard limits, card copy rules, legality keys, player counts, life totals and engine game types. A format's validation support is separate from its enabled simulation capability.

All six require at least 60 mainboard cards and permit up to 15 sideboard cards. The service has an additional 250-mainboard-card resource bound; that is not represented as a Magic rules maximum. Copy limits count mainboard and sideboard together, exempt basic/snow-basic lands, and honor card-defined quantity exceptions. Vintage permits cards marked `restricted` in the cached Scryfall data, with a one-copy combined limit. Restricted is not treated as banned.

The cached Scryfall legality key supplies the actual card pool and banned/restricted status for the dated metadata snapshot. This avoids guessing set cutoffs, rotation or individual bans in application code. The exact metadata source/hash stays attached to immutable submitted deck versions. Forge's local card scripts are also checked before enqueueing. The runner uses Forge's constructed game rules; format legality is an application precondition rather than a guessed CLI format argument.

Each enabled format has two explicitly project-authored reference decks selected from known legal, supported candidates and validated before import. These are fixed-pool integration/comparison lists, not a top metagame claim. The examples endpoint supplies a validated list appropriate to the chosen format. JSON and CSV imports accept all validation-supported formats and retain immutable provenance.

## Primary rules sources inspected

- [Wizards: Standard](https://magic.wizards.com/en/formats/standard), [Pioneer](https://magic.wizards.com/en/formats/pioneer), [Modern](https://magic.wizards.com/en/formats/modern) — constructed deck/sideboard structure.
- [Wizards: Vintage](https://magic.wizards.com/en/formats/vintage), [Banned and restricted lists](https://magic.wizards.com/en/banned-restricted-list) — one-copy restriction across the complete deck and sideboard.
- [Scryfall Card objects](https://scryfall.com/docs/api/cards) — per-format legality metadata. The application caches bulk data instead of making card-by-card requests.

Commander-family validation, starting-life overrides and four-player execution are the next distinct milestones. Unsupported simulation modes stay disabled until their engine path is verified.

## Acceptance

`node scripts/formats-smoke.mjs` validates and queues two real games in each enabled format using a matching snapshot, checks persisted format/player identities and results, and optionally verifies JSON imports when `ADMIN_TOKEN` is supplied. `node scripts/formats-browser.mjs` checks all six selectors, validated examples, modern banned-card feedback and format-specific pool browsing. The scheduled/manual real-engine workflow runs both in addition to the general smoke and browser workflow.
