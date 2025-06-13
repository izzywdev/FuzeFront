# Build stage
FROM node:18-alpine AS build

WORKDIR /app

# Install dependencies for native modules
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Set environment variables for build
ENV VITE_API_URL=http://localhost:3001
ENV VITE_APP_TITLE="Task Manager - FuzeFront"

# Build the application
RUN npm run build

# Production stage with Nginx
FROM nginx:alpine AS production

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user
RUN addgroup -g 1001 -S nginx-user && \
    adduser -S taskmanager -u 1001 -G nginx-user

# Copy built application
COPY --from=build /app/dist /usr/share/nginx/html

# Copy custom Nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

# Create directories and set permissions
RUN mkdir -p /var/cache/nginx /var/run && \
    chown -R taskmanager:nginx-user /var/cache/nginx /var/run /usr/share/nginx/html /etc/nginx

# Switch to non-root user
USER taskmanager

# Expose port
EXPOSE 3002

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3002/ || exit 1

# Start Nginx
ENTRYPOINT ["dumb-init", "--"]
CMD ["nginx", "-g", "daemon off;"] 