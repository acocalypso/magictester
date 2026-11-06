# Card metadata and benchmark sources

## Cards

Bootstrap requests Scryfall's bulk-data index using HTTPS and a named `MagicTester/0.1` User-Agent, then downloads one Oracle bulk artifact. Both current JSONL gzip and older JSON-array download metadata are supported. No thousands-of-cards API loop is used. Cached names, legalities, rules text and color identity omit artwork; the source date, fetch time and SHA-256 are stored with validation/deck versions.

Tokens, emblems and art-series objects do not override playable cards. Exact names have priority over split/adventure/transform face aliases. Forge's own card scripts supply the engine-availability check. A present script is not a guarantee of perfect rules/AI behavior; a runtime failure is still possible and remains visible.

To refresh cached metadata, run the bootstrap service with `node scripts/bootstrap.mjs --refresh-cards` as an operator, then restart API and workers so their cached provider reloads. Old validation provenance is immutable. Metadata is a dated snapshot, not a promise of live legality changes or automatic bans refresh.

## Opponents

Manual JSON and CSV import work without scraping. The importer validates every deck, retains explicit strategy/archetype tags, accepts nullable source URL/date/meta share, and creates an immutable snapshot. Records are not edited in place. Equal archetype mode rejects duplicate archetype labels but does not invent classifications or deduplicate strategic similarity without source evidence.

The included Pauper pool contains two project-authored reference lists, with no tournament rank, event statistics or popularity claims. They are useful for integration and comparison under a fixed pool. They are not a claimed "top 50" metagame.

MTGGoldfish, MTGTop8 and EDHTop16 are potential research sources, not implemented adapters. No automated importer is supplied because documented APIs, access terms, robots guidance, data rights and acceptable request rates require source-specific review. Users can supply authorized exports immediately. No login, anti-bot or scraping bypass is implemented.

Import JSON shape: `examples/pauper-reference.json`. CSV is wrapped as `{name,source,format:"pauper",csv}` and uses `name,archetype,strategy,decklist` columns; quote multiline deck text. Imports require the configured admin token and are disabled without it.
