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
)

fix_mode="${1:-}"
overall=0

for pair in "${PAIRS[@]}"; do
  SRC="${pair%%:*}"
  DST="${pair##*:}"

  for f in "$SRC" "$DST"; do
    if [ ! -f "$f" ]; then
      echo "ERROR: missing $f" >&2
      overall=2
      continue 2
    fi
  done

  if [ "$fix_mode" = "--fix" ]; then
    cp "$SRC" "$DST"
    echo "Copied $SRC -> $DST"
    continue
  fi

  if diff -q "$SRC" "$DST" >/dev/null 2>&1; then
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
    diff -u "$SRC" "$DST" >&2 || true
    echo >&2
    echo "Fix with: ./scripts/check-mcp-spec-drift.sh --fix" >&2
    overall=1
  fi
done

exit $overall
