#!/usr/bin/env bash
# =============================================================================
# Create and enable: fuzefront.identity.prefixed-ids (FFRNT-185 step 4)
#
# Flag spec
# ---------
#   Name:    fuzefront.identity.prefixed-ids
#   Type:    release
#   Default: OFF in code (fail-safe when Unleash is unreachable)
#            ON in Unleash production (explicitly authorised — run this script)
#   Owner:   feature-flags-engineer (platform slice)
#            backend-engineer (consuming service code in FFRNT-185 steps 3–5)
#   Removal: delete once every service type listed in FFRNT-185 has migrated to
#            the prefixed wire form, all dual-accept windows have closed, and the
#            prefixed form is the only accepted wire format. Remove both this flag
#            from Unleash AND every `isEnabled('fuzefront.identity.prefixed-ids')`
#            call-site in the codebase.
#
# What this script does
# ---------------------
#   1. Creates the feature toggle (idempotent — skips if it already exists).
#   2. Adds a global 100 % flexibleRollout strategy to the production environment
#      (flag ON for all users — user has explicitly authorised this).
#   3. Adds a developers-segment (id 1) 100 % strategy per the creation checklist,
#      so the developer cohort continues to see the flag even if the global strategy
#      is later narrowed to a partial rollout.
#   4. Enables the production environment for this flag.
#   5. Verifies the flag is present and the production environment is enabled.
#
# Prerequisites
# -------------
#   Unleash admin access. Two options:
#
#   Option A — kubectl port-forward (recommended; works from any machine with
#              cluster access):
#     kubectl -n fuzefront port-forward svc/fuzefront-unleash 4242:4242 &
#     export UNLEASH="http://localhost:4242"
#     export TOKEN="$(kubectl -n fuzefront get secret unleash-secrets \
#       -o jsonpath='{.data.INIT_ADMIN_API_TOKENS}' | base64 -d)"
#
#   Option B — Cloudflare Access session (requires OTP login at
#              https://unleash.prod.fuzefront.com):
#     export UNLEASH="https://unleash.prod.fuzefront.com"
#     export TOKEN="<INIT_ADMIN_API_TOKENS value from unleash-secrets>"
#     # You also need to supply the CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET
#     # (Service Token) or complete browser OTP auth and pass the cookie — easier
#     # to just use the port-forward.
#
# Usage
# -----
#   UNLEASH=http://localhost:4242 TOKEN=<admin-token> bash scripts/create-flag-identity-prefixed-ids.sh
#   # or export UNLEASH and TOKEN, then: bash scripts/create-flag-identity-prefixed-ids.sh
#   # Dry-run (no writes): DRY_RUN=1 UNLEASH=... TOKEN=... bash scripts/create-flag-identity-prefixed-ids.sh
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
UNLEASH="${UNLEASH:?UNLEASH must be set, e.g. http://localhost:4242}"
TOKEN="${TOKEN:?TOKEN must be set to the Unleash INIT_ADMIN_API_TOKENS value}"
DRY_RUN="${DRY_RUN:-0}"

PROJECT="default"
ENVIRONMENT="production"
FLAG="fuzefront.identity.prefixed-ids"
DESCRIPTION="Enable TypeID-prefixed wire form on API responses (FFRNT-185 step 4). Default OFF during the dual-accept migration window. Flip ON per-service once their dual-accept window is in place and the backfill is complete."
DEVELOPERS_SEGMENT_ID=1   # The 'developers' segment — id is 1 (created 2026-07-26).

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
die() { echo "ERROR: $*" >&2; exit 1; }

# POST wrapper — skips in dry-run mode and prints the command instead.
do_post() {
  local label="$1" url="$2" body="$3"
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "[DRY-RUN] POST $url"
    echo "[DRY-RUN] body: $body"
    return 0
  fi
  echo "  POST $url"
  http_code="$(curl -sf -o /dev/null -w "%{http_code}" \
    -X POST "$url" \
    -H "Authorization: $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$body")" || {
    echo "  FAILED ($label) — check token + Unleash connectivity"
    return 1
  }
  echo "  -> HTTP $http_code ($label)"
}

# ---------------------------------------------------------------------------
# Step 0: Connectivity check
# ---------------------------------------------------------------------------
echo "==> Checking Unleash connectivity at $UNLEASH ..."
health_code="$(curl -sf -o /dev/null -w "%{http_code}" "$UNLEASH/health" 2>/dev/null)" || health_code="FAILED"
[[ "$health_code" == "200" ]] || die "Unleash health check returned '$health_code'. Is the endpoint reachable and the server running?"
echo "  OK (health: $health_code)"

# ---------------------------------------------------------------------------
# Step 1: Create the feature toggle (idempotent)
# ---------------------------------------------------------------------------
echo ""
echo "==> Step 1: Create flag '$FLAG' ..."

existing_code="$(curl -sf -o /dev/null -w "%{http_code}" \
  -H "Authorization: $TOKEN" \
  "$UNLEASH/api/admin/projects/$PROJECT/features/$FLAG" 2>/dev/null)" || existing_code="FAILED"

if [[ "$existing_code" == "200" ]]; then
  echo "  Flag already exists — skipping creation."
else
  do_post "create flag" \
    "$UNLEASH/api/admin/projects/$PROJECT/features" \
    "$(printf '{"name":"%s","type":"release","description":"%s","impressionData":false}' \
      "$FLAG" \
      "$(echo "$DESCRIPTION" | sed 's/"/\\"/g')")"
fi

# ---------------------------------------------------------------------------
# Step 2: Add global 100 % strategy (flag ON for all users)
# ---------------------------------------------------------------------------
echo ""
echo "==> Step 2: Add global 100 % strategy to $ENVIRONMENT ..."
# Check existing strategies to avoid duplicates.
strategies_json="$(curl -sf \
  -H "Authorization: $TOKEN" \
  "$UNLEASH/api/admin/projects/$PROJECT/features/$FLAG/environments/$ENVIRONMENT/strategies" 2>/dev/null)" || strategies_json="{}"

has_global_100="$(echo "$strategies_json" | python3 -c "
import sys, json
data = json.load(sys.stdin)
strategies = data if isinstance(data, list) else data.get('strategies', [])
found = any(
  s.get('name') == 'flexibleRollout'
  and str(s.get('parameters', {}).get('rollout', '')) == '100'
  and not s.get('segments')
  for s in strategies
)
print('yes' if found else 'no')
" 2>/dev/null || echo "unknown")"

if [[ "$has_global_100" == "yes" ]]; then
  echo "  Global 100 % strategy already present — skipping."
else
  do_post "global 100% strategy" \
    "$UNLEASH/api/admin/projects/$PROJECT/features/$FLAG/environments/$ENVIRONMENT/strategies" \
    "$(printf '{"name":"flexibleRollout","title":"Global 100%%","parameters":{"rollout":"100","stickiness":"default","groupId":"%s"},"segments":[]}' "$FLAG")"
fi

# ---------------------------------------------------------------------------
# Step 3: Add developers-segment (id 1) 100 % strategy per creation checklist
# ---------------------------------------------------------------------------
echo ""
echo "==> Step 3: Add developers-segment strategy (segment id $DEVELOPERS_SEGMENT_ID) ..."
has_dev_strategy="$(echo "$strategies_json" | python3 -c "
import sys, json
data = json.load(sys.stdin)
strategies = data if isinstance(data, list) else data.get('strategies', [])
found = any(
  s.get('name') == 'flexibleRollout'
  and str(s.get('parameters', {}).get('rollout', '')) == '100'
  and $DEVELOPERS_SEGMENT_ID in s.get('segments', [])
  for s in strategies
)
print('yes' if found else 'no')
" 2>/dev/null || echo "unknown")"

if [[ "$has_dev_strategy" == "yes" ]]; then
  echo "  Developers-segment strategy already present — skipping."
else
  do_post "developers-segment strategy" \
    "$UNLEASH/api/admin/projects/$PROJECT/features/$FLAG/environments/$ENVIRONMENT/strategies" \
    "$(printf '{"name":"flexibleRollout","title":"Developers 100%%","parameters":{"rollout":"100","stickiness":"default","groupId":"%s"},"segments":[%d]}' "$FLAG" "$DEVELOPERS_SEGMENT_ID")"
fi

# ---------------------------------------------------------------------------
# Step 4: Enable the production environment
# ---------------------------------------------------------------------------
echo ""
echo "==> Step 4: Enable '$ENVIRONMENT' environment for '$FLAG' ..."
do_post "enable environment" \
  "$UNLEASH/api/admin/projects/$PROJECT/features/$FLAG/environments/$ENVIRONMENT/on" \
  "{}"

# ---------------------------------------------------------------------------
# Step 5: Verify
# ---------------------------------------------------------------------------
echo ""
echo "==> Step 5: Verify ..."
feature_json="$(curl -sf \
  -H "Authorization: $TOKEN" \
  "$UNLEASH/api/admin/projects/$PROJECT/features/$FLAG" 2>/dev/null)"

if [[ -z "$feature_json" ]]; then
  die "Could not fetch flag details for verification."
fi

is_enabled="$(echo "$feature_json" | python3 -c "
import sys, json
data = json.load(sys.stdin)
envs = data.get('environments', [])
for e in envs:
  if e.get('name') == '$ENVIRONMENT':
    print('yes' if e.get('enabled') else 'no')
    break
else:
  print('not-found')
" 2>/dev/null || echo "unknown")"

flag_type="$(echo "$feature_json" | python3 -c "import sys,json;print(json.load(sys.stdin).get('type','?'))" 2>/dev/null || echo "?")"

echo ""
echo "  Flag:        $FLAG"
echo "  Type:        $flag_type"
echo "  Environment: $ENVIRONMENT enabled = $is_enabled"

if [[ "$is_enabled" == "yes" ]]; then
  echo ""
  echo "DONE: $FLAG is created and enabled in Unleash ($ENVIRONMENT)."
  echo ""
  echo "Evaluation:"
  echo "  ON state (Unleash live):  global 100% strategy -> evaluates TRUE for all callers"
  echo "  OFF state (Unleash down): in-code default FALSE -> API serves bare UUIDs (safe)"
  echo ""
  echo "Consuming code reads this flag as:"
  echo "  await flags.getBooleanValue('$FLAG', false, ctx)"
else
  echo ""
  echo "WARNING: flag is NOT enabled in $ENVIRONMENT (is_enabled=$is_enabled)."
  echo "  Check that step 4 succeeded and that your token has admin rights."
  exit 1
fi
