---
name: repo-hardening
description: Use to apply (or audit) the org branch-protection + Harden Gate + signing + community-health standard on a repo. Wraps governance/hardening-convention.md and scripts/. Owned operationally by devops-engineer under platform-governance policy.
---

# repo-hardening

Applies the standard in `governance/hardening-convention.md`. Anti-lockout order matters.

## Procedure
1. **Land files via PR** — drop `workflow-templates/harden-gate.yml` + the automation stack + `community-templates/*` (incl. `CODEOWNERS`) onto a branch (`scripts/push_harden.sh`, `scripts/push_stack.sh`), open a PR.
2. **Confirm the gate is green** on that PR (all six `gate-*` report success) before requiring anything.
3. **Apply the ruleset** — one repo: `scripts/apply_ruleset.sh <repo> <require_signatures> [extra,contexts]` (dispatched as `apply-ruleset.yml` with `repo=<owner/repo>`; `dry_run=true` previews with no write). It is a standalone script, **not** a wrapper over `ruleset_sync.py`: it reads the repo's `required_now` from `governance/required-checks.json` (falling back to `fleet.required_now`), UNIONS that with whatever the repo already requires (never removes a context), and carries the existing `pull_request` rule and `bypass_actors` forward. `<require_signatures>` must match the repo's live ruleset (`false` removes an existing `required_signatures` rule); the `[extra,contexts]` arg bypasses the policy file and is for a first apply only. **To require a repo-specific gate, add it to `repos.<Name>.required_now` + an `audit` entry and dispatch this — never click it into branch protection (`governance/required-checks.md` §5.2).** The whole fleet, on a schedule: `.github/workflows/apply-ruleset.yml`'s `fleet` job runs `scripts/ruleset_sync.py --check` weekly (read-only, exits non-zero on drift/missing/unreachable) against every repo in `governance/ruleset-fleet.json`; `workflow_dispatch` with `mode: apply` writes. Either path requires only confirmed-reporting contexts — see `governance/ruleset-ratchet.json` for the ones deliberately held back today (`gate-actionlint`, the two documented bypass actors) and why.
4. **Signing-safe automation** — before enabling `required_signatures`, ensure any workflow that pushes directly to the default branch commits via the GitHub API (auto-signed) or runs as an admin/app bypass identity.
5. **Deploy-on-push repos** (path-filtered deploys) — never bot-merge; merge in a deploy window.

## Verify
`gh api repos/<r>/rulesets` shows one active branch-target ruleset on `~DEFAULT_BRANCH` (match by target+condition, not name — a repo's ruleset need not be named "Protect default branch"; FuzeFront's live one is "Protect Master") with the expected rules and contexts. **Bypass actors are currently unmanaged**: `governance/ruleset.json` does not set any, and a live audit (2026-08-25) found `bypass_actors: null` on every one of the 17 fleet repos that already had a ruleset — despite this file having long documented admin `RepositoryRole:5` + app `Integration:1236702` as expected. Do not assume either is present without checking; see `governance/ruleset-ratchet.json` for the open question of whether `Integration:1236702` even validates as a bypass actor on a personal (non-org) account before writing it anywhere.
