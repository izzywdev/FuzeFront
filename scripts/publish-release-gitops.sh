#!/usr/bin/env bash
# Publish a normally checked GitOps PR and hand the merge to GitHub's persistent
# auto-merge queue. Image builds are bounded; independent reviews are not.
set -euo pipefail

file=${1:?values file required}
tag=${2:?image tag required}
source_sha=${3:?source commit required}
: "${GITHUB_REPOSITORY:?repository required}"
[[ "$file" == deploy/helm/fuzefront/values-prod.yaml ]] || exit 1
[[ "$source_sha" =~ ^[0-9a-f]{40}$ && "$tag" == "${source_sha:0:12}" ]] || exit 1
branch="release/gitops-bump-${tag}"
bot_email=release-bump@users.noreply.github.com

set_output() {
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    printf '%s=%s\n' "$1" "$2" >> "$GITHUB_OUTPUT"
  fi
}

# TOCTOU: master can advance AFTER release.yml computed the bump (RELEASE_MASTER_SHA
# is the master tip it was computed against) and BEFORE we publish. Accepting a
# newer descendant head merely because source is its ancestor is not enough: that
# window may have changed/removed a service's inputs, and publishing our (older)
# tag for it would deploy code current master already dropped. So when the live
# tip differs from the basis, RE-EVALUATE the per-service gate against the fresh
# tip and rebuild the bump on top of it. Descendant masters are still accepted
# (no livelock) - only the per-service skip set is recomputed.
# Opt-in via RELEASE_MASTER_SHA so a bare invocation keeps the old behaviour.
check_source_ancestry() { # <master sha>
  # The local clone may predate the API value; fetch loudly so a nonzero
  # --is-ancestor means "not an ancestor", not "Not a valid object name".
  git fetch origin "$1" || { echo "::error::cannot fetch current master $1"; exit 1; }
  local rc=0
  git merge-base --is-ancestor "$source_sha" "$1" || rc=$?
  if [[ "$rc" == 1 ]]; then
    echo "::error::source ${source_sha} is not in current master ($1) history; refusing"
    exit 1
  elif [[ "$rc" != 0 ]]; then
    echo "::error::ancestry check failed (exit ${rc}) for ${source_sha} vs $1"
    exit 1
  fi
}
if [[ -n "${RELEASE_MASTER_SHA:-}" ]]; then
  fresh_master="$(gh api "repos/${GITHUB_REPOSITORY}/git/ref/heads/master" --jq '.object.sha')"
  if [[ "$fresh_master" != "$RELEASE_MASTER_SHA" ]]; then
    allow_script=${RELEASE_ALLOW_BUMP:?RELEASE_ALLOW_BUMP required when RELEASE_MASTER_SHA is set}
    echo "::notice::master advanced ${RELEASE_MASTER_SHA} -> ${fresh_master} after the bump was computed; re-evaluating per-service gate against the fresh head"
    check_source_ancestry "$fresh_master"
    work=$(mktemp -d)
    cp "$file" "$work/candidate.yaml"
    git show "${fresh_master}:${file}" > "$work/vp-fresh.yaml"
    git diff --name-only "$source_sha" "$fresh_master" > "$work/changed.txt"
    : > "$work/skip-log"
    # Services this bump rewrites = those whose candidate tag is ours.
    mapfile -t bumped < <(awk -v tag="$tag" '
      { sub(/\r$/, "") }
      found { if ($1 == "tag:") { t=$2; gsub(/"/, "", t); if (t == tag) print img } found=0 }
      match($0, /repository: ghcr\.io\/izzywdev\/[a-z0-9-]+$/) {
        img=substr($0, RSTART + length("repository: ghcr.io/izzywdev/")); found=1 }' "$work/candidate.yaml")
    allowed=" "
    for img in "${bumped[@]}"; do
      verdict=$(SHA="$tag" GITHUB_SHA="$source_sha" MASTER_SHA="$fresh_master" VP_CURRENT="$work/vp-fresh.yaml" \
        CHANGED_FILES="$work/changed.txt" SKIP_LOG="$work/skip-log" bash "$allow_script" 1 "$img")
      if [[ "$verdict" == 1 ]]; then allowed+="${img} "; fi
    done
    # Rebuild on the FRESH head: only allowed services take our tag.
    awk -v tag="$tag" -v allowed="$allowed" '
      hot { hot=0
        if ($0 ~ /^[[:space:]]*tag:/) { match($0, /^[[:space:]]*/)
          print substr($0, 1, RLENGTH) "tag: " tag ($0 ~ /\r$/ ? "\r" : ""); next } }
      match($0, /repository: ghcr\.io\/izzywdev\/[a-z0-9-]+\r?$/) {
        i=substr($0, RSTART + length("repository: ghcr.io/izzywdev/")); sub(/\r$/, "", i)
        if (index(allowed, " " i " ")) hot=1 }
      { print }' "$work/vp-fresh.yaml" > "$work/vp-new.yaml"
    git checkout -q -f -B release-rebase "$fresh_master"
    cp "$work/vp-new.yaml" "$file"
    if grep -qv ' newer$' "$work/skip-log"; then
      echo "::error::late-window re-evaluation hit an unresolvable/hand-pinned tag; see notices above"
      exit 1
    fi
    if cmp -s "$work/vp-fresh.yaml" "$file"; then
      echo "::warning::release of ${tag} bumped NOTHING after re-evaluating against master ${fresh_master}: every service was skipped (a newer master change owns them)."
      set_output merged false
      exit 0
    fi
  fi
fi
expected_blob=$(git hash-object "$file")

pr=$(gh pr list --repo "$GITHUB_REPOSITORY" --base master --head "$branch" \
  --state open --json number --jq '.[0].number // empty')
if [[ -n "$pr" ]]; then
  # Re-runs may reuse exactly the intended branch, never overwrite others' work.
  actual_blob=$(gh api "repos/${GITHUB_REPOSITORY}/contents/${file}?ref=${branch}" --jq '.sha')
  if [[ "$actual_blob" != "$expected_blob" ]]; then
    # The committed blob is a function of master's HEAD at bump time, so a re-run
    # after master moved legitimately produces a different blob for the SAME
    # tag-keyed branch. Refusing wedged that release forever. Relax ONLY for the
    # bot's own release branch: exact name, exact bot title, head commit authored
    # by the release bot. A human-edited PR (anything else) is still refused.
    old_head=$(gh pr view "$pr" --repo "$GITHUB_REPOSITORY" --json headRefOid --jq '.headRefOid')
    pr_title=$(gh pr view "$pr" --repo "$GITHUB_REPOSITORY" --json title --jq '.title')
    head_author=$(gh api "repos/${GITHUB_REPOSITORY}/commits/${old_head}" --jq '.commit.author.email')
    if [[ "$old_head" =~ ^[0-9a-f]{40}$ && "$pr_title" == "release: fuzefront images ${tag}" \
          && "$head_author" == "$bot_email" ]]; then
      echo "::notice::bot release branch ${branch} is stale (master moved); updating it to the rebased bump"
      git add -- "$file"
      git commit -m "release: fuzefront images ${tag}" -- "$file"
      # Lease on the exact head we just verified as bot-authored: a concurrent
      # writer makes this fail rather than being overwritten.
      git push "--force-with-lease=refs/heads/${branch}:${old_head}" origin "HEAD:refs/heads/${branch}"
    else
      echo "::error::existing release PR differs and is not the bot's own untouched branch; refusing to overwrite it"
      exit 1
    fi
  fi
else
  if git ls-remote --exit-code --heads origin "refs/heads/${branch}" >/dev/null; then
    echo "::error::release branch already exists without an open PR; inspect before retrying"
    exit 1
  else
    status=$?
    # Exit 2 means no matching ref; transport/auth failures are NOT absence.
    [[ "$status" == 2 ]] || exit "$status"
  fi
  git add -- "$file"
  git commit -m "release: fuzefront images ${tag}" -- "$file"
  # Non-forced branch creation. A race must fail, never replace another writer.
  git push origin "HEAD:refs/heads/${branch}"
  gh pr create --repo "$GITHUB_REPOSITORY" --base master --head "$branch" \
    --title "release: fuzefront images ${tag}" \
    --body "Built from ${source_sha}. Updates only successfully pushed image tags. Requires normal repository checks and independent approval. GitOps merge is not production verification."
  pr=$(gh pr list --repo "$GITHUB_REPOSITORY" --base master --head "$branch" \
    --state open --json number --jq '.[0].number // empty')
  [[ -n "$pr" ]] || { echo "::error::no release PR receipt"; exit 1; }
fi

only_values=$(gh pr view "$pr" --repo "$GITHUB_REPOSITORY" --json files \
  --jq '(.files | length) == 1 and .files[0].path == "deploy/helm/fuzefront/values-prod.yaml"')
[[ "$only_values" == true ]] || { echo "::error::release PR contains unexpected files"; exit 1; }
head=$(gh pr view "$pr" --repo "$GITHUB_REPOSITORY" --json headRefOid --jq '.headRefOid')
[[ "$head" =~ ^[0-9a-f]{40}$ ]] || exit 1
# FFRNT rebase-and-retry: the release.yml bump step now rebases onto current
# master (re-applying only this run's built tags, per-service ancestry-guarded
# so nothing older is published over newer). So master advancing past
# source_sha is EXPECTED, not a reason to abort — that abort livelocked every
# release. Still require source_sha to be a real ancestor of current master
# (a sane build off master history), and reject only a divergent/garbage source.
cur_master="$(gh api "repos/${GITHUB_REPOSITORY}/git/ref/heads/master" --jq '.object.sha')"
if [[ "$cur_master" != "$source_sha" ]]; then
  # cur_master comes fresh from the API; the local clone may predate it. Fetch it
  # first (loudly) so a nonzero --is-ancestor genuinely means "not an ancestor"
  # and not "Not a valid object name" misread as divergence.
  git fetch origin "$cur_master" || { echo "::error::cannot fetch current master ${cur_master}"; exit 1; }
  rc=0
  git merge-base --is-ancestor "$source_sha" "$cur_master" || rc=$?
  if [[ "$rc" == 1 ]]; then
    echo "::error::source ${source_sha} is not in current master (${cur_master}) history; refusing"
    exit 1
  elif [[ "$rc" != 0 ]]; then
    echo "::error::ancestry check failed (exit ${rc}) for ${source_sha} vs ${cur_master}"
    exit 1
  fi
fi
# Do not approve our own PR or bypass any review/check/signature requirement.
if [[ "$(gh pr view "$pr" --repo "$GITHUB_REPOSITORY" --json autoMergeRequest --jq '.autoMergeRequest != null')" != true ]]; then
  gh pr merge "$pr" --repo "$GITHUB_REPOSITORY" --auto --squash --match-head-commit "$head"
fi

# Tags are immutable and this PR changes only reviewed deployment values. A
# later master commit is a new candidate, not evidence this built candidate is
# unsafe. Disabling auto-merge here created an endless build/review/stale loop.
# The closed-PR workflow is the merge receipt and dispatches verification.
set_output gitops_pr "$pr"
set_output merged false
echo "GitOps PR #${pr} is queued for normal checks and independent approval; post-deploy verification runs after it merges"
