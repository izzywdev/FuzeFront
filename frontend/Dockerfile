# Build stage — glibc + Node 20 so Tailwind v4's @tailwindcss/oxide native
# binding resolves reliably (it is flaky on alpine/musl).
#
# IMPORTANT: this image builds from the REPO ROOT context (release.yml passes
# `context: .` + `file: frontend/Dockerfile`), NOT from ./frontend. frontend/
# vite.config.ts aliases the @fuzefront/* UI packages (i18n, identity-ui,
# design-system, chat-ui) to their SOURCE under ../packages/*/src. Those sources
# live outside frontend/, so the build needs the whole workspace layout. Building
# with `context: ./frontend` is what broke the prod frontend image: vite resolved
# `../packages/i18n/src/index.ts` to a path that did not exist in the context.
FROM node:20-bookworm-slim AS build

WORKDIR /app

# No GitHub Packages token is needed: every @fuzefront/* package resolves from the
# local workspace (members + file: deps + vite source aliases), so the install never
# hits the private registry. (Verified by a clean local build with no token.) This
# avoids baking a credential into an image layer/cache that gets pushed to GHCR.

# Copy the whole monorepo (node_modules/.git excluded via .dockerignore). The
# frontend's vite config aliases the @fuzefront/* UI packages (identity-ui, i18n,
# design-system, chat-client, chat-ui) to their SOURCE under ../packages/* and
# ../design-system, so the build needs the full workspace, not just frontend/.
COPY . .

# Workspace install at the ROOT so every workspace member's deps hoist into
# /app/node_modules — e.g. identity-ui's @tanstack/react-table. This mirrors local
# dev (root `npm install`); a frontend-only install can't see these transitive deps
# and is exactly what broke the prod frontend image. Drop the host (Windows)
# lockfile so linux-native optional deps (e.g. @tailwindcss/oxide) re-resolve
# (npm optional-deps bug npm/cli#4828).
RUN rm -f package-lock.json && npm install

# Frontend is NOT a workspace member — install its own deps (incl. the chat-*
# file: packages) and build. vite resolves the aliased package SOURCES from
# /app/packages + /app/design-system and their transitive deps from the hoisted
# /app/node_modules.
WORKDIR /app/frontend

# Accept build arguments. VITE_API_URL defaults EMPTY so the app resolves the API
# same-origin (window.location.origin) unless a caller overrides it — correct for
# the CF-edge/same-origin prod model.
ARG VITE_API_URL=
ARG VITE_APP_TITLE="FuzeFront Platform"

# Set environment variables for build
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_APP_TITLE=$VITE_APP_TITLE

RUN rm -f package-lock.json && npm install

# Build the application
RUN npm run build

# Production stage with Nginx
FROM nginx:alpine AS production

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user
RUN addgroup -g 1001 -S nginx-user && \
    adduser -S frontend -u 1001 -G nginx-user

# Copy built application
COPY --from=build /app/frontend/dist /usr/share/nginx/html

# Copy custom Nginx configuration
COPY frontend/nginx.conf /etc/nginx/nginx.conf

# Create required directories and set permissions
RUN mkdir -p /var/cache/nginx /var/run && \
    chown -R frontend:nginx-user /var/cache/nginx /var/run /var/log/nginx /usr/share/nginx/html

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/ || exit 1

# Switch to non-root user
USER frontend

# Start Nginx
ENTRYPOINT ["dumb-init", "--"]
CMD ["nginx", "-g", "daemon off;"]
