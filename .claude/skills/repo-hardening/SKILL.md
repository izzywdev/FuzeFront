---
name: repo-hardening
description: Use to apply (or audit) the org branch-protection + Harden Gate + signing + community-health standard on a repo. Wraps governance/hardening-convention.md and scripts/. Owned operationally by devops-engineer under platform-governance policy.
---

# repo-hardening

Applies the standard in `governance/hardening-convention.md`. Anti-lockout order matters.

## Procedure
1. **Land files via PR** — drop `workflow-templates/harden-gate.yml` + the automation stack + `community-templates/*` (incl. `CODEOWNERS`) onto a branch (`scripts/push_harden.sh`, `scripts/push_stack.sh`), open a PR.
2. **Confirm the gate is green** on that PR (all six `gate-*` report success) before requiring anything.
3. **Apply the ruleset** — `scripts/apply_ruleset.sh <repo> <require_signatures> [extra,contexts]` builds `governance/ruleset.json` targeting `~DEFAULT_BRANCH`; require only confirmed-reporting contexts.
4. **Signing-safe automation** — before enabling `required_signatures`, ensure any workflow that pushes directly to the default branch commits via the GitHub API (auto-signed) or runs as an admin/app bypass identity.
5. **Deploy-on-push repos** (path-filtered deploys) — never bot-merge; merge in a deploy window.

## Verify
`gh api repos/<r>/rulesets` shows one active `Protect default branch` on `~DEFAULT_BRANCH` with the expected rules, contexts, signatures, and bypass actors (admin 5 + app 1236702). On a User account, GitHub Actions (15368) cannot be a bypass actor.
