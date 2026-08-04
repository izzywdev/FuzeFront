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

RUN npm ci --workspace=services/notification-service --omit=dev --ignore-scripts

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

RUN npm ci --workspace=services/notification-service --ignore-scripts

COPY services/notification-service/ ./services/notification-service/

RUN cd services/notification-service && npm run build

# ---------- production ----------
FROM node:24-alpine AS production
WORKDIR /app

RUN apk add --no-cache dumb-init && \
    addgroup -S notifsvc && adduser -S notifsvc -G notifsvc -u 1001

COPY --from=base /app/node_modules ./node_modules
COPY --from=build /app/services/notification-service/dist ./services/notification-service/dist

# Declaration files are build output, not runtime input.
RUN find ./services/notification-service/dist -name "*.d.ts" -type f -delete

WORKDIR /app/services/notification-service

ENV PORT=3008
ENV NODE_ENV=production

EXPOSE 3008

USER notifsvc

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
