# Latest stable Forge

The application follows the official [latest stable GitHub release](https://github.com/Card-Forge/forge/releases/latest). Drafts, prereleases and nightlies are excluded. The maintained bootstrap baseline is 2.0.15; the live GitHub endpoint also reported 2.0.15 on 6 November 2026. The JAR's build banner contains `SNAPSHOT`; update selection uses the stable GitHub release designation, not that internal banner.

First boot checks for a newer release before starting the API. Maintenance checks on startup and hourly (`FORGE_CHECK_HOURS`, minimum one). It uses the official release asset's SHA-256 digest, resolves the exact source tag to an immutable commit and rejects unexpected URLs, missing checksums or downgrades. An archive changed under the same version is an error.

A newer release is extracted into a separate staging directory. Bootstrap generates that release's supported-card names and rules facts, applies maintained overrides to source from the exact release commit, and compiles the bridge against that JAR. Every patch anchor must match exactly once; changed upstream APIs fail validation rather than silently losing rule fixes. Release identity and resolved patch bytes are included in the bridge build hash.

Activation requires the actual native Duel, match and Commander-color contracts plus played BO1, BO3, four-player Commander and Duel Commander games. The candidate must complete normally. Only then is the complete immutable directory renamed into `forge/releases/` and `runtime-registry.json` atomically switched. A PostgreSQL advisory lock serializes engine updates and metadata refreshes. Maintenance has a 4 GiB memory limit; Java compilation, metadata extraction and validation use bounded heaps. Old release directories and bridge builds remain available for queued and resumed jobs, whose requests pin engine version and bridge source hash.

The API reloads active rules data within 30 seconds. Daily opponent pools are revalidated when the engine or card data changes. New daily benchmarks wait for a pool validated against the active engine. If a newer stable release is known but cannot pass validation, new benchmarks return 503; existing pinned jobs can finish. Release-check errors and checks older than 26 hours also block new benchmarks. Upstream compatibility changes may require maintaining the bridge; the service exposes the failure and keeps the last validated runtime intact.

`GET /api/v1/status` and `/api/v1/operations` expose active/latest versions, stable channel, check time, validation evidence and errors. The sidebar shows the actual active version; the queue maintenance disclosure shows update status. An admin can trigger `POST /api/v1/operations/check-forge`. To run manually with the configured database and runtime volume:

```sh
docker compose run --rm --no-deps bootstrap node scripts/update-forge.mjs
# Exercise download/checksum/build/native contracts/real games for the current stable version:
docker compose run --rm --no-deps bootstrap node scripts/update-forge.mjs --verify-current
```

Metadata refresh uses `--metadata-only` and cannot upgrade or downgrade Forge. Back up PostgreSQL, runtime registry and release directories together. Do not delete an archived runtime while its jobs may be resumed. Runtime evidence is private deployment data; no third-party release archive is committed.
