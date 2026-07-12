#!/usr/bin/env bash
# One-shot setup for a fresh Ubuntu server (e.g. Contabo VPS).
# Run from inside the shopify-nav/deploy directory:
#   cd shopify-nav/deploy && sudo bash setup.sh
#
# Non-interactive use (CI / re-runs): pre-create .env yourself, or export
#   DOMAIN=... ANTHROPIC_API_KEY=... before running.
set -euo pipefail

cd "$(dirname "$0")"

if [ "$(id -u)" -ne 0 ]; then
  echo "This script needs root (it installs Docker and opens firewall ports)." >&2
  echo "Re-run with:  sudo bash setup.sh" >&2
  exit 1
fi

echo "==> Shopify Navigator server setup"

# 1. Docker engine
if ! command -v docker >/dev/null 2>&1; then
  echo "==> Installing Docker..."
  curl -fsSL https://get.docker.com | sh
else
  echo "==> Docker already installed"
fi

# 2. Compose v2 plugin (get.docker.com bundles it, but pre-existing docker.io/snap
#    installs often don't). Verify and install if missing.
if ! docker compose version >/dev/null 2>&1; then
  echo "==> 'docker compose' plugin missing — installing docker-compose-plugin..."
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -y && apt-get install -y docker-compose-plugin
  fi
  if ! docker compose version >/dev/null 2>&1; then
    echo "ERROR: 'docker compose' is still unavailable. Install the Compose v2 plugin manually:" >&2
    echo "       https://docs.docker.com/compose/install/linux/" >&2
    exit 1
  fi
fi

# 3. Firewall — open web ports incl. UDP 443 for HTTP/3 (QUIC)
if command -v ufw >/dev/null 2>&1; then
  echo "==> Opening ports 80/tcp, 443/tcp, 443/udp (ufw)"
  ufw allow 80/tcp   >/dev/null || true
  ufw allow 443/tcp  >/dev/null || true
  ufw allow 443/udp  >/dev/null || true
fi

# 4. .env — write it directly (no sed; values may contain & | / etc.)
if [ ! -f .env ]; then
  DOMAIN_VAL="${DOMAIN:-}"
  KEY_VAL="${ANTHROPIC_API_KEY:-}"
  if [ -z "$DOMAIN_VAL" ] || [ -z "$KEY_VAL" ]; then
    if [ -t 0 ]; then
      [ -z "$DOMAIN_VAL" ] && { read -rp "Domain pointing at this server [shopify-nav.fuzefront.com]: " DOMAIN_VAL; }
      DOMAIN_VAL="${DOMAIN_VAL:-shopify-nav.fuzefront.com}"
      [ -z "$KEY_VAL" ] && { read -rp "Anthropic API key (sk-ant-...): " KEY_VAL; }
    else
      echo "ERROR: no .env and no TTY. Export DOMAIN and ANTHROPIC_API_KEY, or create .env from .env.example." >&2
      exit 1
    fi
  fi
  if [ -z "$KEY_VAL" ]; then
    echo "ERROR: ANTHROPIC_API_KEY is required." >&2
    exit 1
  fi
  umask 077
  {
    printf 'DOMAIN=%s\n' "$DOMAIN_VAL"
    printf 'ANTHROPIC_API_KEY=%s\n' "$KEY_VAL"
    printf 'SCAN_MODEL=%s\n' "${SCAN_MODEL:-claude-sonnet-5}"
  } > .env
  chmod 600 .env
  echo "==> Wrote .env"
else
  echo "==> Using existing .env"
fi

# 5. Build & start
echo "==> Building and starting containers..."
docker compose up -d --build

DOMAIN_OUT=$(grep '^DOMAIN=' .env | cut -d= -f2-)
echo ""
echo "==> Done. Within ~1 minute (after Let's Encrypt issues the certificate):"
echo "    https://${DOMAIN_OUT}"
echo ""
echo "    Make sure DNS has an A record: ${DOMAIN_OUT} -> this server's IP"
echo "    Logs:    docker compose logs -f"
echo "    Update:  git pull && docker compose up -d --build"
