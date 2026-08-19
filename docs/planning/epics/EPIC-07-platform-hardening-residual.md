---
key: FF-EPIC-07
title: Adopt cross-repo hardening convention + close internal gaps (signing, unified gate)
label: [fuzefront, devops, security, deploy-window]
github: https://github.com/izzywdev/FuzeFront/issues/94
status: ready
priority: High
domain: DevOps / Security
---

## 🎯 Epic: Platform hardening residual (signing-safe bot commits + ruleset upgrade)

| Field | Value |
|-------|-------|
| **Epic ID** | FF-EPIC-07 |
| **Domain** | DevOps / Security |
| **Priority** | High |
| **Owner** | Orchestrator (`devops-engineer`; `security`/`platform-governance` advise) |
| **Target Release** | Deploy window (master is deploy-on-push) |
| **Effort Estimate** | M |
| **GitHub** | [#94](https://github.com/izzywdev/FuzeFront/issues/94) |

---

### 📌 Problem Statement
> FuzeFront has not fully adopted the org-wide repo-hardening convention standardized across the other
> Fuze repos. `required_signatures` is not yet enabled on `master` because `release.yml` / `sdk-publish.yml`
> / `packages-publish.yml` push directly to `master` with plain (unsigned) commits, and the "Protect Master"
> ruleset lacks the canonical `gate-*` contexts. Without this, signing/branch-protection parity is missing
> on a deploy-on-push branch.

### 🎯 Goal
> `master` has `required_signatures` + the 6 `gate-*` required contexts, the publish/release automation
> still runs green (commits Verified), and the unified harden-gate + community-health files are in place —
> with no unintended prod deploy.

### 👥 Target Personas
- **Platform operator / repo admin** — relies on consistent hardening across the family.
- **Release automation** — must keep pushing to `master` with Verified commits under `required_signatures`.

### ✅ Features In Scope
- [ ] Feature 1: Merge PR #93 (`harden-gate.yml` + `CODEOWNERS` + `SECURITY.md`) in a deploy-safe window.
- [ ] Feature 2: Make `release.yml` / `sdk-publish.yml` / `packages-publish.yml` bot commits signing-safe (GitHub-API/Verified commits OR runner identity as ruleset bypass actor), then enable `required_signatures`.
- [ ] Feature 3: Upgrade the "Protect Master" ruleset (id `17974934`) to add the 6 `gate-*` required contexts + `required_signatures`, preserving current bypass actors.
- [ ] Feature 4: Confirm automation-stack parity (`claude.yml`, `claude-auto-pr.yml`, `auto-merge.yml`, `claude-ci-autofix.yml`, `telegram-pr-merged.yml`).

### 🚫 Out of Scope
- Triggering an unintended prod deploy — all changes land via PR, merged in a deploy window.
- Re-authoring the convention — it is defined; FuzeFront adopts + closes internal gaps.
- Changing the publish destinations/scopes themselves.

### 🏗️ High-Level Architecture Notes
> `master` is deploy-on-push (`deploy.yml`, `release.yml`, `sdk-publish.yml`, `packages-publish.yml`).
> Signing-safe options: server-side GitHub-API commits (auto-Verified) OR add the runner identity as a
> ruleset bypass actor. Bypass actors = admin RepositoryRole 5 + Integration app 1236702. Harden Gate
> emits `gate-lint/test/build/sast/secret-scan/dependency-scan`; non-secret scanners report-only first pass.

### 📊 Success Metrics
| Metric | Current Baseline | Target |
|--------|-----------------|--------|
| `required_signatures` on `master` | Off | On (publish automation still green) |
| `gate-*` contexts in "Protect Master" ruleset | Absent | All 6 present (strict) |
| Release/publish commits Verified | Unsigned | Verified |
| Unintended prod deploys during rollout | — | 0 |

### 📋 Child Stories
| Story ID | Summary | Status |
|----------|---------|--------|
| FF-EPIC-07-S1 | Merge PR #93 (harden-gate + CODEOWNERS + SECURITY) in deploy window | Open |
| FF-EPIC-07-S2 | Signing-safe bot commits + enable required_signatures | Open |
| FF-EPIC-07-S3 | Upgrade "Protect Master" ruleset (gate-* + signatures) | Open |
| FF-EPIC-07-S4 | Confirm automation-stack parity | Open |

### 🔗 Dependencies
- **Related:** PR #93 (staged); FF-EPIC-08 (adds `gate-pagination`/`gate-ds-conformance` to harden-gate — coordinate the gate-context set).
- **Blocked By:** A scheduled deploy window (master is deploy-on-push).

### 📎 References
- GitHub issue: https://github.com/izzywdev/FuzeFront/issues/94
- PR #93; ruleset id `17974934`; `governance/hardening-convention.md`; `repo-hardening` skill

---

## Stories

### 📖 Story: Land the unified Harden Gate + community-health files (PR #93)

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-07-S1 |
| **Parent Epic** | FF-EPIC-07 — Platform hardening residual |
| **Priority** | High |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 8 (4 DevOps + 4 QA) |
| **Tech Layers** | DevOps |
| **Environment** | GitHub repo settings + `master` (deploy-on-push) |

#### 🧑‍💼 User Story
> As a **repo admin**, I want **`harden-gate.yml`, `CODEOWNERS`, and `SECURITY.md` merged to `master`** so
> that **FuzeFront has the unified gate + community-health files in parity with the other Fuze repos**.

#### 📌 Background & Context
PR #93 (`chore/harden-and-contrib`) already adds these and the gate ran green. This story is the
deploy-window merge.

#### ✅ Acceptance Criteria
1. **Given** PR #93 is green **When** merged in a deploy window **Then** `harden-gate.yml` + `CODEOWNERS` + `SECURITY.md` are on `master`.
2. **Given** the merge **When** `deploy.yml` runs on push **Then** the resulting deploy is the intended one (no surprise prod change).
3. **Edge case:** **Given** the gate flags report-only findings **When** merged **Then** the merge is not blocked by report-only scanners (only secret-scan gates).
4. **Error case:** **Given** the gate fails on a real secret **When** detected **Then** the merge is blocked until resolved.

#### 🔲 Definition of Done
- [ ] PR #93 reviewed + merged in a deploy window
- [ ] Files present on `master`
- [ ] Deploy verified intended (no unintended prod change)
- [ ] **Rollback Plan:** trigger = unexpected deploy/gate breakage → revert the merge commit on `master` (signed revert) and re-run deploy from the prior tag
- [ ] **Security Checklist:** secret-scan gating active · no secrets added · CODEOWNERS in force · SECURITY.md policy published

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| DevOps | Review + merge PR #93 in a deploy window; verify files on master | 4 | Open |
| QA | Confirm harden-gate green + deploy intended + rollback rehearsed | 4 | Open |

#### 🔗 Dependencies
- **Blocks:** S2, S3 (the gate contexts/ruleset build on this).

#### ⚠️ Risks & Assumptions
- **Assumption:** PR #93 is still green on rebase.
- **Risk:** Deploy-on-push side effects → merge only in a deploy window.

#### 📎 References
- PR #93.

---

### 📖 Story: Make release/publish bot commits signing-safe and enable required_signatures

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-07-S2 |
| **Parent Epic** | FF-EPIC-07 — Platform hardening residual |
| **Priority** | High |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 16 (8 DevOps + 4 DevOps-verify + 4 QA) |
| **Tech Layers** | DevOps |
| **Environment** | GitHub Actions (`release.yml`/`sdk-publish.yml`/`packages-publish.yml`) + `master` |

#### 🧑‍💼 User Story
> As a **release engineer**, I want **the workflows that push to `master` to produce Verified commits** so
> that **I can enable `required_signatures` without breaking release/publish**.

#### 📌 Background & Context
`release.yml`/`sdk-publish.yml`/`packages-publish.yml` push directly to `master`. Convert them to
GitHub-API (auto-signed) commits OR add their runner identity as a ruleset bypass actor, then enable
`required_signatures`.

#### ✅ Acceptance Criteria
1. **Given** the publish workflows **When** they push to `master` **Then** the resulting commits are Verified (GitHub-API commits or bypass-actor identity).
2. **Given** `required_signatures` is enabled on `master` **When** a publish workflow runs **Then** the push succeeds (not rejected) and commits show Verified.
3. **Edge case:** **Given** a human feature-branch commit (possibly unsigned) **When** squash-merged **Then** the squash-merge commit is signed (satisfies the rule).
4. **Error case:** **Given** an unsigned direct push to `master` **When** attempted **Then** it is rejected by `required_signatures` (proves the rule is active).

#### 🔲 Definition of Done
- [ ] Publish workflows produce Verified commits (chosen mechanism documented)
- [ ] `required_signatures` enabled on `master`
- [ ] Release/publish runs green post-change
- [ ] **Rollback Plan:** trigger = publish workflow rejected by signatures → temporarily add runner as bypass actor (documented) or revert to API-commit path; re-run publish
- [ ] **Security Checklist:** signing keys/app identity scoped least-priv · no secrets in logs · bypass actors limited to admin role 5 + app 1236702 · Verified status confirmed

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| DevOps | Convert publish workflows to signing-safe commits (API/Verified or bypass actor) | 8 | Open |
| DevOps | Enable `required_signatures` on `master`; verify publish push succeeds | 4 | Open |
| QA | Verify Verified status on release/publish commits + unsigned-push rejection | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** S1.

#### ⚠️ Risks & Assumptions
- **Assumption:** A signing app/identity is available for the runner.
- **Risk:** Enabling signatures bricks publishing → make commits signing-safe FIRST, then enable.

#### 📎 References
- `governance/hardening-convention.md` §3; FuzeFront CLAUDE overlay (signing).

---

### 📖 Story: Upgrade the "Protect Master" ruleset with gate-* contexts + signatures

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-07-S3 |
| **Parent Epic** | FF-EPIC-07 — Platform hardening residual |
| **Priority** | High |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 8 (4 DevOps + 4 QA) |
| **Tech Layers** | DevOps |
| **Environment** | GitHub ruleset id `17974934` on `~DEFAULT_BRANCH` |

#### 🧑‍💼 User Story
> As a **repo admin**, I want **the "Protect Master" ruleset to require the 6 `gate-*` contexts +
> `required_signatures` while preserving bypass actors** so that **branch protection matches the family
> standard**.

#### 📌 Background & Context
Update ruleset `17974934` to add the 6 canonical `gate-*` required contexts (alongside/replacing legacy
`Security Scan` / `In-repo packages resolve from source`) + `required_signatures`, keeping current bypass
actors (admin role 5 + app 1236702).

#### ✅ Acceptance Criteria
1. **Given** ruleset `17974934` **When** updated **Then** the 6 `gate-*` contexts are required (strict) and `required_signatures` is set.
2. **Given** the update **When** inspected **Then** existing bypass actors (admin role 5 + app 1236702) are preserved.
3. **Edge case:** **Given** a PR missing one `gate-*` context **When** merge is attempted **Then** it is blocked until that context reports.
4. **Error case:** **Given** the legacy contexts are removed **When** an old PR relies on them **Then** the ruleset still resolves cleanly (no dangling required context that can never report).

#### 🔲 Definition of Done
- [ ] Ruleset shows the 6 `gate-*` contexts (strict) + `required_signatures`
- [ ] Bypass actors preserved (admin role 5 + app 1236702)
- [ ] A test PR confirms the gates block + signatures enforced
- [ ] **Rollback Plan:** trigger = legitimate work blocked by a misconfigured context → restore the prior ruleset JSON (export kept) via the API
- [ ] **Security Checklist:** strict status checks on · code-owner review required · last-push-approval on · thread-resolution required

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| DevOps | Update ruleset `17974934` (gate-* contexts + required_signatures, preserve bypass) | 4 | Open |
| QA | Test PR: gates block + signatures enforced + bypass preserved | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** S1 (gate exists), S2 (signatures safe to require). **Related:** FF-EPIC-08 (coordinate which gate-* contexts are in the required set).

#### ⚠️ Risks & Assumptions
- **Assumption:** Admin API access to edit ruleset `17974934`.
- **Risk:** Requiring a context that never reports blocks all merges → only require contexts that actually run.

#### 📎 References
- Ruleset id `17974934`; `repo-hardening` skill.

---

### 📖 Story: Confirm the standard automation stack is present

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-07-S4 |
| **Parent Epic** | FF-EPIC-07 — Platform hardening residual |
| **Priority** | Medium |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 8 (4 DevOps + 4 QA) |
| **Tech Layers** | DevOps |
| **Environment** | `.github/workflows/` on FuzeFront |

#### 🧑‍💼 User Story
> As a **repo admin**, I want **to confirm `claude.yml`, `claude-auto-pr.yml`, `auto-merge.yml`,
> `claude-ci-autofix.yml`, and `telegram-pr-merged.yml` are present + current** so that **FuzeFront keeps
> automation parity with the family template**.

#### 📌 Background & Context
Audit-and-close-gaps story: verify the standard workflow stack exists and matches the family template;
add/upgrade any missing/stale workflow.

#### ✅ Acceptance Criteria
1. **Given** `.github/workflows/` **When** audited **Then** all 5 standard workflows are present and current.
2. **Given** `claude-ci-autofix.yml` **When** inspected **Then** it covers all CI workflows including "Harden Gate".
3. **Edge case:** **Given** a workflow is stale vs the template **When** found **Then** it is upgraded to parity (not just noted).
4. **Error case:** **Given** a missing workflow **When** found **Then** it is added from the template (no silent gap left).

#### 🔲 Definition of Done
- [ ] All 5 standard workflows present + current
- [ ] `claude-ci-autofix.yml` covers Harden Gate
- [ ] Any gap added/upgraded (PR)
- [ ] **Rollback Plan:** trigger = a new/upgraded workflow misbehaves → disable that single workflow (revert its file) without affecting the others
- [ ] **Security Checklist:** workflow permissions least-priv · no plaintext secrets · `@claude` handler scoped · auto-merge only on green

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| DevOps | Audit + add/upgrade the 5 standard workflows to family parity | 4 | Open |
| QA | Confirm autofix covers Harden Gate + each workflow runs | 4 | Open |

#### 🔗 Dependencies
- **Related:** FF-EPIC-08 (autofix must also cover the new gate jobs).

#### ⚠️ Risks & Assumptions
- **Assumption:** Family template is the source of truth for the stack.
- **Risk:** Workflow loops (autofix on autofix) → branch-name-prefix loop guard preserved.

#### 📎 References
- Standard GitHub automation stack (baseline).
