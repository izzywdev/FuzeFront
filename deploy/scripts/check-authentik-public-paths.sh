#!/usr/bin/env bash
# check-authentik-public-paths.sh — assert that none of the Authentik-backed
# Ingress paths rendered by the FuzeFront chart is a STRING PREFIX of a
# known-forbidden Authentik path.
#
# WHY THIS EXISTS (FuzeFront live incident, 2026-08-23). The Kubernetes
# Ingress spec defines `pathType: Prefix` as an ELEMENT-WISE segment match:
# `/application` matching `/applications` would be a bug under the spec.
# Traefik's Kubernetes Ingress provider does NOT implement it that way — its
# `PathPrefix` matcher is a plain STRING prefix. So `- /application` (no
# trailing slash) in fuzefront.authentikPublicPaths string-prefix-matched
# `/applications`, and Authentik's application-list endpoint was reachable at
# https://app.fuzefront.com/applications with no network boundary in front of
# it — live, unnoticed, until reported. `helm lint` and `kubeconform` both
# stayed green throughout: they validate manifest SHAPE against the
# Kubernetes API schema, not CONTROLLER semantics, so neither could ever have
# caught this. This script models Traefik's actual matcher instead.
#
# This is the same class of gap `check-networkpolicy-ports` (helm-validate.yml)
# exists for: a schema check confirmed the rendered value had the right
# SHAPE while its live-cluster SEMANTICS were wrong (FuzeInfra#501).
#
# Usage:
#   check-authentik-public-paths.sh <rendered-templates-dir>
#   check-authentik-public-paths.sh --self-test
set -euo pipefail

# Ingress resources deliberately EXCLUDED from this check. The admin Ingress
# (fuzefront-authentik-admin, ingress.yaml) intentionally serves `path: /` —
# the WHOLE Authentik UI, including /if/admin/ — to authentik-server, because
# it is a separate host (authentik.<prod domain>) gated by Cloudflare Access,
# not by fuzefront.authentikPublicPaths. That is its documented design (see
# the "Authentik ADMIN Ingress" comment block in ingress.yaml), not a gap this
# check should flag.
EXCLUDED_INGRESS_NAMES=(
  "fuzefront-authentik-admin"
)

# Every path that must NEVER be reachable through an Authentik-backed Ingress
# path in this chart. Extend this list if a new sensitive Authentik surface
# is identified — see the comment above fuzefront.authentikPublicPaths for
# the full rationale (admin UI, admin REST API, application-list API).
FORBIDDEN_PATHS=(
  "/applications"
  "/if/admin"
  "/if/user"
  "/api/v3/core"
  "/api/v3/providers"
  "/api/v3/policies"
  "/sources"
)

# --- core check: does any allowed path string-prefix-match a forbidden one? ---
# $1 = directory of rendered YAML templates to scan
check_dir() {
  local dir="$1"
  local fail=0
  local allowed_paths
  # Pull every `path: <value>` that immediately follows a
  # `- path:` line whose sibling backend targets authentik-server, across all
  # rendered Ingress manifests. We don't have a YAML parser dependency here
  # (mirrors check-job-interpreters.sh / the networkpolicy-ports guard, both
  # of which use plain grep on rendered YAML), so pull every Ingress `path:`
  # value that is followed within a few lines by `name: authentik-server`.
  local excluded_pattern
  excluded_pattern=$(IFS='|'; echo "${EXCLUDED_INGRESS_NAMES[*]}")

  allowed_paths=$(
    for f in "$dir"/*.yaml; do
      [ -f "$f" ] || continue
      grep -q '^kind: Ingress$' "$f" || continue
      awk -v excluded="$excluded_pattern" '
        BEGIN { in_ingress = 0; skip = 0; pending = "" }
        /^---[ \t]*$/ { pending = ""; next }
        /^kind:[ \t]*Ingress[ \t]*$/ { in_ingress = 1; skip = 0; pending = ""; next }
        /^kind:[ \t]*/ && !/Ingress/ { in_ingress = 0; skip = 0; pending = ""; next }
        in_ingress && /^  name:[ \t]*/ {
          name = $0
          sub(/^  name:[ \t]*/, "", name)
          skip = (excluded != "" && name ~ ("^(" excluded ")$")) ? 1 : 0
          next
        }
        skip { next }
        /^[ \t]*-[ \t]*path:[ \t]*/ {
          split($0, a, "path:")
          gsub(/^[ \t]+|[ \t]+$/, "", a[2])
          pending = a[2]
          next
        }
        /name: authentik-server/ && pending != "" {
          print pending
          pending = ""
        }
      ' "$f"
    done | sort -u
  )

  if [ -z "$allowed_paths" ]; then
    echo "::error::no Authentik-backed Ingress paths found in $dir — the extraction regex" \
         "itself may be broken (this check must never silently pass on nothing to check)." >&2
    return 1
  fi

  echo "Authentik-backed Ingress paths found:"
  while IFS= read -r p; do
    printf '  %s\n' "$p"
  done <<< "$allowed_paths"

  for forbidden in "${FORBIDDEN_PATHS[@]}"; do
    for allowed in $allowed_paths; do
      # Traefik's PathPrefix: does $forbidden start with the literal string
      # $allowed? (bash prefix match, exactly what PathPrefix does — no
      # segment-boundary awareness.)
      case "$forbidden" in
        "$allowed"*)
          echo "::error::Authentik Ingress path '$allowed' string-prefix-matches forbidden path" \
               "'$forbidden' under Traefik's PathPrefix semantics — this would route" \
               "'$forbidden' to authentik-server publicly. Narrow '$allowed' (see" \
               "fuzefront.authentikPublicPaths in _helpers.tpl)." >&2
          fail=1
          ;;
      esac
    done
  done

  return $fail
}

self_test() {
  echo "Self-test: proving the probe FAILS on the known-broken input first" \
       "(a check only ever observed passing is not evidence of anything)."
  local tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  cat > "$tmp/ingress.yaml" <<'EOF'
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: fuzefront
spec:
  rules:
    - host: app.fuzefront.com
      http:
        paths:
          - path: /application
            pathType: Prefix
            backend:
              service:
                name: authentik-server
                port:
                  number: 9000
          - path: /if/flow/
            pathType: Prefix
            backend:
              service:
                name: authentik-server
                port:
                  number: 9000
EOF

  if check_dir "$tmp"; then
    echo "::error::self-test FAILED — the probe passed on a manifest containing the exact" \
         "regression (bare '/application', which must string-prefix-match '/applications')." \
         "The check is not doing its job; fix it before trusting it." >&2
    exit 1
  fi
  echo "Self-test OK: probe correctly failed on bare '/application' (matches '/applications')."

  rm -rf "$tmp"
  tmp="$(mktemp -d)"
  cat > "$tmp/ingress.yaml" <<'EOF'
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: fuzefront
spec:
  rules:
    - host: app.fuzefront.com
      http:
        paths:
          - path: /application/o/
            pathType: Prefix
            backend:
              service:
                name: authentik-server
                port:
                  number: 9000
          - path: /if/flow/
            pathType: Prefix
            backend:
              service:
                name: authentik-server
                port:
                  number: 9000
EOF
  if ! check_dir "$tmp"; then
    echo "::error::self-test FAILED — the probe rejected a manifest with the NARROWED," \
         "correct paths ('/application/o/'). It must pass on the fixed shape." >&2
    exit 1
  fi
  echo "Self-test OK: probe correctly passed on narrowed '/application/o/'."
  rm -rf "$tmp"
  trap - EXIT
}

case "${1:-}" in
  --self-test)
    self_test
    ;;
  "")
    echo "usage: check-authentik-public-paths.sh <rendered-templates-dir> | --self-test" >&2
    exit 2
    ;;
  *)
    check_dir "$1"
    ;;
esac
