# =============================================================================
# @fuzefront/mcp-gateway — ONE image, deployed once per product.
#
# Nothing product-specific is baked in. The pod becomes "the FuzeService
# gateway" or "the FuzeSales gateway" purely through runtime config:
#
#   MCP_PRODUCT           product name, used as the MCP server name
#   MCP_UPSTREAM_BASE_URL in-cluster base URL of that product's REST API
#   MCP_OPENAPI_SPEC      path to the mounted OpenAPI document
#   MCP_TOOL_OVERRIDES    path to the mounted mutation-overrides file (optional)
#
# Deliberately absent: any credential env var. The gateway forwards the caller's
# identity and holds none of its own; src/config.ts refuses to start if a
# service-token variable is present.
#
# Build from the REPO ROOT (it needs the workspace package):
#   docker build -f packages/mcp-gateway/Dockerfile -t ghcr.io/izzywdev/fuze-mcp-gateway:0.1.0 .
# =============================================================================
FROM node:24-alpine AS builder
WORKDIR /build

COPY packages/mcp-gateway/package.json packages/mcp-gateway/package-lock.json* ./
RUN npm install --no-workspaces --ignore-scripts

COPY packages/mcp-gateway/tsconfig.json packages/mcp-gateway/tsconfig.build.json ./
COPY packages/mcp-gateway/src ./src
RUN npm run build

# Drop dev dependencies from what we ship.
RUN npm prune --omit=dev --no-workspaces

# -----------------------------------------------------------------------------
FROM node:24-alpine AS runtime
WORKDIR /app

# Run unprivileged. The gateway reads two mounted files and makes outbound HTTP
# calls; it has no reason to own anything on disk.
RUN addgroup -g 1001 -S nodejs && adduser -S mcp -u 1001 -G nodejs

COPY --from=builder --chown=mcp:nodejs /build/node_modules ./node_modules
COPY --from=builder --chown=mcp:nodejs /build/dist ./dist
COPY --from=builder --chown=mcp:nodejs /build/package.json ./package.json

USER mcp
EXPOSE 8081

ENV NODE_ENV=production \
    PORT=8081

# /healthz reports the tool count, so a container that booted with a broken
# spec is visibly different from a healthy one rather than just "up".
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8081)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
