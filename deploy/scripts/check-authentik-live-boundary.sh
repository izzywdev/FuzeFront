#!/usr/bin/env bash
# check-authentik-live-boundary.sh — black-box, no-cluster-access probe that a
# known-forbidden Authentik path is NOT specially routed on the live public
# host.
#
# WHY THIS EXISTS, and why it's a SEPARATE layer from
# check-authentik-public-paths.sh (the static, rendered-manifest guard). The
# static guard models Traefik's PathPrefix semantics against the RENDERED
# chart — it catches a manifest regression before it ships. It cannot catch a
# CONTROLLER BEHAVIOUR change (a Traefik upgrade that alters matcher
# semantics, a manually-applied IngressRoute/Middleware bypassing the chart, a
# second Ingress object added outside this chart that also targets
# authentik-server). Only a live probe against the actual public edge proves
# the boundary holds in production, which is exactly the FuzeFront live
# incident this exists to catch a recurrence of: `/applications` was reachable
# on the real edge for an unknown period while both `helm lint` and
# `kubeconform` stayed green.
#
# THE TECHNIQUE — a control-diff, not a signature match. Rather than hard-code
# what an "Authentik response" looks like (fragile — depends on Authentik
# internals we don't want to encode here and that can change upstream), this
# compares each forbidden path's live response (status code + content-type)
# against a CONTROL path on the SAME host: a random, guaranteed-unmatched path
# that cannot be claimed by any real Ingress rule. If the origin has a
# catch-all (`path: /`, e.g. app.fuzefront.com's frontend SPA), both the
# control path and a correctly-narrowed forbidden path fall through to that
# SAME catch-all and get an IDENTICAL response shape. If the origin has no
# catch-all (auth.fuzefront.com), both get Traefik's identical unmatched-host
# 404. Either way, a forbidden path that is specially routed (i.e. leaking to
# authentik-server, exactly the incident) diverges from the control response —
# different status code and/or content-type — and that divergence is the
# signal, with no assumption about what Authentik itself returns.
#
# TIER-AWARE CONTROL — a single control path is only valid when every
# candidate path shares the SAME fallback tier as the control. app.fuzefront.com
# has TWO nested catch-alls, not one: the chart's Ingress (ingress.yaml) puts a
# `path: /api`, `pathType: Prefix` rule (-> fuzefront-backend) *below* several
# specific `/api/...` service routes and *above* the outer `path: /` catch-all
# (-> fuzefront-frontend). A forbidden path under `/api/` (e.g. /api/v3/core/)
# that is correctly NOT routed to Authentik still doesn't fall all the way to
# the SPA — it falls to the /api catch-all and gets the backend's own JSON 404,
# which legitimately differs in both status and content-type from the SPA's
# 200 text/html. Comparing such a path against a bare top-level control (which
# only ever reaches the OUTER `/` catch-all) is comparing across tiers, not
# checking whether the path reaches Authentik — it produced a false positive
# on /api/v3/core|providers|policies (all correctly backend-routed, none
# Authentik-routed) once FuzeFront's own `/api` prefix legitimately started
# 404-ing those paths as JSON. So every forbidden path is compared against a
# control that shares its own routing tier: paths under `/api/` get a
# guaranteed-unmatched control ALSO under `/api/` (so both fall through to the
# `/api` catch-all if neither is specially routed); every other path gets the
# original bare top-level control (both fall through to `/`, or to Traefik's
# unmatched-host 404 on a host with no catch-all at all, e.g. auth.fuzefront.com).
# A path that reaches Authentik still diverges from ITS tier's control, exactly
# as before — this only fixes which control it's compared against.
#
# Usage:
#   check-authentik-live-boundary.sh [app_origin] [auth_origin]
#   check-authentik-live-boundary.sh --self-test
set -euo pipefail

APP_ORIGIN_DEFAULT="https://app.fuzefront.com"
AUTH_ORIGIN_DEFAULT="https://auth.fuzefront.com"

# Every path that must respond IDENTICALLY (status + content-type) to a
# guaranteed-unmatched, SAME-TIER control path — i.e. must NOT be specially
# routed to authentik-server. Mirrors FORBIDDEN_PATHS in
# check-authentik-public-paths.sh; keep the two lists in sync.
FORBIDDEN_PATHS=(
  "/applications"
  "/if/admin/"
  "/if/user/"
  "/api/v3/core/"
  "/api/v3/providers/"
  "/api/v3/policies/"
  "/sources"
)

# fetch STATUS and CONTENT-TYPE for a URL. Loud on network failure (curl exit
# != 0) rather than treating it as a silent pass — a probe that can't reach
# the origin has proven nothing about the boundary.
fetch_shape() {
  local url="$1"
  local out
  if ! out=$(curl -sS -o /dev/null --max-time 15 -w '%{http_code} %{content_type}' "$url"); then
    echo "::error::could not reach $url — the live boundary probe requires network access to the" \
         "public origin; a failed fetch is NOT evidence the boundary holds." >&2
    return 2
  fi
  echo "$out"
}

# The routing tier a path would fall through to if it is NOT specially routed
# to authentik-server: "api" for anything under /api/, "bare" for everything
# else. Keep this in sync with the /api catch-all in ingress.yaml — it is the
# only extra fallback tier the chart currently defines between a specific
# service route and the outer `/` catch-all.
tier_for() {
  case "$1" in
    /api/*) echo "api" ;;
    *)      echo "bare" ;;
  esac
}

# $1 = origin (e.g. https://app.fuzefront.com)
probe_origin() {
  local origin="$1"
  local fail=0
  local nonce
  nonce="$(date +%s)-$$"

  # One guaranteed-unmatched control per tier. Both are random suffixes that
  # cannot collide with any real Ingress rule; the "api" one is additionally
  # scoped under /api/ so it lands on the SAME /api catch-all a correctly
  # narrowed /api/v3/* forbidden path would, instead of falling all the way to
  # the outer `/` catch-all.
  local bare_control_path="/__fuzefront-boundary-control-${nonce}__"
  local api_control_path="/api/__fuzefront-boundary-control-${nonce}__"
  local bare_control_shape api_control_shape
  bare_control_shape="$(fetch_shape "${origin}${bare_control_path}")"
  api_control_shape="$(fetch_shape "${origin}${api_control_path}")"
  echo "  control [bare] ${origin}${bare_control_path} -> ${bare_control_shape}"
  echo "  control [api]  ${origin}${api_control_path} -> ${api_control_shape}"

  for p in "${FORBIDDEN_PATHS[@]}"; do
    local tier control_shape
    tier="$(tier_for "$p")"
    if [ "$tier" = "api" ]; then
      control_shape="$api_control_shape"
    else
      control_shape="$bare_control_shape"
    fi

    local shape
    shape="$(fetch_shape "${origin}${p}")"
    if [ "$shape" != "$control_shape" ]; then
      echo "::error::${origin}${p} is specially routed — got '${shape}', but its [$tier]-tier control" \
           "(guaranteed unmatched, same fallback tier) got '${control_shape}'. This path is reachable" \
           "through a route its own tier's control is not, exactly the shape of the" \
           "app.fuzefront.com/applications incident." >&2
      fail=1
    else
      echo "  OK      ${origin}${p} -> ${shape} (matches [$tier] control)"
    fi
  done
  return $fail
}

self_test() {
  echo "Self-test: proving the comparator FAILS when a forbidden path is specially routed," \
       "and PASSES when it isn't — a check only ever observed passing is not evidence of anything."

  command -v python3 >/dev/null 2>&1 || { echo "::error::python3 required for self-test" >&2; exit 1; }

  local server_py
  server_py="$(mktemp)"
  cat > "$server_py" <<'PYEOF'
import http.server, sys

leaky = sys.argv[1] == "leaky"

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        # Two tiers, mirroring app.fuzefront.com's real Ingress fallback
        # chain: an `/api` catch-all (-> fuzefront-backend, JSON 404 for an
        # unmatched route) nested inside the outer `/` catch-all (-> the SPA,
        # 200 html for anything, including an unmatched route). Neither tier
        # is itself a leak — a forbidden /api/v3/* path legitimately lands on
        # the JSON tier, not the html one, exactly like FuzeFront's own
        # backend.
        if leaky and self.path.startswith("/application"):
            # Reproduce the ORIGINAL incident exactly: fuzefront.authentikPublicPaths
            # once listed `- /application` with NO trailing slash, and
            # Traefik's PathPrefix does a plain string-prefix match, so it
            # also matched "/applications". Model that same shape here: any
            # path starting with "/application" (not just an exact match) is
            # specially routed to "authentik-server".
            self.send_response(403)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"detail":"leaked"}')
        elif leaky and self.path.startswith("/api/v3/core"):
            # A DIFFERENT leak shape: an /api/-tier forbidden path specially
            # routed to something that is not the /api catch-all either (here,
            # an Authentik-like 401 + WWW-Authenticate). Proves the tier-aware
            # rewrite still catches a leak inside the /api tier, not just the
            # bare tier the original incident happened to be in.
            self.send_response(401)
            self.send_header("Content-Type", "application/json")
            self.send_header("WWW-Authenticate", 'Bearer realm="authentik"')
            self.end_headers()
            self.wfile.write(b'{"detail":"leaked-api-tier"}')
        elif self.path.startswith("/api/"):
            # The /api catch-all: every other /api/* path (including the
            # api-tier control and the still-forbidden-but-correctly-routed
            # /api/v3/providers//policies) falls through to this, identical to
            # fuzefront-backend's own JSON 404 handler.
            self.send_response(404)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"error":"not found"}')
        else:
            # The outer `/` catch-all: everything else, including the bare
            # control path, falls through to the SPA shell.
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(b"<html>spa shell</html>")

    def log_message(self, *args):
        pass

port = int(sys.argv[2])
httpd = http.server.HTTPServer(("127.0.0.1", port), Handler)
httpd.serve_forever()
PYEOF

  local leaky_port=18471
  local safe_port=18472

  python3 "$server_py" leaky "$leaky_port" &
  local leaky_pid=$!
  python3 "$server_py" safe "$safe_port" &
  local safe_pid=$!
  trap 'kill "$leaky_pid" "$safe_pid" 2>/dev/null; rm -f "$server_py"' EXIT

  sleep 1

  echo "-- against the LEAKY server (must FAIL) --"
  if probe_origin "http://127.0.0.1:${leaky_port}"; then
    echo "::error::self-test FAILED — the probe passed against a server that specially routes" \
         "/application* and /api/v3/core*. The comparator is not doing its job." >&2
    exit 1
  fi
  echo "Self-test OK: probe correctly failed against the leaky server (both the bare-tier" \
       "/application prefix-match and the api-tier /api/v3/core leak)."

  echo "-- against the SAFE server (must PASS) --"
  if ! probe_origin "http://127.0.0.1:${safe_port}"; then
    echo "::error::self-test FAILED — the probe rejected a server where every forbidden path" \
         "falls through to its own tier's catch-all, same as that tier's control. It must pass on" \
         "the safe shape — including the /api/v3/* paths, which legitimately differ from the bare" \
         "control (JSON 404 vs SPA 200 html) without being routed to Authentik." >&2
    exit 1
  fi
  echo "Self-test OK: probe correctly passed against the safe server, including the /api/v3/*" \
       "paths that only differ from the BARE control by tier, not by being specially routed."

  kill "$leaky_pid" "$safe_pid" 2>/dev/null || true
  rm -f "$server_py"
  trap - EXIT
}

case "${1:-}" in
  --self-test)
    self_test
    ;;
  *)
    app_origin="${1:-$APP_ORIGIN_DEFAULT}"
    auth_origin="${2:-$AUTH_ORIGIN_DEFAULT}"
    fail=0
    echo "=== $app_origin ==="
    probe_origin "$app_origin" || fail=1
    echo "=== $auth_origin ==="
    probe_origin "$auth_origin" || fail=1
    exit $fail
    ;;
esac
