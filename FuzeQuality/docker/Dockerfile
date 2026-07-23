FROM node:22-alpine AS dependencies
RUN apk add --no-cache git
WORKDIR /workspace/FuzeQuality
COPY FuzeQuality/package.json ./
RUN npm install --ignore-scripts --no-audit --no-fund

FROM dependencies AS source
COPY FuzeQuality ./

FROM source AS verify
RUN npm run type-check \
 && npm test \
 && npm run build:web

FROM source AS service
ENV NODE_ENV=production
USER node
CMD ["npm", "run", "start:api"]

FROM nginx:1.27-alpine AS web
COPY --from=verify /workspace/FuzeQuality/dist/web /usr/share/nginx/html
COPY FuzeQuality/docker/nginx.conf /etc/nginx/conf.d/default.conf
RUN chown -R nginx:nginx /usr/share/nginx/html /var/cache/nginx /var/run
USER nginx
EXPOSE 8080
