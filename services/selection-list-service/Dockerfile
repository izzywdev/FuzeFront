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
COPY billing-client/package.json ./billing-client/
COPY config-client/package.json ./config-client/
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
COPY billing-client/package.json ./billing-client/
COPY config-client/package.json ./config-client/
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
COPY services/selection-list-service/package.json ./services/selection-list-service/

RUN npm ci --workspace=services/selection-list-service --ignore-scripts

# Copy source
COPY services/selection-list-service/ ./services/selection-list-service/

# Build
RUN cd services/selection-list-service && npm run build

# ---------- production ----------
FROM node:24-alpine AS production
WORKDIR /app

RUN apk add --no-cache dumb-init && \
    addgroup -S selectionlistsvc && adduser -S selectionlistsvc -G selectionlistsvc -u 1001

COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/services/selection-list-service/node_modules ./services/selection-list-service/node_modules
COPY --from=build /app/services/selection-list-service/dist ./services/selection-list-service/dist
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
