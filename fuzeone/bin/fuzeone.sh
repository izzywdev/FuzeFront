#!/usr/bin/env bash
# Thin shim → fuzeone/sync.mjs. Usage: fuzeone/bin/fuzeone.sh [sync|check] [--target DIR] [...]
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cmd="${1:-sync}"; [ $# -gt 0 ] && shift || true
case "$cmd" in
  check)       exec node "$here/../sync.mjs" --check "$@" ;;
  sync)        exec node "$here/../sync.mjs" "$@" ;;
  user-agents) exec node "$here/../install-user-agents.mjs" "$@" ;;
  *)           exec node "$here/../sync.mjs" "$cmd" "$@" ;;
esac
