# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Debug: Show environment files
RUN ls -la .env* || echo "No .env files found"

# Build the application for production
ENV NODE_ENV=production
RUN echo "Building with NODE_ENV=$NODE_ENV" && \
    npm cache clean --force && \
    npm run build

# Debug: Show build output
RUN ls -la dist/ || echo "No dist directory found"

# Production stage
FROM nginx:alpine AS production

# Copy nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

# Copy built application
COPY --from=builder /app/dist /usr/share/nginx/html

# Create necessary directories and set permissions
RUN mkdir -p /tmp && \
    chown -R nginx:nginx /tmp /usr/share/nginx/html && \
    chmod -R 755 /usr/share/nginx/html

# Switch to non-root user
USER nginx

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/health || exit 1

# Start nginx
CMD ["nginx", "-g", "daemon off;"]