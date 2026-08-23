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
# Usage:
#   check-authentik-live-boundary.sh [app_origin] [auth_origin]
#   check-authentik-live-boundary.sh --self-test
set -euo pipefail

APP_ORIGIN_DEFAULT="https://app.fuzefront.com"
AUTH_ORIGIN_DEFAULT="https://auth.fuzefront.com"

# Every path that must respond IDENTICALLY (status + content-type) to a
# guaranteed-unmatched control path — i.e. must NOT be specially routed to
# authentik-server. Mirrors FORBIDDEN_PATHS in check-authentik-public-paths.sh;
# keep the two lists in sync.
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

# $1 = origin (e.g. https://app.fuzefront.com)
probe_origin() {
  local origin="$1"
  local fail=0
  local control_path
  control_path="/__fuzefront-boundary-control-$(date +%s)-$$__"
  local control_shape
  control_shape="$(fetch_shape "${origin}${control_path}")"
  echo "  control ${origin}${control_path} -> ${control_shape}"

  for p in "${FORBIDDEN_PATHS[@]}"; do
    local shape
    shape="$(fetch_shape "${origin}${p}")"
    if [ "$shape" != "$control_shape" ]; then
      echo "::error::${origin}${p} is specially routed — got '${shape}', but the control (guaranteed" \
           "unmatched) path got '${control_shape}'. This path is reachable through a route the" \
           "control path is not, exactly the shape of the app.fuzefront.com/applications incident." >&2
      fail=1
    else
      echo "  OK      ${origin}${p} -> ${shape} (matches control)"
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
import http.server, sys, threading

leaky = sys.argv[1] == "leaky"

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if leaky and self.path.startswith("/applications"):
            # Simulate the incident: this path is specially routed to
            # "authentik-server" and returns a distinct shape.
            self.send_response(403)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"detail":"leaked"}')
        else:
            # Everything else (including the control path) falls through to
            # the same catch-all, identical shape either way.
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
         "/applications. The comparator is not doing its job." >&2
    exit 1
  fi
  echo "Self-test OK: probe correctly failed against the leaky server."

  echo "-- against the SAFE server (must PASS) --"
  if ! probe_origin "http://127.0.0.1:${safe_port}"; then
    echo "::error::self-test FAILED — the probe rejected a server where every forbidden path" \
         "falls through to the same catch-all as the control path. It must pass on the safe shape." >&2
    exit 1
  fi
  echo "Self-test OK: probe correctly passed against the safe server."

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
