#!/usr/bin/env sh
# Behavioural tests for bin/register.sh against a fake registry (fake-registry.mjs).
#
# These cover the properties the init container depends on and that a schema check
# cannot prove:
#   1. cold start  -> registers AND activates
#   2. re-run      -> idempotent (no duplicate register, no re-activate)
#   3. policy + billing are submitted when the files exist
#   4. bad token   -> EXITS NON-ZERO (so the pod CrashLoopBackOffs, not serves)
#   5. transient 5xx -> retried, not fatal
#
# Requires: node, curl, jq. Run: sh tests/register.test.sh

set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
KIT="$(dirname "$HERE")"
SCRIPT="${KIT}/bin/register.sh"

PASS=0
FAIL=0
SERVER_PID=""

cleanup() { [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null || true; }
trap cleanup EXIT

ok()   { PASS=$((PASS + 1)); echo "  ok   - $1"; }
notok(){ FAIL=$((FAIL + 1)); echo "  NOT OK - $1"; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else notok "$1 (expected '$3', got '$2')"; fi }

WORK="$(mktemp -d)"
REG="${WORK}/registration"
mkdir -p "$REG"

cat > "${REG}/manifest.json" <<'JSON'
{
  "manifestVersion": "1",
  "slug": "testapp",
  "name": "TestApp",
  "menuLabel": "Test",
  "mode": "portal",
  "integration": { "type": "iframe", "url": "https://testapp.example.com" },
  "nav": { "section": "build", "order": 5 },
  "visibility": "organization"
}
JSON

cat > "${REG}/policy.json" <<'JSON'
{
  "name": "TestApp",
  "resources": [{ "key": "Widget", "name": "Widget", "actions": { "read": { "name": "Read" } } }],
  "roles": [{ "key": "viewer", "name": "Viewer", "permissions": ["Widget:read"] }]
}
JSON

cat > "${REG}/billing-profile.json" <<'JSON'
{ "productKey": "testapp", "currencies": ["usd"] }
JSON

start_server() {
  CALL_LOG="${WORK}/calls.txt" FAIL_FIRST_N="${1:-0}" \
    node "${HERE}/fake-registry.mjs" > "${WORK}/server.out" 2>&1 &
  SERVER_PID=$!
  # Wait for the announced port rather than sleeping a guessed interval.
  _i=0
  while [ "$_i" -lt 50 ]; do
    PORT="$(sed -n 's/^LISTENING \([0-9]*\)$/\1/p' "${WORK}/server.out" 2>/dev/null || true)"
    [ -n "${PORT:-}" ] && break
    _i=$((_i + 1)); sleep 0.1
  done
  [ -n "${PORT:-}" ] || { echo "fake registry failed to start:"; cat "${WORK}/server.out"; exit 1; }
  export FUZEFRONT_API_URL="http://127.0.0.1:${PORT}"
}

run_register() {
  REGISTRATION_DIR="$REG" \
  FUZEFRONT_API_URL="$FUZEFRONT_API_URL" \
  FUZEFRONT_REGISTRATION_TOKEN="${1:-test-token}" \
    sh "$SCRIPT" > "${WORK}/run.out" 2>&1
}

echo "register.sh"

# ---- 1 + 3. cold start registers, activates, submits policy + billing ---------
start_server
set +e; run_register; RC=$?; set -e
check "cold start exits 0" "$RC" "0"
CALLS="$(cat "${WORK}/calls.txt")"
echo "$CALLS" | grep -q '^POST /api/v1/app-registry/apps$'            && ok "registers the app"            || notok "registers the app"
echo "$CALLS" | grep -q '^POST /api/v1/app-registry/apps/testapp/activate$' && ok "activates the app"      || notok "activates the app"
echo "$CALLS" | grep -q '^PUT /api/v1/app-registry/apps/testapp/policy$'    && ok "submits authz policy"   || notok "submits authz policy"
echo "$CALLS" | grep -q '^PUT /api/v1/app-registry/apps/testapp/billing-profile$' && ok "registers billing" || notok "registers billing"

# ---- 2. idempotence ----------------------------------------------------------
: > "${WORK}/calls.txt"
set +e; run_register; RC=$?; set -e
check "re-run exits 0" "$RC" "0"
CALLS2="$(cat "${WORK}/calls.txt")"
REREG="$(echo "$CALLS2" | grep -c '^POST /api/v1/app-registry/apps$' || true)"
check "does NOT re-register an existing app" "$REREG" "0"
REACT="$(echo "$CALLS2" | grep -c '/activate$' || true)"
check "does NOT re-activate an already-activated app" "$REACT" "0"
echo "$CALLS2" | grep -q '^PUT /api/v1/app-registry/apps/testapp$' && ok "refreshes the manifest on re-run" || notok "refreshes the manifest on re-run"
cleanup; SERVER_PID=""

# ---- 4. auth failure is FATAL ------------------------------------------------
start_server
set +e; run_register "wrong-token"; RC=$?; set -e
if [ "$RC" -ne 0 ]; then ok "bad token exits NON-ZERO (pod must not start)"; else notok "bad token exits non-zero (got 0)"; fi
grep -q 'auth rejected' "${WORK}/run.out" && ok "reports the auth failure clearly" || notok "reports the auth failure clearly"
cleanup; SERVER_PID=""

# ---- 5. transient 5xx is retried, not fatal ----------------------------------
start_server 2
set +e; run_register; RC=$?; set -e
check "survives 2 transient 500s" "$RC" "0"
cleanup; SERVER_PID=""

# ---- 7. suite: apps/*.json siblings each register and activate ----------------
# The failure this guards against is silent: before apps/ support, a repo shipping
# several surfaces registered only the primary and the rest simply never appeared in
# the portal — no error, no log line, just a product missing four of its five entries.
mkdir -p "${REG}/apps"
cat > "${REG}/apps/talent.json" <<'JSON'
{
  "manifestVersion": "1",
  "slug": "testapp-talent",
  "name": "TestApp Talent",
  "menuLabel": "Talent",
  "mode": "portal",
  "modes": ["portal", "standalone"],
  "integration": { "type": "module-federation", "remoteEntry": "https://testapp.example.com/talent/remoteEntry.js", "scope": "testappTalent", "module": "./App" },
  "nav": { "section": "build", "order": 10, "suite": { "id": "testapp", "label": "TestApp", "order": 5 } },
  "visibility": "organization"
}
JSON
cat > "${REG}/apps/recruiter.json" <<'JSON'
{
  "manifestVersion": "1",
  "slug": "testapp-recruiter",
  "name": "TestApp Recruiter",
  "menuLabel": "Recruiter",
  "mode": "portal",
  "integration": { "type": "module-federation", "remoteEntry": "https://testapp.example.com/recruiter/remoteEntry.js", "scope": "testappRecruiter", "module": "./App" },
  "nav": { "section": "build", "order": 20, "suite": { "id": "testapp", "label": "TestApp", "order": 5 } },
  "visibility": "organization"
}
JSON

start_server
: > "${WORK}/calls.txt"
set +e; run_register; RC=$?; set -e
check "suite run exits 0" "$RC" "0"
SCALLS="$(cat "${WORK}/calls.txt")"
echo "$SCALLS" | grep -q '^POST /api/v1/app-registry/apps/testapp-talent/activate$' \
  && ok "registers+activates sibling 1" || notok "registers+activates sibling 1"
echo "$SCALLS" | grep -q '^POST /api/v1/app-registry/apps/testapp-recruiter/activate$' \
  && ok "registers+activates sibling 2" || notok "registers+activates sibling 2"
# Product-level attachments must stay on the PRIMARY slug, not drift onto whichever
# sibling happened to be registered last.
echo "$SCALLS" | grep -q '^PUT /api/v1/app-registry/apps/testapp/policy$' \
  && ok "policy still binds to the primary slug" || notok "policy still binds to the primary slug"
SIBPOL="$(echo "$SCALLS" | grep -c '/apps/testapp-recruiter/policy' || true)"
check "does NOT submit policy per sibling" "$SIBPOL" "0"
cleanup; SERVER_PID=""

# ---- 8. a broken sibling is FATAL (no half-registered suite) ------------------
echo 'not json' > "${REG}/apps/broken.json"
start_server
set +e; run_register; RC=$?; set -e
if [ "$RC" -ne 0 ]; then ok "invalid sibling manifest exits NON-ZERO"; else notok "invalid sibling manifest exits NON-ZERO (got 0)"; fi
rm -f "${REG}/apps/broken.json"
cleanup; SERVER_PID=""
rm -rf "${REG}/apps"

# ---- 6. missing required env is fatal ----------------------------------------
set +e
REGISTRATION_DIR="$REG" FUZEFRONT_API_URL="" FUZEFRONT_REGISTRATION_TOKEN="x" sh "$SCRIPT" >/dev/null 2>&1
RC=$?
set -e
if [ "$RC" -ne 0 ]; then ok "missing FUZEFRONT_API_URL is fatal"; else notok "missing FUZEFRONT_API_URL is fatal"; fi

rm -rf "$WORK"
echo ""
echo "passed: ${PASS}  failed: ${FAIL}"
[ "$FAIL" -eq 0 ] || exit 1
