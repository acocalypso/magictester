# Deployment and operations

The supported initial boundary is a trusted local/private lab. Compose binds the web port to `127.0.0.1`; database, Redis, API, worker health and runner have no host port. There is no per-user authentication or ownership enforcement. Add authentication, authorization and TLS at a trusted gateway before exposing it to other users. Do not merely change the host binding and call it a production multi-tenant service.

## Services and storage

`bootstrap` is a one-shot data download, migration and seed step. `web`, `api`, `worker`, `forge-runner`, `maintenance`, `postgres` and `redis` have health checks and restart policies. The runner schedules JVMs against detected CPU and available memory and must remain a single replica to retain its global process bound. Docker CPU/memory limits and Docker Desktop VM allocations bound the detected resources. The queue screen shows current capacity and its limiting resource.

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

`MAX_GAMES_PER_JOB` (default 1000), `MAX_ACTIVE_JOBS_PER_CLIENT` (3), `MAX_QUEUED_JOBS` (100), `MAX_JOB_RUNTIME_SECONDS` (21600), `MAX_DECKLIST_BYTES` (32768), `SIMULATION_CONCURRENCY` (0: automatic), `MAX_FORGE_PROCESSES` (0: automatic), `FORGE_HEAP` (1024m). Job creation has a five-requests-per-minute IP limit. The current UI caps custom depth at 1000; lower server limits still apply.

Untrusted deck names never become paths or shell command text. Card input is parsed, canonicalized and validated; the adapter writes generated filenames in private temporary directories and passes an argument array to `spawn` without a shell.

## Parallel analyses and matches

Automatic mode allows several analyses and several independent matches within each analysis. All requests share the single runner's resource budget. New batches favor analyses with fewer active batches; an existing batch finishes before its slot changes hands. Games within one BO3 stay sequential so sideboarding and match state remain correct. Completed run identities and seeds survive parallel execution, cancellation and retry.

Before each launch, the runner reads CPU quotas, CPU affinity and available memory, including Linux cgroup limits. The default CPU budget is two cores per JVM (`FORGE_CPUS_PER_PROCESS=2`). Each process reserves `FORGE_HEAP` (default 1024m) plus `FORGE_MEMORY_OVERHEAD_MB` (512). Additional memory headroom is 15% of detected memory, between 256 MiB and 2 GiB; set `FORGE_MEMORY_RESERVE_MB` to a positive value to override it. Running JVM anonymous RSS is credited once while unused heap remains reserved. Capacity is capped at 16 processes. When memory falls short, new launches wait; running matches finish normally. Other workloads and JVM native allocations can still vary, so this is a conservative admission estimate, not an OOM guarantee.

`SIMULATION_CONCURRENCY` limits active analyses; `MAX_FORGE_PROCESSES` caps total JVMs. Zero enables automatic capacity. Positive values retain an operator cap. Match work is split into batches of at most `FORGE_BATCH_SIZE` units (default 50); smaller batches improve sharing and resource adaptation but repeat Forge's expensive startup more often. The worker refreshes capacity every five seconds; the runner checks every second and before each admission. A free slot can serve another opponent, another batch against the same opponent, or another analysis. More processes help only when hardware has spare capacity.

For an existing installation, old `.env` values still apply. To enable detection instead of the former single-analysis and 2 GB runner settings, use:

```dotenv
SIMULATION_CONCURRENCY=0
MAX_FORGE_PROCESSES=0
RUNNER_MEMORY=0
RUNNER_CPUS=0
```

`RUNNER_MEMORY=0` and `RUNNER_CPUS=0` remove Compose's additional runner-only limit; detected machine/VM limits still apply. Explicit Docker limits remain supported. Restart with `docker compose up -d --build` after current analyses finish. On Docker Desktop, increase its assigned resources if needed; the app cannot use hardware outside that VM allocation.

For real-engine acceptance on an idle lab configured for at least two slots, run `node scripts/concurrency-smoke.mjs`. It checks one analysis using two batches, two analyses sharing the runner, and cancellation/retry with stable completed results. The script records actual capacity and a report in `data/concurrency-smoke.json`; it creates real analyses and consumes Forge time.

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
