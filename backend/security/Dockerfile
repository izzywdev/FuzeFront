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

# Copy EVERY workspace manifest named by the root "workspaces" array, then
# `npm ci`. This is what actually fixes the express-rate-limit crash the old
# `--no-package-lock` was working around: the root lockfile was never stale —
# the install was being run against a SUBSET of the manifests, so npm computed a
# different hoist tree than the one the lockfile describes and express-rate-limit
# never landed in /app/node_modules. Verified by reproducing the install both
# ways; with the full manifest set, `npm ci` keeps express-rate-limit.
#
# `--no-package-lock` traded that crash for a worse property: every build
# re-resolved floating ranges against the live registry, so two builds of the
# same commit could ship different dependency trees (FFRNT-254).
#
# scripts/check-dockerfile-lockfile.mjs keeps this list in sync with the root
# workspaces array.
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
COPY backend/core/ ./backend/core/
COPY backend/security/ ./backend/security/

# Build the shared kafka sub-barrel, then core, then security-service.
RUN cd shared && npm run build:kafka
RUN cd backend/core && npm run build
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
