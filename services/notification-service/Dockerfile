# syntax=docker/dockerfile:1

# ---------- base: install production deps only ----------
FROM node:24-alpine AS base
WORKDIR /app
RUN apk add --no-cache dumb-init

# Workspace root manifests, so npm ci can resolve workspace links.
COPY package.json package-lock.json ./
COPY services/notification-service/package.json ./services/notification-service/

RUN npm ci --workspace=services/notification-service --omit=dev --ignore-scripts

# ---------- build: full compile ----------
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY services/notification-service/package.json ./services/notification-service/

RUN npm ci --workspace=services/notification-service --ignore-scripts

COPY services/notification-service/ ./services/notification-service/

RUN cd services/notification-service && npm run build

# ---------- production ----------
FROM node:24-alpine AS production
WORKDIR /app

RUN apk add --no-cache dumb-init && \
    addgroup -S notifsvc && adduser -S notifsvc -G notifsvc -u 1001

COPY --from=base /app/node_modules ./node_modules
COPY --from=build /app/services/notification-service/dist ./services/notification-service/dist

# Declaration files are build output, not runtime input.
RUN find ./services/notification-service/dist -name "*.d.ts" -type f -delete

WORKDIR /app/services/notification-service

ENV PORT=3008
ENV NODE_ENV=production

EXPOSE 3008

USER notifsvc

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
