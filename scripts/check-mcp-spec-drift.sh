#!/usr/bin/env bash
# =============================================================================
# Prove the MCP gateway's mounted contract has not drifted from the source of
# truth.
#
# WHY THIS EXISTS: Helm's .Files.Get cannot read outside the chart directory, so
# deploy/helm/fuzefront/files/app-registry-openapi.yaml must be a COPY of
# services/app-registry-service/openapi.yaml. A copy with nothing checking it is
# a copy that will drift — and the failure is silent and bad: the gateway keeps
# advertising the OLD tool surface, so an agent calls an operation that no
# longer exists (404) or, worse, misses a newly-added irreversible one that
# nobody classified.
#
# Run it by hand after touching either file, or wire it into CI.
#
#   ./scripts/check-mcp-spec-drift.sh          # verify, non-zero on drift
#   ./scripts/check-mcp-spec-drift.sh --fix    # re-copy source -> chart
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

# Each entry is "source:destination". Add a new pair when a new MCP gateway
# gets its own spec copy in deploy/helm/fuzefront/files/.
PAIRS=(
  "services/app-registry-service/openapi.yaml:deploy/helm/fuzefront/files/app-registry-openapi.yaml"
  "services/selection-list-service/openapi.yaml:deploy/helm/fuzefront/files/selection-list-service-openapi.yaml"
  # config-service: the chart copy is the source MINUS the secret-reveal path
  # (see strip_excluded below). A plain diff would flag that deliberate
  # difference as drift, so the expected copy is computed, not copied.
  "services/config-service/openapi.yaml:deploy/helm/fuzefront/files/config-service-openapi.yaml"
)

# Operations that must NEVER be advertised as MCP tools. The gateway derives a
# tool from every operation in the mounted spec and has no per-operation
# exclusion, so the only way to keep a secret-revealing endpoint off the tool
# surface is to leave it out of the spec the gateway mounts. A tool that returns
# raw secret material puts plaintext into LLM session transcripts.
#   <source path>:<spec path to strip>
EXCLUDED_PATHS=(
  "services/config-service/openapi.yaml:/v1/config/secrets/reveal"
)

# Emit SRC with any excluded top-level path item (2-space-indented key under
# `paths:`) removed: from its key line up to the next 2-space-indented key or
# the next top-level key.
strip_excluded() {
  local src="$1" out
  out="$(mktemp)"
  cp "$src" "$out"
  for ex in "${EXCLUDED_PATHS[@]}"; do
    [ "${ex%%:*}" = "$src" ] || continue
    local p="${ex##*:}"
    local tmp; tmp="$(mktemp)"
    awk -v p="  ${p}:" '
      $0 == p { skip = 1; next }
      skip && (/^  [^ ]/ || /^[^ #]/) { skip = 0 }
      !skip { print }
    ' "$out" > "$tmp"
    mv "$tmp" "$out"
  done
  echo "$out"
}

fix_mode="${1:-}"
overall=0

for pair in "${PAIRS[@]}"; do
  SRC="${pair%%:*}"
  DST="${pair##*:}"

  _need=("$SRC" "$DST")
  [ "$fix_mode" = "--fix" ] && _need=("$SRC")
  for f in "${_need[@]}"; do
    if [ ! -f "$f" ]; then
      echo "ERROR: missing $f" >&2
      overall=2
      continue 2
    fi
  done

  EXPECTED="$(strip_excluded "$SRC")"

  if [ "$fix_mode" = "--fix" ]; then
    cp "$EXPECTED" "$DST"
    echo "Copied $SRC -> $DST"
    continue
  fi

  if diff -q "$EXPECTED" "$DST" >/dev/null 2>&1; then
    echo "OK: $DST matches $SRC ($(sha256sum "$SRC" | cut -c1-12))"
  else
    cat >&2 <<EOF
DRIFT: the MCP gateway's mounted contract does not match the source of truth.

  source of truth : $SRC
  chart copy      : $DST

The gateway pod mounts the CHART COPY, so until these match, the tool surface
served in-cluster is not the contract this repo claims to expose.

Diff (source -> chart copy):
EOF
    diff -u "$EXPECTED" "$DST" >&2 || true
    echo >&2
    echo "Fix with: ./scripts/check-mcp-spec-drift.sh --fix" >&2
    overall=1
  fi
done

exit $overall
