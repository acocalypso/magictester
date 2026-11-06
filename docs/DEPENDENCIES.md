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
