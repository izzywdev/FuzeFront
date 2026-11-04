#!/usr/bin/env bash
# Per-service gate for the release.yml GitOps bump (rebase-and-retry).
#
#   release-allow-bump.sh <built 0|1> <image basename>
#
# Prints exactly "1" (rewrite this service's tag) or "0" (skip) on STDOUT; every
# explanation goes to STDERR so `X=$(release-allow-bump.sh ...)` stays clean.
# Exit non-zero (-> the workflow fails under `set -e`) on a condition that must
# be FIXED rather than skipped: a clone too shallow to resolve a stored sha.
#
# Env (all required unless noted):
#   SHA           12-char tag being released        GITHUB_SHA   built commit
#   MASTER_SHA    current master tip                VP_CURRENT   values-prod.yaml at MASTER_SHA
#   CHANGED_FILES (optional) file listing `git diff --name-only GITHUB_SHA MASTER_SHA`
#                 (absent/empty when master did not move)
#   SKIP_LOG      (optional) file; one "<image> <reason>" line appended per skip.
#                 reason is `newer` (master already ships a newer/other build, or
#                 changed this service's inputs -> its own release will ship it)
#                 or `unresolved` (pinned label / unresolvable sha: needs a human).
set -euo pipefail

built=${1:?built flag required}
img=${2:?image basename required}
: "${SHA:?}" "${GITHUB_SHA:?}" "${MASTER_SHA:?}" "${VP_CURRENT:?}"

skip() { # <reason> <message>
  echo "::notice::release skip ${img}: $2" >&2
  [ -z "${SKIP_LOG:-}" ] || echo "${img} $1" >> "$SKIP_LOG"
  echo 0
  exit 0
}

[ "$built" = "1" ] || { echo 0; exit 0; }

# Current tag for THIS image's block. The match is anchored exactly like the awk
# passes in release.yml / publish-release-gitops.sh: the whole line must be
# `repository: ghcr.io/izzywdev/<img>` (CRLF tolerated, nothing after it), and
# the image name is compared for EQUALITY, so a `# ghcr.io/izzywdev/...` comment
# or an image whose name is a prefix of another can never select the wrong block.
cur=$(awk -v img="${img}" '
  { sub(/\r$/,"") }
  found { if ($1=="tag:") print $2; exit }
  /^[[:space:]]*repository:[[:space:]]*ghcr\.io\/izzywdev\/[a-z0-9-]+[[:space:]]*$/ {
    n=$0; sub(/^.*\/izzywdev\//,"",n); sub(/[[:space:]]+$/,"",n)
    if (n == img) found=1 }' "$VP_CURRENT")
cur=${cur//\"/}

# FAIL CLOSED: an unextractable current tag (block missing/reordered, a comment
# between `repository:` and `tag:`, empty value) means we cannot prove our build
# is not older than what master ships, so we must not publish over it.
if [ -z "$cur" ]; then
  skip unresolved "cannot extract current tag for ${img} from values-prod (block missing, reordered, or not followed directly by tag:); refusing to publish over an unknown tag"
fi

if [ "$cur" != "$SHA" ]; then
  if ! [[ "$cur" =~ ^[0-9a-f]{7,40}$ ]]; then
    # Deliberate hand-pin (label, not a commit). Never overwritten, but visible.
    skip unresolved "values-prod tag '${cur}' is not a commit sha (hand-pinned label); leaving it pinned"
  elif ! git cat-file -e "${cur}^{commit}" 2>/dev/null; then
    if [ "$(git rev-parse --is-shallow-repository)" = "true" ]; then
      echo "::error::cannot resolve current tag '${cur}' for ${img} because the clone is shallow; the --unshallow fetch must succeed so ancestry can be checked. Refusing to silently freeze this service." >&2
      exit 1
    fi
    skip unresolved "values-prod tag '${cur}' is not a commit in this (full) clone; cannot prove our build is newer, leaving it"
  elif ! git merge-base --is-ancestor "$cur" "$GITHUB_SHA"; then
    skip newer "master's tag ${cur} is not an ancestor of ${GITHUB_SHA}; a newer or concurrent release already shipped it"
  fi
fi

# Master moved after our build: if it changed THIS service's inputs, our image
# is stale for it (master removed/changed that code). Fail closed per service;
# that change's own push-triggered release ships the service.
if [ "$MASTER_SHA" != "$GITHUB_SHA" ] && [ -s "${CHANGED_FILES:-/dev/null}" ]; then
  own=()
  shared=1
  case "$img" in
    # COMPLETE per-image input map. Sources of truth (re-read these when adding
    # an image or a workspace dep, do not guess):
    #   frontend/vite.config.ts resolve.alias  -> every dir aliased to SOURCE
    #     (apps-client, billing-client, config-client, portal-client,
    #      design-system; the packages/* aliases are covered by `shared` below)
    #   <service>/Dockerfile COPY lines        -> backend copies
    #     custom-hostname-client/ in full; chat-service also copies docs/ (RAG corpus; deliberately NOT an
    #     input because docs/** is not a release trigger);
    #     devportal-service bakes services/*/openapi.yaml + the collector script
    #   fuzefront-website|devportal-frontend scripts/sync-design-system.mjs
    #     (run by release.yml before docker build) -> vendor the ROOT design-system/
    #   Dockerfiles that COPY only a root client's package.json (security,
    #   applications, chat, ...) do not build from its source, so they are NOT
    #   inputs. Over-listing only costs a skipped bump; under-listing publishes a
    #   stale image, so when unsure for a source-consuming image, list it.
    fuzefront-backend) own=(backend/ custom-hostname-client/) ;;
    fuzefront-security-service|fuzefront-applications-service) own=(backend/) ;;
    fuzefront-frontend) own=(frontend/ design-system/ apps-client/ billing-client/ portal-client/ config-client/) ;;
    fuzefront-email-service) own=(services/email-service/) ;;
    fuzefront-sms-service) own=(services/sms-service/) ;;
    fuzefront-provisioning-service) own=(services/provisioning-service/) ;;
    fuzefront-billing-service) own=(services/billing-service/) ;;
    fuzefront-chat-service) own=(services/chat-service/) ;;
    fuzefront-notification-service) own=(services/notification-service/) ;;
    fuzefront-payment-service) own=(services/payment-service/) ;;
    fuzefront-selection-list-service) own=(services/selection-list-service/) ;;
    fuzefront-config-service) own=(services/config-service/) ;;
    fuzefront-devportal-service) own=(services/devportal-service/ scripts/collect-devportal-specs.mjs) ;;
    fuzefront-clock-app) own=(clock-app/); shared=0 ;;
    fuzefront-website-frontend) own=(fuzefront-website/ design-system/); shared=0 ;;
    fuzefront-website-backend) own=(fuzefront-website/); shared=0 ;;
    fuzefront-devportal-frontend) own=(devportal-frontend/ design-system/); shared=0 ;;
    *) echo "::error::release-allow-bump: no input map for ${img}; add it" >&2; exit 1 ;;
  esac
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    for p in "${own[@]}"; do
      case "$f" in "$p"*) skip newer "master changed its input '${f}' after ${GITHUB_SHA}; a newer master change owns this service's release" ;; esac
    done
    if [ "$shared" = 1 ]; then
      case "$f" in
        packages/*|api-client/*|sdk/*|shared/*|package.json|package-lock.json)
          skip newer "master changed shared workspace input '${f}' after ${GITHUB_SHA}; a newer master change owns this service's release" ;;
      esac
    fi
    # devportal-service bakes every service's openapi.yaml.
    if [ "$img" = fuzefront-devportal-service ]; then
      case "$f" in services/*/openapi.yaml) skip newer "master changed bundled spec '${f}' after ${GITHUB_SHA}" ;; esac
    fi
  done < "$CHANGED_FILES"
fi
echo 1
