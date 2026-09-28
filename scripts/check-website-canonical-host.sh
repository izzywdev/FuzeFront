#!/usr/bin/env bash
# =============================================================================
# gate-website-canonical-host — fuzefront.com presents ONE brand.
#
# WHAT WENT WRONG. The apex, fuzefront.com, served the FuzeOne family
# marketing site out of this repo's chart. `www.fuzefront.com` was an
# unproxied CNAME to an S3/CloudFront distribution serving a static FuzeHub
# landing page. One domain, two brands, no redirect between them — and
# completely invisible here, because `www` never reached the cluster: helm
# lint, kubeconform, and the website's whole Playwright suite (which targets
# the apex) all stayed green the entire time.
#
# WHAT THIS ASSERTS, and why it is BEHAVIOURAL rather than a grep. The fix is
# a redirect, and a redirect is only real if nginx actually emits it. So this
# boots the REAL fuzefront-website/frontend/nginx.conf and makes requests
# through it. Three invariants:
#
#   1. Every host the production Ingress claims as an alias
#      (`websiteFrontend.aliasHosts` in values-prod.yaml) 301s to the
#      canonical host (`websiteFrontend.host`). The alias list is READ FROM
#      THE VALUES FILE, not hardcoded here: claiming a new host in the
#      cluster without teaching the site to canonicalize it is exactly the
#      defect, so the two must be unable to drift apart.
#   2. The redirect preserves path and query. Otherwise every deep link into
#      www silently lands on the homepage.
#   3. /health still answers on the DEFAULT server. The redirect block must
#      never become nginx's default server, or the readiness/liveness probes
#      (which send `Host: <podIP>:3000`) would get a 301 and the pod would
#      never go ready.
#
# The config is copied with ONLY the listen port, document root and log/pid
# paths rewritten, so it can run unprivileged in a sandbox. `server_name`,
# `return` and the server-block ORDER — everything this gate is actually
# about — are byte-identical to what ships in the image.
#
# SELF-TEST FIRST. Before trusting a pass, this proves the probe still FAILS
# on the exact regression (the www server block deleted). A check only ever
# observed passing is not evidence of anything.
#
# Usage:  bash scripts/check-website-canonical-host.sh
# Needs:  nginx, curl, python3.
# =============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NGINX_CONF="$REPO_ROOT/fuzefront-website/frontend/nginx.conf"
VALUES_PROD="$REPO_ROOT/deploy/helm/fuzefront/values-prod.yaml"
PORT="${CANONICAL_HOST_TEST_PORT:-18080}"

command -v nginx  >/dev/null || { echo "::error::nginx is not installed — this gate cannot run."; exit 1; }
command -v curl   >/dev/null || { echo "::error::curl is not installed — this gate cannot run."; exit 1; }
command -v python3>/dev/null || { echo "::error::python3 is not installed — this gate cannot run."; exit 1; }

read_values() {
  python3 - "$VALUES_PROD" <<'PY'
import sys, yaml
v = yaml.safe_load(open(sys.argv[1], encoding='utf-8'))
wf = v.get('websiteFrontend') or {}
host = wf.get('host') or ''
if not host:
    sys.exit("websiteFrontend.host is empty in values-prod.yaml — there is no canonical host to redirect to.")
print(host)
for a in (wf.get('aliasHosts') or []):
    print(a)
PY
}

# Boot the given config on $PORT and leave it running. Echoes nothing.
start_nginx() {
  local conf="$1" workdir="$2"
  mkdir -p "$workdir/html" "$workdir/logs"
  echo '<!doctype html><title>canonical-host probe</title>' > "$workdir/html/index.html"
  chmod -R 0755 "$workdir"
  sed -e "s/listen 3000;/listen ${PORT};/" \
      -e '/listen \[::\]:3000;/d' \
      -e "s#root /usr/share/nginx/html;#root ${workdir}/html;#" \
      -e "s#error_log /tmp/nginx_error.log warn;#error_log ${workdir}/logs/error.log warn;#" \
      -e "s#pid /tmp/nginx.pid;#pid ${workdir}/nginx.pid;#" \
      -e "s#access_log /tmp/nginx_access.log main;#access_log ${workdir}/logs/access.log main;#" \
      "$conf" > "$workdir/nginx.conf"
  nginx -t -c "$workdir/nginx.conf" -p "$workdir" >/dev/null 2>&1 \
    || { echo "::error::nginx rejected $conf:"; nginx -t -c "$workdir/nginx.conf" -p "$workdir"; return 1; }
  nginx -c "$workdir/nginx.conf" -p "$workdir"
  for _ in $(seq 1 25); do
    curl -sS --noproxy '*' -o /dev/null "http://127.0.0.1:${PORT}/health" 2>/dev/null && return 0
    sleep 0.2
  done
  echo "::error::nginx did not come up on port ${PORT}."
  return 1
}

stop_nginx() {
  local workdir="$1"
  [ -f "$workdir/nginx.pid" ] && nginx -c "$workdir/nginx.conf" -p "$workdir" -s stop >/dev/null 2>&1 || true
}

# Returns 0 when the running nginx satisfies every invariant, 1 otherwise.
# Prints each check. `quiet` suppresses failure detail (used by the self-test,
# where failing is the expected outcome).
assert_canonical() {
  local canonical="$1"; shift
  local quiet="$1"; shift
  local aliases=("$@")
  local ok=0

  for alias in "${aliases[@]}"; do
    local code loc deep
    code=$(curl -sS --noproxy '*' -o /dev/null -w '%{http_code}' -H "Host: ${alias}" "http://127.0.0.1:${PORT}/")
    loc=$( curl -sS --noproxy '*' -o /dev/null -w '%{redirect_url}' -H "Host: ${alias}" "http://127.0.0.1:${PORT}/")
    if [ "$code" != "301" ] || [ "$loc" != "https://${canonical}/" ]; then
      [ "$quiet" = "quiet" ] || echo "::error::${alias} answered ${code} -> '${loc:-<none>}'; expected 301 -> https://${canonical}/ . An alias host the Ingress claims must redirect to the canonical host, never serve a page of its own."
      ok=1
      continue
    fi
    echo "  OK   ${alias}/ -> 301 ${loc}"

    deep=$(curl -sS --noproxy '*' -o /dev/null -w '%{redirect_url}' -H "Host: ${alias}" "http://127.0.0.1:${PORT}/pricing?plan=team")
    if [ "$deep" != "https://${canonical}/pricing?plan=team" ]; then
      [ "$quiet" = "quiet" ] || echo "::error::${alias} dropped the path or query: got '${deep}', expected 'https://${canonical}/pricing?plan=team'. Every deep link into the alias would land on the homepage."
      ok=1
      continue
    fi
    echo "  OK   ${alias}/pricing?plan=team -> ${deep} (path + query preserved)"
  done

  # Invariant 3: the probe path on the DEFAULT server must still be a 200.
  local health
  health=$(curl -sS --noproxy '*' -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/health")
  if [ "$health" != "200" ]; then
    [ "$quiet" = "quiet" ] || echo "::error::/health on the default server answered ${health}, expected 200. A redirect block has become nginx's default server — the readiness and liveness probes send Host: <podIP> and would now get a 301, so the pod would never go ready."
    ok=1
  else
    echo "  OK   /health on the default server -> 200"
  fi

  return $ok
}

TMP="$(mktemp -d)"
cleanup() { stop_nginx "$TMP/real" ; stop_nginx "$TMP/broken"; rm -rf "$TMP"; }
trap cleanup EXIT

mapfile -t HOSTS < <(read_values)
CANONICAL="${HOSTS[0]}"
ALIASES=("${HOSTS[@]:1}")

echo "canonical host: ${CANONICAL}"
if [ "${#ALIASES[@]}" -eq 0 ]; then
  echo "::error::websiteFrontend.aliasHosts is empty in values-prod.yaml. www.fuzefront.com must be claimed and canonicalized — leaving it unclaimed is how it ended up serving a different brand."
  exit 1
fi
echo "alias hosts:    ${ALIASES[*]}"

# --- Self-test: strip the redirect server block; the probe MUST go red. -----
echo
echo "[self-test] a config with the alias redirect removed must FAIL"
python3 - "$NGINX_CONF" "$TMP/broken-nginx.conf" <<'PY'
import re, sys
src = open(sys.argv[1], encoding='utf-8').read()
# Drop every server block that answers with a bare `return 301`.
out, removed = [], 0
depth = 0; buf = []
for line in src.splitlines(keepends=True):
    if depth == 0 and re.match(r'^\s*server\s*\{', line):
        depth = 1; buf = [line]; continue
    if depth:
        buf.append(line)
        depth += line.count('{') - line.count('}')
        if depth == 0:
            block = ''.join(buf)
            if re.search(r'^\s*return\s+301\s', block, re.M):
                removed += 1
            else:
                out.append(block)
            buf = []
        continue
    out.append(line)
if not removed:
    sys.exit("self-test could not find a `return 301` server block to remove — the probe would be vacuous.")
open(sys.argv[2], 'w', encoding='utf-8').write(''.join(out))
PY
start_nginx "$TMP/broken-nginx.conf" "$TMP/broken"
if assert_canonical "$CANONICAL" quiet "${ALIASES[@]}" >/dev/null 2>&1; then
  echo "::error::SELF-TEST FAILED — the probe passed against a config with no redirect at all. It proves nothing; fix the probe before trusting it."
  exit 1
fi
stop_nginx "$TMP/broken"
echo "[self-test] OK — the probe goes red when the redirect is missing"

# --- The real config -------------------------------------------------------
echo
echo "[real] fuzefront-website/frontend/nginx.conf"
start_nginx "$NGINX_CONF" "$TMP/real"
if ! assert_canonical "$CANONICAL" loud "${ALIASES[@]}"; then
  stop_nginx "$TMP/real"
  echo
  echo "gate-website-canonical-host: FAILED"
  exit 1
fi
stop_nginx "$TMP/real"

echo
echo "gate-website-canonical-host: OK — one domain, one brand."
