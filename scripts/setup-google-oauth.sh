#!/usr/bin/env bash
# setup-google-oauth.sh — one-shot Google OAuth2 client setup for FuzeFront
#
# Creates TWO Web Application OAuth 2.0 clients:
#   • Production:  redirect URI → https://auth.fuzefront.com/source/oauth/callback/google/
#   • Dev tunnel:  redirect URI → https://auth-dev.fuzefront.com/source/oauth/callback/google/
#
# Writes all four credentials to .env at the repo root.
# After running, follow the printed instructions to add the redirect URIs in
# the Google Cloud Console (a 2-click step that cannot be done via CLI).
#
# Usage:
#   chmod +x scripts/setup-google-oauth.sh
#   ./scripts/setup-google-oauth.sh
#
# Optionally pre-set these to skip interactive prompts:
#   GCP_PROJECT=my-project-id       # project ID (not display name)
#   GCP_PROJECT_NAME=FuzeOne        # look up project by display name
#   OAUTH_SUPPORT_EMAIL=me@x.com
#   SKIP_INSTALL=1                  # don't attempt gcloud install

set -euo pipefail

# ── guard: never run as root ───────────────────────────────────────────────────
if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
  echo "[ERROR] Do not run this script with sudo or as root." >&2
  echo "        gcloud does not require elevated privileges." >&2
  echo "        Re-run without sudo: bash /tmp/fuzefront-setup.sh" >&2
  exit 1
fi

# ── colours ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

# ── locate repo root ───────────────────────────────────────────────────────────
# ${BASH_SOURCE[0]} is unset when the script is piped to bash; fall back to $0
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
# Allow caller to override (e.g. git show ... > /tmp/s.sh && REPO_ROOT=... bash /tmp/s.sh)
REPO_ROOT="${REPO_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
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
    GCLOUD_DIR="$HOME/google-cloud-sdk"
    TMP=$(mktemp -d)
    curl -fsSL "https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-linux-x86_64.tar.gz" \
      -o "$TMP/gcloud.tar.gz"
    tar -xzf "$TMP/gcloud.tar.gz" -C "$TMP"
    # Move to permanent home-dir location before deleting the temp dir
    mv "$TMP/google-cloud-sdk" "$GCLOUD_DIR"
    rm -rf "$TMP"
    # Install (updates shell rc files) without re-downloading
    "$GCLOUD_DIR/install.sh" --quiet --path-update=true
    export PATH="$GCLOUD_DIR/bin:$PATH"
  else
    error "Unsupported OS: $OSTYPE. Install gcloud manually: https://cloud.google.com/sdk/docs/install"
  fi
}

if [[ "${SKIP_INSTALL:-0}" != "1" ]] && ! command -v gcloud &>/dev/null; then
  install_gcloud
fi

if ! command -v gcloud &>/dev/null; then
  error "gcloud not found in PATH. Open a new shell and re-run, or add the SDK to your PATH."
fi

ok "gcloud: $(gcloud --version | head -1)"

# Ensure the alpha component is installed (needed for iap oauth-brands/clients)
if ! gcloud alpha --help &>/dev/null 2>&1; then
  info "Installing gcloud alpha component..."
  gcloud components install alpha --quiet
fi

# ── step 2: authenticate ───────────────────────────────────────────────────────
if ! gcloud auth list --format="value(account)" 2>/dev/null | grep -q '@'; then
  info "No gcloud credentials found. Starting browser-based login..."
  gcloud auth login --no-launch-browser
else
  ACTIVE=$(gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null | head -1)
  info "Already authenticated as: $ACTIVE"
fi

# ── step 3: select / create GCP project ────────────────────────────────────────
# GCP_PROJECT_NAME lets callers specify by display name; we look up the project ID.
if [[ -n "${GCP_PROJECT_NAME:-}" && -z "${GCP_PROJECT:-}" ]]; then
  info "Looking up project by name: $GCP_PROJECT_NAME"
  GCP_PROJECT=$(gcloud projects list \
    --filter="name=$GCP_PROJECT_NAME" \
    --format="value(projectId)" 2>/dev/null | head -1)
  if [[ -z "$GCP_PROJECT" ]]; then
    warn "No project with name '$GCP_PROJECT_NAME' found — will create it."
  else
    ok "Found project '$GCP_PROJECT_NAME' → ID: $GCP_PROJECT"
  fi
fi

if [[ -z "${GCP_PROJECT:-}" ]]; then
  echo ""
  echo "Available projects:"
  gcloud projects list --format="table(projectId,name,projectNumber)" 2>/dev/null || true
  echo ""
  read -rp "Enter GCP project ID to use (or press Enter to create a new one): " GCP_PROJECT
fi

if [[ -z "$GCP_PROJECT" ]]; then
  if [[ -n "${GCP_PROJECT_NAME:-}" ]]; then
    GCP_PROJECT=$(echo "$GCP_PROJECT_NAME" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/-$//' | cut -c1-30)
    info "Derived project ID from name: $GCP_PROJECT"
  else
    read -rp "Enter a new project ID (lowercase letters, digits, hyphens, 6-30 chars): " GCP_PROJECT
  fi
  info "Creating project: $GCP_PROJECT"
  gcloud projects create "$GCP_PROJECT" --name="${GCP_PROJECT_NAME:-$GCP_PROJECT}"
  ok "Project created: $GCP_PROJECT"
fi

gcloud config set project "$GCP_PROJECT"
ok "Active project: $GCP_PROJECT"

# ── step 4: enable required APIs ──────────────────────────────────────────────
info "Enabling APIs: iap.googleapis.com cloudresourcemanager.googleapis.com"
gcloud services enable iap.googleapis.com cloudresourcemanager.googleapis.com \
  --project="$GCP_PROJECT"
ok "APIs enabled."

# ── step 5: configure OAuth consent screen / brand ────────────────────────────
# Only one brand is allowed per project. Check if one already exists.
info "Checking for existing OAuth consent screen..."
BRAND_NAME=$(gcloud alpha iap oauth-brands list \
  --project="$GCP_PROJECT" \
  --format="value(name)" 2>/dev/null | head -1)

if [[ -z "$BRAND_NAME" ]]; then
  if [[ -z "${OAUTH_SUPPORT_EMAIL:-}" ]]; then
    OAUTH_SUPPORT_EMAIL=$(gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null | head -1)
    read -rp "OAuth consent screen support email [$OAUTH_SUPPORT_EMAIL]: " INPUT_EMAIL
    OAUTH_SUPPORT_EMAIL="${INPUT_EMAIL:-$OAUTH_SUPPORT_EMAIL}"
  fi
  info "Creating OAuth consent screen (application: FuzeFront, email: $OAUTH_SUPPORT_EMAIL)..."
  gcloud alpha iap oauth-brands create \
    --application_title="FuzeFront" \
    --support_email="$OAUTH_SUPPORT_EMAIL" \
    --project="$GCP_PROJECT"
  BRAND_NAME=$(gcloud alpha iap oauth-brands list \
    --project="$GCP_PROJECT" \
    --format="value(name)" 2>/dev/null | head -1)
fi

[[ -z "$BRAND_NAME" ]] && error "Could not create or find the OAuth consent screen."
ok "OAuth consent screen: $BRAND_NAME"

# ── helper: create an OAuth 2.0 client ───────────────────────────────────────
# gcloud alpha iap oauth-clients create creates a standard Web Application
# credential (appears under APIs & Services → Credentials in the console).
# Redirect URIs must be added via the console after creation (no CLI support).
create_oauth_client() {
  local DISPLAY_NAME="$1"
  info "Creating OAuth 2.0 client: $DISPLAY_NAME"
  gcloud alpha iap oauth-clients create "$BRAND_NAME" \
    --display_name="$DISPLAY_NAME" \
    --project="$GCP_PROJECT" \
    --format=json 2>/dev/null \
    || error "Failed to create OAuth client '$DISPLAY_NAME'. Try: gcloud components install alpha"
}

# ── step 6: create production client ─────────────────────────────────────────
echo ""
info "─── Creating PRODUCTION OAuth client ────────────────────────────────────"
PROD_JSON=$(create_oauth_client "FuzeFront Production")

# name field: "projects/.../brands/.../identityAwareProxyClients/CLIENT_ID.apps.googleusercontent.com"
PROD_CLIENT_ID=$(echo "$PROD_JSON" | python3 -c \
  "import sys,json; d=json.load(sys.stdin); print(d['name'].split('/')[-1])" 2>/dev/null || echo "")
PROD_CLIENT_SECRET=$(echo "$PROD_JSON" | python3 -c \
  "import sys,json; print(json.load(sys.stdin)['secret'])" 2>/dev/null || echo "")

[[ -z "$PROD_CLIENT_ID" ]] && error "Could not parse client_id from production client response."
ok "Production client created: $PROD_CLIENT_ID"

# ── step 7: create dev tunnel client ─────────────────────────────────────────
echo ""
info "─── Creating DEV TUNNEL OAuth client ────────────────────────────────────"
DEV_JSON=$(create_oauth_client "FuzeFront Dev Tunnel")

DEV_CLIENT_ID=$(echo "$DEV_JSON" | python3 -c \
  "import sys,json; d=json.load(sys.stdin); print(d['name'].split('/')[-1])" 2>/dev/null || echo "")
DEV_CLIENT_SECRET=$(echo "$DEV_JSON" | python3 -c \
  "import sys,json; print(json.load(sys.stdin)['secret'])" 2>/dev/null || echo "")

[[ -z "$DEV_CLIENT_ID" ]] && error "Could not parse client_id from dev tunnel client response."
ok "Dev tunnel client created: $DEV_CLIENT_ID"

# ── step 8: write credentials to .env ─────────────────────────────────────────
echo ""
info "Writing credentials to $ENV_FILE"

if [[ ! -f "$ENV_FILE" ]]; then
  if [[ -f "$REPO_ROOT/.env.example" ]]; then
    cp "$REPO_ROOT/.env.example" "$ENV_FILE"
    info "Created .env from .env.example"
  else
    touch "$ENV_FILE"
  fi
fi

set_env_var() {
  local KEY="$1"
  local VALUE="$2"
  if grep -q "^${KEY}=" "$ENV_FILE" 2>/dev/null; then
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

# ── step 9: print summary + redirect URI instructions ─────────────────────────
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  OAuth clients created — ONE MANUAL STEP REQUIRED${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${YELLOW}ACTION REQUIRED: Add redirect URIs in the Google Cloud Console${NC}"
echo "  The gcloud CLI cannot set redirect URIs — you must add them manually."
echo "  Click each link below, then click Edit (pencil icon) → add the URI shown."
echo ""
echo "  1. PRODUCTION client ($PROD_CLIENT_ID)"
echo "     Open:  https://console.cloud.google.com/apis/credentials/oauthclient/${PROD_CLIENT_ID}?project=${GCP_PROJECT}"
echo "     Add URI:  https://auth.fuzefront.com/source/oauth/callback/google/"
echo ""
echo "  2. DEV TUNNEL client ($DEV_CLIENT_ID)"
echo "     Open:  https://console.cloud.google.com/apis/credentials/oauthclient/${DEV_CLIENT_ID}?project=${GCP_PROJECT}"
echo "     Add URI:  https://auth-dev.fuzefront.com/source/oauth/callback/google/"
echo ""
echo "─────────────────────────────────────────────────────────────────────────"
echo ""
echo "  Credentials saved to: $ENV_FILE"
echo "    GOOGLE_CLIENT_ID     = $PROD_CLIENT_ID"
echo "    GOOGLE_DEV_CLIENT_ID = $DEV_CLIENT_ID"
echo "    (secrets written but not printed here)"
echo ""
echo -e "${YELLOW}Next steps after adding redirect URIs:${NC}"
echo "  1. Add test users (consent screen is in Testing mode):"
echo "       https://console.cloud.google.com/apis/credentials/consent?project=$GCP_PROJECT"
echo ""
echo "  2. For local tunnel dev:"
echo "       docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d"
echo ""
echo "  3. For CI, add these GitHub Actions secrets:"
echo "       GOOGLE_DEV_CLIENT_ID     ← \$GOOGLE_DEV_CLIENT_ID from .env"
echo "       GOOGLE_DEV_CLIENT_SECRET ← \$GOOGLE_DEV_CLIENT_SECRET from .env"
echo "       CLOUDFLARE_TUNNEL_TOKEN  ← cloudflared tunnel token fuzefront-dev"
echo "       GOOGLE_TEST_EMAIL        ← test Google account email (no 2FA)"
echo "       GOOGLE_TEST_PASSWORD     ← test Google account password"
echo ""
echo "  4. For production (k8s), seal the prod credentials:"
echo "       cd deploy/contabo/sealed-secrets && ./seal-secret.sh"
echo ""
