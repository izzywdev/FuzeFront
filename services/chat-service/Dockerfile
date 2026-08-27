# syntax=docker/dockerfile:1

# ---------- base: install production deps only ----------
FROM node:24-alpine AS base
WORKDIR /app
RUN apk add --no-cache dumb-init

# Copy workspace root manifests (needed so npm ci can resolve workspace links)
# Copy EVERY workspace manifest named by the root "workspaces" array before
# installing. npm hoists against the FULL manifest set even with --workspace, so
# with a subset present it computes a different tree than the committed lockfile
# and drops packages SILENTLY — the install still exits 0 and the image crashes
# at boot days later. That is how express-rate-limit went missing from the
# applications image, and how @izzywdev/fuzefront-identity went missing the
# moment packages/identity became a workspace (FFRNT-254).
#
# scripts/check-dockerfile-lockfile.mjs keeps this list in sync.
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY backend/core/package.json ./backend/core/
COPY backend/security/package.json ./backend/security/
COPY backend/applications/package.json ./backend/applications/
COPY shared/package.json ./shared/
COPY packages/identity/package.json ./packages/identity/
COPY packages/auth/package.json ./packages/auth/
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

# Install only production deps for chat-service
RUN npm ci --workspace=services/chat-service --omit=dev --ignore-scripts

# Guarantee the per-workspace node_modules directories the production stage COPYs
# actually exist. npm creates packages/<x>/node_modules ONLY when something could not
# be hoisted: packages/auth gets one because jose@5 conflicts with the root's jose@4,
# but packages/feature-flags' @openfeature/* + unleash-client have no such conflict
# today, so npm hoists them all and creates no directory at all — and `COPY --from=base
# /app/packages/feature-flags/node_modules` then fails the whole build with
# "not found" rather than copying nothing.
#
# The COPY has to stay unconditional (Docker has no conditional COPY, and
# scripts/check-dockerfile-lockfile.mjs requires the line precisely so the image does
# not depend on what one resolution happened to hoist), so make the SOURCE exist
# instead. An empty directory is the correct outcome when everything hoisted; if a
# future resolution stops hoisting, the real contents land here and get copied without
# anyone having to remember why.
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

RUN npm ci --workspace=services/chat-service --ignore-scripts

# Copy source
COPY shared/ ./shared/
COPY packages/identity/ ./packages/identity/
# @fuzefront/auth (agent/securityApiPermitAdapter.ts's createAuthzClient,
# FuzeFront#254) and @fuzefront/feature-flags (agent/authzFlag.ts's lazy
# require) are file:/workspace deps chat-service now imports — both must be
# built here or `npm run build` below fails with TS2307 "Cannot find module"
# (there is no dist/ for either yet at this point in the stage).
COPY packages/auth/ ./packages/auth/
COPY packages/feature-flags/ ./packages/feature-flags/
COPY services/chat-service/ ./services/chat-service/

# Copy the product docs corpus the chat-doc-indexer Job indexes (RAG source).
COPY docs/ ./services/chat-service/docs/

# Build shared first, then identity (required by ref-index consumer), then
# auth + feature-flags (agent/securityApiPermitAdapter.ts and agent/authzFlag.ts
# import them at module load — mirrors services/selection-list-service/Dockerfile's
# identical treatment of @fuzefront/auth), then chat-service.
RUN cd shared && npm run build
RUN cd packages/identity && npm install --ignore-scripts && npm run build
RUN cd packages/auth && npm install --ignore-scripts && npm run build
RUN cd packages/feature-flags && npm install --ignore-scripts && npm run build
RUN cd services/chat-service && npm run build

# ---------- production ----------
FROM node:24-alpine AS production
WORKDIR /app

RUN apk add --no-cache dumb-init && \
    addgroup -S chatservice && adduser -S chatservice -G chatservice -u 1001

COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/services/chat-service/node_modules ./services/chat-service/node_modules
# shared/package.json is required so the @fuzefront/shared workspace symlink
# (node_modules/@fuzefront/shared -> ../shared) resolves "main: dist/index.js".
# Without it Node finds the symlink target but no manifest, falls back to looking
# for /app/shared/index.js, and dies with MODULE_NOT_FOUND at startup — see #538.
# email-service's production stage has carried this line all along; chat-service
# was the one that missed it.
COPY --from=build /app/shared/package.json ./shared/package.json
COPY --from=build /app/shared/dist ./shared/dist
# @izzywdev/fuzefront-identity is a `file:` workspace dep; node_modules links it to
# /app/packages/identity. The base stage ships packages/identity/package.json so the
# symlink doesn't dangle; here we populate the target with the built dist.
COPY --from=build /app/packages/identity/package.json ./packages/identity/package.json
COPY --from=build /app/packages/identity/dist ./packages/identity/dist
# @fuzefront/auth is a `file:` workspace dep (agent/securityApiPermitAdapter.ts's
# createAuthzClient, FuzeFront#254) — node_modules/@fuzefront/auth is a symlink
# to /app/packages/auth. package.json + dist populate the symlink target
# (mirrors services/config-service/Dockerfile and
# services/selection-list-service/Dockerfile's identical treatment).
COPY --from=build /app/packages/auth/package.json ./packages/auth/package.json
COPY --from=build /app/packages/auth/dist ./packages/auth/dist
# ...AND its runtime dependency `jose`, which is NOT hoisted to /app/node_modules:
# @fuzefront/auth needs jose@^5.10.0 but the root lockfile pins node_modules/jose
# to 4.15.9 for other consumers, so jose@5 lives ONLY at
# packages/auth/node_modules/jose. Without this the symlink resolves, dist/ is
# present, and the pod still dies at startup with "Cannot find module 'jose'" —
# the exact crashloop services/config-service/Dockerfile and
# services/selection-list-service/Dockerfile both document hitting first (FFRNT-254).
# Copied from `base`, not `build`: base installed with --omit=dev, so this
# directory holds jose and nothing else — copying from `build` would drag
# tsup/typescript/jest into the production image.
COPY --from=base /app/packages/auth/node_modules ./packages/auth/node_modules
# @fuzefront/feature-flags (agent/authzFlag.ts's lazy `require`, gating
# fuzefront.authz.chat-agent-security-api) is the same kind of `file:`-linked
# symlink target — package.json + dist populate it, same as @fuzefront/auth
# above.
COPY --from=build /app/packages/feature-flags/package.json ./packages/feature-flags/package.json
COPY --from=build /app/packages/feature-flags/dist ./packages/feature-flags/dist
# ...AND its runtime dependencies (@openfeature/server-sdk, @openfeature/web-sdk,
# unleash-client). Same reasoning as jose above: this consumer's lockfile
# carries only a link entry for a `file:` dep, never the target's own
# dependencies, so `npm ci` cannot be trusted to hoist them into
# /app/node_modules on every build — scripts/check-dockerfile-lockfile.mjs
# (FFRNT-254) enforces this unconditionally, regardless of what any one
# resolution happens to hoist. Copied from `base` (--omit=dev), not `build`,
# for the same reason as packages/auth/node_modules above.
COPY --from=base /app/packages/feature-flags/node_modules ./packages/feature-flags/node_modules
COPY --from=build /app/services/chat-service/dist ./services/chat-service/dist
# Product docs corpus for the chat-doc-indexer Job.
COPY --from=build /app/services/chat-service/docs ./services/chat-service/docs

# Remove declaration files from production image
RUN find ./services/chat-service/dist -name "*.d.ts" -type f -delete

WORKDIR /app/services/chat-service

ENV PORT=3006
ENV NODE_ENV=production

EXPOSE 3006

USER chatservice

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
