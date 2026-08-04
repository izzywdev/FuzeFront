#!/usr/bin/env bash
# Provision the FuzeFront OIDC provider + application in the E2E Authentik.
#
# Extracted verbatim from .github/workflows/oidc-plumbing-e2e.yml so that BOTH
# e2e workflows provision the stack identically (see .github/actions/e2e-stack).
# Two hand-rolled copies of this logic is what let `E2E (sign-in)` drift into
# testing a stack that no longer existed.
#
# Idempotent: check-then-create throughout, safe to re-run.
#
# Why REST + Django ORM rather than the blueprint: the blueprint runner applies
# entries at debug log level, so a failed !Find reference is silently invisible
# at info level. Explicit API calls give real error reporting.
#
# Env:
#   AUTHENTIK_OIDC_CLIENT_SECRET — shared secret for the OIDC provider
set -euo pipefail

BASE="http://authentik-server:9000/api/v3"
AUTH="Authorization: Bearer e2e-bootstrap-token"
CT="Content-Type: application/json"
COMPOSE="docker compose -f docker-compose.e2e.yml"

APP_RAW=$(curl -s -H "$AUTH" "$BASE/core/applications/?search=fuzefront")
APP_COUNT=$(echo "$APP_RAW" | jq '.results | length' 2>/dev/null || echo "0")
APP_EXISTS=false
if [ "$APP_COUNT" -gt "0" ]; then
  echo "FuzeFront application already exists (blueprint succeeded)"
  APP_EXISTS=true
else
  echo "FuzeFront application not found — provisioning via REST API"
fi

# ── Resolve the implicit-consent authorization flow via the Django ORM ────────
# Prefer Authentik 2024.12.3's built-in flow: Authentik itself configures the
# ConsentStage correctly (the valid mode is 'permanent', NOT 'never_require').
echo "Resolving implicit-consent authorization flow via Python ORM..."
FLOW_OUTPUT=$($COMPOSE exec -T authentik-worker python - <<'PYEOF'
import os
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "authentik.root.settings")
import django
django.setup()
from authentik.flows.models import Flow, FlowStageBinding
from authentik.stages.consent.models import ConsentStage

try:
    flow = Flow.objects.get(slug="default-provider-authorization-implicit-consent")
    print("FLOW_SOURCE=builtin")
except Flow.DoesNotExist:
    stage, _ = ConsentStage.objects.get_or_create(
        name="FuzeFront Implicit Consent Stage",
        defaults={"mode": "permanent"},
    )
    flow, _ = Flow.objects.get_or_create(
        slug="fuzefront-authorization-implicit-consent",
        defaults={
            "name": "FuzeFront Authorization (Implicit Consent)",
            "designation": "authorization",
            "title": "FuzeFront Authorization",
            "authentication": "none",
            "policy_engine_mode": "all",
        },
    )
    FlowStageBinding.objects.get_or_create(target=flow, stage=stage, defaults={"order": 0})
    print("FLOW_SOURCE=custom")
print("FLOW_PK=" + str(flow.pk))
PYEOF
)
echo "Flow output: $FLOW_OUTPUT"
FLOW_PK=$(echo "$FLOW_OUTPUT" | grep "^FLOW_PK=" | head -1 | cut -d= -f2 | tr -d '\r\n ')
if [ -z "$FLOW_PK" ] || [ "$FLOW_PK" = "null" ]; then
  echo "::error::Could not resolve implicit-consent authorization flow"
  exit 1
fi
echo "Using implicit-consent authorization flow pk=$FLOW_PK"

wait_for_discovery() {
  echo "Waiting for OIDC discovery to be available (up to 3 minutes)..."
  for i in $(seq 1 36); do
    if curl -fsS "http://authentik-server:9000/application/o/fuzefront/.well-known/openid-configuration" >/dev/null 2>&1; then
      echo "OIDC discovery available after $((i * 5))s"
      return 0
    fi
    sleep 5
  done
  echo "WARNING: OIDC discovery not available after 3 minutes — continuing anyway"
  return 0
}

# If the app already exists, just point its provider at the implicit-consent flow.
if [ "$APP_EXISTS" = "true" ]; then
  echo "App exists — updating provider authorization_flow to pk=$FLOW_PK..."
  PROVIDER_RAW=$(curl -s -H "$AUTH" "$BASE/providers/oauth2/?search=FuzeFront")
  PROVIDER_PK=$(echo "$PROVIDER_RAW" | jq -r '.results[]? | select(.name=="FuzeFront") | .pk' 2>/dev/null | head -1 || true)
  if [ -n "$PROVIDER_PK" ] && [ "$PROVIDER_PK" != "null" ]; then
    PATCH_HTTP=$(curl -s -o /dev/null -w "%{http_code}" \
      -X PATCH "$BASE/providers/oauth2/${PROVIDER_PK}/" \
      -H "$AUTH" -H "$CT" \
      -d "{\"authorization_flow\": \"$FLOW_PK\"}")
    echo "Provider PATCH HTTP $PATCH_HTTP (pk=$PROVIDER_PK → flow=$FLOW_PK)"
    wait_for_discovery
    exit 0
  fi
  echo "No existing FuzeFront provider found — falling through to full provisioning"
fi

# ── Scope mappings via the Django ORM ─────────────────────────────────────────
# /api/v3/propertymappings/scope/ returns 405 for POST and 404 for GET in this
# Authentik 2024.12.3 setup — the URL pattern is not registered at the Django
# routing layer. Bypass REST entirely and use the ORM.
echo "Getting scope mapping PKs via Python ORM..."
SCOPE_OUTPUT=$($COMPOSE exec -T authentik-worker python - <<'PYEOF'
import os
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "authentik.root.settings")
import django
django.setup()
from authentik.providers.oauth2.models import ScopeMapping

def ensure_scope(name, scope_name, expr):
    sm, _ = ScopeMapping.objects.get_or_create(
        name=name, defaults={"scope_name": scope_name, "expression": expr}
    )
    print("SCOPE_" + scope_name.upper() + "=" + str(sm.pk))

ensure_scope("FuzeFront OIDC scope - openid", "openid", "return {}")
ensure_scope("FuzeFront OIDC scope - email", "email",
             'return {"email": request.user.email, "email_verified": True}')
ensure_scope("FuzeFront OIDC scope - profile", "profile",
             'return {"name": request.user.name, "given_name": request.user.name, "preferred_username": request.user.username}')
PYEOF
)
echo "Scope output: $SCOPE_OUTPUT"
SCOPE_OPENID=$(echo "$SCOPE_OUTPUT" | grep "^SCOPE_OPENID=" | head -1 | cut -d= -f2 | tr -d '\r\n ')
SCOPE_EMAIL=$(echo "$SCOPE_OUTPUT" | grep "^SCOPE_EMAIL=" | head -1 | cut -d= -f2 | tr -d '\r\n ')
SCOPE_PROFILE=$(echo "$SCOPE_OUTPUT" | grep "^SCOPE_PROFILE=" | head -1 | cut -d= -f2 | tr -d '\r\n ')
if [ -z "$SCOPE_OPENID" ] || [ -z "$SCOPE_EMAIL" ] || [ -z "$SCOPE_PROFILE" ]; then
  echo "::error::Could not get scope mapping PKs (openid=${SCOPE_OPENID:-MISSING} email=${SCOPE_EMAIL:-MISSING} profile=${SCOPE_PROFILE:-MISSING})"
  exit 1
fi
echo "Scope mapping PKs: openid=$SCOPE_OPENID email=$SCOPE_EMAIL profile=$SCOPE_PROFILE"

# ── Invalidation flow (required on the OAuth2 provider in 2024.12.3) ──────────
INV_FLOW_RAW=$(curl -s -H "$AUTH" "$BASE/flows/instances/?designation=invalidation")
INV_FLOW_PK=$(echo "$INV_FLOW_RAW" | jq -r '.results[0].pk // empty' 2>/dev/null || true)
echo "Invalidation flow lookup: pk=${INV_FLOW_PK:-NOT_FOUND}"
if [ -z "$INV_FLOW_PK" ] || [ "$INV_FLOW_PK" = "null" ]; then
  echo "Creating invalidation flow..."
  INV_HTTP=$(curl -s -X POST "$BASE/flows/instances/" -H "$AUTH" -H "$CT" \
    -o /tmp/inv_flow_create.json -w "%{http_code}" \
    -d '{"name":"FuzeFront Invalidation Flow","slug":"fuzefront-invalidation-flow","designation":"invalidation","title":"Signed Out","authentication":"none","policy_engine_mode":"all"}')
  INV_RAW=$(cat /tmp/inv_flow_create.json)
  echo "Invalidation flow create HTTP $INV_HTTP: $INV_RAW"
  [ "$INV_HTTP" = "201" ] || { echo "::error::failed to create invalidation flow (HTTP $INV_HTTP)"; exit 1; }
  INV_FLOW_PK=$(echo "$INV_RAW" | jq -r '.pk // empty' 2>/dev/null || true)
  [ -n "$INV_FLOW_PK" ] && [ "$INV_FLOW_PK" != "null" ] || { echo "::error::no pk in invalidation flow response"; exit 1; }
  echo "Created invalidation flow pk=$INV_FLOW_PK"
fi

# ── OAuth2 provider ───────────────────────────────────────────────────────────
PROVIDER_RAW=$(curl -s -H "$AUTH" "$BASE/providers/oauth2/?search=FuzeFront")
PROVIDER_PK=$(echo "$PROVIDER_RAW" | jq -r '.results[]? | select(.name=="FuzeFront") | .pk' 2>/dev/null | head -1 || true)
if [ -z "$PROVIDER_PK" ] || [ "$PROVIDER_PK" = "null" ]; then
  echo "Creating FuzeFront OAuth2 provider..."
  # redirect_uris use matching_mode:strict — the security service reuses the
  # registered /api/auth/oidc/callback for server-side password sign-in, so that
  # entry MUST be present or Authentik rejects the authorize call.
  PROVIDER_BODY=$(jq -n \
    --arg secret "$AUTHENTIK_OIDC_CLIENT_SECRET" \
    --arg flow "$FLOW_PK" \
    --arg inv_flow "$INV_FLOW_PK" \
    --arg m1 "$SCOPE_OPENID" --arg m2 "$SCOPE_EMAIL" --arg m3 "$SCOPE_PROFILE" \
    '{name:"FuzeFront",client_type:"confidential",client_id:"fuzefront-oidc-client",client_secret:$secret,redirect_uris:[{matching_mode:"strict",url:"http://fuzefront.dev.local/api/auth/oidc/callback"},{matching_mode:"strict",url:"https://fuzefront.dev.local/api/auth/oidc/callback"},{matching_mode:"strict",url:"https://app.fuzefront.com/api/auth/oidc/callback"},{matching_mode:"strict",url:"http://localhost:3001/api/auth/oidc/callback"}],property_mappings:[$m1,$m2,$m3],sub_mode:"user_email",include_claims_in_id_token:true,authorization_flow:$flow,invalidation_flow:$inv_flow}')
  PROVIDER_HTTP=$(curl -s -X POST "$BASE/providers/oauth2/" -H "$AUTH" -H "$CT" \
    -o /tmp/provider_create.json -w "%{http_code}" -d "$PROVIDER_BODY")
  PROVIDER_RAW=$(cat /tmp/provider_create.json)
  echo "Provider create HTTP $PROVIDER_HTTP: $PROVIDER_RAW"
  [ "$PROVIDER_HTTP" = "201" ] || { echo "::error::failed to create OAuth2 provider (HTTP $PROVIDER_HTTP)"; exit 1; }
  PROVIDER_PK=$(echo "$PROVIDER_RAW" | jq -r '.pk // empty' 2>/dev/null || true)
  [ -n "$PROVIDER_PK" ] && [ "$PROVIDER_PK" != "null" ] || { echo "::error::no pk in provider create response"; exit 1; }
  echo "Created OAuth2 provider pk=$PROVIDER_PK"
else
  echo "OAuth2 provider already exists pk=$PROVIDER_PK"
fi

# ── Application ───────────────────────────────────────────────────────────────
echo "Creating FuzeFront application..."
APP_BODY=$(jq -n --argjson provider "$PROVIDER_PK" \
  '{name:"FuzeFront",slug:"fuzefront",provider:$provider,meta_launch_url:"https://fuzefront.dev.local/",meta_description:"FuzeFront runtime microfrontend platform",policy_engine_mode:"all",open_in_new_tab:false}')
APP_HTTP=$(curl -s -X POST "$BASE/core/applications/" -H "$AUTH" -H "$CT" \
  -o /tmp/app_create.json -w "%{http_code}" -d "$APP_BODY")
APP_RAW=$(cat /tmp/app_create.json)
echo "Application create HTTP $APP_HTTP: $APP_RAW"
[ "$APP_HTTP" = "201" ] || { echo "::error::failed to create application (HTTP $APP_HTTP)"; exit 1; }
APP_SLUG=$(echo "$APP_RAW" | jq -r '.slug // empty' 2>/dev/null || true)
[ -n "$APP_SLUG" ] && [ "$APP_SLUG" != "null" ] || { echo "::error::no slug in application create response"; exit 1; }
echo "Created application slug=$APP_SLUG"

wait_for_discovery
