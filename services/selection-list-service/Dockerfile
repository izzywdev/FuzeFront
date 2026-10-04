# syntax=docker/dockerfile:1
#
# selection-list-service Dockerfile
# Base image: node:24-alpine (mandated minimum per CLAUDE.md toolchain table).
#
# WORKSPACE MANIFEST COPY PATTERN: npm ci must see ALL workspace manifests before
# installing, because npm hoists against the full manifest set. A subset install
# computes a different hoisting tree than the lockfile and can silently drop
# packages — the image still exits 0 and crashes at boot (see chat-service
# Dockerfile comment for the incident history).
# scripts/check-dockerfile-lockfile.mjs keeps this list in sync with package.json.

# ---------- base: install production deps only ----------
FROM node:24-alpine AS base
WORKDIR /app
RUN apk add --no-cache dumb-init

# Copy workspace root manifests first (npm hoisting requires all of them)
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY backend/core/package.json ./backend/core/
COPY backend/security/package.json ./backend/security/
COPY backend/applications/package.json ./backend/applications/
COPY shared/package.json ./shared/
COPY packages/identity/package.json ./packages/identity/
COPY packages/auth/package.json ./packages/auth/
COPY packages/telemetry/package.json ./packages/telemetry/
COPY packages/service-auth/package.json ./packages/service-auth/
COPY api-client/package.json ./api-client/
COPY sdk/package.json ./sdk/
COPY billing-client/package.json ./billing-client/
COPY config-client/package.json ./config-client/
COPY packages/config-ui/package.json ./packages/config-ui/
COPY custom-hostname-client/package.json ./custom-hostname-client/
COPY packages/billing-ui/package.json ./packages/billing-ui/
COPY packages/chat-client/package.json ./packages/chat-client/
COPY packages/chat-ui/package.json ./packages/chat-ui/
COPY packages/identity-ui/package.json ./packages/identity-ui/
COPY packages/auth-ui/package.json ./packages/auth-ui/
COPY packages/account-security-ui/package.json ./packages/account-security-ui/
COPY packages/portal-branding-ui/package.json ./packages/portal-branding-ui/
COPY packages/portal-admin-ui/package.json ./packages/portal-admin-ui/
COPY portal-client/package.json ./portal-client/
COPY packages/i18n/package.json ./packages/i18n/
COPY packages/i18n-translate/package.json ./packages/i18n-translate/
COPY packages/feature-flags/package.json ./packages/feature-flags/
COPY packages/security/package.json ./packages/security/
COPY packages/selection-lists-ui/package.json ./packages/selection-lists-ui/
COPY design-system/package.json ./design-system/
COPY services/chat-service/package.json ./services/chat-service/
COPY services/email-service/package.json ./services/email-service/
COPY services/notification-service/package.json ./services/notification-service/
COPY services/selection-list-service/package.json ./services/selection-list-service/
COPY services/devportal-service/package.json ./services/devportal-service/

# Install only production deps for selection-list-service
RUN npm ci --workspace=services/selection-list-service --omit=dev --ignore-scripts

# Guarantee the per-workspace node_modules directories the production stage COPYs
# actually exist. npm creates packages/<x>/node_modules ONLY when something could
# not be hoisted: packages/auth gets one because jose@5 conflicts with the root's
# jose@4, but packages/feature-flags' @openfeature/* + unleash-client have no such
# conflict today, so npm hoists them all and creates no directory at all -- and
# `COPY --from=base /app/packages/feature-flags/node_modules` would then fail the
# whole build with "not found" rather than copy nothing. The COPY has to stay
# unconditional (Docker has no conditional COPY, and
# scripts/check-dockerfile-lockfile.mjs requires the line so the image does not
# depend on what one resolution happened to hoist), so make the SOURCE exist. An
# empty directory is the correct outcome when everything hoisted; if a future
# resolution stops hoisting, the real contents land here and get copied without
# anyone having to remember why. (Same treatment as services/chat-service.)
RUN mkdir -p packages/auth/node_modules packages/feature-flags/node_modules

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
COPY packages/auth/package.json ./packages/auth/
COPY packages/telemetry/package.json ./packages/telemetry/
COPY packages/service-auth/package.json ./packages/service-auth/
COPY billing-client/package.json ./billing-client/
COPY config-client/package.json ./config-client/
COPY packages/config-ui/package.json ./packages/config-ui/
COPY custom-hostname-client/package.json ./custom-hostname-client/
COPY packages/billing-ui/package.json ./packages/billing-ui/
COPY packages/chat-client/package.json ./packages/chat-client/
COPY packages/chat-ui/package.json ./packages/chat-ui/
COPY packages/identity-ui/package.json ./packages/identity-ui/
COPY packages/auth-ui/package.json ./packages/auth-ui/
COPY packages/account-security-ui/package.json ./packages/account-security-ui/
COPY packages/portal-branding-ui/package.json ./packages/portal-branding-ui/
COPY packages/portal-admin-ui/package.json ./packages/portal-admin-ui/
COPY portal-client/package.json ./portal-client/
COPY packages/i18n/package.json ./packages/i18n/
COPY packages/i18n-translate/package.json ./packages/i18n-translate/
COPY packages/feature-flags/package.json ./packages/feature-flags/
COPY packages/security/package.json ./packages/security/
COPY packages/selection-lists-ui/package.json ./packages/selection-lists-ui/
COPY design-system/package.json ./design-system/
COPY services/chat-service/package.json ./services/chat-service/
COPY services/email-service/package.json ./services/email-service/
COPY services/notification-service/package.json ./services/notification-service/
COPY services/selection-list-service/package.json ./services/selection-list-service/
COPY services/devportal-service/package.json ./services/devportal-service/

RUN npm ci --workspace=services/selection-list-service --ignore-scripts

# Copy source
COPY packages/identity/ ./packages/identity/
COPY packages/auth/ ./packages/auth/
COPY packages/security/ ./packages/security/
COPY packages/service-auth/ ./packages/service-auth/
COPY packages/feature-flags/ ./packages/feature-flags/
COPY shared/ ./shared/
COPY services/selection-list-service/ ./services/selection-list-service/

# Build @izzywdev/fuzefront-identity first: it ships only TypeScript sources
# in-repo, and routes/items.ts + routes/lists.ts import it, so `tsc` needs its
# BUILT dist + .d.ts or the service build dies on TS2307 "Cannot find module".
# The manifest COPY in the list above is not enough -- that makes the workspace
# LINK resolve, not the types exist. Mirrors services/config-service/Dockerfile's
# identical treatment of the identical package.
RUN cd packages/identity && npm install --ignore-scripts && npm run build

# Then @fuzefront/auth (src/middleware/authz.ts -- authorization
# routed through FuzeFront's Security API instead of an embedded Permit.io
# SDK -- imports it at module load; createAuthzClient() is constructed at
# authz.ts's module scope), then selection-list-service. packages/auth IS a
# root workspace member, but the --workspace=services/selection-list-service
# filter above only installs SELECTION-LIST-SERVICE's own devDependencies,
# not packages/auth's (tsup) -- mirrors services/config-service/Dockerfile's
# identical treatment of the same package.
RUN cd packages/auth && npm install --ignore-scripts && npm run build
# Build @fuzefront/shared: selection-list-service now imports TypedConsumer /
# TypedProducer from @fuzefront/shared/kafka (src/events/consumer.ts) for
# the user/org lifecycle event consumers. shared/dist/index.d.ts is resolved
# at compile time; shared/dist/index.js at runtime. The --workspace filter
# above only installs selection-list-service's own devDeps, so shared needs
# its own install + build here — same pattern as packages/auth above.
RUN cd shared && npm install --ignore-scripts && npm run build
# @fuzefront/service-auth (src/lib/machineIdentity.ts: the service's own
# client_credentials token for Security API grant/revoke) re-exports types from
# @fuzefront/security-client, so that must be built first -- then service-auth
# itself, because `tsc` for the service resolves its dist/index.d.ts. Mirrors
# services/chat-service/Dockerfile's identical treatment.
RUN cd packages/security && npm install --ignore-scripts && npm run build
RUN cd packages/service-auth && npm run build
# @fuzefront/feature-flags (src/lib/featureFlags.ts calls its init() at startup so
# the release flag can actually turn ON -- rollout runbook B4). It is `require`d
# lazily, so nothing fails at tsc time, but without dist/ in the image the
# `require` throws, the client resolves to null and the flag is OFF forever.
RUN cd packages/feature-flags && npm install --ignore-scripts && npm run build
RUN cd services/selection-list-service && npm run build

# ---------- production ----------
FROM node:24-alpine AS production
WORKDIR /app

RUN apk add --no-cache dumb-init && \
    addgroup -S selectionlistsvc && adduser -S selectionlistsvc -G selectionlistsvc -u 1001

COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/services/selection-list-service/node_modules ./services/selection-list-service/node_modules
COPY --from=build /app/services/selection-list-service/dist ./services/selection-list-service/dist
# @fuzefront/auth is a workspace dependency, so npm LINKS it --
# node_modules/@fuzefront/auth is a symlink to /app/packages/auth. The base
# stage above ships packages/auth/package.json (workspace manifest list) so
# that link resolves instead of dangling; here we populate its target with
# the built output (mirrors services/config-service/Dockerfile's identical
# treatment of the same package -- the "Cannot find module '@fuzefront/auth'"
# crashloop it documents hitting first for @izzywdev/fuzefront-identity).
# @izzywdev/fuzefront-identity is a `file:` dependency, so npm LINKS it --
# node_modules/@izzywdev/fuzefront-identity is a symlink to /app/packages/identity.
# The base stage ships its package.json so the link resolves instead of dangling;
# here we populate its target with the built output. It declares NO runtime
# dependencies, so unlike packages/auth it needs no node_modules COPY.
COPY --from=build /app/packages/identity/package.json ./packages/identity/package.json
COPY --from=build /app/packages/identity/dist ./packages/identity/dist
COPY --from=build /app/packages/auth/package.json ./packages/auth/package.json
COPY --from=build /app/packages/auth/dist ./packages/auth/dist
# ...AND packages/auth's own runtime dependencies, which nothing else puts in
# this image. `jose` is required at module load by packages/auth/dist/index.js,
# and it is NOT hoisted to /app/node_modules: the root lockfile pins
# node_modules/jose to 4.15.9 for other consumers, so @fuzefront/auth's ^5.10.0
# can only live at packages/auth/node_modules/jose. The COPYs above ship the
# manifest and dist but not that directory, so the symlink resolves, dist/ is
# present, and the pod still dies at startup with "Cannot find module 'jose'" —
# the same crashloop services/config-service/Dockerfile documents hitting in
# prod the first time it was enabled. See FFRNT-254.
#
# Copied from `base`, not `build`: base installs with --omit=dev, so this
# directory contains jose and nothing else. The build stage runs a full
# `npm install` inside packages/auth to get tsup, and copying from there would
# drag tsup/typescript/jest into the production image.
COPY --from=base /app/packages/auth/node_modules ./packages/auth/node_modules
# @fuzefront/service-auth is a `file:` dep linked the same way (symlink target
# /app/packages/service-auth; its package.json ships in the base stage's manifest
# list). It declares NO runtime dependencies, so -- like @izzywdev/fuzefront-identity
# above and unlike packages/auth -- package.json + dist is all it needs.
COPY --from=build /app/packages/service-auth/package.json ./packages/service-auth/package.json
COPY --from=build /app/packages/service-auth/dist ./packages/service-auth/dist
# @fuzefront/feature-flags: same kind of `file:`-linked symlink target
# (node_modules/@fuzefront/feature-flags -> /app/packages/feature-flags). It is
# loaded by `require('@fuzefront/feature-flags')` in src/flags.ts and
# src/lib/featureFlags.ts; main is dist/index.cjs.
COPY --from=build /app/packages/feature-flags/package.json ./packages/feature-flags/package.json
COPY --from=build /app/packages/feature-flags/dist ./packages/feature-flags/dist
# ...AND its runtime dependencies (@openfeature/server-sdk, @openfeature/web-sdk,
# unleash-client). Same reasoning as jose above: this consumer's lockfile carries
# only a link entry for a `file:` dep, never the target's own dependencies, so
# `npm ci` cannot be trusted to hoist them into /app/node_modules on every build --
# scripts/check-dockerfile-lockfile.mjs (FFRNT-254) enforces this unconditionally.
# Copied from `base` (--omit=dev), not `build`, so tsup/typescript/jest stay out.
COPY --from=base /app/packages/feature-flags/node_modules ./packages/feature-flags/node_modules
# @fuzefront/shared is a workspace dep linked by npm. Populate the symlink
# target with the built output so the Kafka consumer resolves at runtime.
COPY --from=build /app/shared/package.json ./shared/package.json
COPY --from=build /app/shared/dist ./shared/dist
# Copy openapi.yaml so the docs route can serve swagger-ui-express at runtime
COPY --from=build /app/services/selection-list-service/openapi.yaml ./services/selection-list-service/openapi.yaml
# Seeding assets (docs/planning/selection-lists-events.md sections 8 and 10): the reviewed
# seed-source allowlist and the platform default packs. src/index.ts validates both at boot
# (initSeeding) and refuses to start if they are missing or invalid, so they must ship in the
# image; they are resolved relative to dist/ (../seed-sources.json, ../seed-packs/platform).
COPY --from=build /app/services/selection-list-service/seed-sources.json ./services/selection-list-service/seed-sources.json
COPY --from=build /app/services/selection-list-service/seed-packs ./services/selection-list-service/seed-packs

# Remove declaration files from production image
RUN find ./services/selection-list-service/dist -name "*.d.ts" -type f -delete

WORKDIR /app/services/selection-list-service

ENV PORT=3011
ENV NODE_ENV=production

EXPOSE 3011

USER selectionlistsvc

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
