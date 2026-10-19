# syntax=docker/dockerfile:1

# ---------- base: install production deps only ----------
FROM node:24-alpine AS base
WORKDIR /app
RUN apk add --no-cache dumb-init

# Workspace root manifests, so npm ci can resolve workspace links.
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
COPY packages/telemetry/package.json ./packages/telemetry/
COPY packages/service-auth/package.json ./packages/service-auth/
COPY api-client/package.json ./api-client/
COPY sdk/package.json ./sdk/
COPY billing-client/package.json ./billing-client/
COPY config-client/package.json ./config-client/
COPY packages/config-ui/package.json ./packages/config-ui/
COPY packages/fuzepicker-ui/package.json ./packages/fuzepicker-ui/
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
COPY selection-list-client/package.json ./selection-list-client/
COPY design-system/package.json ./design-system/
COPY services/chat-service/package.json ./services/chat-service/
COPY services/email-service/package.json ./services/email-service/
COPY services/notification-service/package.json ./services/notification-service/
COPY services/selection-list-service/package.json ./services/selection-list-service/
COPY services/devportal-service/package.json ./services/devportal-service/
COPY packages/billing-types/package.json ./packages/billing-types/
COPY packages/metered-usage/package.json ./packages/metered-usage/
COPY services/billing-service/package.json ./services/billing-service/

RUN npm ci --workspace=services/notification-service --omit=dev --ignore-scripts && \
    mkdir -p packages/telemetry/node_modules
# npm may hoist every telemetry runtime dependency into /app/node_modules.
# Keep the optional workspace dependency directory copyable in either
# locked layout (same pattern as services/devportal-service/Dockerfile).

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
COPY packages/fuzepicker-ui/package.json ./packages/fuzepicker-ui/
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
COPY selection-list-client/package.json ./selection-list-client/
COPY design-system/package.json ./design-system/
COPY services/chat-service/package.json ./services/chat-service/
COPY services/email-service/package.json ./services/email-service/
COPY services/notification-service/package.json ./services/notification-service/
COPY services/selection-list-service/package.json ./services/selection-list-service/
COPY services/devportal-service/package.json ./services/devportal-service/
COPY packages/billing-types/package.json ./packages/billing-types/
COPY packages/metered-usage/package.json ./packages/metered-usage/
COPY services/billing-service/package.json ./services/billing-service/

RUN npm ci --workspace=services/notification-service --ignore-scripts

COPY packages/telemetry/ ./packages/telemetry/
COPY services/notification-service/ ./services/notification-service/

# @fuzefront/telemetry (index.ts's initTelemetry(), app.ts's
# tracingMiddleware()) must be built before notification-service: its
# package `main` points at dist/, and both call the package at module load.
RUN cd packages/telemetry && npm install --ignore-scripts && npm run build
RUN cd services/notification-service && npm run build

# ---------- production ----------
FROM node:24-alpine AS production
WORKDIR /app

RUN apk add --no-cache dumb-init && \
    addgroup -S notifsvc && adduser -S notifsvc -G notifsvc -u 1001

COPY --from=base /app/node_modules ./node_modules
# @fuzefront/telemetry is a `file:` dependency, so npm LINKS it —
# node_modules/@fuzefront/telemetry is a symlink to /app/packages/telemetry
# (NOT populated by the root node_modules copy above). package.json + dist
# populate the symlink target; node_modules carries its RUNTIME deps (the
# @opentelemetry/* SDK packages) for the case where they do NOT hoist to
# /app/node_modules — mirrors services/devportal-service/Dockerfile's
# identical treatment of @fuzefront/auth.
COPY --from=build /app/packages/telemetry/package.json ./packages/telemetry/package.json
COPY --from=build /app/packages/telemetry/dist ./packages/telemetry/dist
COPY --from=base /app/packages/telemetry/node_modules ./packages/telemetry/node_modules
COPY --from=build /app/services/notification-service/dist ./services/notification-service/dist
# index.ts reads its own service.version via `require('../package.json').version`
# (OTel resource attribute — npm_package_version is unset under the bare `node
# dist/index.js` CMD below). Without this the container dies at boot with
# "Cannot find module '../package.json'".
COPY --from=build /app/services/notification-service/package.json ./services/notification-service/package.json

# Declaration files are build output, not runtime input.
RUN find ./services/notification-service/dist -name "*.d.ts" -type f -delete

WORKDIR /app/services/notification-service

ENV PORT=3008
ENV NODE_ENV=production

EXPOSE 3008

USER notifsvc

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
