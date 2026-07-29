#!/usr/bin/env sh
# FuzeFront app self-registration — run as a Kubernetes INIT CONTAINER.
#
# Registers the app with the FuzeFront platform at pod startup: app registry entry,
# AuthZ (Permit) policy, and billing profile. Idempotent — safe to run on every pod
# start, every restart, and concurrently across replicas.
#
# WHY THIS IS AN INIT CONTAINER AND NOT A BEST-EFFORT SIDECAR:
# the app depends on FuzeFront for AuthN, AuthZ, org/user context, and billing. An
# unregistered app cannot function correctly, so a registration failure MUST stop the
# pod — it exits non-zero and the pod CrashLoopBackOffs until the problem is fixed.
# Failing loudly at deploy beats a half-registered app serving traffic.
#
# Required env:
#   FUZEFRONT_API_URL             base URL, e.g. http://fuzefront-applications:3003
#   FUZEFRONT_REGISTRATION_TOKEN  bearer token for a service account with apps:register
# Optional env:
#   REGISTRATION_DIR   directory holding manifest.json (default: /registration)
#   SKIP_ACTIVATE      "true" to register but not activate (staged rollout)
#
# Exit codes: 0 = registered/activated (or already was). 1 = anything else.

set -eu

REGISTRATION_DIR="${REGISTRATION_DIR:-/registration}"
MANIFEST="${REGISTRATION_DIR}/manifest.json"
POLICY="${REGISTRATION_DIR}/policy.json"
BILLING="${REGISTRATION_DIR}/billing-profile.json"

# BOTH go to stderr, on purpose. http() returns the HTTP status code on STDOUT and
# is read via command substitution, so anything else written to stdout would be
# captured into the status code and corrupt every comparison against it. Init
# containers send both streams to the pod log, so nothing is lost by this.
log()  { echo "[fuzefront-register] $*" >&2; }
die()  { echo "[fuzefront-register] FATAL: $*" >&2; exit 1; }

# ---- preflight ---------------------------------------------------------------
[ -n "${FUZEFRONT_API_URL:-}" ] || die "FUZEFRONT_API_URL is not set"
[ -n "${FUZEFRONT_REGISTRATION_TOKEN:-}" ] || die "FUZEFRONT_REGISTRATION_TOKEN is not set"
[ -f "$MANIFEST" ] || die "no manifest at $MANIFEST"

command -v curl >/dev/null 2>&1 || die "curl is required but not installed"
command -v jq   >/dev/null 2>&1 || die "jq is required but not installed"

jq empty "$MANIFEST" 2>/dev/null || die "$MANIFEST is not valid JSON"

SLUG="$(jq -r '.slug // empty' "$MANIFEST")"
[ -n "$SLUG" ] || die "manifest has no .slug"

# nav placement is what orders the app in the portal's side menu. Not fatal if
# absent (the platform defaults it to the 'platform' section, last) but it almost
# always means someone forgot, so say so loudly rather than silently sorting last.
NAV_SECTION="$(jq -r '.nav.section // empty' "$MANIFEST")"
if [ -z "$NAV_SECTION" ]; then
  log "WARNING: manifest declares no .nav.section — this app will sort LAST in the side menu."
fi

API="${FUZEFRONT_API_URL%/}/api/v1/app-registry"
AUTH="Authorization: Bearer ${FUZEFRONT_REGISTRATION_TOKEN}"

log "slug=${SLUG} section=${NAV_SECTION:-<unset>} api=${API}"

# ---- helpers -----------------------------------------------------------------
# Emits the HTTP status on stdout and writes the body to $2. Retries transient
# failures (connection refused / 5xx) — the platform may still be starting up.
http() {
  _method="$1"; _url="$2"; _body_file="$3"; _payload="${4:-}"
  _attempt=1
  while [ "$_attempt" -le 5 ]; do
    if [ -n "$_payload" ]; then
      _code="$(curl -sS -o "$_body_file" -w '%{http_code}' \
        -X "$_method" "$_url" \
        -H "$AUTH" -H 'Content-Type: application/json' \
        --data-binary "@$_payload" 2>/dev/null || echo 000)"
    else
      _code="$(curl -sS -o "$_body_file" -w '%{http_code}' \
        -X "$_method" "$_url" -H "$AUTH" 2>/dev/null || echo 000)"
    fi
    # 000 = could not connect; 5xx = server-side transient. Both worth retrying.
    case "$_code" in
      000|5??)
        log "  ${_method} ${_url} -> ${_code} (attempt ${_attempt}/5), retrying in $((_attempt * 2))s"
        sleep "$((_attempt * 2))"
        _attempt=$((_attempt + 1))
        ;;
      *) echo "$_code"; return 0 ;;
    esac
  done
  echo "$_code"
  return 0
}

BODY="$(mktemp)"
# shellcheck disable=SC2064  # expand BODY now, on purpose
trap "rm -f '$BODY'" EXIT

# ---- 1. register (idempotent) ------------------------------------------------
CODE="$(http GET "${API}/apps/${SLUG}" "$BODY")"

case "$CODE" in
  200)
    STATUS="$(jq -r '.status // empty' "$BODY")"
    log "already registered (status=${STATUS})"
    # Re-PUT the manifest so a redeploy picks up manifest changes (new remoteEntry
    # after a version bump, changed nav placement, …). Without this, the very first
    # registration would be frozen forever and every later manifest edit a no-op.
    PUT_CODE="$(http PUT "${API}/apps/${SLUG}" "$BODY" "$MANIFEST")"
    case "$PUT_CODE" in
      200|204) log "manifest refreshed" ;;
      # A manifest update is not worth failing the pod over — the app IS registered
      # and can serve. Report it; the drift shows up in the registry.
      *) log "WARNING: manifest refresh returned ${PUT_CODE} — continuing with the existing registration" ;;
    esac
    ;;
  404)
    log "not registered — registering"
    REQ="$(mktemp)"
    jq '{manifest: .}' "$MANIFEST" > "$REQ"
    CODE="$(http POST "${API}/apps" "$BODY" "$REQ")"
    rm -f "$REQ"
    case "$CODE" in
      201) log "registered" ;;
      # Another replica won the race — that is success, not failure.
      409) log "already registered (409 — concurrent replica won the race)" ;;
      *) die "register failed: HTTP ${CODE} $(cat "$BODY")" ;;
    esac
    STATUS="registered"
    ;;
  401|403)
    die "auth rejected (HTTP ${CODE}) — check FUZEFRONT_REGISTRATION_TOKEN has the apps:register scope"
    ;;
  *)
    die "unexpected response looking up ${SLUG}: HTTP ${CODE} $(cat "$BODY")"
    ;;
esac

# ---- 2. activate -------------------------------------------------------------
if [ "${SKIP_ACTIVATE:-false}" = "true" ]; then
  log "SKIP_ACTIVATE=true — leaving app in '${STATUS}' (it will NOT appear in the menu)"
elif [ "${STATUS:-}" = "activated" ]; then
  log "already activated"
else
  CODE="$(http POST "${API}/apps/${SLUG}/activate" "$BODY")"
  case "$CODE" in
    200|204) log "activated" ;;
    *) die "activate failed: HTTP ${CODE} $(cat "$BODY")" ;;
  esac
fi

# ---- 3. AuthZ policy (optional file) -----------------------------------------
# The product declares its OWN Permit resources/roles with BARE keys; the platform
# namespaces them (<product>_Listing, …) and merges into the base schema. This is
# what replaces hand-editing backend/src/permit/products/*.policy.ts in FuzeFront.
if [ -f "$POLICY" ]; then
  jq empty "$POLICY" 2>/dev/null || die "$POLICY is not valid JSON"
  CODE="$(http PUT "${API}/apps/${SLUG}/policy" "$BODY" "$POLICY")"
  case "$CODE" in
    200|201|204) log "authz policy submitted" ;;
    *) die "policy submission failed: HTTP ${CODE} $(cat "$BODY")" ;;
  esac
else
  log "no policy.json — skipping authz policy (app will have no product-specific roles)"
fi

# ---- 4. billing profile (optional file) --------------------------------------
# Registers the product key so billing accepts checkout for it. Replaces editing the
# BILLING_PRODUCT_KEYS env allowlist in the platform's Helm values by hand.
if [ -f "$BILLING" ]; then
  jq empty "$BILLING" 2>/dev/null || die "$BILLING is not valid JSON"
  CODE="$(http PUT "${API}/apps/${SLUG}/billing-profile" "$BODY" "$BILLING")"
  case "$CODE" in
    200|201|204) log "billing profile registered" ;;
    *) die "billing profile registration failed: HTTP ${CODE} $(cat "$BODY")" ;;
  esac
else
  log "no billing-profile.json — skipping billing (app cannot take payments)"
fi

log "OK — ${SLUG} is registered and ready"
exit 0
