# Build context is the shopify-nav/ directory:  docker build -f deploy/Dockerfile .
FROM node:22-alpine

WORKDIR /app

# Server (zero-dependency — no npm install needed)
COPY server/server.js /app/server/server.js

# PWA static files
COPY index.html sw.js manifest.webmanifest \
     favicon.png apple-touch-icon.png icon-192.png icon-512.png icon-maskable.png \
     /app/public/
COPY .well-known/ /app/public/.well-known/

ENV NODE_ENV=production \
    PORT=8787 \
    STATIC_DIR=/app/public \
    DATA_DIR=/data

RUN mkdir -p /data && chown -R node:node /data /app
USER node

EXPOSE 8787
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8787/api/health || exit 1

CMD ["node", "/app/server/server.js"]
