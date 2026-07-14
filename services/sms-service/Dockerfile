# syntax=docker/dockerfile:1

# ---------- base: install production deps only ----------
FROM node:18-alpine AS base
WORKDIR /app
RUN apk add --no-cache dumb-init

# services/sms-service is NOT in the root workspaces array, so workspace-mode
# installs (npm ci --workspace=...) fail with "No workspaces found". Use the
# service's own package-lock.json instead — same pattern as email-service.
COPY services/sms-service/package.json services/sms-service/package-lock.json ./services/sms-service/

# Install only production deps for sms-service
RUN cd services/sms-service && npm ci --omit=dev --ignore-scripts

# ---------- build: full compile ----------
FROM node:18-alpine AS build
WORKDIR /app
COPY services/sms-service/package.json services/sms-service/package-lock.json ./services/sms-service/

RUN cd services/sms-service && npm ci --ignore-scripts

# Copy source
COPY services/sms-service/ ./services/sms-service/

# Build sms-service
RUN cd services/sms-service && npm run build

# ---------- production ----------
FROM node:18-alpine AS production
WORKDIR /app

RUN apk add --no-cache dumb-init && \
    addgroup -S smsservice && adduser -S smsservice -G smsservice -u 1001

COPY --from=base /app/services/sms-service/node_modules ./services/sms-service/node_modules
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
