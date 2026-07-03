#!/usr/bin/env bash
# setup-google-oauth.sh — guided Google OAuth2 client setup for FuzeFront
#
# Google has no public API for creating Web Application OAuth 2.0 credentials
# on personal GCP accounts (the IAP Admin API only works for Workspace orgs
# and was deprecated in Jan 2026). This script therefore:
#
#   1. Uses gcloud to authenticate and select your project
#   2. Opens the exact Google Cloud Console URLs for you
#   3. Prints step-by-step instructions for creating TWO OAuth clients
#   4. Prompts you to paste the client_id and client_secret for each
#   5. Writes all four values to .env at the repo root
#
# OAuth clients to create:
#   • Production:  redirect URI → https://auth.fuzefront.com/source/oauth/callback/google/
#   • Dev tunnel:  redirect URI → https://auth-dev.fuzefront.com/source/oauth/callback/google/
#
# Usage:
#   bash scripts/setup-google-oauth.sh
#
# Optionally pre-set these to skip interactive prompts:
#   GCP_PROJECT=my-project-id    # project ID (not display name)
#   GCP_PROJECT_NAME=FuzeOne     # look up project by display name
#   SKIP_INSTALL=1               # don't attempt gcloud install

set -euo pipefail

# ── guard: never run as root ───────────────────────────────────────────────────
if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
  echo "[ERROR] Do not run this script with sudo or as root." >&2
  echo "        Re-run without sudo." >&2
  exit 1
fi

# ── colours ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'
BOLD='\033[1m'; NC='\033[0m'
info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }
step()  { echo ""; echo -e "${BOLD}${YELLOW}━━━ $* ━━━${NC}"; }
pause() { echo ""; read -rp "$(echo -e "${CYAN}Press Enter when done...${NC}") " _; }

# ── locate repo root ───────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
ENV_FILE="$REPO_ROOT/.env"

# ── step 1: install gcloud if absent ──────────────────────────────────────────
install_gcloud() {
  info "Installing Google Cloud SDK..."
  if [[ "$OSTYPE" == darwin* ]]; then
    command -v brew &>/dev/null \
      || error "Homebrew not found. Install from https://brew.sh then re-run."
    brew install --cask google-cloud-sdk
    # shellcheck source=/dev/null
    source "$(brew --prefix)/share/google-cloud-sdk/path.bash.inc" 2>/dev/null || true
  elif [[ "$OSTYPE" == linux* ]]; then
    GCLOUD_DIR="$HOME/google-cloud-sdk"
    TMP=$(mktemp -d)
    curl -fsSL "https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-linux-x86_64.tar.gz" \
      -o "$TMP/gcloud.tar.gz"
    tar -xzf "$TMP/gcloud.tar.gz" -C "$TMP"
    mv "$TMP/google-cloud-sdk" "$GCLOUD_DIR"
    rm -rf "$TMP"
    "$GCLOUD_DIR/install.sh" --quiet --path-update=true
    export PATH="$GCLOUD_DIR/bin:$PATH"
  else
    error "Unsupported OS: $OSTYPE. Install gcloud from https://cloud.google.com/sdk/docs/install"
  fi
}

if [[ "${SKIP_INSTALL:-0}" != "1" ]] && ! command -v gcloud &>/dev/null; then
  install_gcloud
fi
command -v gcloud &>/dev/null \
  || error "gcloud not found in PATH. Open a new shell and re-run."

ok "gcloud: $(gcloud --version | head -1)"

# ── step 2: authenticate ───────────────────────────────────────────────────────
if ! gcloud auth list --format="value(account)" 2>/dev/null | grep -q '@'; then
  info "Starting browser-based login..."
  gcloud auth login --no-launch-browser
else
  ACTIVE=$(gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null | head -1)
  info "Already authenticated as: $ACTIVE"
fi

# ── step 3: select / create GCP project ────────────────────────────────────────
if [[ -n "${GCP_PROJECT_NAME:-}" && -z "${GCP_PROJECT:-}" ]]; then
  info "Looking up project by name: $GCP_PROJECT_NAME"
  GCP_PROJECT=$(gcloud projects list \
    --filter="name=$GCP_PROJECT_NAME" \
    --format="value(projectId)" 2>/dev/null | head -1)
  if [[ -z "$GCP_PROJECT" ]]; then
    warn "No project named '$GCP_PROJECT_NAME' found — will create it."
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
    GCP_PROJECT=$(echo "$GCP_PROJECT_NAME" \
      | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/-$//' | cut -c1-30)
    info "Derived project ID: $GCP_PROJECT"
  else
    read -rp "Enter a new project ID (lowercase, hyphens, 6-30 chars): " GCP_PROJECT
  fi
  info "Creating project: $GCP_PROJECT"
  gcloud projects create "$GCP_PROJECT" --name="${GCP_PROJECT_NAME:-$GCP_PROJECT}"
  ok "Project created: $GCP_PROJECT"
fi

gcloud config set project "$GCP_PROJECT" --quiet
ok "Active project: $GCP_PROJECT"

# ── step 4: consent screen + credentials (guided manual setup) ────────────────
#
# There is no public API for creating Web Application OAuth 2.0 credentials on
# personal GCP accounts. The IAP Admin API only supports Workspace org projects
# and was deprecated in Jan 2026. The steps below must be done in the Console.

CONSOLE_CONSENT="https://console.cloud.google.com/apis/credentials/consent?project=${GCP_PROJECT}"
CONSOLE_CREDS="https://console.cloud.google.com/apis/credentials?project=${GCP_PROJECT}"

step "Configure the OAuth consent screen (one-time)"
echo ""
echo -e "  Open this URL in your browser:"
echo -e "  ${BOLD}${CONSOLE_CONSENT}${NC}"
echo ""
echo "  Fill in:"
echo "    User type:      External"
echo "    App name:       FuzeFront"
echo "    Support email:  your email"
echo "    Developer email: your email"
echo "  Click [Save and Continue] through all steps (scopes and test users can be added later)."

# Try to open the browser automatically
if command -v xdg-open &>/dev/null; then
  xdg-open "$CONSOLE_CONSENT" 2>/dev/null || true
elif command -v open &>/dev/null; then
  open "$CONSOLE_CONSENT" 2>/dev/null || true
elif command -v powershell.exe &>/dev/null; then
  powershell.exe -Command "Start-Process '${CONSOLE_CONSENT}'" 2>/dev/null || true
fi

pause "Press Enter once the consent screen is saved"

# ── Production client ──────────────────────────────────────────────────────────
step "Create the PRODUCTION OAuth client"
echo ""
echo -e "  Open: ${BOLD}${CONSOLE_CREDS}${NC}"
echo ""
echo "  Click [+ CREATE CREDENTIALS] → [OAuth client ID]"
echo "    Application type:        Web application"
echo "    Name:                    FuzeFront Production"
echo "    Authorized redirect URIs:"
echo -e "      ${GREEN}https://auth.fuzefront.com/source/oauth/callback/google/${NC}"
echo ""
echo "  Click [Create]. A dialog shows the client ID and secret."

if command -v xdg-open &>/dev/null; then
  xdg-open "$CONSOLE_CREDS" 2>/dev/null || true
elif command -v open &>/dev/null; then
  open "$CONSOLE_CREDS" 2>/dev/null || true
elif command -v powershell.exe &>/dev/null; then
  powershell.exe -Command "Start-Process '${CONSOLE_CREDS}'" 2>/dev/null || true
fi

echo ""
read -rp "Paste PRODUCTION Client ID:     " PROD_CLIENT_ID
read -rsp "Paste PRODUCTION Client Secret: " PROD_CLIENT_SECRET
echo ""
[[ -z "$PROD_CLIENT_ID" || -z "$PROD_CLIENT_SECRET" ]] \
  && error "Production client ID and secret are required."
ok "Production credentials captured."

# ── Dev tunnel client ──────────────────────────────────────────────────────────
step "Create the DEV TUNNEL OAuth client"
echo ""
echo -e "  Open: ${BOLD}${CONSOLE_CREDS}${NC}"
echo ""
echo "  Click [+ CREATE CREDENTIALS] → [OAuth client ID] again"
echo "    Application type:        Web application"
echo "    Name:                    FuzeFront Dev Tunnel"
echo "    Authorized redirect URIs:"
echo -e "      ${GREEN}https://auth-dev.fuzefront.com/source/oauth/callback/google/${NC}"
echo ""
echo "  Click [Create]. Copy the new client ID and secret."
echo ""
read -rp "Paste DEV TUNNEL Client ID:     " DEV_CLIENT_ID
read -rsp "Paste DEV TUNNEL Client Secret: " DEV_CLIENT_SECRET
echo ""
[[ -z "$DEV_CLIENT_ID" || -z "$DEV_CLIENT_SECRET" ]] \
  && error "Dev tunnel client ID and secret are required."
ok "Dev tunnel credentials captured."

# ── step 5: write to .env ─────────────────────────────────────────────────────
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
  local KEY="$1" VALUE="$2"
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

# ── summary ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Setup complete!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "  Credentials saved to: $ENV_FILE"
echo "    GOOGLE_CLIENT_ID     = $PROD_CLIENT_ID"
echo "    GOOGLE_DEV_CLIENT_ID = $DEV_CLIENT_ID"
echo "    (secrets written but not echoed here)"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo ""
echo "  1. Add test users so they can sign in (consent screen is in Testing mode):"
echo "       $CONSOLE_CONSENT"
echo ""
echo "  2. For local tunnel dev:"
echo "       docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d"
echo ""
echo "  3. Add GitHub Actions secrets for the E2E CI job:"
echo "       GOOGLE_DEV_CLIENT_ID     ← GOOGLE_DEV_CLIENT_ID from .env"
echo "       GOOGLE_DEV_CLIENT_SECRET ← GOOGLE_DEV_CLIENT_SECRET from .env"
echo "       CLOUDFLARE_TUNNEL_TOKEN  ← cloudflared tunnel token fuzefront-dev"
echo "       GOOGLE_TEST_EMAIL        ← test Google account email (no 2FA)"
echo "       GOOGLE_TEST_PASSWORD     ← test Google account password"
echo ""
echo "  4. For production (k8s), seal the prod credentials:"
echo "       cd deploy/contabo/sealed-secrets && ./seal-secret.sh"
echo ""
