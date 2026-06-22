# Build stage — glibc + Node 20 so Tailwind v4's @tailwindcss/oxide native
# binding resolves reliably (it is flaky on alpine/musl).
FROM node:20-bookworm-slim AS build

WORKDIR /app

# Copy package files + the scoped .npmrc so @fuzefront/* (e.g. @fuzefront/i18n)
# resolves from GitHub Packages during install.
COPY package*.json ./
COPY .npmrc ./

# GitHub token used only to read @fuzefront/* from GitHub Packages. Passed as a
# build secret/arg by CI; not baked into the final image (build stage only).
ARG GITHUB_TOKEN=""
ENV GITHUB_TOKEN=$GITHUB_TOKEN

# Install dependencies. Drop the host (Windows) lockfile first so npm re-resolves
# platform-native optional deps (e.g. @tailwindcss/oxide linux binding) inside the
# linux build — works around npm's optional-deps bug (npm/cli#4828).
RUN rm -f package-lock.json && npm install

# Copy source code
COPY . .

# Accept build arguments
ARG VITE_API_URL=http://localhost:3001
ARG VITE_APP_TITLE="FuzeFront Platform"

# Set environment variables for build
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_APP_TITLE=$VITE_APP_TITLE

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
COPY --from=build /app/dist /usr/share/nginx/html

# Copy custom Nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

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