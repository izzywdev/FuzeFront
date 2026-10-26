# FuzeFront product-specific A2A image.
#
# Extends the shared Fuze A2A runtime (ghcr.io/izzywdev/fuze-a2a) and bakes
# in a pre-generated agent-card.json so the pod needs no GitHub access at
# startup — no init container, no git clone, no git token secret.
#
# AGENT_CARD_FILE tells the server to serve the baked JSON at
# /.well-known/agent-card.json directly (server.py well_known_card()).
# If the file is absent or malformed it falls through to dynamic projection.
#
# Rebuild and push this image whenever agent-card.json changes
# (i.e. when .fuze/manifest.json or agent-templates/roles/app-shell-platform/
# changes). build-a2a-image.yml handles that automatically on push to master.
#
# Per-product topology reference:
#   izzywdev/FuzeAgent docs/a2a/per-product-pod.md
ARG BASE_TAG=latest
FROM ghcr.io/izzywdev/fuze-a2a:${BASE_TAG}

COPY agent-card.json /app/agent-card.json
ENV AGENT_CARD_FILE=/app/agent-card.json
