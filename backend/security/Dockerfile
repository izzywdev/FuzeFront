# syntax=docker/dockerfile:1
#
# IMPORTANT: build context is the REPOSITORY ROOT (see skaffold.yaml / release.yml),
# not backend/security/. This lets security-service consume the @fuzefront/core
# and @fuzefront/shared workspace packages (mirrors backend/Dockerfile and
# services/email-service/Dockerfile).

# ---------- build: full compile ----------
FROM node:18-alpine AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY backend/core/package.json ./backend/core/
COPY backend/security/package.json ./backend/security/

# --no-package-lock: the root package-lock.json is stale — express-rate-limit
# (a backend/security dependency) is an orphan entry not linked to the security
# workspace, so a lockfile-honoring `npm install` PRUNES it → the image crashes
# at boot with "Cannot find module 'express-rate-limit'". Resolving fresh from
# package.json installs it. (Proper long-term fix: regenerate package-lock.json.)
RUN npm install --no-package-lock

# Copy source
COPY shared/ ./shared/
COPY backend/core/ ./backend/core/
COPY backend/security/ ./backend/security/

# Build the shared kafka sub-barrel, then core, then security-service.
RUN cd shared && npm run build:kafka
RUN cd backend/core && npm run build
RUN cd backend/security && npm run build

# ---------- production ----------
FROM node:18-alpine AS production
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
