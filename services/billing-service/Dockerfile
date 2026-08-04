# syntax=docker/dockerfile:1

# ---------- base: install production deps only ----------
FROM node:24-alpine AS base
WORKDIR /app
RUN apk add --no-cache dumb-init

# Copy EVERY workspace manifest named by the root "workspaces" array, then
# `npm ci` from the lockfile root. The previous `cd <member> && npm install`
# re-resolved floating ranges against the live registry on every build, so two
# builds of the same commit could ship different dependency trees (FFRNT-254).
# `npm ci` cannot run from inside a workspace member — the lockfile lives at the
# root — so the install moves to the root.
#
# Most deps hoist to /app/node_modules, which node resolution reaches by walking
# UP from both /app/services/billing-service/dist and /app/shared/dist. Some do
# NOT hoist — a dependency that loses a version conflict is pinned inside the
# member instead — so the production stage copies both trees. `stripe` is that
# case here.
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

# A FULL root `npm ci`, not `npm ci -w <member>`. The scoped form installed 610
# packages but left billing-service's own third-party deps somewhere tsc could
# not resolve them — the image build failed with "Cannot find module 'express'"
# for every route file while the workspace symlinks resolved fine. Caught by the
# image build on the PR, which is the entire reason that job exists.
#
# The unscoped form is the one actually verified to install this service's whole
# dependency tree — express and pg hoisted into /app/node_modules, stripe pinned
# under /app/services/billing-service/node_modules. It installs more than this
# service strictly needs, which costs image size; correctness first, and
# trimming it is a follow-up that must be re-verified against a real build
# rather than reasoned about — reasoning is what got the scoped form wrong.
RUN npm ci --omit=dev --ignore-scripts

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

# Copy source BEFORE installing, not after.
#
# `stripe` does not hoist: a version conflict with another workspace pins it to
# services/billing-service/node_modules/stripe (the root lockfile has no
# "node_modules/stripe" entry at all). Installing first and copying the source
# over the top left that nested directory missing, and tsc failed with
# "Cannot find module 'stripe'" in all 22 files that import it — while express
# and pg, which DO hoist to /app/node_modules, resolved fine. That asymmetry is
# what identified the cause.
#
# The cost is layer caching: a source change now re-runs the install. Worth it —
# the alternative is an ordering that works only for dependencies that happen to
# hoist, which is not a property any manifest states or guarantees.
COPY shared/ ./shared/
COPY packages/identity/ ./packages/identity/
COPY services/billing-service/ ./services/billing-service/

# devDeps included here (tsc, and shared's toolchain for the kafka sub-tree).
RUN npm ci --ignore-scripts

# Build the shared kafka + identity sub-trees first (avoids socket.io-client /
# React dep), then billing-service. identity supplies the graph-create
# middleware app.ts mounts; without it the image starts and fails on import.
RUN cd shared && npm run build:kafka
# No `npm install` here any more: the root `npm ci` above already installed
# identity's toolchain, and a bare install would re-resolve floating ranges
# against the live registry — reintroducing, in one line, the exact
# non-reproducibility this change set exists to remove (FFRNT-254).
RUN cd packages/identity && npm run build
RUN cd services/billing-service && npm run build
# tsc does NOT copy non-TS assets. runMigrations reads
# dist/migrations/001_billing_schema.sql at startup; without this the pod logs
# "ENOENT ... dist/migrations/001_billing_schema.sql", the migration is skipped,
# and every billing table is missing ("relation billing.* does not exist").
RUN mkdir -p services/billing-service/dist/migrations && \
    cp services/billing-service/src/migrations/*.sql services/billing-service/dist/migrations/
# The public /docs route (Swagger UI) reads dist/openapi.yaml at request time;
# tsc does not copy non-TS assets, so place the contract next to the compiled JS.
RUN cp services/billing-service/openapi.yaml services/billing-service/dist/openapi.yaml

# ---------- production ----------
FROM node:24-alpine AS production
WORKDIR /app

RUN apk add --no-cache dumb-init && \
    addgroup -S billingservice && adduser -S billingservice -G billingservice -u 1001

COPY --from=build /app/shared/dist ./shared/dist
# The ROOT tree. shared/dist/kafka/* does require('zod') + kafkajs at runtime,
# resolved by walking UP from the file until it reaches /app/node_modules; the
# service resolves the same way from /app/services/billing-service/dist. Copying
# only the SIBLING tree is what previously crashlooped the pod with "Cannot find
# module 'zod'", because nothing under /app/shared can reach it.
COPY --from=base /app/node_modules ./node_modules
# The NESTED tree as well, and this is not redundant with the line above: a
# dependency that loses a version conflict is pinned inside the member rather
# than hoisted — `stripe` is exactly that case. Copying only the root tree ships
# an image whose entrypoint dies on require('stripe').
#
# This is what the original double-copy was really doing. An earlier revision of
# this change removed it as "hand-building a hoist"; that reading was wrong, and
# the image build is what showed it.
COPY --from=base /app/services/billing-service/node_modules ./services/billing-service/node_modules
COPY --from=build /app/services/billing-service/dist ./services/billing-service/dist
# @izzywdev/fuzefront-identity is a `file:` dependency, so npm links it —
# /app/node_modules/@izzywdev/fuzefront-identity is a SYMLINK to
# /app/packages/identity, and copying node_modules alone copies a DANGLING link.
# The package must be copied too or app.ts fails at module load with "Cannot find
# module '@izzywdev/fuzefront-identity'": it imports graphCreate at the top of the
# file, so the process dies at boot rather than degrading.
#
# This was broken on master: `npm install` exits 0 with the link's target absent,
# so nothing surfaced it until the container ran. Verified by replicating the
# base stage and inspecting the link. Only dist/ + package.json are needed —
# that is exactly what the package publishes ("files": ["dist", "README.md"]).
COPY --from=build /app/packages/identity/package.json ./packages/identity/package.json
COPY --from=build /app/packages/identity/dist ./packages/identity/dist

# Remove declaration files from production image
RUN find ./services/billing-service/dist -name "*.d.ts" -type f -delete

WORKDIR /app/services/billing-service

ENV PORT=3006
ENV NODE_ENV=production

EXPOSE 3006

USER billingservice

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
