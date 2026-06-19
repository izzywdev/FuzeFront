# syntax=docker/dockerfile:1
#
# IMPORTANT: build context is the REPOSITORY ROOT (see skaffold.yaml), not
# backend/. This lets the backend consume the @fuzefront/shared workspace
# (kafka sub-barrel) the same way services/email-service does. Only the kafka
# sub-tree of shared is built (npm run build:kafka) so the server image needs no
# React/DOM toolchain.

# ---------- build: full compile ----------
FROM node:18-alpine AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY backend/package.json ./backend/

RUN npm install

# Copy source
COPY shared/ ./shared/
COPY backend/ ./backend/

# Build shared kafka sub-tree first, then the backend.
RUN cd shared && npm run build:kafka
RUN cd backend && npm run build

# ---------- production ----------
FROM node:18-alpine AS production
RUN apk add --no-cache dumb-init && \
    addgroup -g 1001 -S nodejs && \
    adduser -S backend -u 1001

WORKDIR /app

# node_modules from the build stage. The full (dev+prod) root install hoists
# shared's runtime deps (kafkajs, zod, react) to /app/node_modules — which is
# where the @fuzefront/shared symlink (and shared/dist/kafka/*) resolves them.
# A prod-only `--omit=dev` install does NOT hoist them consistently, so we take
# the build stage's tree as-is. (Image carries devDeps; acceptable for parity.)
COPY --from=build --chown=backend:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=backend:nodejs /app/backend/node_modules ./backend/node_modules

# Built shared kafka output + compiled backend.
COPY --from=build --chown=backend:nodejs /app/shared/dist ./shared/dist
COPY --from=build --chown=backend:nodejs /app/shared/package.json ./shared/package.json
COPY --from=build --chown=backend:nodejs /app/backend/dist ./backend/dist
COPY --from=build --chown=backend:nodejs /app/backend/package.json ./backend/package.json

# Remove declaration files to prevent conflicts.
RUN find ./backend/dist -name "*.d.ts" -type f -delete

WORKDIR /app/backend

ENV NODE_ENV=production
ENV USE_POSTGRES=true
ENV DB_HOST=shared-postgres
ENV DB_PORT=5432
ENV DB_NAME=fuzefront_platform
ENV DB_USER=postgres
ENV DB_PASSWORD=postgres
ENV JWT_SECRET=fuzefront-production-secret-change-this
ENV PORT=3001

EXPOSE 3001

USER backend

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
