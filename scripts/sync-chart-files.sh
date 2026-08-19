#!/usr/bin/env bash
# =============================================================================
# Keep the Helm chart's copies of repo files in sync with their sources.
#
# Helm can only read files inside the chart directory, so every file the chart
# has to ship — the MCP gateway's spec + overrides, and the registration payload
# the init container submits — must exist a second time under
# the chart's files/ directory. That duplication is forced by Helm. Silent drift is
# not: this script is the thing that makes the duplication safe.
#
# Drift here is never cosmetic, and both halves have already bitten:
#   - the chart is what the cluster runs, so a stale SPEC copy means the deployed
#     MCP tool surface disagrees with the contract — a tool that no longer exists,
#     or an irreversible operation whose override never reached the pod;
#   - the REGISTRATION manifest copy silently drifted from registration/, so the
#     deploy registered an app missing `modes`, `nav` and `routing.host`. Nothing
#     reported it, because check-registration.mjs compares only the policy copy.
#
#   scripts/sync-chart-files.sh          copy sources -> chart files
#   scripts/sync-chart-files.sh --check  fail if they differ (for CI)
#
# (Was scripts/sync-mcp-spec.sh, when the MCP spec was the only thing copied.)
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# The chart directory is DISCOVERED, not hardcoded. The original read
# `$ROOT/helm/fuzeservice/files`, which is correct in exactly one repo. Both layouts are
# live across the family — 10 repos keep charts under helm/ and the rest under deploy/helm/
# — and they are deliberately not normalized, because an Argo Application pins
# spec.source.path and relocating a chart breaks prod sync.
# CHART_DIR from the environment wins. This USED TO BE the escape hatch the multi-chart
# error told you to use, while the variable was unconditionally reset to "" one line above
# the loop — so setting it changed nothing and the message named a remedy that did not
# exist. Measured on FuzePlan, which ships FOUR charts (fuzeplan, claude-runner,
# jira-project-analyzer, repo-digester) and could therefore never run this script at all.
CHART_DIR="${CHART_DIR:-}"
if [ -n "$CHART_DIR" ]; then
  case "$CHART_DIR" in /*) ;; *) CHART_DIR="$ROOT/$CHART_DIR" ;; esac
  if [ ! -f "$CHART_DIR/Chart.yaml" ]; then
    echo "ERROR: CHART_DIR=$CHART_DIR has no Chart.yaml." >&2
    exit 2
  fi
else
  # Both layouts are live across the family — 10 repos keep charts under helm/ and the rest
  # under deploy/helm/ — and they are deliberately not normalized, because an Argo
  # Application pins spec.source.path and relocating a chart breaks prod sync.
  CHARTS=()
  for candidate in "$ROOT"/helm/*/Chart.yaml "$ROOT"/deploy/helm/*/Chart.yaml; do
    [ -f "$candidate" ] && CHARTS+=("$(dirname "$candidate")")
  done

  if [ "${#CHARTS[@]}" -eq 0 ]; then
    # Loud, not silent. A no-op sync leaves the chart serving whatever it last had, and the
    # drift this script exists to prevent is exactly what you would then get.
    echo "ERROR: no chart found under helm/*/ or deploy/helm/*/ — nothing to sync into." >&2
    exit 1
  elif [ "${#CHARTS[@]}" -eq 1 ]; then
    CHART_DIR="${CHARTS[0]}"
  else
    # A repo with several charts has one that IS the product; the others are sidecars that
    # do not carry this repo's registration payload. Match on the repo directory name
    # rather than erroring, because erroring made the script unusable in every multi-chart
    # repo, and an unusable sync script is how the chart copy drifts in the first place.
    REPO_NAME="$(basename "$ROOT" | tr '[:upper:]' '[:lower:]')"
    for c in "${CHARTS[@]}"; do
      [ "$(basename "$c" | tr '[:upper:]' '[:lower:]')" = "$REPO_NAME" ] && CHART_DIR="$c"
    done
    if [ -z "$CHART_DIR" ]; then
      echo "ERROR: ${#CHARTS[@]} charts found and none is named '$REPO_NAME':" >&2
      printf '  %s\n' "${CHARTS[@]#"$ROOT"/}" >&2
      echo "Set CHART_DIR to the one that carries this repo's registration payload." >&2
      exit 2
    fi
    echo "note: ${#CHARTS[@]} charts found; using ${CHART_DIR#"$ROOT"/} (matches repo name)." >&2
  fi
fi
DEST="$CHART_DIR/files"

declare -A PAIRS=(
  ["$ROOT/contracts/openapi.yaml"]="$DEST/openapi.yaml"
  ["$ROOT/mcp/tools.overrides.yaml"]="$DEST/tools.overrides.yaml"
  ["$ROOT/registration/manifest.json"]="$DEST/registration/manifest.json"
  ["$ROOT/registration/policy.json"]="$DEST/registration/policy.json"
  ["$ROOT/registration/register.sh"]="$DEST/registration/register.sh"
)

if [[ "${1:-}" == "--check" ]]; then
  status=0
  for src in "${!PAIRS[@]}"; do
    dst="${PAIRS[$src]}"
    # A source this repo does not have is not drift. Reporting "DRIFT: x differs from y"
    # for two files that BOTH do not exist — which is what the bare diff did — is noise
    # that teaches people to stop reading this output, and a sync check nobody reads is
    # the same as no sync check. An orphaned COPY with no source still IS drift, and is
    # reported below.
    if [ ! -f "$src" ]; then
      if [ -f "$dst" ]; then
        echo "DRIFT: ${dst#"$ROOT"/} exists in the chart but ${src#"$ROOT"/} does not — the chart ships a file nothing generates."
        status=1
      fi
      continue
    fi
    if ! diff -q "$src" "$dst" >/dev/null 2>&1; then
      echo "DRIFT: ${dst#"$ROOT"/} differs from ${src#"$ROOT"/}"
      diff -u "$dst" "$src" | head -40 || true
      status=1
    fi
  done
  if [[ $status -eq 0 ]]; then
    echo "Chart file copies are in sync."
  else
    echo
    echo "Run scripts/sync-chart-files.sh to update the chart copies, then commit them."
  fi
  exit $status
fi

for src in "${!PAIRS[@]}"; do
  dst="${PAIRS[$src]}"
  [ -f "$src" ] || { echo "skipped ${src#"$ROOT"/} (not present in this repo)"; continue; }
  mkdir -p "$(dirname "$dst")"
  cp "$src" "$dst"
  echo "synced ${dst#"$ROOT"/}"
done
