# syntax=docker/dockerfile:1

# ---------- base: install production deps only ----------
FROM node:24-alpine AS base
WORKDIR /app
RUN apk add --no-cache dumb-init

# config-service is NOT in the root workspaces array — it uses its OWN
# package-lock.json (npm ci below installs from it exactly), matching
# services/email-service's convention rather than billing-service's (which
# installs against the root lockfile — see check-dockerfile-lockfile.mjs's
# EXEMPT list for why that one is a special case, not a pattern to copy).
#
# app.ts imports @izzywdev/fuzefront-identity (file:../../packages/identity) as
# a bare specifier. npm must see the target manifest here or it creates a
# DANGLING symlink in node_modules — the "Cannot find module
# '@izzywdev/fuzefront-identity'" crashloop billing-service's Dockerfile
# documents hitting first.
COPY packages/identity/package.json ./packages/identity/
COPY services/config-service/package.json services/config-service/package-lock.json ./services/config-service/

RUN cd services/config-service && npm ci --omit=dev --ignore-scripts

# ---------- build: full compile ----------
FROM node:24-alpine AS build
WORKDIR /app
COPY packages/identity/package.json ./packages/identity/
COPY services/config-service/package.json services/config-service/package-lock.json ./services/config-service/

RUN cd services/config-service && npm ci --ignore-scripts

# Copy source
COPY packages/identity/ ./packages/identity/
COPY services/config-service/ ./services/config-service/

# Build identity first (config-service's app.ts imports it at module load —
# graphCreate-style middleware is not mounted yet, but mintId/toUuid/assertRef
# are used by the repositories), then config-service.
RUN cd packages/identity && npm install --ignore-scripts && npm run build
RUN cd services/config-service && npm run build
# tsc does NOT copy non-TS assets. runMigrations reads
# dist/migrations/*.sql at startup; without this the pod logs
# "ENOENT ... dist/migrations/001_config_namespaces.sql" and every table is
# missing ("relation config_namespaces does not exist") — the exact failure
# billing-service's Dockerfile documents hitting first.
RUN mkdir -p services/config-service/dist/migrations && \
    cp services/config-service/src/migrations/*.sql services/config-service/dist/migrations/

# ---------- production ----------
FROM node:24-alpine AS production
WORKDIR /app

RUN apk add --no-cache dumb-init && \
    addgroup -S configservice && adduser -S configservice -G configservice -u 1001

COPY --from=base /app/services/config-service/node_modules ./services/config-service/node_modules
COPY --from=build /app/services/config-service/dist ./services/config-service/dist
# @izzywdev/fuzefront-identity is a `file:` dependency, so npm LINKS it —
# node_modules/@izzywdev/fuzefront-identity is a symlink to /app/packages/identity.
# The base stage ships packages/identity/package.json so that link resolves
# instead of dangling; here we populate its target with the built output.
COPY --from=build /app/packages/identity/package.json ./packages/identity/package.json
COPY --from=build /app/packages/identity/dist ./packages/identity/dist

# Remove declaration files from production image
RUN find ./services/config-service/dist -name "*.d.ts" -type f -delete

WORKDIR /app/services/config-service

ENV PORT=3009
ENV NODE_ENV=production

EXPOSE 3009

USER configservice

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
