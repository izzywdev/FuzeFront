# syntax=docker/dockerfile:1

# ---------- base: install production deps only ----------
FROM node:18-alpine AS base
WORKDIR /app
RUN apk add --no-cache dumb-init

# Copy workspace root manifests (needed so npm ci can resolve workspace links)
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY services/provisioning-service/package.json ./services/provisioning-service/

# Install only production deps for provisioning-service
RUN npm ci --workspace=services/provisioning-service --omit=dev --ignore-scripts

# ---------- build: full compile ----------
FROM node:18-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY services/provisioning-service/package.json ./services/provisioning-service/

RUN npm ci --workspace=services/provisioning-service --ignore-scripts

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

COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/services/provisioning-service/node_modules ./services/provisioning-service/node_modules
COPY --from=build /app/shared/dist ./shared/dist
COPY --from=build /app/services/provisioning-service/dist ./services/provisioning-service/dist

# Remove declaration files from production image
RUN find ./services/provisioning-service/dist -name "*.d.ts" -type f -delete

WORKDIR /app/services/provisioning-service

ENV PORT=3005
ENV NODE_ENV=production

EXPOSE 3005

USER provisioningservice

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
