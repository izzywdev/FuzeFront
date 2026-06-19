# syntax=docker/dockerfile:1

# ---------- base: install production deps only ----------
FROM node:18-alpine AS base
WORKDIR /app
RUN apk add --no-cache dumb-init

# Copy workspace root manifests and service manifest
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY services/billing-service/package.json ./services/billing-service/

# Install only production deps for billing-service
RUN cd services/billing-service && npm install --omit=dev --ignore-scripts

# ---------- build: full compile ----------
FROM node:18-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY services/billing-service/package.json ./services/billing-service/

# Install billing-service deps (including devDeps for tsc)
RUN cd services/billing-service && npm install --ignore-scripts
# Install shared devDeps so we can compile the kafka sub-tree
RUN cd shared && npm install --ignore-scripts

# Copy source
COPY shared/ ./shared/
COPY services/billing-service/ ./services/billing-service/

# Build shared kafka sub-tree first (avoids socket.io-client / React dep), then billing-service
RUN cd shared && npm run build:kafka
RUN cd services/billing-service && npm run build

# ---------- production ----------
FROM node:18-alpine AS production
WORKDIR /app

RUN apk add --no-cache dumb-init && \
    addgroup -S billingservice && adduser -S billingservice -G billingservice -u 1001

COPY --from=base /app/services/billing-service/node_modules ./services/billing-service/node_modules
COPY --from=build /app/shared/dist ./shared/dist
COPY --from=build /app/services/billing-service/dist ./services/billing-service/dist

# Remove declaration files from production image
RUN find ./services/billing-service/dist -name "*.d.ts" -type f -delete

WORKDIR /app/services/billing-service

ENV PORT=3006
ENV NODE_ENV=production

EXPOSE 3006

USER billingservice

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
