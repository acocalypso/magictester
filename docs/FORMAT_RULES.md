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

## Commander-family validation

Commander, cEDH and Duel Commander decks can be validated and imported. Simulations remain disabled until the structured engine and multiplayer path pass acceptance. Validation requires exactly 100 cards including one eligible commander or two compatible commanders, singleton with card-text/basic exceptions, legal color identity and no sideboard other than a designated companion. cEDH uses the Commander card pool and rules; it is a benchmark selection distinction.

Bootstrap reads the pinned Forge scripts through `CardRules.Reader` in `services/forge-runner/metadata/CardFacts.java`. It caches commander eligibility, actual partner-pair compatibility, outside-battlefield creature characteristics and activated-ability facts. This handles legendary Vehicles/Spacecraft, Grist, generic/named/grouped partners, Choose a Background and Doctor's companion using the engine's own interpretation. Universes Within flavor aliases resolve to their shared engine script. Unknown/missing role facts fail validation; the cache includes its source hash, engine version and extraction failures. Two CopyFaceFrom-only split scripts (`Bind // Liberate`, `Start // Fire`) require the full engine database and have no standalone role facts; they are not eligible commanders. No oracle-statistics guesses substitute for unavailable facts.

The cached Scryfall `duel: restricted` status means banned **as commander**, not banned from the library. Globally banned cards are rejected separately. Lutri is legal in a Commander deck/as commander under the current list but banned as a companion; the role-specific prohibition is explicit. The Prismatic Piper and Faceless One may each add one chosen color; decks requiring more additional colors are rejected.

All ten companion restrictions are checked against the starting deck **including commanders**. Mana-cost symbols, front-face characteristics, creature subtypes, shared card types and Forge activated-ability facts are used as appropriate. A companion is outside the 100-card Commander deck but shares its color-identity/singleton restrictions. Yorion cannot expand a fixed 100-card deck. Arena's Companion designation plus the same Sideboard entry describes one physical card, not two; a companion-only designation still consumes one constructed sideboard slot. Forge receives the card in its real Sideboard section, since its native player code selects companions there. Selection among multiple eligible companions is an engine concern and is not claimed to be explicitly controlled yet.

Rules references checked for this implementation:

- [Current Comprehensive Rules, November 6, 2026](https://media.wizards.com/2026/downloads/MagicCompRules%2020261106.txt), rules 903.3–903.5, 702.124 and 702.139.
- [Wizards banned/restricted lists](https://magic.wizards.com/en/banned-restricted-list), including Lutri's companion-only status.
- [Official Duel Commander banlist](https://www.duelcommander.org/banlist/) and [Duel rules](https://www.duelcommander.org/rules/duelcommander_comprehensiverules/). The historical `.com` domain redirects to `.org`; the archived MTGDC/AeonShift list is not the current authority.
- [Pinned Forge CardRules](https://github.com/Card-Forge/forge/blob/forge-2.0.15/forge-core/src/main/java/forge/card/CardRules.java) and [companion selection](https://github.com/Card-Forge/forge/blob/forge-2.0.15/forge-game/src/main/java/forge/game/player/Player.java).

Duel execution must additionally honor 20 life, no commander-damage win condition and its first-cast paired-commander restriction. Validation support alone does not claim those engine behaviors are implemented.

## Acceptance

`node scripts/formats-smoke.mjs` validates and queues two real games in each enabled format using a matching snapshot, checks persisted format/player identities and results, and optionally verifies JSON imports when `ADMIN_TOKEN` is supplied. `node scripts/formats-browser.mjs` checks all six selectors, validated examples, modern banned-card feedback and format-specific pool browsing. The scheduled/manual real-engine workflow runs both in addition to the general smoke and browser workflow.
