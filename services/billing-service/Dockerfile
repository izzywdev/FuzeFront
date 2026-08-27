# syntax=docker/dockerfile:1

# ---------- base: install production deps only ----------
FROM node:24-alpine AS base
WORKDIR /app
RUN apk add --no-cache dumb-init

# Copy workspace root manifests and service manifest
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY services/billing-service/package.json ./services/billing-service/
# app.ts imports @izzywdev/fuzefront-identity (file:../../packages/identity) as a
# bare specifier. npm must see the target manifest here or it creates a DANGLING
# symlink in node_modules — the "Cannot find module '@izzywdev/fuzefront-identity'"
# crashloop. With the manifest present the symlink resolves to /app/packages/identity,
# which the production stage then populates with the built dist.
COPY packages/identity/package.json ./packages/identity/

# Install only production deps for billing-service
RUN cd services/billing-service && npm install --omit=dev --ignore-scripts

# ---------- build: full compile ----------
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY services/billing-service/package.json ./services/billing-service/

# Install billing-service deps (including devDeps for tsc)
RUN cd services/billing-service && npm install --ignore-scripts
# Install shared devDeps so we can compile the kafka sub-tree
RUN cd shared && npm install --ignore-scripts

# Copy source
COPY shared/ ./shared/
COPY packages/identity/ ./packages/identity/
COPY services/billing-service/ ./services/billing-service/

# Build the shared kafka + identity sub-trees first (avoids socket.io-client /
# React dep), then billing-service. identity supplies the graph-create
# middleware app.ts mounts; without it the image starts and fails on import.
RUN cd shared && npm run build:kafka
RUN cd packages/identity && npm install --ignore-scripts && npm run build
RUN cd services/billing-service && npm run build
# tsc does NOT copy non-TS assets. runMigrations reads
# dist/migrations/001_billing_schema.sql at startup; without this the pod logs
# "ENOENT ... dist/migrations/001_billing_schema.sql", the migration is skipped,
# and every billing table is missing ("relation billing.* does not exist").
RUN mkdir -p services/billing-service/dist/migrations && \
    cp services/billing-service/src/migrations/*.sql services/billing-service/dist/migrations/
# The public /docs route (Swagger UI) reads dist/openapi.yaml at request time;
# tsc does not copy non-TS assets, so place the contract next to the compiled JS.
RUN cp services/billing-service/openapi.yaml services/billing-service/dist/openapi.yaml

# ---------- production ----------
FROM node:24-alpine AS production
WORKDIR /app

RUN apk add --no-cache dumb-init && \
    addgroup -S billingservice && adduser -S billingservice -G billingservice -u 1001

COPY --from=base /app/services/billing-service/node_modules ./services/billing-service/node_modules
COPY --from=build /app/shared/dist ./shared/dist
# shared/package.json carries the `exports` map that makes `@fuzefront/shared/kafka`
# (the supported subpath — see src/index.ts et al.) resolvable at all: with no
# package.json here, Node has no `exports` to consult and a subpath import beyond
# the package root simply 404s (MODULE_NOT_FOUND), it does not "fall back" to
# anything. Omitting this file is NOT a safe shortcut — a prior version of this
# image omitted it, which happened to make an undeclared deep path
# (`@fuzefront/shared/dist/kafka`) resolve by accident (no exports map to enforce
# against). That was the bug fixed here (issue #753); this COPY is what makes the
# *correct* subpath import work in the image the same way it works locally.
COPY --from=build /app/shared/package.json ./shared/package.json
# shared/dist/kafka/* does require('zod') + kafkajs at runtime, resolved by walking
# UP from the file → it reaches /app/node_modules. The service deps (which include
# zod + kafkajs) only sat in the sibling services/billing-service/node_modules,
# unreachable from /app/shared/dist → the pod crashlooped "Cannot find module
# 'zod'". Put the deps at the ROOT /app/node_modules so BOTH shared/dist and the
# service (WORKDIR walks up) resolve them.
COPY --from=base /app/services/billing-service/node_modules ./node_modules
COPY --from=build /app/services/billing-service/dist ./services/billing-service/dist
# @izzywdev/fuzefront-identity is a `file:` dependency, so npm LINKS it —
# node_modules/@izzywdev/fuzefront-identity is a symlink to /app/packages/identity.
# The base stage now ships packages/identity/package.json so that link resolves
# instead of dangling; here we populate its target with the built output. app.ts
# imports graphCreate at module load, so without this the container dies at boot
# with "Cannot find module '@izzywdev/fuzefront-identity'". Only dist/ +
# package.json are needed — exactly what the package publishes.
COPY --from=build /app/packages/identity/package.json ./packages/identity/package.json
COPY --from=build /app/packages/identity/dist ./packages/identity/dist

# Remove declaration files from production image
RUN find ./services/billing-service/dist -name "*.d.ts" -type f -delete

WORKDIR /app/services/billing-service

ENV PORT=3006
ENV NODE_ENV=production

EXPOSE 3006

USER billingservice

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
