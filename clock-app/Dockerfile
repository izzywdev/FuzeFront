# Build stage — glibc/Node 20 (consistent with the host frontend build).
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
# Drop any host lockfile so npm resolves platform-native deps in this image.
RUN rm -f package-lock.json && npm install
COPY . .

# Build-time configuration (no host code, just URLs). HTTPS by default so the
# federated remote loads from the https host without a mixed-content block.
ARG VITE_HUB_API_URL=https://fuzefront.dev.local
ARG VITE_PUBLIC_URL=https://clock.dev.local
ENV VITE_HUB_API_URL=$VITE_HUB_API_URL
ENV VITE_PUBLIC_URL=$VITE_PUBLIC_URL
RUN npm run build

# Serve the built remote with nginx.
FROM nginx:alpine AS production
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://localhost:8080/health || exit 1
CMD ["nginx", "-g", "daemon off;"]
