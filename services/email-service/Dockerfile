# syntax=docker/dockerfile:1

# ---------- base: install production deps only ----------
FROM node:24-alpine AS base
WORKDIR /app
RUN apk add --no-cache dumb-init

# Copy manifests for services/email-service and its file: dep on shared.
# We use the email-service's own package-lock.json (not root workspace mode)
# because services/email-service is not in the root workspaces array.
COPY shared/package.json ./shared/
# Same file: dependency shape for @fuzefront/telemetry — manifest must be
# present in EVERY stage that installs, or npm creates a dangling symlink.
COPY packages/telemetry/package.json ./packages/telemetry/
COPY services/email-service/package.json services/email-service/package-lock.json ./services/email-service/

# Install only production deps for email-service
RUN cd services/email-service && npm ci --omit=dev --ignore-scripts

# ---------- build: full compile ----------
FROM node:24-alpine AS build
WORKDIR /app
COPY shared/package.json ./shared/
COPY packages/telemetry/package.json ./packages/telemetry/
COPY services/email-service/package.json services/email-service/package-lock.json ./services/email-service/

RUN cd services/email-service && npm ci --ignore-scripts
# shared is part of the root workspace (no own lock file); install its devDeps
# (typescript, etc.) so `npm run build` inside shared can find `tsc`.
RUN cd shared && npm install --ignore-scripts

# Copy source
COPY shared/ ./shared/
COPY packages/telemetry/ ./packages/telemetry/
COPY services/email-service/ ./services/email-service/

# Build shared first, then @fuzefront/telemetry (app.ts calls
# tracingMiddleware(), index.ts calls initTelemetry() at module load), then
# email-service.
RUN cd shared && npm run build
RUN cd packages/telemetry && npm install --ignore-scripts && npm run build
# telemetry has RUNTIME dependencies (the @opentelemetry/* SDK packages) that
# must reach the production image. The install above pulls in devDeps too
# (tsup/jest/typescript) because the build needs them; prune them here so the
# node_modules copied below is production-only.
RUN cd packages/telemetry && npm prune --omit=dev
RUN cd services/email-service && npm run build

# ---------- production ----------
FROM node:24-alpine AS production
WORKDIR /app

RUN apk add --no-cache dumb-init && \
    addgroup -S emailservice && adduser -S emailservice -G emailservice -u 1001

COPY --from=base /app/services/email-service/node_modules ./services/email-service/node_modules
# shared/package.json is required so the @fuzefront/shared workspace symlink
# (node_modules/@fuzefront/shared -> ../../shared) resolves "main: dist/index.js"
COPY --from=build /app/shared/package.json ./shared/package.json
COPY --from=build /app/shared/dist ./shared/dist
# @fuzefront/telemetry is a `file:` dependency, so npm LINKS it —
# node_modules/@fuzefront/telemetry is a symlink to /app/packages/telemetry.
# package.json + dist populate the symlink target; node_modules carries its
# RUNTIME deps (the @opentelemetry/* SDK packages), which — same as
# shared/kafkajs below — are not hoisted anywhere else in this image.
COPY --from=build /app/packages/telemetry/package.json ./packages/telemetry/package.json
COPY --from=build /app/packages/telemetry/dist ./packages/telemetry/dist
COPY --from=build /app/packages/telemetry/node_modules ./packages/telemetry/node_modules
COPY --from=build /app/services/email-service/dist ./services/email-service/dist

# Remove declaration files from production image
RUN find ./services/email-service/dist -name "*.d.ts" -type f -delete

WORKDIR /app/services/email-service

# shared/dist/kafka/* (loaded via the @fuzefront/shared symlink) requires kafkajs
# and zod. Node.js resolves requires from the real file path (/app/shared/dist/…),
# which walks up through /app/shared/ — but shared has no node_modules in this
# image. NODE_PATH adds email-service/node_modules as a fallback search path so
# those packages are found without duplicating them.
ENV NODE_PATH=/app/services/email-service/node_modules
ENV PORT=3003
ENV NODE_ENV=production

EXPOSE 3003

USER emailservice

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
