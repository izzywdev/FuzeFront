#!/usr/bin/env bash
# setup-google-oauth.sh — one-shot Google OAuth2 client setup for FuzeFront
#
# Creates TWO Web Application OAuth 2.0 clients:
#   • Production:  redirect URI → https://auth.fuzefront.com/source/oauth/callback/google/
#   • Dev tunnel:  redirect URI → https://auth-dev.fuzefront.com/source/oauth/callback/google/
#
# Writes all four credentials to .env at the repo root.
#
# Usage:
#   chmod +x scripts/setup-google-oauth.sh
#   ./scripts/setup-google-oauth.sh
#
# Optionally pre-set these to skip interactive prompts:
#   GCP_PROJECT=my-project-id
#   OAUTH_SUPPORT_EMAIL=me@example.com
#   SKIP_INSTALL=1   # don't attempt gcloud install

set -euo pipefail

# ── colours ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

# ── locate repo root ───────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"

# ── step 1: install gcloud if absent ──────────────────────────────────────────
install_gcloud() {
  info "Installing Google Cloud SDK..."
  if [[ "$OSTYPE" == darwin* ]]; then
    if command -v brew &>/dev/null; then
      brew install --cask google-cloud-sdk
      # shellcheck source=/dev/null
      source "$(brew --prefix)/share/google-cloud-sdk/path.bash.inc" 2>/dev/null || true
    else
      error "Homebrew not found. Install it from https://brew.sh then re-run."
    fi
  elif [[ "$OSTYPE" == linux* ]]; then
    info "Downloading gcloud installer for Linux..."
    TMP=$(mktemp -d)
    curl -fsSL "https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-linux-x86_64.tar.gz" \
      -o "$TMP/gcloud.tar.gz"
    tar -xzf "$TMP/gcloud.tar.gz" -C "$TMP"
    "$TMP/google-cloud-sdk/install.sh" --quiet --path-update=true
    export PATH="$HOME/google-cloud-sdk/bin:$PATH"
    # Also try the extracted location
    export PATH="$TMP/google-cloud-sdk/bin:$PATH"
    rm -rf "$TMP"
  else
    error "Unsupported OS: $OSTYPE. Install gcloud manually: https://cloud.google.com/sdk/docs/install"
  fi
}

if [[ "${SKIP_INSTALL:-0}" != "1" ]] && ! command -v gcloud &>/dev/null; then
  install_gcloud
fi

if ! command -v gcloud &>/dev/null; then
  error "gcloud not found in PATH even after install attempt. Open a new shell and re-run, or add the SDK to your PATH manually."
fi

ok "gcloud: $(gcloud --version | head -1)"

# ── step 2: authenticate ───────────────────────────────────────────────────────
if ! gcloud auth list --format="value(account)" 2>/dev/null | grep -q '@'; then
  info "No gcloud credentials found. Starting browser-based login..."
  gcloud auth login --no-launch-browser
else
  ACTIVE=$(gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null | head -1)
  info "Already authenticated as: $ACTIVE"
fi

# Also ensure application-default credentials exist (needed for REST API calls)
if ! gcloud auth application-default print-access-token &>/dev/null 2>&1; then
  info "Setting up application-default credentials..."
  gcloud auth application-default login --no-launch-browser
fi

# ── step 3: select / create GCP project ────────────────────────────────────────
if [[ -z "${GCP_PROJECT:-}" ]]; then
  echo ""
  echo "Available projects:"
  gcloud projects list --format="table(projectId,name,projectNumber)" 2>/dev/null || true
  echo ""
  read -rp "Enter GCP project ID to use (or press Enter to create a new one): " GCP_PROJECT
fi

if [[ -z "$GCP_PROJECT" ]]; then
  read -rp "Enter a new project ID (lowercase letters, digits, hyphens, 6-30 chars): " GCP_PROJECT
  info "Creating project: $GCP_PROJECT"
  gcloud projects create "$GCP_PROJECT" --name="$GCP_PROJECT"
  ok "Project created: $GCP_PROJECT"
fi

gcloud config set project "$GCP_PROJECT"
ok "Active project: $GCP_PROJECT"

# Resolve numeric project number (needed for some API calls)
PROJECT_NUMBER=$(gcloud projects describe "$GCP_PROJECT" --format="value(projectNumber)")
info "Project number: $PROJECT_NUMBER"

# ── step 4: enable required APIs ──────────────────────────────────────────────
APIS=(
  "oauth2.googleapis.com"
  "iap.googleapis.com"
  "cloudresourcemanager.googleapis.com"
)
info "Enabling APIs: ${APIS[*]}"
gcloud services enable "${APIS[@]}" --project="$GCP_PROJECT"
ok "APIs enabled."

# ── step 5: configure OAuth consent screen ────────────────────────────────────
# Determine support email
if [[ -z "${OAUTH_SUPPORT_EMAIL:-}" ]]; then
  OAUTH_SUPPORT_EMAIL=$(gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null | head -1)
  read -rp "OAuth consent screen support email [$OAUTH_SUPPORT_EMAIL]: " INPUT_EMAIL
  OAUTH_SUPPORT_EMAIL="${INPUT_EMAIL:-$OAUTH_SUPPORT_EMAIL}"
fi

info "Configuring OAuth consent screen (External, testing mode)..."
# Use gcloud CLI for the brand / consent screen
# External type, testing mode — no need for Google verification for dev clients
gcloud alpha iap oauth-brands create \
  --application_title="FuzeFront" \
  --support_email="$OAUTH_SUPPORT_EMAIL" \
  --project="$GCP_PROJECT" 2>/dev/null \
  || warn "OAuth consent screen may already exist — continuing."

ok "OAuth consent screen configured."

# ── helper: create a Web Application OAuth 2.0 client via REST API ────────────
# gcloud does not expose a direct command for standard Web Application clients
# (only IAP clients). We call the clientauthconfig REST API instead.
create_web_client() {
  local CLIENT_NAME="$1"
  local REDIRECT_URI="$2"

  info "Creating OAuth client: $CLIENT_NAME"
  info "  Redirect URI: $REDIRECT_URI"

  ACCESS_TOKEN=$(gcloud auth print-access-token)

  RESPONSE=$(curl -fsS \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -X POST \
    "https://clientauthconfig.googleapis.com/v1/projects/$PROJECT_NUMBER/brands/$PROJECT_NUMBER/oauthClients" \
    -d "{
      \"displayName\": \"$CLIENT_NAME\",
      \"clientType\": \"WEB\",
      \"redirectUris\": [\"$REDIRECT_URI\"]
    }") || error "Failed to create OAuth client: $CLIENT_NAME"

  echo "$RESPONSE"
}

# ── step 6: create production client ─────────────────────────────────────────
echo ""
info "─── Creating PRODUCTION OAuth client ────────────────────────────────────"
PROD_RESPONSE=$(create_web_client \
  "FuzeFront Production" \
  "https://auth.fuzefront.com/source/oauth/callback/google/")

PROD_CLIENT_ID=$(echo "$PROD_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('name','').split('/')[-1] + '.apps.googleusercontent.com')" 2>/dev/null \
  || echo "$PROD_RESPONSE" | grep -o '"name":"[^"]*"' | grep -o '[^"]*$' | sed 's|.*/||' | head -1)

PROD_CLIENT_SECRET=$(echo "$PROD_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('secret',''))" 2>/dev/null \
  || echo "$PROD_RESPONSE" | grep -o '"secret":"[^"]*"' | sed 's/"secret":"//;s/"//')

# The API may return clientId directly instead of deriving from name
if echo "$PROD_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('clientId',''))" 2>/dev/null | grep -q '\.apps\.'; then
  PROD_CLIENT_ID=$(echo "$PROD_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['clientId'])")
fi

ok "Production client created."
info "  Client ID: $PROD_CLIENT_ID"

# ── step 7: create dev tunnel client ─────────────────────────────────────────
echo ""
info "─── Creating DEV TUNNEL OAuth client ────────────────────────────────────"
DEV_RESPONSE=$(create_web_client \
  "FuzeFront Dev Tunnel" \
  "https://auth-dev.fuzefront.com/source/oauth/callback/google/")

DEV_CLIENT_ID=$(echo "$DEV_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('clientId',''))" 2>/dev/null \
  || echo "")

if [[ -z "$DEV_CLIENT_ID" ]]; then
  DEV_CLIENT_ID=$(echo "$DEV_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('name','').split('/')[-1] + '.apps.googleusercontent.com')" 2>/dev/null || echo "")
fi

DEV_CLIENT_SECRET=$(echo "$DEV_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('secret',''))" 2>/dev/null || echo "")

ok "Dev tunnel client created."
info "  Client ID: $DEV_CLIENT_ID"

# ── step 8: write credentials to .env ─────────────────────────────────────────
echo ""
info "Writing credentials to $ENV_FILE"

# Create .env from example if it doesn't exist yet
if [[ ! -f "$ENV_FILE" ]]; then
  if [[ -f "$REPO_ROOT/.env.example" ]]; then
    cp "$REPO_ROOT/.env.example" "$ENV_FILE"
    info "Created .env from .env.example"
  else
    touch "$ENV_FILE"
  fi
fi

# Helper: set or replace a key in the .env file
set_env_var() {
  local KEY="$1"
  local VALUE="$2"
  if grep -q "^${KEY}=" "$ENV_FILE" 2>/dev/null; then
    # Replace existing line (portable sed)
    sed -i.bak "s|^${KEY}=.*|${KEY}=${VALUE}|" "$ENV_FILE" && rm -f "${ENV_FILE}.bak"
  else
    echo "${KEY}=${VALUE}" >> "$ENV_FILE"
  fi
}

set_env_var "GOOGLE_CLIENT_ID"         "$PROD_CLIENT_ID"
set_env_var "GOOGLE_CLIENT_SECRET"     "$PROD_CLIENT_SECRET"
set_env_var "GOOGLE_DEV_CLIENT_ID"     "$DEV_CLIENT_ID"
set_env_var "GOOGLE_DEV_CLIENT_SECRET" "$DEV_CLIENT_SECRET"

ok "Credentials written to .env"

# ── step 9: print summary ─────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Google OAuth setup complete!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "  PRODUCTION client"
echo "    Client ID:     $PROD_CLIENT_ID"
echo "    Redirect URI:  https://auth.fuzefront.com/source/oauth/callback/google/"
echo ""
echo "  DEV TUNNEL client"
echo "    Client ID:     $DEV_CLIENT_ID"
echo "    Redirect URI:  https://auth-dev.fuzefront.com/source/oauth/callback/google/"
echo ""
echo "  Credentials saved to: $ENV_FILE"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "  1. For local tunnel dev:"
echo "       docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d"
echo ""
echo "  2. For CI (Google OAuth E2E job), add these GitHub Actions secrets:"
echo "       GOOGLE_DEV_CLIENT_ID     ← from .env GOOGLE_DEV_CLIENT_ID"
echo "       GOOGLE_DEV_CLIENT_SECRET ← from .env GOOGLE_DEV_CLIENT_SECRET"
echo "       CLOUDFLARE_TUNNEL_TOKEN  ← from cloudflared tunnel token fuzefront-dev"
echo "       GOOGLE_TEST_EMAIL        ← test account email (no 2FA)"
echo "       GOOGLE_TEST_PASSWORD     ← test account password"
echo ""
echo "  3. For production (k8s), seal the production credentials:"
echo "       cd deploy/contabo/sealed-secrets"
echo "       ./seal-secret.sh"
echo "       # Commit the updated fuzefront-secrets.yaml"
echo ""
echo -e "${YELLOW}IMPORTANT:${NC} The consent screen is in TESTING mode."
echo "  Only users added as Test Users in the Google Console can sign in."
echo "  To add test users:"
echo "    https://console.cloud.google.com/apis/credentials/consent?project=$GCP_PROJECT"
echo "  For production, submit for verification to allow all users."
echo ""
