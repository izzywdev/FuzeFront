# syntax=docker/dockerfile:1
#
# devportal-service Dockerfile
# Base image: node:24-alpine (mandated minimum per CLAUDE.md toolchain table).
#
# WORKSPACE MANIFEST COPY PATTERN: npm ci must see ALL workspace manifests before
# installing, because npm hoists against the full manifest set. A subset install
# computes a different hoisting tree than the lockfile and can silently drop
# packages — the image still exits 0 and crashes at boot. Mirrors
# services/selection-list-service/Dockerfile's identical treatment.
# scripts/check-dockerfile-lockfile.mjs keeps this list in sync with package.json.

# ---------- base: install production deps only ----------
FROM node:24-alpine AS base
WORKDIR /app
RUN apk add --no-cache dumb-init

COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY backend/core/package.json ./backend/core/
COPY backend/security/package.json ./backend/security/
COPY backend/applications/package.json ./backend/applications/
COPY shared/package.json ./shared/
COPY packages/identity/package.json ./packages/identity/
COPY packages/auth/package.json ./packages/auth/
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

RUN npm ci --workspace=services/devportal-service --omit=dev --ignore-scripts

# ---------- specs: gather this repo's own openapi.yaml files ----------
# Only the spec FILES are needed here, not each service's full source — see
# scripts/collect-devportal-specs.mjs's SOURCES list, which this stage's COPY
# lines must stay in sync with.
FROM node:24-alpine AS specs
WORKDIR /app
COPY scripts/collect-devportal-specs.mjs ./scripts/collect-devportal-specs.mjs
COPY services/app-registry-service/openapi.yaml ./services/app-registry-service/openapi.yaml
COPY services/billing-service/openapi.yaml ./services/billing-service/openapi.yaml
COPY services/chat-service/openapi.yaml ./services/chat-service/openapi.yaml
COPY services/config-service/openapi.yaml ./services/config-service/openapi.yaml
COPY services/custom-hostname-api/openapi.yaml ./services/custom-hostname-api/openapi.yaml
COPY services/notification-service/openapi.yaml ./services/notification-service/openapi.yaml
COPY services/payment-service/openapi.yaml ./services/payment-service/openapi.yaml
COPY services/portal-service/openapi.yaml ./services/portal-service/openapi.yaml
COPY services/selection-list-service/openapi.yaml ./services/selection-list-service/openapi.yaml
COPY services/sms-service/openapi.yaml ./services/sms-service/openapi.yaml
COPY services/devportal-service/openapi.yaml ./services/devportal-service/openapi.yaml
COPY packages/auth/openapi.yaml ./packages/auth/openapi.yaml
COPY packages/security/openapi.yaml ./packages/security/openapi.yaml
RUN node scripts/collect-devportal-specs.mjs

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

RUN npm ci --workspace=services/devportal-service --ignore-scripts

COPY packages/auth/ ./packages/auth/
COPY services/devportal-service/ ./services/devportal-service/
COPY --from=specs /app/services/devportal-service/specs ./services/devportal-service/specs

# Build @fuzefront/auth first (src/middleware/authz.ts imports it at module
# load), then devportal-service. Mirrors services/selection-list-service/
# Dockerfile's identical treatment of the same package.
RUN cd packages/auth && npm install --ignore-scripts && npm run build
RUN cd services/devportal-service && npm run build

# ---------- production ----------
FROM node:24-alpine AS production
WORKDIR /app

RUN apk add --no-cache dumb-init && \
    addgroup -S devportalsvc && adduser -S devportalsvc -G devportalsvc -u 1001

COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/services/devportal-service/node_modules ./services/devportal-service/node_modules
COPY --from=build /app/services/devportal-service/dist ./services/devportal-service/dist
COPY --from=build /app/services/devportal-service/specs ./services/devportal-service/specs
# @fuzefront/auth is a workspace dependency, so npm LINKS it —
# node_modules/@fuzefront/auth is a symlink to /app/packages/auth. Mirrors
# services/selection-list-service/Dockerfile's identical treatment,
# including the "jose is not hoisted" gotcha documented there (FFRNT-254).
COPY --from=build /app/packages/auth/package.json ./packages/auth/package.json
COPY --from=build /app/packages/auth/dist ./packages/auth/dist
COPY --from=base /app/packages/auth/node_modules ./packages/auth/node_modules
# Copy openapi.yaml so the docs route can serve swagger-ui-express at runtime
COPY --from=build /app/services/devportal-service/openapi.yaml ./services/devportal-service/openapi.yaml

RUN find ./services/devportal-service/dist -name "*.d.ts" -type f -delete

WORKDIR /app/services/devportal-service

ENV PORT=3013
ENV NODE_ENV=production

EXPOSE 3013

USER devportalsvc

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
