# Use Node.js 18 Alpine as base image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Expose port 3002
EXPOSE 3002

# Start the development server
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"] 