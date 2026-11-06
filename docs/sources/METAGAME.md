# Source research and feed contract

Research checked 6 November 2026. Public display is not assumed to authorize a scraping integration.

- [MTGGoldfish robots](https://www.mtggoldfish.com/robots.txt) explicitly disallow `/deck/download*` and `/deck/registration*`. No downloader or challenge bypass is implemented.
- MTGDecks automated requests encountered access controls. No bypass is implemented.
- [MTGContent developer API](https://www.mtgcontent.com/developers) expressly offers a public read-only individual-player lookup. It is not a representative metagame distribution: it requires a player handle, has incomplete coverage, and warns against interpreting old results as current decks. No fabricated meta share or broad tournament provider is derived from it.
- Bundled [reference feed](../../examples/pauper-reference.json) is project-authored and distributed under this repository's license. It is the repeatable remote-ingestion acceptance source, **not tournament data**.

Operators can register JSON feeds they own or are permitted to poll. The payload is the same documented immutable JSON snapshot accepted by `/api/v1/meta/import`. It supplies the source label/date, format, selection method, complete decklists, optional per-deck source URLs and source-reported meta shares. Every deck is validated against cached format rules before publication. An invalid feed leaves the last good snapshot intact.

`META_FEED_HOSTS` is an exact hostname allowlist, default `raw.githubusercontent.com`. Feeds require HTTPS, no embedded credentials/ports/fragments, no redirects, a 20-second deadline and a 2 MB streamed body limit. Operators should only add trusted public feed hosts, never internal network hosts. Registration records the permission/license basis; this is an operator declaration rather than automated legal verification. Feed URLs and snapshots are public within the local/private deployment.

Admin bearer endpoints:

- `POST /api/v1/meta/feeds`: `{name, url, format, permission, intervalHours:24}`; minimum one hour.
- `POST /api/v1/meta/feeds/:id/sync`: immediate bounded refresh.
- `PATCH /api/v1/meta/feeds/:id`: `{enabled:false}` pauses scheduled imports.
- `GET /api/v1/meta/feeds`: success/error timestamps, current/stale/never state and last published snapshot.

The API checks due feeds every minute, sequentially in batches of ten. PostgreSQL session advisory locks prevent concurrent imports across replicas. Network failures defer another scheduled attempt for the configured interval; operators can retry manually. ETag/304 and identical SHA-256 content avoid duplicate versions. Changed bytes are validated, then a new snapshot and source URL/body SHA-256/fetch timestamp/card-data provenance are committed atomically. Existing snapshots and simulation plans remain unchanged. “Current” means a successful fetch within twice the polling interval; it does not assert that the source's event date is recent. The UI separately displays source date and import date.
