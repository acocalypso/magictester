# Daily metagame sources

Checked 6 November 2026. The default dashboard pool is fetched automatically at startup and daily at 00:00 UTC for Standard, Pioneer, Modern, Pauper, Legacy, Vintage, Duel Commander, Commander and cEDH. `DAILY_META_ENABLED=false` disables initial registration; existing feeds can be paused individually. `DAILY_META_DECKS` controls the number of archetypes (default 10, maximum 50).

[MTGTop8](https://www.mtgtop8.com/) supplies source-reported archetype shares and recent tournament lists. Commander and cEDH both use the explicitly labelled competitive Commander population; this is not a universal casual Commander metagame. Duel Commander uses its separate ranking. Percent and per-mille shares retain their source meaning. Coverage is the sum of selected shares, not an estimate of missing decks.

Each archetype gets one recent representative (at most 60 days old), validated against current Scryfall legality, deck construction rules and installed Forge support. Imports try up to three recent lists per archetype, record exclusions and leave absent statistics null. Source window, event dates, URLs, page SHA-256 hashes and validation provenance accompany every immutable snapshot. An infrastructure failure aborts publication and retains the last good pool. New jobs resolve the latest validated pool and pin its immutable version; stale, paused, unavailable or incompatible pools cannot silently fall back to reference fixtures. Historical pools remain selectable explicitly.

Requests use an identified application agent, robots checks cached for 24 hours, a shared PostgreSQL host lock, at least five seconds between requests, six-hour HTML caching, conditional requests, a 20-second request deadline and a 4 MB streamed limit. Robots restrictions and longer crawl delays are honored. Authentication failures, rate limits and server failures abort imports; Retry-After postpones retries. Daily failures otherwise retry after one hour. No export route blocked by robots, challenge bypass, browser scripts, remote assets or fonts are used. Cached source HTML is private deployment data and expires after seven days.

## Source findings

- [MTGTop8 robots](https://www.mtgtop8.com/robots.txt) allows the read-only pages used here and specifies a five-second crawl delay; `/compare` is excluded.
- [MTGDecks API documentation](https://mtgdecks.net/docs/api) describes event submission, not a public metagame read API. Its [robots](https://mtgdecks.net/robots.txt) restricts text exports and named crawlers. The optional `mtgdecks` adapter reads permitted normal HTML and validates its deck textarea. During verification, a public Pauper-labelled list contained cards illegal in Pauper; it was rejected. Consequently MTGTop8 is the default.
- MTGDecks terms describe personal/non-commercial downloads. Source imports are intended for private analysis; public display is not a blanket redistribution license. No fetched deck corpus or HTML is committed to this repository.
- MTGGoldfish robots disallows deck download/registration routes; no downloader is implemented.

## Administration and JSON feeds

`GET /api/v1/meta/:format/current` returns the current pool and source freshness. The UI displays source date, coverage and refresh failures. Admin bearer endpoints:

- `POST /api/v1/meta/feeds`: `{name,url,format,permission,intervalHours:24,provider:"json",maxDecks:10}`. Providers: `json`, `mtgtop8`, `mtgdecks`.
- `POST /api/v1/meta/feeds/:id/sync`: JSON refresh completes inline; HTML refresh returns 202 and runs in the background.
- `PATCH /api/v1/meta/feeds/:id`: `{enabled:false}` pauses a feed.
- `GET /api/v1/meta/feeds`: scheduling, timestamps, last error and published version.

JSON feeds retain the immutable snapshot contract documented in [the reference payload](../../examples/pauper-reference.json), which is project-authored test data, not current tournament data. `META_FEED_HOSTS` is an exact hostname allowlist (default `raw.githubusercontent.com`); HTTPS only, no credentials, ports, fragments or redirects, 20-second deadline and 2 MB limit. HTML providers have separate exact host allowlists. Registration records the operator's permission basis. Every deck must validate before a changed payload is published atomically; ETag/304 and content digests avoid duplicate versions.

Run `node scripts/daily-meta-smoke.mjs` against a running deployment for real all-format imports, immutable latest-pool resolution, stale-selection rejection, paused-source rejection and an actual game against a sourced opponent. `CHROMIUM_PATH=/usr/bin/chromium node scripts/daily-meta-browser.mjs` checks the default pool, allocation, responsive layout and local fonts.
