# Dependency audit

Audit date: 6 November 2026. Versions were checked against npm's current stable tags and published engine/peer requirements. Context7 was queried through its public MCP endpoint for BullMQ migration, TypeScript-ESLint compatibility/configuration and ESLint 10 migration guidance. Context7 documentation snapshots can lag package releases; npm metadata determines the available versions.

## Application dependencies

| Package | Previously installed | Updated baseline |
| --- | --- | --- |
| BullMQ | 5.81.5 | 6.7.1 |
| ioredis | 5.11.1 | 6.0.0 |
| @fastify/rate-limit | 10.3.0 | 11.2.2 |
| Cheerio | 1.1.2 | 1.2.0 |

The queue does not use removed BullMQ internals, legacy repeatable jobs or deprecated job APIs. The explicit ioredis dependency is retained because BullMQ 6 makes Redis drivers optional peers. ioredis 6 defaults to RESP3; connection options explicitly retain RESP2 to preserve the existing queue protocol during migration. The Fastify rate-limit plugin's published compatibility table and plugin metadata support Fastify 5. Cheerio's Node >=20.18.1 requirement is satisfied by Node 24.

Next.js 16.4.5, React/React DOM 19.3.1, Fastify 5.12.8, Drizzle 0.45.4, pg 8.23.1, Zod 4.6.7, Playwright 1.65.0, and the remaining direct application packages were already current in the lockfile. Old-looking minimum caret ranges in the manifests were not their installed versions; those minimums now match the verified baseline.

Sources:

- [Context7 BullMQ](https://context7.com/taskforcesh/bullmq), including the upstream v6 breaking-change notes.
- [BullMQ migration changelog](https://github.com/taskforcesh/bullmq/blob/master/docs/gitbook/changelog.md).
- [ioredis 6 release notes](https://github.com/redis/ioredis/blob/main/CHANGELOG.md).
- [Fastify rate-limit compatibility](https://github.com/fastify/fastify-rate-limit#compatibility).
- [Context7 TypeScript-ESLint](https://context7.com/typescript-eslint/typescript-eslint).
- [Context7 ESLint](https://context7.com/eslint/eslint).

Use `npm outdated`, `npm ls --all` and `npm audit` when reviewing future upgrades. Keep the lockfile checked in and use `npm ci` for reproducible installations. A package with a higher major release needs a compatibility check rather than an automatic forced update.

Runtime upgrade verification: build, type checking, lint and 69 tests passed. The upgraded API/worker connected to the existing Redis queue and completed real-engine acceptance, including six games and cancellation/resume (`c87811a1-d7be-49cb-8d35-2308af4290f8`, cancellation job `16cd8641-2d8a-4b47-8502-1e0c212b724d`). Existing completed queue/job data was retained.

## Tooling and security

| Package | Previously installed | Updated baseline |
| --- | --- | --- |
| TypeScript | 5.9.3 | 6.0.3 (patch-only range) |
| ESLint | 9.39.5 | 10.14.0 |
| @eslint/js | 9.39.5 | 10.0.1 |
| @types/node | 22.20.5 | 24.19.2 |
| typescript-eslint | 8.72.1 | 8.72.1, explicit current baseline |

TypeScript 7.0.2 is the latest stable compiler, but `typescript-eslint@8.72.1` declares `typescript >=4.8.4 <6.1.0`. The supported compiler is therefore 6.0.3, pinned to patch updates until the parser supports a newer compiler. Node typings intentionally follow the application's Node 24 runtime rather than the latest Node 26 declarations. These are the only two direct packages remaining in `npm outdated`; both are on their newest allowed versions.

The ESLint config now uses core `defineConfig` instead of the deprecated `typescript-eslint.config` helper, as recommended by Context7's versioned TypeScript-ESLint documentation. ESLint 10's recommended rules found an unused initial assignment in companion validation; removing it preserves the exhaustive switch's behavior. TypeScript 6 emits identical backend JavaScript to TypeScript 5.9 for every other source file.

The initial audit reported seven moderate entries caused by one development-only minimatch advisory ([GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)). A targeted override upgrades minimatch 10 consumers to the patched 11.x API (`^11.0.1`, resolved 11.0.5). It does not force older callable minimatch APIs onto a new major. Linting and TypeScript-ESLint parsing pass against this override. The audit's proposed downgrade to an older TypeScript-ESLint version was not used. Final `npm audit` reports zero vulnerabilities, including development dependencies.

One upstream deprecation warning remains: the latest Cheerio 1.2.0 depends on `encoding-sniffer@^0.2.1`, which uses deprecated `whatwg-encoding@3.1.1`. The newer encoding-sniffer 1.x changes module format and falls outside Cheerio's published range; it is not forced into the application just to hide a warning. No advisory is reported for this chain. This should be revisited when Cheerio updates its supported dependency range.

On x64, npm 11 may report the platform-filtered Sharp WASM descendants (`@img/sharp-wasm32`, `@emnapi/runtime`) as extraneous while retaining them in the cross-platform optional lockfile. Their parent packages target FreeBSD/WebContainers. They are not invalid peers or outdated direct dependencies, and their lock entries are preserved for other platforms.

Tooling verification: a fresh `npm ci`, production build, type checking, ESLint 10 and all 69 tests passed. Peer versions satisfy the published constraints. The updated runtime also passed daily-source acceptance across all nine formats and a real sourced-opponent game (`3fbd1e9f-fd1d-41d9-bb94-74d827028c5b`).

Additional acceptance: BullMQ 6 exhausted-retry reconciliation passed (`04f9bc4d-2eae-47cc-a7f9-4e7d70b67b61`): failed jobs stayed failed without automatic requeue, and explicit retry queued them again. Browser acceptance passed at 1440/768/390 pixels against an existing real job, including keyboard dialog checks, zero uncaught/font errors and local fonts only. The fresh TypeScript 6 build was used for this browser check.
