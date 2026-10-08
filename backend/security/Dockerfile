# syntax=docker/dockerfile:1
#
# IMPORTANT: build context is the REPOSITORY ROOT (see skaffold.yaml / release.yml),
# not backend/security/. This lets security-service consume the @fuzefront/core
# and @fuzefront/shared workspace packages (mirrors backend/Dockerfile and
# services/email-service/Dockerfile).

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
COPY backend/core/ ./backend/core/
COPY packages/identity/ ./packages/identity/
COPY packages/feature-flags/ ./packages/feature-flags/
COPY packages/telemetry/ ./packages/telemetry/
COPY backend/security/ ./backend/security/

# Build the shared kafka sub-barrel, then core, then identity, then
# feature-flags, then telemetry, then security-service. @izzywdev/fuzefront-identity
# must be BUILT here: its package `main` points at dist/, and
# auth.ts/organizations.ts import mintId/toUuid at the top level, so an unbuilt
# (empty) package crashloops the container at boot. @fuzefront/feature-flags
# and @fuzefront/telemetry likewise point at dist/ — index.ts calls
# initTelemetry()/tracingMiddleware() at module load, so an unbuilt telemetry
# package crashloops the container exactly the same way.
RUN cd shared && npm run build:kafka
RUN cd backend/core && npm run build
RUN cd packages/identity && npm run build
RUN cd packages/feature-flags && npm run build
RUN cd packages/telemetry && npm run build
RUN cd backend/security && npm run build

# ---------- production ----------
FROM node:24-alpine AS production
RUN apk add --no-cache dumb-init && \
    addgroup -g 1001 -S nodejs && \
    adduser -S security -u 1001

WORKDIR /app

# Hoisted node_modules from the build stage (carries devDeps; acceptable for parity).
COPY --from=build --chown=security:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=security:nodejs /app/shared/dist ./shared/dist
COPY --from=build --chown=security:nodejs /app/shared/package.json ./shared/package.json
COPY --from=build --chown=security:nodejs /app/backend/core/dist ./backend/core/dist
COPY --from=build --chown=security:nodejs /app/backend/core/package.json ./backend/core/package.json
# Ship built identity dist + manifest so the node_modules workspace symlink resolves.
COPY --from=build --chown=security:nodejs /app/packages/identity/dist ./packages/identity/dist
COPY --from=build --chown=security:nodejs /app/packages/identity/package.json ./packages/identity/package.json
# Same reasoning for telemetry: index.ts calls initTelemetry()/tracingMiddleware()
# at module load, so the node_modules/@fuzefront/telemetry symlink must resolve
# to a real dist/, not an empty package. Its own runtime deps (the OTel SDK
# packages) hoist into the shared node_modules copied above — no version
# conflict with anything else in this image, so no per-package node_modules
# copy is needed (unlike packages/auth's jose in other services).
COPY --from=build --chown=security:nodejs /app/packages/telemetry/dist ./packages/telemetry/dist
COPY --from=build --chown=security:nodejs /app/packages/telemetry/package.json ./packages/telemetry/package.json
COPY --from=build --chown=security:nodejs /app/backend/security/dist ./backend/security/dist
COPY --from=build --chown=security:nodejs /app/backend/security/package.json ./backend/security/package.json

# Remove declaration files to prevent knex from require()ing .d.ts migrations.
RUN find ./backend/security/dist -name "*.d.ts" -type f -delete

WORKDIR /app/backend/security

ENV NODE_ENV=production
ENV USE_POSTGRES=true
ENV PORT=3002

EXPOSE 3002

USER security

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3002/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
