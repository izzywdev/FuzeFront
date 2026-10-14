# syntax=docker/dockerfile:1

# ---------- base: install production deps only ----------
FROM node:24-alpine AS base
WORKDIR /app
RUN apk add --no-cache dumb-init

# services/sms-service is NOT in the root workspaces array, so workspace-mode
# installs (npm ci --workspace=...) fail with "No workspaces found". Use the
# service's own package-lock.json instead — same pattern as email-service.
# packages/telemetry/package.json must be present so the file:../../packages/
# telemetry dep resolves during npm ci (same reasoning as email-service's
# shared/package.json copy).
COPY packages/telemetry/package.json ./packages/telemetry/
COPY services/sms-service/package.json services/sms-service/package-lock.json ./services/sms-service/

# Install only production deps for sms-service
RUN cd services/sms-service && npm ci --omit=dev --ignore-scripts

# ---------- build: full compile ----------
FROM node:24-alpine AS build
WORKDIR /app
COPY packages/telemetry/package.json ./packages/telemetry/
COPY services/sms-service/package.json services/sms-service/package-lock.json ./services/sms-service/

RUN cd services/sms-service && npm ci --ignore-scripts

# Copy source
COPY packages/telemetry/ ./packages/telemetry/
COPY services/sms-service/ ./services/sms-service/

# Build @fuzefront/telemetry first (app.ts calls tracingMiddleware(), index.ts
# calls initTelemetry() at module load), then sms-service.
RUN cd packages/telemetry && npm install --ignore-scripts && npm run build
# telemetry has RUNTIME dependencies (the @opentelemetry/* SDK packages) that
# must reach the production image. The install above pulls in devDeps too
# (tsup/jest/typescript) because the build needs them; prune them here so the
# node_modules copied below is production-only.
RUN cd packages/telemetry && npm prune --omit=dev
RUN cd services/sms-service && npm run build

# ---------- production ----------
FROM node:24-alpine AS production
WORKDIR /app

RUN apk add --no-cache dumb-init && \
    addgroup -S smsservice && adduser -S smsservice -G smsservice -u 1001

COPY --from=base /app/services/sms-service/node_modules ./services/sms-service/node_modules
# @fuzefront/telemetry is a `file:` dependency, so npm LINKS it —
# node_modules/@fuzefront/telemetry is a symlink to /app/packages/telemetry.
# package.json + dist populate the symlink target; node_modules carries its
# RUNTIME deps (the @opentelemetry/* SDK packages), same shape as
# services/config-service/Dockerfile's identical treatment.
COPY --from=build /app/packages/telemetry/package.json ./packages/telemetry/package.json
COPY --from=build /app/packages/telemetry/dist ./packages/telemetry/dist
COPY --from=build /app/packages/telemetry/node_modules ./packages/telemetry/node_modules
COPY --from=build /app/services/sms-service/dist ./services/sms-service/dist

# Remove declaration files from production image
RUN find ./services/sms-service/dist -name "*.d.ts" -type f -delete

WORKDIR /app/services/sms-service

ENV PORT=3004
ENV NODE_ENV=production

EXPOSE 3004

USER smsservice

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
