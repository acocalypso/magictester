# Deployment and operations

The supported initial boundary is a trusted local/private lab. Compose binds the web port to `127.0.0.1`; database, Redis, API, worker health and runner have no host port. There is no per-user authentication or ownership enforcement. Add authentication, authorization and TLS at a trusted gateway before exposing it to other users. Do not merely change the host binding and call it a production multi-tenant service.

## Services and storage

`bootstrap` is a one-shot data download, migration and seed step. `web`, `api`, `worker`, `forge-runner`, `maintenance`, `postgres` and `redis` have health checks and restart policies. The runner handles one or a configured small number of JVMs and must remain a single replica to retain its global process bound. Configure memory to cover process count × heap plus JVM/Node overhead. The default 2 GB runner accommodates one 1 GB heap, not eight.

Named volumes preserve PostgreSQL records, Redis AOF, Forge/card cache and game logs. Back up PostgreSQL and runtime metadata before upgrades. Engine stdout/stderr are in `forge-logs`; Docker JSON logs rotate at 10 MB × 3 files. Engine logs have automatic byte/file/age limits; see [operations](OPERATIONS.md) for configuration and metadata refresh.

`docker compose down` preserves volumes. `down -v` deletes them and must not be used for routine restarts. Never commit `.env`, credentials, caches, or generated benchmark artifacts.

## Recovery

BullMQ maintains worker locks and detects stalled attempts. A PostgreSQL advisory lock prevents concurrent processing of a single benchmark. Every game is planned with a unique stable identity, and completed writes only replace pending rows. After interruption, only pending absolute unit indices execute. A partially played BO3 restarts from its first game; completed games/matches remain unchanged and interrupted game observations stay in the audit. On ordinary process/HTTP failure BullMQ retries once; final unresolved games become explicit errors. Failed/cancelled benchmarks have an explicit retry action that preserves completed rows.

API reconciliation checks active durable jobs every 10 seconds and republishes missing queue entries, covering a database commit followed by a Redis failure. Redis AOF and PostgreSQL must both retain their data for normal operations. Recovery from deliberate Redis data deletion is outside the ordinary restart path; review persisted job states before restoring backups.

Cancellation stores a durable flag immediately and stops new work. Polling aborts an active runner request within about one second; the runner kills its process group and escalates after three seconds. A job can show cancelled while the previous worker is still releasing resources; retry returns HTTP 409 until that worker stops.

## Health and logs

- API `/health`: database, Redis and loaded card data.
- Runner `/health`: JAR availability, active/capacity and verified capabilities.
- Worker `/health`: BullMQ running status, database and Redis.
- Maintenance `/health`: refresh activity and last success/error; admin refresh is proxied through the API.
- Web root: HTTP availability; `/api/v1/status` checks the proxied API path.
- PostgreSQL `pg_isready`; Redis `PING`.

Structured logs carry job/opponent IDs and failures. Logs retain game text and stderr; never expose the internal runner directly to untrusted clients. Job/runs APIs intentionally omit internal stack traces. API OpenAPI/Swagger is proxied through `/api/docs`.

Scheduled feeds, immutable build publication, card-cache hot reload, storage retention and operational health are described in [operations](OPERATIONS.md).

## Limits

`MAX_GAMES_PER_JOB` (default 1000), `MAX_ACTIVE_JOBS_PER_CLIENT` (3), `MAX_QUEUED_JOBS` (100), `MAX_JOB_RUNTIME_SECONDS` (21600), `MAX_DECKLIST_BYTES` (32768), `SIMULATION_CONCURRENCY` (1), `MAX_FORGE_PROCESSES` (1), `FORGE_HEAP` (1024m). Job creation has a five-requests-per-minute IP limit. The current UI caps custom depth at 1000; lower server limits still apply.

Untrusted deck names never become paths or shell command text. Card input is parsed, canonicalized and validated; the adapter writes generated filenames in private temporary directories and passes an argument array to `spawn` without a shell.

## CI

Push/PR CI runs lint, build, type checks, unit tests and backend/web Docker builds. Scheduled/manual real-engine CI boots Compose and runs the smoke script, including cancellation/resume. Benchmark scripts run larger real workloads on demand. CI definitions are present; workflow results must be checked after pushing rather than assumed from their existence.

## Controlled exhausted-retry test

On an idle lab (no queued or running benchmarks), `scripts/queue-failure-smoke.mjs` can verify the terminal failure path. Stop the ordinary worker, run the test inside the API container, then start the worker again:

```sh
docker compose stop worker
docker compose exec -T api node scripts/queue-failure-smoke.mjs
docker compose start worker
```

The script creates one benchmark, injects a bounded failing worker, verifies that reconciliation does not retry forever, and queues an explicit retry. The normal worker then completes its one real game. It requires compiled backend files and the Compose service environment; it is not a unit test.
