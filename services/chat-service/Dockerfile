# syntax=docker/dockerfile:1

# ---------- base: install production deps only ----------
FROM node:18-alpine AS base
WORKDIR /app
RUN apk add --no-cache dumb-init

# Copy workspace root manifests (needed so npm ci can resolve workspace links)
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY services/chat-service/package.json ./services/chat-service/

# Install only production deps for chat-service
RUN npm ci --workspace=services/chat-service --omit=dev --ignore-scripts

# ---------- build: full compile ----------
FROM node:18-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY services/chat-service/package.json ./services/chat-service/

RUN npm ci --workspace=services/chat-service --ignore-scripts

# Copy source
COPY shared/ ./shared/
COPY services/chat-service/ ./services/chat-service/

# Copy the product docs corpus the chat-doc-indexer Job indexes (RAG source).
COPY docs/ ./services/chat-service/docs/

# Build shared first, then chat-service
RUN cd shared && npm run build
RUN cd services/chat-service && npm run build

# ---------- production ----------
FROM node:18-alpine AS production
WORKDIR /app

RUN apk add --no-cache dumb-init && \
    addgroup -S chatservice && adduser -S chatservice -G chatservice -u 1001

COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/services/chat-service/node_modules ./services/chat-service/node_modules
COPY --from=build /app/shared/dist ./shared/dist
COPY --from=build /app/services/chat-service/dist ./services/chat-service/dist
# Product docs corpus for the chat-doc-indexer Job.
COPY --from=build /app/services/chat-service/docs ./services/chat-service/docs

# Remove declaration files from production image
RUN find ./services/chat-service/dist -name "*.d.ts" -type f -delete

WORKDIR /app/services/chat-service

ENV PORT=3006
ENV NODE_ENV=production

EXPOSE 3006

USER chatservice

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
