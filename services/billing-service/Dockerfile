# syntax=docker/dockerfile:1

# ---------- base: install production deps only ----------
FROM node:24-alpine AS base
WORKDIR /app
RUN apk add --no-cache dumb-init

# Copy EVERY workspace manifest named by the root "workspaces" array, then
# `npm ci` from the lockfile root. The previous `cd <member> && npm install`
# re-resolved floating ranges against the live registry on every build, so two
# builds of the same commit could ship different dependency trees (FFRNT-254).
# `npm ci` cannot run from inside a workspace member — the lockfile lives at the
# root — so the install moves to the root and `-w` keeps it to this service's
# subtree instead of pulling in every UI workspace's React toolchain.
#
# Deps therefore land in /app/node_modules rather than
# /app/services/billing-service/node_modules. That is where they were being
# copied to anyway (see the production stage): node resolution walks UP from
# /app/services/billing-service/dist and from /app/shared/dist, so a single root
# node_modules serves both — which is exactly what the old double-copy was
# hand-building.
#
# scripts/check-dockerfile-lockfile.mjs keeps this list in sync with the root
# workspaces array.
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY backend/core/package.json ./backend/core/
COPY backend/security/package.json ./backend/security/
COPY backend/applications/package.json ./backend/applications/
COPY shared/package.json ./shared/
COPY packages/identity/package.json ./packages/identity/
COPY billing-client/package.json ./billing-client/
COPY custom-hostname-client/package.json ./custom-hostname-client/
COPY packages/billing-ui/package.json ./packages/billing-ui/
COPY packages/chat-client/package.json ./packages/chat-client/
COPY packages/chat-ui/package.json ./packages/chat-ui/
COPY packages/identity-ui/package.json ./packages/identity-ui/
COPY packages/auth-ui/package.json ./packages/auth-ui/
COPY packages/account-security-ui/package.json ./packages/account-security-ui/
COPY packages/portal-branding-ui/package.json ./packages/portal-branding-ui/
COPY portal-client/package.json ./portal-client/
COPY packages/i18n/package.json ./packages/i18n/
COPY packages/i18n-translate/package.json ./packages/i18n-translate/
COPY packages/feature-flags/package.json ./packages/feature-flags/
COPY packages/security/package.json ./packages/security/
COPY design-system/package.json ./design-system/
COPY services/chat-service/package.json ./services/chat-service/
COPY services/email-service/package.json ./services/email-service/
COPY services/notification-service/package.json ./services/notification-service/

RUN npm ci --omit=dev --ignore-scripts \
      -w services/billing-service -w shared -w packages/identity \
      --include-workspace-root

# ---------- build: full compile ----------
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY backend/core/package.json ./backend/core/
COPY backend/security/package.json ./backend/security/
COPY backend/applications/package.json ./backend/applications/
COPY shared/package.json ./shared/
COPY packages/identity/package.json ./packages/identity/
COPY billing-client/package.json ./billing-client/
COPY custom-hostname-client/package.json ./custom-hostname-client/
COPY packages/billing-ui/package.json ./packages/billing-ui/
COPY packages/chat-client/package.json ./packages/chat-client/
COPY packages/chat-ui/package.json ./packages/chat-ui/
COPY packages/identity-ui/package.json ./packages/identity-ui/
COPY packages/auth-ui/package.json ./packages/auth-ui/
COPY packages/account-security-ui/package.json ./packages/account-security-ui/
COPY packages/portal-branding-ui/package.json ./packages/portal-branding-ui/
COPY portal-client/package.json ./portal-client/
COPY packages/i18n/package.json ./packages/i18n/
COPY packages/i18n-translate/package.json ./packages/i18n-translate/
COPY packages/feature-flags/package.json ./packages/feature-flags/
COPY packages/security/package.json ./packages/security/
COPY design-system/package.json ./design-system/
COPY services/chat-service/package.json ./services/chat-service/
COPY services/email-service/package.json ./services/email-service/
COPY services/notification-service/package.json ./services/notification-service/

# devDeps included here (tsc, and shared's toolchain for the kafka sub-tree).
RUN npm ci --ignore-scripts \
      -w services/billing-service -w shared -w packages/identity \
      --include-workspace-root

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

COPY --from=build /app/shared/dist ./shared/dist
# ONE copy at the ROOT, not two. shared/dist/kafka/* does require('zod') +
# kafkajs at runtime, resolved by walking UP from the file until it reaches
# /app/node_modules; the service resolves the same way from
# /app/services/billing-service/dist. A single /app/node_modules therefore
# serves both — which is what the previous double-copy was hand-building from a
# per-service install (the sibling-only copy is what crashlooped the pod with
# "Cannot find module 'zod'"). `npm ci` at the workspace root now puts the deps
# there directly.
COPY --from=base /app/node_modules ./node_modules
COPY --from=build /app/services/billing-service/dist ./services/billing-service/dist
# @izzywdev/fuzefront-identity is a `file:` dependency, so npm links it —
# /app/node_modules/@izzywdev/fuzefront-identity is a SYMLINK to
# /app/packages/identity, and copying node_modules alone copies a DANGLING link.
# The package must be copied too or app.ts fails at module load with "Cannot find
# module '@izzywdev/fuzefront-identity'": it imports graphCreate at the top of the
# file, so the process dies at boot rather than degrading.
#
# This was broken on master: `npm install` exits 0 with the link's target absent,
# so nothing surfaced it until the container ran. Verified by replicating the
# base stage and inspecting the link. Only dist/ + package.json are needed —
# that is exactly what the package publishes ("files": ["dist", "README.md"]).
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
