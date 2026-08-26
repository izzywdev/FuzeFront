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

# The forbidden list AND the approved closed set both come from the shared
# policy file, which both this guard and the live post-deploy probe source.
# They used to be duplicated under a "keep the two lists in sync" comment;
# nothing enforced that, so the two could drift silently in opposite
# directions with both jobs green. See authentik-path-policy.sh for the full
# rationale, including why the closed set (an ALLOWLIST) was added: a denylist
# alone can only forbid a surface somebody remembered to enumerate, which is
# exactly how /applications reached the internet unlisted and unnoticed.
# shellcheck source=deploy/scripts/authentik-path-policy.sh
. "$(dirname "${BASH_SOURCE[0]}")/authentik-path-policy.sh"

# --- extraction: which paths does the rendered chart route to authentik? ---
# $1 = directory of rendered YAML templates to scan.
# Prints one path per line, sorted+deduped. Shared by BOTH checks below so they
# can never disagree about what the chart actually renders.
extract_paths() {
  local dir="$1"
  # Pull every `path: <value>` that immediately follows a
  # `- path:` line whose sibling backend targets authentik-server, across all
  # rendered Ingress manifests. We don't have a YAML parser dependency here
  # (mirrors check-job-interpreters.sh / the networkpolicy-ports guard, both
  # of which use plain grep on rendered YAML), so pull every Ingress `path:`
  # value that is followed within a few lines by `name: authentik-server`.
  # Join EXCLUDED_INGRESS_NAMES with "|" for the awk alternation below.
  # Deliberately NOT `IFS='|'; echo "${arr[*]}"` — that tampers with the
  # special IFS variable, which affects unquoted-expansion word-splitting for
  # the rest of the shell it runs in (Semgrep bash.lang.security.ifs-tampering).
  # It happened to be scoped to a `$(...)` subshell here, but a mechanical
  # join loop has the identical result with none of that class of risk.
  local excluded_pattern=""
  local name
  for name in "${EXCLUDED_INGRESS_NAMES[@]}"; do
    if [ -z "$excluded_pattern" ]; then
      excluded_pattern="$name"
    else
      excluded_pattern="${excluded_pattern}|${name}"
    fi
  done

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
}

# --- check 1 (denylist): does any routed path string-prefix-match a forbidden one? ---
# $1 = directory of rendered YAML templates to scan
check_dir() {
  local dir="$1"
  local fail=0
  local allowed_paths
  allowed_paths="$(extract_paths "$dir")"

  if [ -z "$allowed_paths" ]; then
    echo "::error::no Authentik-backed Ingress paths found in $dir — the extraction regex" \
         "itself may be broken (this check must never silently pass on nothing to check)." >&2
    return 1
  fi

  echo "Authentik-backed Ingress paths found:"
  while IFS= read -r p; do
    printf '  %s\n' "$p"
  done <<< "$allowed_paths"

  for forbidden in "${AUTHENTIK_FORBIDDEN_PATHS[@]}"; do
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

# --- check 2 (closed set): is the routed set EXACTLY the approved set? ---
# The denylist above can only object to a surface somebody remembered to
# enumerate — which is why `/applications`, unlisted, reached the internet
# with every check green. This asserts set EQUALITY against
# APPROVED_PUBLIC_PATHS instead, so a path nobody anticipated still fails.
# $1 = directory of rendered YAML templates to scan
check_closed_set() {
  local dir="$1"
  local fail=0
  local rendered approved extra missing entry path verified why
  rendered="$(extract_paths "$dir")"

  if [ -z "$rendered" ]; then
    echo "::error::no Authentik-backed Ingress paths found in $dir — the extraction regex" \
         "itself may be broken (this check must never silently pass on nothing to check)." >&2
    return 1
  fi

  approved="$(
    for entry in "${APPROVED_PUBLIC_PATHS[@]}"; do
      printf '%s\n' "${entry%%|*}"
    done | sort -u
  )"

  # Rendered but NOT approved — a newly exposed Authentik surface.
  extra="$(comm -23 <(printf '%s\n' "$rendered") <(printf '%s\n' "$approved") || true)"
  # Approved but NOT rendered — the chart dropped a path, or the policy file is
  # stale. Either way the two disagree and a human must reconcile them.
  missing="$(comm -13 <(printf '%s\n' "$rendered") <(printf '%s\n' "$approved") || true)"

  if [ -n "$extra" ]; then
    while IFS= read -r path; do
      [ -n "$path" ] || continue
      echo "::error::Authentik Ingress path '$path' is routed to authentik-server but is NOT in" \
           "APPROVED_PUBLIC_PATHS (deploy/scripts/authentik-path-policy.sh). Every publicly" \
           "routed IdP surface must be explicitly approved with a justification — a denylist" \
           "only ever catches surfaces someone thought to enumerate, which is how /applications" \
           "shipped. If this path is genuinely required by the browser OIDC flow, add it there" \
           "with the network capture that proves it; otherwise remove it from" \
           "fuzefront.authentikPublicPaths in _helpers.tpl." >&2
    done <<< "$extra"
    fail=1
  fi

  if [ -n "$missing" ]; then
    while IFS= read -r path; do
      [ -n "$path" ] || continue
      echo "::error::'$path' is approved in deploy/scripts/authentik-path-policy.sh but the chart" \
           "no longer routes it. The policy and the chart have drifted — either restore it in" \
           "fuzefront.authentikPublicPaths (_helpers.tpl) or drop it from APPROVED_PUBLIC_PATHS." >&2
    done <<< "$missing"
    fail=1
  fi

  if [ "$fail" -eq 0 ]; then
    echo "Closed set OK: the ${#APPROVED_PUBLIC_PATHS[@]} routed Authentik paths are exactly the approved set."
  fi

  # Surface the approved-but-unproven entries. These are NOT a failure: removing
  # a path that a live login turns out to need is an outage, and this session
  # has no cluster or browser capture to settle it. Printing them each run keeps
  # the debt visible instead of letting it sit silently in a list forever.
  local unverified_count=0
  for entry in "${APPROVED_PUBLIC_PATHS[@]}"; do
    path="${entry%%|*}"
    verified="${entry#*|}"; verified="${verified%%|*}"
    why="${entry##*|}"
    if [ "$verified" = "unverified" ]; then
      unverified_count=$((unverified_count + 1))
      echo "::warning::Authentik public path '$path' is approved but UNVERIFIED: $why"
    fi
  done
  if [ "$unverified_count" -gt 0 ]; then
    echo "$unverified_count of ${#APPROVED_PUBLIC_PATHS[@]} approved paths lack evidence that a browser needs them." \
         "Each is a candidate for removal once a network capture of a live login settles it."
  fi

  return $fail
}

# Build a rendered-Ingress fixture routing exactly the given paths to
# authentik-server. Used by the self-test to construct both the known-broken
# and the known-good inputs from real data rather than hand-copied YAML.
#   $1 = target directory, remaining args = paths
write_fixture() {
  local dir="$1"; shift
  {
    printf 'apiVersion: networking.k8s.io/v1\nkind: Ingress\nmetadata:\n  name: fuzefront\nspec:\n  rules:\n    - host: app.fuzefront.com\n      http:\n        paths:\n'
    local p
    for p in "$@"; do
      printf '          - path: %s\n            pathType: Prefix\n            backend:\n              service:\n                name: authentik-server\n                port:\n                  number: 9000\n' "$p"
    done
  } > "$dir/ingress.yaml"
}

# Every approved path, as a plain array — the "correct" fixture input.
approved_path_list() {
  local entry
  for entry in "${APPROVED_PUBLIC_PATHS[@]}"; do
    printf '%s\n' "${entry%%|*}"
  done
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

  # ── Closed-set check ────────────────────────────────────────────────────
  # The denylist above only objects to enumerated surfaces. These three cases
  # prove the set-equality check fires on the two ways the chart and the
  # policy can disagree, and stays quiet when they agree.
  local -a approved
  mapfile -t approved < <(approved_path_list)

  # (a) RED: an EXTRA path nobody approved. Deliberately NOT one of the
  #     enumerated forbidden prefixes — the whole point is catching a surface
  #     the denylist has never heard of.
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  write_fixture "$tmp" "${approved[@]}" "/api/v3/some-future-authentik-surface/"
  if check_closed_set "$tmp" >/dev/null 2>&1; then
    echo "::error::self-test FAILED — the closed-set check passed on a manifest routing an" \
         "unapproved Authentik path. It would not have caught /applications either." >&2
    exit 1
  fi
  echo "Self-test OK: closed-set check correctly failed on an unapproved extra path."

  # (b) RED: an approved path silently dropped from the chart.
  rm -rf "$tmp"; tmp="$(mktemp -d)"
  write_fixture "$tmp" "${approved[@]:1}"
  if check_closed_set "$tmp" >/dev/null 2>&1; then
    echo "::error::self-test FAILED — the closed-set check passed while the chart was missing" \
         "an approved path, so policy/chart drift would go unreported." >&2
    exit 1
  fi
  echo "Self-test OK: closed-set check correctly failed on a missing approved path."

  # (c) GREEN: exactly the approved set.
  rm -rf "$tmp"; tmp="$(mktemp -d)"
  write_fixture "$tmp" "${approved[@]}"
  if ! check_closed_set "$tmp" >/dev/null 2>&1; then
    echo "::error::self-test FAILED — the closed-set check rejected exactly the approved set." \
         "It must pass on the correct shape." >&2
    exit 1
  fi
  echo "Self-test OK: closed-set check correctly passed on exactly the approved set."

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
    # Both layers, and report both before exiting so one failure does not mask
    # the other.
    rc=0
    check_dir "$1" || rc=1
    check_closed_set "$1" || rc=1
    exit $rc
    ;;
esac
