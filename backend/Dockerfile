# syntax=docker/dockerfile:1
#
# IMPORTANT: build context is the REPOSITORY ROOT (see skaffold.yaml), not
# backend/. This lets the backend consume the @fuzefront/shared workspace
# (kafka sub-barrel) the same way services/email-service does. Only the kafka
# package root is also used by the chat-response websocket bridge, so the full
# shared package must be built into the runtime image.

# ---------- build: full compile ----------
FROM node:24-alpine AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++

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
COPY custom-hostname-client/package.json ./custom-hostname-client/
COPY packages/billing-ui/package.json ./packages/billing-ui/
COPY packages/chat-client/package.json ./packages/chat-client/
COPY packages/chat-ui/package.json ./packages/chat-ui/
COPY packages/identity-ui/package.json ./packages/identity-ui/
COPY packages/auth-ui/package.json ./packages/auth-ui/
COPY packages/account-security-ui/package.json ./packages/account-security-ui/
COPY packages/portal-admin-ui/package.json ./packages/portal-admin-ui/
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
COPY services/selection-list-service/package.json ./services/selection-list-service/
COPY services/devportal-service/package.json ./services/devportal-service/
COPY packages/selection-lists-ui/package.json ./packages/selection-lists-ui/
COPY packages/config-ui/package.json ./packages/config-ui/

# Install the complete workspace tree exactly as recorded in the root lockfile.
RUN npm ci

# Copy source
COPY shared/ ./shared/
COPY packages/feature-flags/ ./packages/feature-flags/
COPY packages/identity/ ./packages/identity/
COPY packages/security/ ./packages/security/
COPY packages/service-auth/ ./packages/service-auth/
COPY custom-hostname-client/ ./custom-hostname-client/
COPY backend/ ./backend/

# Build shared, then the flag client, then the backend.
# @fuzefront/feature-flags must be BUILT here: its package `main` points at
# dist/, and without this the workspace symlink resolves to an empty package —
# which is why the flag client was absent from the running image and every flag
# silently took its in-code default.
RUN cd shared && npm run build
RUN cd packages/feature-flags && npm run build
# Same reason as the flag client above: @izzywdev/fuzefront-identity's `main`
# points at dist/, and backend/src routes/services import mintId/toUuid
# STATICALLY. Without this build the workspace symlink resolves to an empty
# package and the container crashloops at boot.
RUN cd packages/identity && npm run build
RUN cd packages/security && npm run build
RUN cd packages/service-auth && npm run build
# Same reason as the flag client above: @fuzefront/custom-hostname-client's
# `main`/`types` point at dist/, and backend/src/custom-domains imports it
# STATICALLY. Without this build the workspace symlink resolves to an empty
# package and the custom-domain layer would be inert in the running image.
RUN cd custom-hostname-client && npm run build
# @fuzefront/core's `main` points at dist/ and backend/src imports enqueueEvent
# STATICALLY; build it (after shared, whose kafka barrel it consumes) or the
# workspace symlink resolves to an empty package and the container crashloops.
RUN cd backend/core && npm run build
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
COPY --from=build --chown=backend:nodejs /app/backend/core/dist ./backend/core/dist
COPY --from=build --chown=backend:nodejs /app/backend/core/package.json ./backend/core/package.json
COPY --from=build --chown=backend:nodejs /app/packages/feature-flags/dist ./packages/feature-flags/dist
COPY --from=build --chown=backend:nodejs /app/packages/feature-flags/package.json ./packages/feature-flags/package.json
COPY --from=build --chown=backend:nodejs /app/packages/identity/dist ./packages/identity/dist
COPY --from=build --chown=backend:nodejs /app/packages/identity/package.json ./packages/identity/package.json
COPY --from=build --chown=backend:nodejs /app/packages/service-auth/dist ./packages/service-auth/dist
COPY --from=build --chown=backend:nodejs /app/packages/service-auth/package.json ./packages/service-auth/package.json
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
