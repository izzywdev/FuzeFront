---
name: governance-reconciliation
description: Use for the nightly (or on-demand) per-repo governance sweep that platform-governance runs — find stale/drifting branches, triage every open PR (why open, what's needed to finish), drive open issues to completion/reconciliation, and check drift vs the FuzeSDLC canonical. Takes safe automated actions and files a single tracking issue with findings + what needs a human.
---

# governance-reconciliation

Keeps a repo *converging*: nothing left half-done, no branch/PR/issue silently rotting, no drift from the standard. Runs nightly via `governance-nightly.yml`, or on demand. **platform-governance** owns it. Be a good citizen: take only **safe, reversible** actions automatically; everything risky becomes a recommendation in the tracking issue.

## What to sweep

### 1. Branches (stale / drifting)
- List non-default branches (`gh api repos/{r}/branches`, `gh pr list --state all`). For each, classify:
  - **Story integration branch (`story/**` or runtime-prefixed equivalent)** → must have an open draft/final PR to the default branch, an active Jira Story in the current sprint, and no lifetime beyond one sprint. Report its single next action to completion.
  - **Task branch (`task/**` or runtime-prefixed equivalent)** → must have a PR to its live Story branch, never directly to default for planned Story work. A task whose Story branch is gone is orphaned and must be reconciled.
  - **Merged-but-not-deleted** → delete the branch (safe).
  - **Has an open PR** → handled in §2 (don't touch here).
  - **No PR + ahead of default + recent (<14d)** → open a **draft PR** ("what is this branch / does it want to land?") and ask the author in the tracking issue.
  - **No PR + stale (>30d) / fully behind / no unique commits** → recommend deletion in the tracking issue (don't delete unilaterally unless it has zero unique commits).

### 2. Open PRs — why open, what's needed to finish
For each open PR, determine the blocker and act:
- **Failing checks** → summarize the failure; if it's the kind the CI-autofix caller (`fuze-ci-autofix.yml`, formerly `claude-ci-autofix.yml` — some repos still carry the old name until re-stamped) handles, nudge it; else note the fix needed.
- **Merge conflict / behind base** → `gh pr update-branch` if safe; else flag.
- **Awaiting review** → for solo repos, note it's ready (admin/auto-merge path); request the AI reviewer if configured.
- **Green + approved + not deploy-sensitive** → note "ready to merge" (don't auto-merge deploy-on-push repos — those are deploy-window/human).
- **Stale draft (>30d)** → ping in the tracking issue; recommend close-or-finish.
Always answer, per PR: *why is it still open, and what is the single next action to completion?*

### 3. Open issues — drive to completion + reconciliation
For each open issue:
- **Already resolved** (linked PR merged / behavior shipped) → comment with evidence and **close** (safe).
- **Actionable + small** → open a PR or delegate via the `@fuze` cross-repo protocol (post `@fuze` with a `STATE:` block).
- **Needs a decision / large** → summarize options in the tracking issue for the human; label/triage.
- **Duplicate / stale** → link the canonical, recommend close.
(FuzeInfra's backlog is the first target — process each open issue to a concrete next step or closure.)

### 4. Drift vs canonical
Compare the repo's `.claude/agents` + `CLAUDE.md` + workflow stack against FuzeSDLC (the repo's `.fuze/manifest.json` is the expectation). Flag missing agents, absent `<repo>-expert`, agents without a `skills:` allowlist, stale templates, or out-of-band edits. Open a fix PR for mechanical drift; flag judgment calls.

Also flag, specifically: repos **missing the nightly integration suite / bounded local-up** — ensure the one-shot `@fuze` "Build nightly integration suite" issue exists and is being driven to a draft PR; and repos **missing the ADLC handler** (`fuze.yml` — and `claude.yml` for the `@claude` escape hatch — plus the agent set), because without it that `@fuze` build-issue can't be answered — install it first (re-run `sdlc-bootstrap`). Confirm `nightly-integration.yml` is present (with a staggered cron) alongside `governance-nightly.yml`.

Also confirm the repo's **manifest declares the platform-service spine** (`platformServices`) + `dependsOn`/`providesTo`, and that the **`<repo>-expert` knows the spine + the cross-product feature-request protocol** (`governance/platform-services.md`). Flag experts/manifests that don't as drift; open a fix PR.

## Output — one tracking issue per run
Open or update a single issue titled `Governance reconciliation — <YYYY-MM-DD>` (label `governance`), containing: branches (action taken/recommended), per-PR blocker + next action, per-issue disposition, and the drift report. Link the PRs/issues you opened or acted on. Keep it idempotent — update the day's issue rather than spawning duplicates; close the prior day's once its items are resolved.

## Guardrails
Safe-auto: delete merged branches, close demonstrably-resolved issues, open draft/follow-up PRs, comment/label, `update-branch`. **Never** auto-merge (especially deploy-on-push repos), never delete branches with unique unmerged commits, never force-push, never close an issue you can't prove is resolved. Honor the verification protocol for anything you claim done.
