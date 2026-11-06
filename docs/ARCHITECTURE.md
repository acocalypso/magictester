# Architecture

```mermaid
flowchart LR
  Browser --> Web[Next.js web / API proxy]
  Web --> API[Fastify TypeScript API]
  API --> PG[(PostgreSQL / Drizzle)]
  API --> Queue[(Redis / BullMQ)]
  Queue --> Worker[Simulation worker]
  Worker --> PG
  Worker --> Runner[Internal Forge runner]
  Runner --> JVM[Isolated Forge JVM]
```

The API does inexpensive parsing, validation, snapshot import, job planning and read operations. It never spawns Forge. Fastify supplies explicit modules, request schemas, rate limits, structured logs and OpenAPI with less scaffolding than NestJS for this MVP. Next.js uses React and TypeScript; plain CSS makes the compact interface independent of a styling build plugin.

`CardDataProvider` loads a single cached Scryfall bulk dataset plus script names and role/ability facts extracted through the pinned Forge rules parser. Exact card names win over face aliases; tokens/emblems cannot overwrite real cards. `MetaDeckProvider` implementations normalize manual JSON/CSV imports before simulation. Each deck and opponent snapshot is immutable.

The API transaction inserts a deck version, immutable job configuration/roster and every planned run. Commander/cEDH use stable ordered pod keys in the run identity; saved rosters resolve exclusively against their immutable opponent snapshot. A stable `(job_id, opponent_id, batch_index)` identity prevents duplicate counting. The job table acts as a durable enqueue outbox. A reconciliation loop inserts missing BullMQ jobs after Redis/network interruptions. A PostgreSQL session advisory lock prevents concurrent workers from owning the same benchmark.

The worker runs one opponent batch at a time and checkpoints each completed game. The runner streams NDJSON results and heartbeats. Its process counter is the global JVM bound; only one runner replica should be deployed. Worker concurrency may exceed engine capacity, in which case workers wait rather than spawning more JVMs.

Cancellation commits a flag/status, the worker aborts its HTTP stream, and the runner terminates the Java process group with SIGTERM followed by SIGKILL. Completed rows survive. On recovery, an incomplete opponent batch uses its stable per-game seed schedule; already committed run identities are skipped. This is checkpoint recovery, not mid-game continuation or deterministic replay.

The database stores normalized results, snapshots, configuration, engine build, batch seed and game index. Aggregates are computed from those results and can always be rebuilt. No calculated rate is persisted as a substitute for evidence.
