#!/usr/bin/env bash
#
# reap-agent-worktrees.sh — reclaim git worktrees left behind by agent runs.
#
# WHY THIS EXISTS
# ---------------
# The Agent tool auto-removes an isolated worktree ONLY if it is unchanged.
# Agents exist to change files, so in practice every productive agent — and
# every agent killed mid-run (API error, usage cap, timeout) — leaks its
# worktree and its `worktree-agent-*` branch. Nothing reaps them.
#
# That accumulation is not cosmetic. Each worktree is a full checkout (~2k
# files, plus node_modules if the agent installed). Past ~50 the repo gets slow
# enough that `git worktree add` exceeds the launcher's timeout and NO agent can
# start at all — a self-inflicted denial of service. This happened: a session
# reached 100+ worktrees and every launch failed until they were reaped.
#
# SAFETY CONTRACT
# ---------------
# Work is never destroyed. A worktree is reaped only when ALL hold:
#   1. it has no uncommitted changes, AND
#   2. every commit on its branch is reachable from origin (already pushed or
#      merged) — i.e. nothing exists only on this disk.
# Anything dirty or carrying unpushed commits is REPORTED and SKIPPED, so a
# stalled agent's work can still be salvaged. `--force` is deliberately absent:
# reaping unpushed work is exactly the failure this guards against.
#
# USAGE
#   scripts/reap-agent-worktrees.sh            # reap what is safe
#   scripts/reap-agent-worktrees.sh --dry-run  # report only, change nothing
#
set -uo pipefail

DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "reap-agent-worktrees: not inside a git repository" >&2
  exit 1
}
cd "$REPO_ROOT" || exit 1

# Only ever consider agent-created worktrees. A human's own worktree must never
# be touched, so match the harness's naming, not "everything under .claude".
is_agent_worktree() {
  [[ "$1" =~ /(\.claude/worktrees/)?(agent-|worktree-agent-)[a-z0-9]+/?$ ]]
}

reaped=0 skipped=0 kept_work=()

# Refresh remote refs once so "is it pushed?" is answered against reality and we
# don't skip worktrees whose commits landed on origin since the last fetch.
git fetch --quiet --all --prune 2>/dev/null || true

while IFS= read -r wt; do
  [[ -z "$wt" ]] && continue
  [[ "$wt" == "$REPO_ROOT" ]] && continue
  is_agent_worktree "$wt" || continue

  # A partially-deleted worktree has a broken .git link; git commands run inside
  # it silently walk UP and report the PARENT repo's state. Guard explicitly, or
  # the parent's dirty files look like this worktree's and nothing gets reaped.
  if [[ ! -e "$wt/.git" ]]; then
    echo "reap: ${wt##*/} (broken//partially-removed worktree)"
    (( DRY_RUN )) || { git worktree remove "$wt" --force >/dev/null 2>&1; rm -rf "$wt" 2>/dev/null; }
    (( reaped++ ))
    continue
  fi

  dirty="$(git -C "$wt" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
  branch="$(git -C "$wt" rev-parse --abbrev-ref HEAD 2>/dev/null)"

  # Commits that exist here but on no remote branch = unpushed work.
  unpushed="$(git -C "$wt" rev-list --count HEAD --not --remotes 2>/dev/null || echo 0)"

  if [[ "$dirty" != "0" || "$unpushed" != "0" ]]; then
    kept_work+=("${wt##*/} (branch=$branch, uncommitted=$dirty, unpushed=$unpushed)")
    (( skipped++ ))
    continue
  fi

  echo "reap: ${wt##*/} (branch=$branch — fully pushed, clean)"
  if (( ! DRY_RUN )); then
    git worktree remove "$wt" --force >/dev/null 2>&1 || rm -rf "$wt" 2>/dev/null
    # The throwaway worktree-agent-* branch has no value once its worktree is
    # gone; real claude/* feature branches are left alone for their PRs.
    [[ "$branch" == worktree-agent-* ]] && git branch -D "$branch" >/dev/null 2>&1
  fi
  (( reaped++ ))
done < <(git worktree list --porcelain 2>/dev/null | awk '/^worktree /{print $2}')

(( DRY_RUN )) || git worktree prune >/dev/null 2>&1

# Orphaned throwaway branches whose worktree is already gone.
while IFS= read -r b; do
  [[ -z "$b" ]] && continue
  if [[ "$(git rev-list --count "$b" --not --remotes 2>/dev/null || echo 1)" == "0" ]]; then
    (( DRY_RUN )) || git branch -D "$b" >/dev/null 2>&1
  fi
done < <(git branch --list 'worktree-agent-*' --format='%(refname:short)' 2>/dev/null)

echo
echo "reaped=$reaped skipped=$skipped remaining=$(git worktree list 2>/dev/null | wc -l | tr -d ' ')"
if (( ${#kept_work[@]} )); then
  echo
  echo "KEPT (work would be lost — salvage or push these, they are not reaped):"
  printf '  - %s\n' "${kept_work[@]}"
fi
