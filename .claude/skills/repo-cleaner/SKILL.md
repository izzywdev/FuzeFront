---
name: repo-cleaner
description: >
  On-demand repo cleanup: audit every branch (merge or delete), drive every open PR to
  closure (merge when green, close when stale or superseded), and close every resolved or
  stale issue. Goal is convergence to zero open items. Combines branch-audit discipline with
  PR merge/close and issue-triage logic. Use when explicitly asked to clean up a repo,
  reach 0 open items, or batch-close accumulated branches/PRs/issues.
---

# repo-cleaner

Drives a repo to convergence: 0 stale branches, 0 lingering PRs, 0 resolved/stale issues.
Distinct from `governance-reconciliation` (nightly sweep, outputs a tracking issue) — this
skill takes direct action, merging and closing as it goes, and reports outcomes rather than
filing recommendations for a human.

## Phase 1 — Branch audit

For every non-default branch, run the `branch-audit` algorithm in full:

1. Fetch + merge `origin/main` into the branch locally.
2. Diff the result against `main`. Empty diff → **stale**; non-empty diff → policy check.
3. Policy alignment: does the unique content contradict, weaken, or duplicate existing policy?
   If clear net value → **valuable** (open a PR if none exists). If ambiguous or conflicting → **conflict**.
4. Act:

| Verdict | Action |
|---------|--------|
| `stale` | Delete the remote branch (safe — zero unique content). |
| `valuable` | Ensure a PR is open; update the branch to avoid merge conflicts. |
| `conflict` | Record files + tension; leave for human. |

**Special cases:**
- **Has an open PR** → skip to Phase 2 (handle under PR audit).
- **Release branches** (`chore/release-vX.Y.Z`) with a matching tag → stale, delete.
- **`claude/*` session branches** with no open PR and no unique content → stale, delete.
- **Conflict branch** → never delete or push partial merges.

## Phase 2 — PR audit and closure

For every open PR, determine the single blocker and act:

### Decision tree

```
Is the PR stale (no activity >30 d, superseded, author abandoned)?
  → Close with explanation: "Superseded by <PR/commit> / no recent activity / branch content landed."

Is the PR a duplicate of another open or merged PR?
  → Close, link the canonical.

Are CI checks failing?
  → Root-cause the failure.
     Is it a flake or infra outage (runner down, transient network)?
       → Re-run once. If still failing, note in the PR and leave open for CI recovery.
     Is the failure in code this PR touches?
       → Fix in a new commit on the branch; push; let CI re-run.
     Is it unrelated (fails on main too)?
       → Note it, but do not block merge on this PR for an unrelated breakage.

Is the branch behind base?
  → Update the branch (`gh pr update-branch` / merge base in). Let CI re-run.

Is CI green + PR approved (or solo repo where approval is N/A)?
  → Merge (squash, unless the repo convention says otherwise).
     Deploy-on-push repos: never auto-merge outside a deploy window — note "ready, needs deploy window".

Is the PR a draft?
  → If stale (>30 d) → close. Otherwise leave open, note it in the summary.
```

### Merge method

Default: **squash merge** (keeps history linear). Override only if:
- The repo's `CLAUDE.md` or `governance/` explicitly specifies a different method.
- The PR contains merge commits from another team's branch (preserve structure).

### PR close message template

```
Closing: <one of — Superseded by #N / Duplicate of #N / No activity in 30+ days and content
has since landed / Branch stale after squash-merge>.

If this should reopen, push new commits to the branch or open a fresh PR.
```

## Phase 3 — Issue closure

For every open issue:

1. **Check current state** — the body describes state at filing time, not now. Always verify.
   - Search commits/PRs for the reported symptom. Matching fix → close with evidence.
   - Check if the branch/environment mentioned in the issue still exists.

2. **Classify and act:**

| Classification | Evidence check | Action |
|---------------|---------------|--------|
| Fixed | Commit or PR that addresses the exact symptom | Close with link + symptom match |
| Stale | Branch gone, transient CI, env deleted | Close with one-line explanation |
| Duplicate | Linked to a canonical open or closed issue | Close, link canonical |
| Actionable (small) | Reproducible, fix fits one PR | Open a PR; link issue; close when merged |
| Needs decision | Multi-file, architectural, or cross-repo | Leave open; add a comment with options |
| Cross-repo | Root fix lives in another repo | Delegate via `@fuze` cross-repo protocol; keep open until delegate PR merges |

3. **Evidence standard** — never close with "fixed in a newer version" alone. Always include:
   - The PR or commit link.
   - Explicit confirmation that the symptom matches.

## Phase 4 — Summary report

After each phase, emit a structured report:

```json
{
  "branches": [
    { "name": "feat/example", "verdict": "stale|valuable|conflict", "action": "deleted|pr-opened|left", "reason": "..." }
  ],
  "prs": [
    { "number": 42, "title": "...", "action": "merged|closed|updated|left-open", "reason": "..." }
  ],
  "issues": [
    { "number": 7, "title": "...", "action": "closed-fixed|closed-stale|closed-duplicate|pr-opened|delegated|left-open", "reason": "..." }
  ],
  "remainingOpen": { "branches": 0, "prs": 0, "issues": 0 },
  "humanReview": ["list of items that need human judgment"]
}
```

## Guardrails

- **Never** delete a branch with unique unmerged content that passes the policy check — open a PR instead.
- **Never** force-push or rebase another team's branch.
- **Never** merge a deploy-on-push repo's PR outside a deploy window.
- **Never** close an issue without verifiable evidence of resolution (for "fixed") or an explicit explanation (for "stale").
- **Never** auto-merge if required CI checks are still queued — wait for them, or document a confirmed infra outage.
- When in doubt on a PR or issue: leave it open, add a comment with your assessment, and list it in `humanReview`.

## Invocation example

```
Using the repo-cleaner skill, clean up izzywdev/FuzeSDLC:
- Phase 1: audit all non-default branches; delete stale ones, open PRs for valuable ones.
- Phase 2: for each open PR, merge if CI is green and approved, close if stale or superseded.
- Phase 3: for each open issue, close if fixed or stale, delegate if cross-repo.
Return the structured summary report.
```
