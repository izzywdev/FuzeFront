# syntax=docker/dockerfile:1

# ---------- base: install production deps only ----------
FROM node:18-alpine AS base
WORKDIR /app
RUN apk add --no-cache dumb-init

# services/provisioning-service is NOT in the root workspaces array, so
# workspace-mode installs (npm ci --workspace=...) fail with "No workspaces
# found". Use the service's own package-lock.json instead — same pattern as
# email-service. shared/package.json is needed so the file:../../shared dep
# resolves during npm ci.
COPY shared/package.json ./shared/
COPY services/provisioning-service/package.json services/provisioning-service/package-lock.json ./services/provisioning-service/

# Install only production deps for provisioning-service
RUN cd services/provisioning-service && npm ci --omit=dev --ignore-scripts

# ---------- build: full compile ----------
FROM node:18-alpine AS build
WORKDIR /app
COPY shared/package.json ./shared/
COPY services/provisioning-service/package.json services/provisioning-service/package-lock.json ./services/provisioning-service/

RUN cd services/provisioning-service && npm ci --ignore-scripts
# shared is part of the root workspace (no own lock file); install its devDeps
# (typescript, etc.) so `npm run build` inside shared can find `tsc`.
RUN cd shared && npm install --ignore-scripts

# Copy source
COPY shared/ ./shared/
COPY services/provisioning-service/ ./services/provisioning-service/

# Build shared first, then provisioning-service
RUN cd shared && npm run build
RUN cd services/provisioning-service && npm run build

# ---------- production ----------
FROM node:18-alpine AS production
WORKDIR /app

RUN apk add --no-cache dumb-init && \
    addgroup -S provisioningservice && adduser -S provisioningservice -G provisioningservice -u 1001

COPY --from=base /app/services/provisioning-service/node_modules ./services/provisioning-service/node_modules
# shared/package.json is required so the @fuzefront/shared link
# (node_modules/@fuzefront/shared -> ../../shared) resolves "main: dist/index.js"
COPY --from=build /app/shared/package.json ./shared/package.json
COPY --from=build /app/shared/dist ./shared/dist
COPY --from=build /app/services/provisioning-service/dist ./services/provisioning-service/dist

# Remove declaration files from production image
RUN find ./services/provisioning-service/dist -name "*.d.ts" -type f -delete

WORKDIR /app/services/provisioning-service

# This service imports ONLY from '@fuzefront/shared/kafka' (the subpath export
# → shared/dist/kafka/index.js), never from the '@fuzefront/shared' root export.
# The root export re-exports React hooks and socket.io-client; the kafka subpath
# is compiled CJS and requires only kafkajs + zod — both present in
# provisioning-service/node_modules. NODE_PATH makes Node.js fall back to those
# modules when resolving requires whose real on-disk path is under /app/shared/dist/
# (which has no node_modules of its own in this image).
# IMPORTANT: if future changes add a root-shared import here, also copy
# socket.io-client and react into the image or switch to a workspace install.
ENV NODE_PATH=/app/services/provisioning-service/node_modules
ENV PORT=3005
ENV NODE_ENV=production

EXPOSE 3005

USER provisioningservice

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
