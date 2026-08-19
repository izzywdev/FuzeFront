#!/usr/bin/env bash
# register-machine-client.sh
#
# Registers a new machine/service-account OAuth2 client in Authentik.
#
# Creates:
#   1. An OAuth2 Provider configured for client_credentials grant only
#   2. An Application bound to that provider
#
# Outputs the generated client_id and client_secret to stdout.
# These credentials should be stored securely (e.g. a Kubernetes SealedSecret).
#
# Usage:
#   export AUTHENTIK_BASE_URL=http://authentik.dev.local
#   export AUTHENTIK_ADMIN_TOKEN=<your-admin-api-token>
#   ./scripts/register-machine-client.sh <agent-name> [scopes]
#
# Arguments:
#   agent-name   Required. Name for the service account (e.g. "billing-worker")
#   scopes       Optional. Space-separated OAuth2 scopes (default: "openid")
#
# Environment variables:
#   AUTHENTIK_BASE_URL     Base URL of your Authentik instance (no trailing slash)
#   AUTHENTIK_ADMIN_TOKEN  Authentik API token with write access
#
# Examples:
#   ./scripts/register-machine-client.sh billing-worker "openid profile"
#   ./scripts/register-machine-client.sh chat-agent
#
# Exit codes:
#   0  Success — client_id and client_secret printed
#   1  Missing argument or environment variable
#   2  API call failed

set -euo pipefail

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------

AGENT_NAME="${1:-}"
SCOPES="${2:-openid}"

if [[ -z "$AGENT_NAME" ]]; then
  echo "Error: agent-name is required" >&2
  echo "Usage: $0 <agent-name> [scopes]" >&2
  exit 1
fi

AUTHENTIK_BASE_URL="${AUTHENTIK_BASE_URL:-}"
AUTHENTIK_ADMIN_TOKEN="${AUTHENTIK_ADMIN_TOKEN:-}"

if [[ -z "$AUTHENTIK_BASE_URL" ]]; then
  echo "Error: AUTHENTIK_BASE_URL environment variable is required" >&2
  exit 1
fi
if [[ -z "$AUTHENTIK_ADMIN_TOKEN" ]]; then
  echo "Error: AUTHENTIK_ADMIN_TOKEN environment variable is required" >&2
  exit 1
fi

# Normalise slug: lowercase, replace non-alphanumeric with hyphens
SLUG=$(echo "$AGENT_NAME" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g')

echo "[register-machine-client] Registering agent: $AGENT_NAME (slug: $SLUG)"

# ---------------------------------------------------------------------------
# Helper: HTTP calls with error handling
# ---------------------------------------------------------------------------

api_post() {
  local path="$1"
  local payload="$2"
  local response
  local http_code

  # Use a temp file so we can capture both body and status code
  local tmp_body
  tmp_body=$(mktemp)

  http_code=$(curl -s -o "$tmp_body" -w "%{http_code}" \
    -X POST \
    -H "Authorization: Bearer $AUTHENTIK_ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    --data "$payload" \
    "${AUTHENTIK_BASE_URL}/api/v3${path}")

  response=$(cat "$tmp_body")
  rm -f "$tmp_body"

  if [[ "$http_code" -lt 200 || "$http_code" -ge 300 ]]; then
    echo "Error: API call to ${path} failed with HTTP ${http_code}" >&2
    echo "Response: $response" >&2
    exit 2
  fi

  echo "$response"
}

api_get() {
  local path="$1"
  local response
  local http_code
  local tmp_body
  tmp_body=$(mktemp)

  http_code=$(curl -s -o "$tmp_body" -w "%{http_code}" \
    -X GET \
    -H "Authorization: Bearer $AUTHENTIK_ADMIN_TOKEN" \
    "${AUTHENTIK_BASE_URL}/api/v3${path}")

  response=$(cat "$tmp_body")
  rm -f "$tmp_body"

  if [[ "$http_code" -lt 200 || "$http_code" -ge 300 ]]; then
    echo "Error: API call to ${path} failed with HTTP ${http_code}" >&2
    echo "Response: $response" >&2
    exit 2
  fi

  echo "$response"
}

# ---------------------------------------------------------------------------
# Step 1: Find the default authorization flow (required by Authentik provider)
# ---------------------------------------------------------------------------

echo "[register-machine-client] Fetching available authorization flows..."
FLOWS_JSON=$(api_get "/flows/instances/?designation=authorization")

# Pick the implicit-consent flow if available, else the first one
FLOW_PK=$(echo "$FLOWS_JSON" | python3 -c "
import json, sys
data = json.load(sys.stdin)
results = data.get('results', [])
for f in results:
    if 'implicit-consent' in f.get('slug', '') or 'authorization' in f.get('slug', ''):
        print(f['pk'])
        sys.exit(0)
if results:
    print(results[0]['pk'])
" 2>/dev/null || echo "")

if [[ -z "$FLOW_PK" ]]; then
  echo "Warning: Could not find authorization flow; proceeding without one" >&2
  FLOW_PK=""
fi

echo "[register-machine-client] Using authorization flow: ${FLOW_PK:-<none>}"

# ---------------------------------------------------------------------------
# Step 2: Create OAuth2 Provider (client_credentials grant only)
# ---------------------------------------------------------------------------

echo "[register-machine-client] Creating OAuth2 Provider..."

PROVIDER_PAYLOAD=$(cat <<EOF
{
  "name": "${AGENT_NAME} (machine)",
  "authorization_flow": "${FLOW_PK}",
  "client_type": "confidential",
  "allowed_grant_types": ["client_credentials"],
  "token_validity": "hours=1",
  "sub_mode": "hashed_user_id",
  "issuer_mode": "global"
}
EOF
)

PROVIDER_JSON=$(api_post "/providers/oauth2/" "$PROVIDER_PAYLOAD")
PROVIDER_ID=$(echo "$PROVIDER_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['pk'])")
echo "[register-machine-client] Created provider id=${PROVIDER_ID}"

# ---------------------------------------------------------------------------
# Step 3: Create Application bound to the provider
# ---------------------------------------------------------------------------

echo "[register-machine-client] Creating Application..."

APP_PAYLOAD=$(cat <<EOF
{
  "name": "${AGENT_NAME}",
  "slug": "${SLUG}",
  "provider": ${PROVIDER_ID},
  "meta_description": "Machine identity for ${AGENT_NAME}",
  "policy_engine_mode": "any"
}
EOF
)

APP_JSON=$(api_post "/core/applications/" "$APP_PAYLOAD")
APP_SLUG=$(echo "$APP_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['slug'])")
echo "[register-machine-client] Created application slug=${APP_SLUG}"

# ---------------------------------------------------------------------------
# Step 4: Retrieve generated client_id / client_secret
# ---------------------------------------------------------------------------

echo "[register-machine-client] Retrieving client credentials..."
PROVIDER_DETAIL=$(api_get "/providers/oauth2/${PROVIDER_ID}/")

CLIENT_ID=$(echo "$PROVIDER_DETAIL" | python3 -c "import json,sys; print(json.load(sys.stdin)['client_id'])")
CLIENT_SECRET=$(echo "$PROVIDER_DETAIL" | python3 -c "import json,sys; print(json.load(sys.stdin)['client_secret'])")

# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

echo ""
echo "=========================================="
echo "  Machine client registered successfully"
echo "=========================================="
echo "  Agent name:    $AGENT_NAME"
echo "  Application:   $APP_SLUG"
echo "  Provider ID:   $PROVIDER_ID"
echo ""
echo "  CLIENT_ID:     $CLIENT_ID"
echo "  CLIENT_SECRET: $CLIENT_SECRET"
echo ""
echo "  Store these in a Kubernetes SealedSecret:"
echo "    MACHINE_CLIENT_ID=$CLIENT_ID"
echo "    MACHINE_CLIENT_SECRET=$CLIENT_SECRET"
echo "=========================================="
echo ""
echo "  Token endpoint:"
echo "  ${AUTHENTIK_BASE_URL}/application/o/${APP_SLUG}/token/"
echo ""
echo "  Obtain a token:"
echo "  curl -X POST ${AUTHENTIK_BASE_URL}/application/o/${APP_SLUG}/token/ \\"
echo "    -d 'grant_type=client_credentials' \\"
echo "    -d 'client_id=${CLIENT_ID}' \\"
echo "    -d 'client_secret=${CLIENT_SECRET}' \\"
echo "    -d 'scope=${SCOPES}'"
echo "=========================================="
