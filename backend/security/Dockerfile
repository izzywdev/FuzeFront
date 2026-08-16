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
# @fuzefront/feature-flags (FF-EPIC-17 rootMembershipFlag.ts) is deliberately
# NOT a declared `dependency` in backend/security/package.json — adding it
# there previously broke this build (a registry lookup for an unpublished
# scoped package; the security-service consumer uses a lazy `require()`
# instead, see utils/rootMembershipFlag.ts). Its manifest still needs to be
# present here so `npm install`, which resolves every workspace listed in the
# root package.json regardless of cross-package dependency edges, creates the
# node_modules/@fuzefront/feature-flags workspace symlink the lazy require
# resolves at runtime.
COPY packages/feature-flags/package.json ./packages/feature-flags/

# Two-step install — DO NOT collapse back to a single `npm install
# --no-package-lock`. That was tried (and reverted) while wiring
# @fuzefront/feature-flags in: a full --no-package-lock re-resolve ignores
# EVERY pinned version in package-lock.json, not just the one broken entry
# below, and picked up whatever was newest on the registry at build time —
# concretely, @openfeature/web-sdk 1.10.0 (locked: 1.9.0) with a changed .d.ts
# surface (`Client.addHandler`/`OpenFeatureAPI.close` renamed/removed), which
# broke `packages/feature-flags`'s tsup `dts` build. Two lockfile-respecting
# steps instead:
#   1. plain `npm install` — resolves everything (typescript, the OpenFeature
#      SDKs, etc.) from package-lock.json, i.e. the exact versions already
#      tested elsewhere (this is how backend/Dockerfile installs the same
#      packages/feature-flags workspace without incident).
#   2. `npm install --no-save express-rate-limit@7.2.0` — step 1 alone PRUNES
#      this backend/security dependency: package-lock.json's only
#      express-rate-limit entries are pinned under the root and `backend`
#      workspaces (7.5.1 / 7.2.0 respectively), and `backend/` isn't part of
#      this image's build context, so the lockfile has no entry that maps to
#      *this* workspace → npm drops it → the image crashed at boot with
#      "Cannot find module 'express-rate-limit'". A second, explicitly
#      versioned, non-lockfile-mutating (--no-save) install adds back just
#      that one package without re-resolving (and so not perturbing) anything
#      else. (Proper long-term fix: regenerate package-lock.json so the
#      security workspace has its own entry.)
RUN npm install
RUN npm install --no-save express-rate-limit@7.2.0

# Copy source
COPY shared/ ./shared/
COPY backend/core/ ./backend/core/
COPY packages/identity/ ./packages/identity/
COPY packages/feature-flags/ ./packages/feature-flags/
COPY backend/security/ ./backend/security/

# Build the shared kafka sub-barrel, then core, then identity, then the flag
# client, then security-service. @izzywdev/fuzefront-identity must be BUILT
# here: its package `main` points at dist/, and auth.ts/organizations.ts
# import mintId/toUuid at the top level, so an unbuilt (empty) package
# crashloops the container at boot. @fuzefront/feature-flags must be BUILT
# here for the same reason its `main` points at dist/ — rootMembershipFlag.ts's
# lazy `require('@fuzefront/feature-flags')` would otherwise resolve to an
# empty package and every flag read would silently fall through to its
# in-code default (this is what left #615's flag permanently OFF).
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
# Same reason: node_modules/@fuzefront/feature-flags is a symlink to
# ../../packages/feature-flags — the target must exist at this exact relative
# path in the production stage or the lazy require() in
# rootMembershipFlag.ts/feature-flags.ts resolves to nothing.
COPY --from=build --chown=security:nodejs /app/packages/feature-flags/dist ./packages/feature-flags/dist
COPY --from=build --chown=security:nodejs /app/packages/feature-flags/package.json ./packages/feature-flags/package.json
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
