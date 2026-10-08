#!/usr/bin/env bash
# Publish only a normally checked PR; successful return requires a real merge.
set -euo pipefail

file=${1:?values file required}
tag=${2:?image tag required}
source_sha=${3:?source commit required}
: "${GITHUB_REPOSITORY:?repository required}"
[[ "$file" == deploy/helm/fuzefront/values-prod.yaml ]] || exit 1
[[ "$source_sha" =~ ^[0-9a-f]{40}$ && "$tag" == "${source_sha:0:12}" ]] || exit 1
branch="release/gitops-bump-${tag}"
timeout=${GITOPS_MERGE_TIMEOUT_SECONDS:-1800}
interval=${GITOPS_POLL_SECONDS:-10}
[[ "$timeout" =~ ^[0-9]+$ && "$interval" =~ ^[1-9][0-9]*$ ]] || exit 1
expected_blob=$(git hash-object "$file")

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
deadline=$((SECONDS + timeout))
while :; do
  state=$(gh pr view "$pr" --repo "$GITHUB_REPOSITORY" --json state --jq '.state')
  case "$state" in
    MERGED)
      echo "GitOps PR #${pr} merged; production verification is still required"
      exit 0
      ;;
    OPEN) ;;
    *) echo "::error::release PR is ${state}, not merged"; exit 1 ;;
  esac
  if [[ "$(gh pr view "$pr" --repo "$GITHUB_REPOSITORY" --json headRefOid --jq '.headRefOid')" != "$head" ]]; then
    gh pr merge "$pr" --repo "$GITHUB_REPOSITORY" --disable-auto
    echo "::error::release PR head changed; auto-merge disabled pending inspection"
    exit 1
  fi
  current_master=$(gh api "repos/${GITHUB_REPOSITORY}/git/ref/heads/master" --jq '.object.sha')
  if [[ "$current_master" != "$source_sha" ]]; then
    gh pr merge "$pr" --repo "$GITHUB_REPOSITORY" --disable-auto
    echo "::error::source advanced while waiting; auto-merge disabled, rebuild current master"
    exit 1
  fi
  if (( SECONDS >= deadline )); then
    # A late unattended merge must not occur after verification was abandoned.
    gh pr merge "$pr" --repo "$GITHUB_REPOSITORY" --disable-auto
    echo "::error::GitOps PR #${pr} is still pending required checks/review; no deployment claimed"
    exit 1
  fi
  sleep "$interval"
done
