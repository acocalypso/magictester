# MagicTester

A private, Docker-hosted Magic: The Gathering deck benchmark lab. Paste a Pauper deck, validate it against cached Scryfall metadata and pinned Forge card scripts, queue real AI-vs-AI BO1 games, and inspect persistent per-opponent results.

**No random or fabricated matchup results.** The bundled opponent pool is explicitly labeled as project-authored reference decks, not a current tournament metagame. Import your own sourced JSON/CSV snapshots for metagame testing.

![MagicTester deck analysis](docs/screenshots/analysis.png)

## Run

Requires Docker Engine with Compose v2, Internet access on first boot, and approximately 4 GB RAM and 8 GB free storage (more when Docker uses the VFS storage driver).

```sh
cp .env.example .env
# Optional: set ADMIN_TOKEN to a generated token for snapshot imports.
docker compose up --build -d --wait
```

Open **http://localhost:3000**. Choose **Load example**, validate, select the reference pool, and start a benchmark. API documentation: http://localhost:3000/api/docs.

First boot downloads Forge 2.0.15 (SHA-256 verified, about 297 MB) and Scryfall Oracle bulk data. It creates persistent caches, runs versioned database migrations, and validates/imports the reference pool. Later boots reuse those caches. Forge runs in separate Java processes behind an internal runner; it is never executed inside the API process.

The default deployment listens only on localhost and has no user authentication. All local users can view/cancel jobs. Keep it private. Add authentication and authorization before changing that deployment boundary. Set a database password and admin import token for your own deployment.

### Managed environment proxy

When your environment supplies an HTTPS inspection CA:

```sh
docker compose -f docker-compose.yml -f infra/docker/compose.managed.yml up --build -d --wait
```

The optional overlay mounts `CODEX_PROXY_CERT` (or the system CA bundle) for dependency installation and bootstrap downloads. TLS verification remains enabled. Normal installations need no overlay.

## What is implemented

- Dedicated deck parser, structured line errors, name normalization, format legality, deck/sideboard sizes, combined copy limits, card-defined copy exceptions, and Forge script availability.
- Pauper BO1, an engine adapter, seeded real games, observed starting player, end round, durations, explicit draws/timeouts/errors, process groups and external deadlines.
- PostgreSQL/Drizzle schema and versioned migrations; immutable snapshot and deck records enforced by database triggers.
- BullMQ/Redis queue, job creation limits, bounded JVM capacity, progress events, cancellation, explicit retry, durable planned run identities, restart recovery, and completed-result deduplication.
- Analysis, queue, results, run evidence, benchmark browser, JSON/CSV admin import; charcoal-and-white interface with locally hosted typography.
- Win/loss/draw records, per-opponent rates, Wilson 95% intervals, sample warnings, observed play/draw splits, and round distributions.
- OpenAPI, structured logs, service health checks, graceful shutdown, Docker builds, CI and scheduled/manual real-engine smoke tests.

Commander, cEDH, BO3, sideboarding AI, commander cast timing and additional enabled formats are deferred. Format definitions and multiplayer-capable engine result models leave room for them. Unsupported features are not exposed as working.

## Development and verification

Node 24 and Java 21 are used. Backend: structured Fastify/TypeScript modules (small enough to avoid a separate NestJS layer). Frontend: Next.js/React/TypeScript with plain CSS; no charting service or external state library is required. PostgreSQL access uses Drizzle.

```sh
npm ci
npm run build
npm run typecheck
npm run lint
npm test
# With Compose running:
node scripts/smoke.mjs
# After npx playwright install chromium:
npm run test:browser
node scripts/benchmark.mjs 50
node scripts/benchmark.mjs 250
```

The smoke test queues real games, checks SSE and results, cancels a running job, resumes it and verifies stable unique run identities. Benchmark reports are written under ignored `data/`. CI unit tests do not substitute for real-engine integration; the latter has a separate scheduled/manual workflow.

For a standalone engine spike after bootstrap, set `FORGE_HOME` and `LOG_DIR` to writable local runtime paths and run `npm run spike`. `SPIKE_CLOCK=1` exercises Forge's native clock; timed-out apparent wins are discarded.

## Benchmark import

The [reference JSON](examples/pauper-reference.json) documents the complete payload. Replace its decks and provenance with data you are authorized to import. Source URLs, date and meta share are optional; missing statistics remain null. Each import produces a new immutable version.

```sh
curl -X POST http://localhost:3000/api/v1/meta/import \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  --data-binary @examples/pauper-reference.json
```

CSV input is a JSON object with `name`, `source`, `format: "pauper"`, and `csv`. CSV columns: `name,archetype,strategy,decklist` (quote multiline decklists). Import is disabled when `ADMIN_TOKEN` is empty.

## Reading results

Forge AI uses heuristics and is generally strongest with aggro/midrange, weaker with control and combo. **A simulated rate measures this Forge configuration, not human tournament win rate.** Win rates include rule draws as non-wins; timeouts and engine errors are excluded and shown separately. Starting player is observed rather than forced. Seeds initialize Forge's RNG but are not a guarantee of deterministic replay across builds or internal threads.

See [simulation methodology](docs/SIMULATION_MODEL.md), [Forge integration](docs/FORGE_INTEGRATION.md), [statistics](docs/STATISTICS.md), [deployment](docs/DEPLOYMENT.md), [licensing](docs/LICENSING.md), and [verification evidence](docs/VERIFICATION.md).

This independent application is not affiliated with or endorsed by Wizards of the Coast. Magic: The Gathering is a trademark of Wizards of the Coast. No card artwork is bundled.
