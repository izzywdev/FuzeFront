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

# Install only production deps for chat-service
RUN npm ci --workspace=services/chat-service --omit=dev --ignore-scripts

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

RUN npm ci --workspace=services/chat-service --ignore-scripts

# Copy source
COPY shared/ ./shared/
COPY services/chat-service/ ./services/chat-service/

# Copy the product docs corpus the chat-doc-indexer Job indexes (RAG source).
COPY docs/ ./services/chat-service/docs/

# Build shared first, then chat-service
RUN cd shared && npm run build
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
