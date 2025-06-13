# Use Node.js 18 Alpine as base image
FROM node:18-alpine AS base

# Set working directory
WORKDIR /app

# Install dependencies for native modules
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install && npm cache clean --force

# Build stage
FROM node:18-alpine AS build

WORKDIR /app

# Install dependencies for build
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev)
RUN npm install

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM node:18-alpine AS production

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S backend -u 1001

WORKDIR /app

# Copy production dependencies
COPY --from=base --chown=backend:nodejs /app/node_modules ./node_modules

# Copy built application
COPY --from=build --chown=backend:nodejs /app/dist ./dist

# Copy package.json for version info
COPY --chown=backend:nodejs package.json ./

# Set environment variables
ENV NODE_ENV=production
ENV USE_POSTGRES=true
ENV DB_HOST=shared-postgres
ENV DB_PORT=5432
ENV DB_NAME=fuzefront_platform
ENV DB_USER=postgres
ENV DB_PASSWORD=postgres
ENV JWT_SECRET=fuzefront-production-secret-change-this
ENV PORT=3001

# Expose port
EXPOSE 3001

# Switch to non-root user
USER backend

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

# Start the application
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"] 