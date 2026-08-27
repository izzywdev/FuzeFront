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

# Install only production deps for selection-list-service
RUN npm ci --workspace=services/selection-list-service --omit=dev --ignore-scripts

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

RUN npm ci --workspace=services/selection-list-service --ignore-scripts

# Copy source
COPY packages/auth/ ./packages/auth/
COPY services/selection-list-service/ ./services/selection-list-service/

# Build @fuzefront/auth first (src/middleware/authz.ts -- authorization
# routed through FuzeFront's Security API instead of an embedded Permit.io
# SDK -- imports it at module load; createAuthzClient() is constructed at
# authz.ts's module scope), then selection-list-service. packages/auth IS a
# root workspace member, but the --workspace=services/selection-list-service
# filter above only installs SELECTION-LIST-SERVICE's own devDependencies,
# not packages/auth's (tsup) -- mirrors services/config-service/Dockerfile's
# identical treatment of the same package.
RUN cd packages/auth && npm install --ignore-scripts && npm run build
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
# Copy openapi.yaml so the docs route can serve swagger-ui-express at runtime
COPY --from=build /app/services/selection-list-service/openapi.yaml ./services/selection-list-service/openapi.yaml

# Remove declaration files from production image
RUN find ./services/selection-list-service/dist -name "*.d.ts" -type f -delete

WORKDIR /app/services/selection-list-service

ENV PORT=3011
ENV NODE_ENV=production

EXPOSE 3011

USER selectionlistsvc

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
