#!/usr/bin/env bash
# set-penpot-mcp-secret.sh
#
# Sets the PENPOT_MCP_URL GitHub Secret in every FuzeOne family repo under
# the izzywdev org (any repo that has a .fuze/manifest.json).
#
# USAGE
#   export PENPOT_MCP_URL="https://design.penpot.app/mcp/stream?userToken=<token>"
#   bash scripts/set-penpot-mcp-secret.sh
#
# REQUIRES
#   gh CLI installed and authenticated (gh auth login)
#   jq  (brew install jq / apt install jq)
#
# OPTIONAL OVERRIDE
#   ORG=izzywdev          # default: izzywdev
#   REPOS="repo1 repo2"  # space-separated list; skips auto-discovery if set

set -euo pipefail

ORG="${ORG:-izzywdev}"
SECRET_NAME="PENPOT_MCP_URL"

# ── Validate environment ──────────────────────────────────────────────────────
if [[ -z "${PENPOT_MCP_URL:-}" ]]; then
  echo "ERROR: PENPOT_MCP_URL env var is not set."
  echo "  export PENPOT_MCP_URL=\"https://design.penpot.app/mcp/stream?userToken=<token>\""
  exit 1
fi

if ! command -v gh &>/dev/null; then
  echo "ERROR: gh CLI not found. Install from https://cli.github.com"
  exit 1
fi

if ! gh auth status &>/dev/null; then
  echo "ERROR: gh CLI not authenticated. Run: gh auth login"
  exit 1
fi

if ! command -v jq &>/dev/null; then
  echo "ERROR: jq not found. Install: brew install jq / apt install jq"
  exit 1
fi

# ── Discover family repos (or use override) ───────────────────────────────────
if [[ -n "${REPOS:-}" ]]; then
  # Manual override: REPOS="FuzeFront FuzeChat ..."
  REPO_LIST=($REPOS)
else
  echo "Discovering FuzeOne family repos in ${ORG}..."
  # List all repos in the org, then keep only those with .fuze/manifest.json
  ALL_REPOS=$(gh repo list "$ORG" --limit 100 --json name --jq '.[].name')
  REPO_LIST=()
  for repo in $ALL_REPOS; do
    if gh api "repos/${ORG}/${repo}/contents/.fuze/manifest.json" &>/dev/null 2>&1; then
      REPO_LIST+=("$repo")
      echo "  found: ${ORG}/${repo}"
    fi
  done
fi

if [[ ${#REPO_LIST[@]} -eq 0 ]]; then
  echo "No FuzeOne family repos found. Use: REPOS=\"RepoA RepoB\" bash $0"
  exit 1
fi

echo ""
echo "Setting ${SECRET_NAME} in ${#REPO_LIST[@]} repo(s)..."
echo ""

FAILED=()
for repo in "${REPO_LIST[@]}"; do
  TARGET="${ORG}/${repo}"
  echo -n "  ${TARGET} ... "
  if echo "$PENPOT_MCP_URL" | gh secret set "$SECRET_NAME" --repo "$TARGET" --body -; then
    echo "OK"
  else
    echo "FAILED"
    FAILED+=("$TARGET")
  fi
done

echo ""
if [[ ${#FAILED[@]} -eq 0 ]]; then
  echo "Done. ${SECRET_NAME} set in all ${#REPO_LIST[@]} repo(s)."
else
  echo "Done with errors. Failed repos:"
  for r in "${FAILED[@]}"; do echo "  $r"; done
  exit 1
fi
