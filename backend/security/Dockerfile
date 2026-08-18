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
COPY shared/package.json ./shared/
COPY backend/core/package.json ./backend/core/
COPY backend/security/package.json ./backend/security/
# @izzywdev/fuzefront-identity is a workspace dep (like @fuzefront/core). Its
# manifest MUST be present so `npm install` links it from the local workspace
# instead of trying to fetch @izzywdev/fuzefront-identity@1.0.0 from the registry.
COPY packages/identity/package.json ./packages/identity/
# @fuzefront/feature-flags is a workspace package (packages/feature-flags/).
# Its manifest MUST be present so `npm install` links it from the local workspace
# instead of trying to fetch @fuzefront/feature-flags@1.0.0 from the registry
# (where it is not published — it is GitHub Packages-only).
COPY packages/feature-flags/package.json ./packages/feature-flags/

# --no-package-lock: the root package-lock.json is stale — express-rate-limit
# (a backend/security dependency) is an orphan entry not linked to the security
# workspace, so a lockfile-honoring `npm install` PRUNES it → the image crashes
# at boot with "Cannot find module 'express-rate-limit'". Resolving fresh from
# package.json installs it. (Proper long-term fix: regenerate package-lock.json.)
RUN npm install --no-package-lock

# Copy source
COPY shared/ ./shared/
COPY backend/core/ ./backend/core/
COPY packages/identity/ ./packages/identity/
COPY packages/feature-flags/ ./packages/feature-flags/
COPY backend/security/ ./backend/security/

# Build the shared kafka sub-barrel, then core, then identity, then
# feature-flags, then security-service. @izzywdev/fuzefront-identity must be
# BUILT here: its package `main` points at dist/, and auth.ts/organizations.ts
# import mintId/toUuid at the top level, so an unbuilt (empty) package
# crashloops the container at boot. @fuzefront/feature-flags likewise points at
# dist/ and must be built before security-service compiles against it.
RUN cd shared && npm run build:kafka
RUN cd backend/core && npm run build
RUN cd packages/identity && npm run build
RUN cd packages/feature-flags && npm run build
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
