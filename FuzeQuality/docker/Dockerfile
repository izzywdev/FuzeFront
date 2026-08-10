FROM node:24-alpine AS dependencies
RUN apk add --no-cache git
WORKDIR /workspace/FuzeQuality
COPY FuzeQuality/package.json ./
RUN npm install --ignore-scripts --no-audit --no-fund

FROM dependencies AS source
# This COPY is what bakes contracts/openapi.yaml INTO the image, alongside the
# code that implements it. That is the property that matters: the spec a
# deployment serves must be the spec that deployment was built from. A
# ConfigMap-mounted copy can drift from the running code; a copy in the image
# cannot — so /openapi.yaml and /openapi.json can never describe a different
# build than the one answering them.
COPY FuzeQuality ./

FROM source AS verify
RUN npm run type-check \
 && npm test \
 && npm run build:web

FROM source AS service
ENV NODE_ENV=production
# Explicit rather than relying on path discovery: the service falls back to
# walking up from its own module and from cwd, which is right for the dev loop
# but leaves prod depending on where the process happens to be started. Naming
# the path here means a missing contract is a visible 503 + openapi:"unavailable"
# on /health, not a silent fallback to some other copy.
ENV OPENAPI_SPEC_PATH=/workspace/FuzeQuality/contracts/openapi.yaml
USER node
CMD ["npm", "run", "start:api"]

FROM nginx:1.27-alpine AS web
COPY --from=verify /workspace/FuzeQuality/dist/web /usr/share/nginx/html
COPY FuzeQuality/docker/nginx.conf /etc/nginx/conf.d/default.conf
RUN chown -R nginx:nginx /usr/share/nginx/html /var/cache/nginx /var/run
USER nginx
EXPOSE 8080
