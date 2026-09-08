# Build stage
FROM node:24-alpine AS builder

WORKDIR /app

# Copy package files (vendor-design-system must already be synced —
# scripts/sync-design-system.mjs runs as its own CI step before this build,
# mirroring fuzefront-website/frontend/Dockerfile's identical pattern).
COPY package*.json ./
COPY vendor-design-system ./vendor-design-system

RUN npm ci

COPY . .

ENV NODE_ENV=production
RUN npm run build

# Production stage
FROM nginx:alpine AS production

COPY nginx.conf /etc/nginx/nginx.conf
COPY --from=builder /app/dist /usr/share/nginx/html

RUN mkdir -p /tmp && \
    chown -R nginx:nginx /tmp /usr/share/nginx/html && \
    chmod -R 755 /usr/share/nginx/html

USER nginx

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
