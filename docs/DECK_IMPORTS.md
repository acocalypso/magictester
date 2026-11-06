# Importing a deck link

The deck editor accepts public or unlisted Moxfield and Archidekt links. Choose the intended format, paste a deck URL and select **Import deck**. The editor receives a copy of the list and immediately runs the normal validation. A deck can be imported successfully and still fail legality or construction checks; its errors remain visible and it cannot start a benchmark until corrected. Importing does not start a simulation or track subsequent source changes.

Moxfield mainboard, sideboard, commander, companion and maybeboard roles are preserved. Archidekt uses explicit role categories; categories excluded from the deck become maybeboard entries. Split printings aggregate quantities. Custom cards, conflicting roles and unsupported auxiliary decks are rejected instead of silently omitted. Tokens and prices are not deck entries. Private, deleted, blocked and rate-limited decks produce a useful error and leave existing editor content intact. A text export remains available for other providers.

Requests use constructed API URLs on two fixed HTTPS hosts, no credentials or redirects, a 20-second deadline, a 4 MB streamed response limit and ten imports per client per minute. These are individual user-requested reads, not scheduled crawling or deck discovery. The API returns the canonical source URL, retrieval time and content SHA-256. No deck-site scripts, images or fonts are loaded. Selected-format legality comes from the application's refreshed data, rather than trusting a deck site's legality label.

`POST /api/v1/decks/import-link` accepts `{url,format}` and returns `{name,decklist,sourceFormat,source,validation}`. Moxfield source format is advisory; the selected application format controls validation. Archidekt's numeric format identifier is not treated as an authoritative mapping.

The testing screen also has **How your deck is checked and tested**, explaining validation, daily opponent coverage, pinned job inputs, Forge AI, BO3 sideboarding, queue/startup time, cancellation/resume, excluded failures and limits on interpreting win rates.

For a running deployment, `CHROMIUM_PATH=/usr/bin/chromium node scripts/deck-links-browser.mjs` checks live Moxfield importing, the guide, mobile layout and preservation of existing text on an explicitly simulated error. Set `MOXFIELD_TEST_URL` to a public deck you control when rerunning this check; remote authors can remove or change their lists.
