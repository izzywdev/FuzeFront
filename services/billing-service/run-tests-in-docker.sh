#!/usr/bin/env bash
# Runs billing-service unit tests in a clean node:18 Linux container.
# Avoids the host (Windows) node_modules entirely — copies sources into the
# container, installs fresh, and runs jest. Used for local verification where
# the Windows npm install is unreliable. CI runs jest natively on Linux.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

docker run --rm \
  -e GITHUB_TOKEN=x-dummy \
  -v "$REPO_ROOT":/repo:ro \
  node:18-alpine sh -c '
    set -e
    mkdir -p /work
    cp -r /repo/shared /work/shared
    cp -r /repo/services/billing-service /work/billing-service
    # Drop any copied lockfile/node_modules from the read-only mount snapshot.
    rm -rf /work/billing-service/node_modules /work/shared/node_modules
    # billing-service depends on file:../../shared — recreate that layout.
    mkdir -p /work/services
    mv /work/billing-service /work/services/billing-service
    cd /work/shared && npm install --no-audit --no-fund --ignore-scripts >/dev/null 2>&1
    cd /work/services/billing-service && npm install --no-audit --no-fund --ignore-scripts
    npx jest --colors
  '
