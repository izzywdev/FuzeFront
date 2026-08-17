# syntax=docker/dockerfile:1
#
# IMPORTANT: build context is the REPOSITORY ROOT (see skaffold.yaml / release.yml),
# not backend/applications/. This lets applications-service consume the
# @fuzefront/core and @fuzefront/shared workspace packages.

# ---------- build: full compile ----------
FROM node:24-alpine AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++

# Copy EVERY workspace manifest referenced by the root "workspaces" array before
# installing. npm resolves/hoists against the full set of workspace manifests;
# omitting any of them makes `npm install` compute a DIFFERENT hoist tree than the
# committed package-lock.json. That is exactly how express-rate-limit went missing
# from the image: backend/security pins express-rate-limit@7.2.0 (exact) while the
# other consumers allow ^7.2.0, producing a lockfile doppelganger
# (root express-rate-limit@7.5.1 + backend/node_modules/express-rate-limit@7.2.0).
# With those manifests absent, npm re-resolved and express-rate-limit never landed
# in /app/node_modules, so the copied production node_modules lacked it.
# Copy all manifests and use `npm ci`, which installs EXACTLY the committed
# lockfile (deterministic hoist) and fails loudly if lock and manifests drift.
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
COPY packages/selection-lists-ui/package.json ./packages/selection-lists-ui/
COPY design-system/package.json ./design-system/
COPY services/chat-service/package.json ./services/chat-service/
COPY services/email-service/package.json ./services/email-service/
COPY services/notification-service/package.json ./services/notification-service/
COPY services/selection-list-service/package.json ./services/selection-list-service/

RUN npm ci

# Copy source
COPY shared/ ./shared/
COPY backend/core/ ./backend/core/
COPY packages/feature-flags/ ./packages/feature-flags/
COPY packages/identity/ ./packages/identity/
COPY backend/applications/ ./backend/applications/

# Build the shared kafka sub-barrel, then core, then the flag client, then the
# identity package, then applications-service. @fuzefront/feature-flags and
# @izzywdev/fuzefront-identity must both be BUILT here: their package `main`
# points at dist/, and without this the workspace symlink resolves to an empty
# package. For feature-flags that silently defaulted every flag; for identity
# apps.ts's top-level `mintId`/`toUuid` import would crashloop the container at
# boot with "Cannot find module '@izzywdev/fuzefront-identity'".
RUN cd shared && npm run build:kafka
RUN cd backend/core && npm run build
RUN cd packages/feature-flags && npm run build
RUN cd packages/identity && npm run build
RUN cd backend/applications && npm run build

# ---------- production ----------
FROM node:24-alpine AS production
RUN apk add --no-cache dumb-init && \
    addgroup -g 1001 -S nodejs && \
    adduser -S applications -u 1001

WORKDIR /app

COPY --from=build --chown=applications:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=applications:nodejs /app/shared/dist ./shared/dist
COPY --from=build --chown=applications:nodejs /app/shared/package.json ./shared/package.json
COPY --from=build --chown=applications:nodejs /app/backend/core/dist ./backend/core/dist
COPY --from=build --chown=applications:nodejs /app/backend/core/package.json ./backend/core/package.json
COPY --from=build --chown=applications:nodejs /app/packages/feature-flags/dist ./packages/feature-flags/dist
COPY --from=build --chown=applications:nodejs /app/packages/feature-flags/package.json ./packages/feature-flags/package.json
# @izzywdev/fuzefront-identity is a workspace symlink in node_modules; ship its
# built dist + manifest so the link resolves at runtime (see the build-stage note).
COPY --from=build --chown=applications:nodejs /app/packages/identity/dist ./packages/identity/dist
COPY --from=build --chown=applications:nodejs /app/packages/identity/package.json ./packages/identity/package.json
COPY --from=build --chown=applications:nodejs /app/backend/applications/dist ./backend/applications/dist
COPY --from=build --chown=applications:nodejs /app/backend/applications/package.json ./backend/applications/package.json

# Remove declaration files to prevent knex from require()ing .d.ts migrations.
RUN find ./backend/applications/dist -name "*.d.ts" -type f -delete

WORKDIR /app/backend/applications

ENV NODE_ENV=production
ENV USE_POSTGRES=true
ENV PORT=3003

EXPOSE 3003

USER applications

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3003/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
