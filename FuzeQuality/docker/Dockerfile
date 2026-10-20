# syntax=docker/dockerfile:1.7
FROM node:24-alpine AS dependencies
WORKDIR /workspace/FuzeQuality
COPY FuzeQuality/package.json FuzeQuality/.npmrc ./
# FuzeQuality lives inside FuzeFront and consumes the same checked-in Design
# System and Security contracts. Installing the local packages avoids an
# otherwise unnecessary GitHub Packages credential during test and image
# builds while keeping the production bundle on the published package APIs.
COPY design-system /workspace/design-system
COPY packages/security /workspace/packages/security
COPY packages/onboarding-kit /workspace/packages/onboarding-kit
RUN npm install --ignore-scripts --no-audit --no-fund
# The checked-in design system is intentionally consumed from its repository
# path so the image verifies the exact source being shipped. Its React peer
# dependencies resolve by walking up from /workspace/design-system, while this
# package's dependencies live under /workspace/FuzeQuality. Expose that one
# dependency tree at the monorepo root so root-local packages use the same
# React singleton as FuzeQuality during Vitest and Vite builds.
RUN ln -s /workspace/FuzeQuality/node_modules /workspace/node_modules

FROM dependencies AS source
# This COPY is what bakes contracts/openapi.yaml INTO the image, alongside the
# code that implements it. That is the property that matters: the spec a
# deployment serves must be the spec that deployment was built from. A
# ConfigMap-mounted copy can drift from the running code; a copy in the image
# cannot — so /openapi.yaml and /openapi.json can never describe a different
# build than the one answering them.
COPY FuzeQuality ./

FROM source AS verify
# A supplied value is used for a standalone deployment. The federated remote
# selects its same-origin /apps/fuzequality proxy at runtime instead, so it
# never crosses the Cloudflare Access boundary for its API calls.
ARG FUZEQUALITY_API_URL=
ENV VITE_FUZEQUALITY_API_URL=${FUZEQUALITY_API_URL}
RUN npm run type-check \
 && npm test \
 && npm run build:web

FROM source AS service
ENV NODE_ENV=production
# Keep the runtime image limited to production dependencies. Type definitions,
# Vite, Vitest, and the verification toolchain remain in the verify stage.
RUN npm prune --omit=dev --no-audit --no-fund
# Explicit rather than relying on path discovery: the service falls back to
# walking up from its own module and from cwd, which is right for the dev loop
# but leaves prod depending on where the process happens to be started. Naming
# the path here means a missing contract is a visible 503 + openapi:"unavailable"
# on /health, not a silent fallback to some other copy.
ENV OPENAPI_SPEC_PATH=/workspace/FuzeQuality/contracts/openapi.yaml
USER node
CMD ["npm", "run", "start:api"]

FROM nginx:1.27-alpine AS web
COPY --from=verify /workspace/FuzeQuality/dist /usr/share/nginx/html
COPY FuzeQuality/docker/nginx.conf /etc/nginx/conf.d/default.conf
RUN chown -R nginx:nginx /usr/share/nginx/html /var/cache/nginx /var/run
USER nginx
EXPOSE 8080
