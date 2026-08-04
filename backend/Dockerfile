# syntax=docker/dockerfile:1
#
# IMPORTANT: build context is the REPOSITORY ROOT (see skaffold.yaml), not
# backend/. This lets the backend consume the @fuzefront/shared workspace
# (kafka sub-barrel) the same way services/email-service does. Only the kafka
# sub-tree of shared is built (npm run build:kafka) so the server image needs no
# React/DOM toolchain.

# ---------- build: full compile ----------
FROM node:24-alpine AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++

# Copy EVERY workspace manifest named by the root "workspaces" array before
# installing, then `npm ci`. npm hoists against the FULL set of manifests, so
# omitting any of them makes the install compute a different tree than the
# committed lockfile — that is exactly how express-rate-limit went missing from
# the applications image. `npm ci` then installs the lockfile exactly and fails
# loudly if lock and manifests drift, instead of silently re-resolving floating
# ranges against the live registry on every build (FFRNT-254).
#
# scripts/check-dockerfile-lockfile.mjs keeps this list in sync with the root
# workspaces array; it is the only thing standing between here and the next
# missing-module-at-boot bug.
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

RUN npm ci

# Copy source
COPY shared/ ./shared/
COPY packages/feature-flags/ ./packages/feature-flags/
COPY custom-hostname-client/ ./custom-hostname-client/
COPY backend/ ./backend/

# Build shared kafka sub-tree, then the flag client, then the backend.
# @fuzefront/feature-flags must be BUILT here: its package `main` points at
# dist/, and without this the workspace symlink resolves to an empty package —
# which is why the flag client was absent from the running image and every flag
# silently took its in-code default.
RUN cd shared && npm run build:kafka
RUN cd packages/feature-flags && npm run build
# Same reason as the flag client above: @fuzefront/custom-hostname-client's
# `main`/`types` point at dist/, and backend/src/custom-domains imports it
# STATICALLY. Without this build the workspace symlink resolves to an empty
# package and the custom-domain layer would be inert in the running image.
RUN cd custom-hostname-client && npm run build
RUN cd backend && npm run build

# ---------- production ----------
FROM node:24-alpine AS production
RUN apk add --no-cache dumb-init && \
    addgroup -g 1001 -S nodejs && \
    adduser -S backend -u 1001

WORKDIR /app

# node_modules from the build stage. The full (dev+prod) root install hoists
# shared's runtime deps (kafkajs, zod, react) to /app/node_modules — which is
# where the @fuzefront/shared symlink (and shared/dist/kafka/*) resolves them.
# A prod-only `--omit=dev` install does NOT hoist them consistently, so we take
# the build stage's tree as-is. (Image carries devDeps; acceptable for parity.)
COPY --from=build --chown=backend:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=backend:nodejs /app/backend/node_modules ./backend/node_modules

# Built shared kafka output + compiled backend.
COPY --from=build --chown=backend:nodejs /app/shared/dist ./shared/dist
COPY --from=build --chown=backend:nodejs /app/shared/package.json ./shared/package.json
COPY --from=build --chown=backend:nodejs /app/packages/feature-flags/dist ./packages/feature-flags/dist
COPY --from=build --chown=backend:nodejs /app/packages/feature-flags/package.json ./packages/feature-flags/package.json
COPY --from=build --chown=backend:nodejs /app/custom-hostname-client/dist ./custom-hostname-client/dist
COPY --from=build --chown=backend:nodejs /app/custom-hostname-client/package.json ./custom-hostname-client/package.json
COPY --from=build --chown=backend:nodejs /app/backend/dist ./backend/dist
COPY --from=build --chown=backend:nodejs /app/backend/package.json ./backend/package.json

# Remove declaration files to prevent conflicts.
RUN find ./backend/dist -name "*.d.ts" -type f -delete

WORKDIR /app/backend

ENV NODE_ENV=production
ENV USE_POSTGRES=true
ENV DB_HOST=shared-postgres
ENV DB_PORT=5432
ENV DB_NAME=fuzefront_platform
ENV DB_USER=postgres
ENV DB_PASSWORD=postgres
ENV JWT_SECRET=fuzefront-production-secret-change-this
ENV PORT=3001

EXPOSE 3001

USER backend

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
