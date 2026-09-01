---
name: github-issue-triage
description: >
  Structured workflow for triaging, closing, delegating, or implementing GitHub
  issues — especially in FuzeSDLC family repos (FuzeInfra, FuzeFront,
  MendysRobotics, etc.). Use this skill whenever the user asks to 'go through
  issues', 'handle the backlog', 'assess issue #N', 'close stale issues',
  'work through open issues', or any variant of reviewing/acting on GitHub
  issues. Also triggers when assessing whether an issue was already fixed, when
  deciding to delegate cross-repo, or when a CI-failure issue appears.
  Enforces FuzeSDLC GitOps, security, and evidence standards automatically.
---

# GitHub Issue Triage

This skill encodes the discipline for correctly triaging GitHub issues in
FuzeSDLC-family repos. The goal: every issue gets one of four outcomes, each
backed by verifiable evidence, without cutting corners that create expensive
rework.

## The four outcomes

| Verdict | When | What to do |
|---------|------|------------|
| **Close — fixed** | The reported problem was demonstrably resolved | Close with evidence (PR/commit link + symptom match) |
| **Close — stale** | Issue is moot: branch gone, transient CI, superseded | Close with one-line explanation |
| **Delegate** | Root fix lives in another repo | Open cross-repo issue with `@claude` + full STATE block |
| **Implement** | Fix belongs in this repo and is actionable | Create PR following GitOps rules |

Always pick the tightest-fitting outcome. "Implement" is a last resort — exhaust the other three first.

## Step 1: Read the issue properly

Before forming any opinion, read:
- The issue title and body (full text, not a skim)
- Linked PRs or commits mentioned in comments
- The `gh issue view <N> --comments` output for any resolution hints

**Issue families matter.** If an issue references others or shares a theme
(same service, same root cause, same epic), identify the family and assess all
members together. A member-level assessment without the family context will
often reach the wrong conclusion.

## Step 2: Check current state before deciding

The issue body describes the state *when the issue was filed*, not now. Always
verify the current state before closing or delegating.

### For "might be fixed" issues
Do not close based on a version number alone. The version progressing forward
is necessary but not sufficient — you need to confirm the *specific symptom*
was addressed.

```
# Get commits in the relevant version range
gh api repos/ORG/REPO/compare/v1.8.7...v2.1.0 --jq '.commits[].commit.message'

# Or search commit messages for the symptom keywords
gh search commits "absolute import" --repo ORG/REPO
```

Look for a commit or PR that explicitly mentions the failure mode described in
the issue. Matching symptoms → safe to close. Version bump alone → reopen
and keep looking.

### For "might be stale" CI-failure issues
```
gh api repos/ORG/REPO/branches/BRANCH-NAME 2>&1 | head -3
# 404 means branch is gone → close as stale
```

## Step 3: Closing a fixed issue

Write a comment that gives the next person everything they need:

```
Fixed in <version> (PR #N: <title>).

The specific symptom "<symptom>" is addressed by
<commit/PR>. Evidence: <link>.
```

Never write "Fixed in newer version" or "Superseded by version X" without the
PR/commit link and symptom match.

## Step 4: Closing a stale issue

```
Closing as stale: the branch <branch> no longer exists and this CI failure was
transient. No code change needed.
```

## Step 5: Cross-repo delegation

```
## Context

<what the originating issue found>

## What's needed

<actionable ask>

## Originating issue

<link>

@claude please <do the thing>

---
STATE:
  done: []
  remaining: []
  decisions: []
  blocked_on: null
```

After opening, post on originating issue:
`Delegated to #<N>. This issue stays open until that PR merges.`

## Step 6: Implementation (when fix belongs here)

Every implementation must go through GitOps:
- Cluster-scoped changes → edit file → commit → PR → merge → apply-cluster-config.yml applies automatically
- FuzeInfra Helm changes → edit helm/fuzeinfra/ → PR to main → ArgoCD syncs
- Sealed secrets → seal locally → commit ciphertext only → wipe plaintext immediately
- Never suggest: kubectl apply directly on prod, kubectl patch/edit Argo-managed resources (selfHeal reverts within seconds)

## Security constraints (always active)

- OIDC client secrets, API keys, tokens: never in GitHub issues, PR descriptions, or conversation output
- Sealed secrets: plaintext wiped immediately after sealing; only ciphertext committed
- Argo selfHeal: never kubectl-patch Argo-managed resources — Argo reverts them within ~15s

## Backlog rhythm

1. Group first — identify issue families before assessing individuals
2. Oldest stale first — CI failures on dead branches are easy wins
3. Delegation before implementation — if root is cross-repo, delegate and keep moving
4. One honest "done" per issue — either closed with evidence, or open with clear next action
5. State your assumptions — when closing based on a commit check, say which commits you checked
