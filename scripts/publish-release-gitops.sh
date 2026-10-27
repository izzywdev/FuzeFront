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
expected_blob=$(git hash-object "$file")

set_output() {
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    printf '%s=%s\n' "$1" "$2" >> "$GITHUB_OUTPUT"
  fi
}

pr=$(gh pr list --repo "$GITHUB_REPOSITORY" --base master --head "$branch" \
  --state open --json number --jq '.[0].number // empty')
if [[ -n "$pr" ]]; then
  # Re-runs may reuse exactly the intended branch, never overwrite others' work.
  actual_blob=$(gh api "repos/${GITHUB_REPOSITORY}/contents/${file}?ref=${branch}" --jq '.sha')
  [[ "$actual_blob" == "$expected_blob" ]] || {
    echo "::error::existing release PR differs; refusing to overwrite it"
    exit 1
  }
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
[[ "$(gh api "repos/${GITHUB_REPOSITORY}/git/ref/heads/master" --jq '.object.sha')" == "$source_sha" ]] || {
  echo "::error::source advanced before merge request; rebuild current master"
  exit 1
}
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
