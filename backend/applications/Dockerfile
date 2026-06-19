# syntax=docker/dockerfile:1
#
# IMPORTANT: build context is the REPOSITORY ROOT (see skaffold.yaml / release.yml),
# not backend/applications/. This lets applications-service consume the
# @fuzefront/core and @fuzefront/shared workspace packages.

# ---------- build: full compile ----------
FROM node:18-alpine AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY backend/core/package.json ./backend/core/
COPY backend/applications/package.json ./backend/applications/

RUN npm install

# Copy source
COPY shared/ ./shared/
COPY backend/core/ ./backend/core/
COPY backend/applications/ ./backend/applications/

# Build the shared kafka sub-barrel, then core, then applications-service.
RUN cd shared && npm run build:kafka
RUN cd backend/core && npm run build
RUN cd backend/applications && npm run build

# ---------- production ----------
FROM node:18-alpine AS production
RUN apk add --no-cache dumb-init && \
    addgroup -g 1001 -S nodejs && \
    adduser -S applications -u 1001

WORKDIR /app

COPY --from=build --chown=applications:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=applications:nodejs /app/shared/dist ./shared/dist
COPY --from=build --chown=applications:nodejs /app/shared/package.json ./shared/package.json
COPY --from=build --chown=applications:nodejs /app/backend/core/dist ./backend/core/dist
COPY --from=build --chown=applications:nodejs /app/backend/core/package.json ./backend/core/package.json
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
