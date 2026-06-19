# syntax=docker/dockerfile:1

# ---------- base: install production deps only ----------
FROM node:18-alpine AS base
WORKDIR /app
RUN apk add --no-cache dumb-init

# Copy workspace root manifests (needed so npm ci can resolve workspace links)
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY services/email-service/package.json ./services/email-service/

# Install only production deps for email-service
RUN npm ci --workspace=services/email-service --omit=dev --ignore-scripts

# ---------- build: full compile ----------
FROM node:18-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY services/email-service/package.json ./services/email-service/

RUN npm ci --workspace=services/email-service --ignore-scripts

# Copy source
COPY shared/ ./shared/
COPY services/email-service/ ./services/email-service/

# Build shared first, then email-service
RUN cd shared && npm run build
RUN cd services/email-service && npm run build

# ---------- production ----------
FROM node:18-alpine AS production
WORKDIR /app

RUN apk add --no-cache dumb-init && \
    addgroup -S emailservice && adduser -S emailservice -G emailservice -u 1001

COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/services/email-service/node_modules ./services/email-service/node_modules
COPY --from=build /app/shared/dist ./shared/dist
COPY --from=build /app/services/email-service/dist ./services/email-service/dist

# Remove declaration files from production image
RUN find ./services/email-service/dist -name "*.d.ts" -type f -delete

WORKDIR /app/services/email-service

ENV PORT=3003
ENV NODE_ENV=production

EXPOSE 3003

USER emailservice

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
