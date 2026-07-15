# syntax=docker/dockerfile:1
#
# payment-service — self-contained image (no @fuzefront/shared dependency), so
# the build context is services/payment-service/ (NOT the repo root the
# workspace services use). Mirrors the clock-app self-contained pattern.

# ---------- base: production deps only ----------
FROM node:18-alpine AS base
WORKDIR /app
RUN apk add --no-cache dumb-init
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts

# ---------- build: full compile ----------
FROM node:18-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install --ignore-scripts
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ---------- production ----------
FROM node:18-alpine AS production
WORKDIR /app

RUN apk add --no-cache dumb-init && \
    addgroup -S paymentservice && adduser -S paymentservice -G paymentservice -u 1001

COPY --from=base /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

# Drop declaration files from the production image.
RUN find ./dist -name "*.d.ts" -type f -delete

ENV PORT=3007
ENV NODE_ENV=production

EXPOSE 3007

USER paymentservice

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
