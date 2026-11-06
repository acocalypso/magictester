# syntax=docker/dockerfile:1
FROM node:24-alpine AS backend-build
WORKDIR /app
COPY . .
RUN --mount=type=secret,id=proxy_ca NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca npm ci --workspaces=false --strict-ssl=true && npx tsc && npm prune --omit=dev --workspaces=false && mkdir -p logs && chown node:node logs
FROM node:24-alpine AS backend
WORKDIR /app
ENV NODE_ENV=production
COPY --from=backend-build --chown=node:node /app /app
USER node
CMD ["node","dist/api.js"]
FROM backend AS runner
USER root
RUN --mount=type=secret,id=proxy_ca if [ -f /run/secrets/proxy_ca ]; then export SSL_CERT_FILE=/run/secrets/proxy_ca; fi; apk add --no-cache openjdk21-jre-headless
USER node
CMD ["node","dist/runner.js"]
FROM backend AS bootstrap
USER root
RUN --mount=type=secret,id=proxy_ca if [ -f /run/secrets/proxy_ca ]; then export SSL_CERT_FILE=/run/secrets/proxy_ca; fi; apk add --no-cache openjdk21-jdk bzip2
ENV NODE_USE_ENV_PROXY=1
CMD ["sh","-c","node scripts/bootstrap.mjs && node dist/migrate.js && node dist/seed.js"]
FROM node:24-alpine AS web-build
WORKDIR /app
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN --mount=type=secret,id=proxy_ca NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca npm ci --strict-ssl=true && npm run build -w apps/web && mkdir -p /out/apps/web/.next && cp -a apps/web/.next/standalone/. /out/ && cp -a apps/web/.next/static /out/apps/web/.next/static && node -e "require('fs').rmSync('node_modules',{recursive:true,force:true});require('fs').rmSync('apps/web/.next',{recursive:true,force:true})"
FROM node:24-alpine AS web
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
COPY --from=web-build --chown=node:node /out /app
USER node
CMD ["node","apps/web/server.js"]
