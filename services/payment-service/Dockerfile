# syntax=docker/dockerfile:1
#
# payment-service — repo-root build context (NOT services/payment-service/ as the
# old self-contained image used). The migration to managed service tokens added a
# `file:../../packages/service-auth` dependency (@fuzefront/service-auth), which a
# service-scoped context cannot see — so, like billing-service, this Dockerfile is
# built from the repo root (`context: .` in release.yml) and vendors the built
# @fuzefront/* packages it needs. Still a scaffold gateway, disabled in prod.

# ---------- pkgbuild: build @fuzefront/security-client + @fuzefront/service-auth ----------
# service-auth's tsup dts step needs security-client's types, and its
# `@fuzefront/security-client: ^0.8.0` range only resolves to the in-repo package
# via npm workspaces. A throwaway 2-package workspace root links them locally
# (no registry, no repo-wide install) and builds both dists.
FROM node:24-alpine AS pkgbuild
WORKDIR /pkg
COPY packages/security/package.json packages/security/package.json
COPY packages/service-auth/package.json packages/service-auth/package.json
RUN printf '{"name":"pkgbuild","private":true,"workspaces":["packages/security","packages/service-auth"]}' > package.json
RUN npm install --ignore-scripts --no-audit --no-fund
COPY packages/security/ packages/security/
COPY packages/service-auth/ packages/service-auth/
# security-client first — service-auth's type-only import resolves against its dist .d.ts.
RUN npm run build -w @fuzefront/security-client
RUN npm run build -w @fuzefront/service-auth

# ---------- base: payment-service production deps only ----------
FROM node:24-alpine AS base
WORKDIR /app
RUN apk add --no-cache dumb-init
COPY services/payment-service/package.json services/payment-service/package.json
# Provide the built service-auth package so `file:../../packages/service-auth`
# resolves to a real dir. npm only symlinks it (no transitive fetch — service-auth
# has no runtime deps), so its dist must already be present. Same file:-link dance
# billing-service does for @izzywdev/fuzefront-identity.
COPY --from=pkgbuild /pkg/packages/service-auth/package.json packages/service-auth/package.json
COPY --from=pkgbuild /pkg/packages/service-auth/dist packages/service-auth/dist
RUN cd services/payment-service && npm install --omit=dev --ignore-scripts --no-audit --no-fund

# ---------- build: compile payment-service ----------
FROM node:24-alpine AS build
WORKDIR /app
COPY services/payment-service/package.json services/payment-service/package.json
COPY --from=pkgbuild /pkg/packages/service-auth/package.json packages/service-auth/package.json
COPY --from=pkgbuild /pkg/packages/service-auth/dist packages/service-auth/dist
RUN cd services/payment-service && npm install --ignore-scripts --no-audit --no-fund
COPY services/payment-service/tsconfig.json services/payment-service/tsconfig.json
COPY services/payment-service/src services/payment-service/src
RUN cd services/payment-service && npm run build

# ---------- production ----------
FROM node:24-alpine AS production
WORKDIR /app

RUN apk add --no-cache dumb-init && \
    addgroup -S paymentservice && adduser -S paymentservice -G paymentservice -u 1001

# node_modules/@fuzefront/service-auth is a relative symlink into /app/packages/service-auth;
# copy the deps (preserving the symlink) then populate its target with the built dist.
COPY --from=base /app/services/payment-service/node_modules ./services/payment-service/node_modules
COPY --from=pkgbuild /pkg/packages/service-auth/package.json ./packages/service-auth/package.json
COPY --from=pkgbuild /pkg/packages/service-auth/dist ./packages/service-auth/dist
COPY --from=build /app/services/payment-service/dist ./services/payment-service/dist
COPY services/payment-service/package.json ./services/payment-service/package.json

# Drop declaration files from the production image.
RUN find ./services/payment-service/dist -name "*.d.ts" -type f -delete

WORKDIR /app/services/payment-service

ENV PORT=3007
ENV NODE_ENV=production

EXPOSE 3007

USER paymentservice

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
