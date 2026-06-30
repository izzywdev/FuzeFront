---
key: FF-EPIC-08
title: SDLC quality gates — pagination gate, DS-conformance gate, UI-frame contract, bidirectional DS onboarding
label: [fuzefront, governance, devops, design-system-first]
github: https://github.com/izzywdev/FuzeFront/issues/108
status: in-progress
priority: Medium
domain: Governance / CI
---

## 🎯 Epic: SDLC quality gates (propagate FuzeSDLC#14 into FuzeFront)

| Field | Value |
|-------|-------|
| **Epic ID** | FF-EPIC-08 |
| **Domain** | Governance / CI |
| **Priority** | Medium |
| **Owner** | Orchestrator (`platform-governance` + `devops-engineer`; `frontend-engineer` for DS onboarding) |
| **Target Release** | Deploy window (PR rebase pending) |
| **Effort Estimate** | M |
| **GitHub** | [#108](https://github.com/izzywdev/FuzeFront/issues/108) |

---

### 📌 Problem Statement
> The four governance enhancements from FuzeSDLC#14 (the L0 source of truth) are not yet propagated into
> FuzeFront: there is no pagination gate, no design-system-conformance gate, no UI-frame contract step,
> and no bidirectional DS onboarding. Without them, list endpoints can ship unpaginated, UI can drift from
> the design system, and feature UI can be built without an approved visual frame.

### 🎯 Goal
> FuzeFront's CI runs `gate-pagination` + `gate-ds-conformance` (report-only first pass), the UI-frame
> contract + DS-conformance skills are available, and the relevant agent definitions carry the new steps —
> all mirroring FuzeSDLC#14.

### 👥 Target Personas
- **Platform-governance maintainer** — keeps FuzeFront in parity with the L0 SDLC baseline.
- **Backend / Frontend engineer** — must satisfy the new pagination + DS-conformance + frame gates.

### ✅ Features In Scope
- [ ] Feature 1: `scripts/gate_pagination.py` + `scripts/gate_ds_conformance.py` (git-ls-files discovery, fast on the monorepo).
- [ ] Feature 2: `.claude/skills/` `design-system-conformance` + `ui-frame-contract`.
- [ ] Feature 3: `harden-gate.yml` new `gate-pagination` + `gate-ds-conformance` jobs (report-only first pass, `|| true`); `claude-ci-autofix.yml` covers "Harden Gate".
- [ ] Feature 4: `governance/pagination-standard.md` + `pagination-allowlist.txt` + `docs/pagination-standard.md`.
- [ ] Feature 5: `.claude/agents/` deltas (backend/test pagination, contract-designer pagination-in-contract + gate-on-frames, frontend-engineer UI-frame step + base-DS onboarding, frontend-test-engineer Playwright-against-frames).

### 🚫 Out of Scope
- Touching product feature code, the live billing/$9 flow, or prod deploy — governance/CI/docs only.
- Resolving the flagged debt (e.g. `GET /subscriptions` pagination, 182 raw-value DS findings) — those are owned by the feature epics; gates are report-only here.
- Ratcheting the gates to enforcing — a later step once debt is burned down.

### 🏗️ High-Level Architecture Notes
> Mirrors FuzeSDLC#14 (L0). Gates use `git ls-files` discovery (~5s pagination / ~3s DS-conformance on
> this monorepo) and run report-only (`|| true`) in the first pass so they do not break CI. `gate-pagination`
> already flags `GET /plans` (exemption candidate) + `GET /subscriptions` (should paginate) in
> `services/billing-service/openapi.yaml`; `gate-ds-conformance` flags 182 raw-value findings + 16
> extraction candidates (advisory). PR rebase pending. Draft + do NOT bot-merge (master deploy-on-push +
> signed) — merge in a deploy window.

### 📊 Success Metrics
| Metric | Current Baseline | Target |
|--------|-----------------|--------|
| FuzeSDLC#14 enhancements propagated | 0 of 4 | 4 of 4 |
| `gate-pagination` + `gate-ds-conformance` in CI | Absent | Present (report-only) |
| Agent defs carrying the new steps | Stale | Updated |
| Drift vs L0 FuzeSDLC#14 | Present | None (mirrored) |

### 📋 Child Stories
| Story ID | Summary | Status |
|----------|---------|--------|
| FF-EPIC-08-S1 | Pagination gate script + standard + allowlist + docs | Open |
| FF-EPIC-08-S2 | DS-conformance gate script + skills | Open |
| FF-EPIC-08-S3 | Wire gates into harden-gate.yml + autofix coverage | Open |
| FF-EPIC-08-S4 | Agent-definition deltas (frame/pagination/DS-onboarding) | Open |

### 🔗 Dependencies
- **Blocks:** FF-EPIC-01/02/03/04 (their pagination + DS-conformance DoD items reference these gates).
- **Related:** FuzeSDLC#14 (L0 source); FF-EPIC-07 (autofix must cover the new gate jobs; ruleset gate-context set).
- **Blocked By:** PR rebase (the existing PR for #108 needs a rebase before merge).

### 📎 References
- GitHub issue: https://github.com/izzywdev/FuzeFront/issues/108
- FuzeSDLC#14 (L0); `services/billing-service/openapi.yaml` (flagged endpoints)

---

## Stories

### 📖 Story: Pagination gate, standard, allowlist, and docs land

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-08-S1 |
| **Parent Epic** | FF-EPIC-08 — SDLC quality gates |
| **Priority** | Medium |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 12 (8 DevOps + 4 Docs) |
| **Tech Layers** | DevOps + Docs |
| **Environment** | FuzeFront repo `scripts/` + `governance/` + `docs/` + CI |

#### 🧑‍💼 User Story
> As a **platform-governance maintainer**, I want **`gate_pagination.py` plus the pagination standard,
> allowlist, and docs** so that **list endpoints are checked for pagination consistently with FuzeSDLC#14**.

#### 📌 Background & Context
Mirrors FuzeSDLC#14: a fast git-ls-files pagination gate (~5s on the monorepo) + `governance/`
pagination standard/allowlist + `docs/pagination-standard.md`. Report-only first pass.

#### ✅ Acceptance Criteria
1. **Given** the repo **When** `gate_pagination.py` runs **Then** it discovers OpenAPI specs via git ls-files and reports list endpoints missing pagination (≤ a few seconds).
2. **Given** the billing spec **When** scanned **Then** it flags `GET /plans` (exemption candidate) + `GET /subscriptions` (should paginate) as documented.
3. **Edge case:** **Given** an endpoint in `pagination-allowlist.txt` **When** scanned **Then** it is exempted (no false positive).
4. **Error case:** **Given** a malformed spec **When** scanned **Then** the gate reports the parse problem clearly (does not crash the CI job).

#### 🔲 Definition of Done
- [ ] `scripts/gate_pagination.py` runs fast via git ls-files
- [ ] `governance/pagination-standard.md` + `pagination-allowlist.txt` + `docs/pagination-standard.md` present
- [ ] Mirrors FuzeSDLC#14 (no drift)
- [ ] Report-only (does not break CI in first pass)
- [ ] Flagged endpoints documented (owned by feature epics)

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| DevOps | Port `gate_pagination.py` + `pagination-allowlist.txt` from FuzeSDLC#14 | 8 | Open |
| Docs | `governance/pagination-standard.md` + `docs/pagination-standard.md` | 4 | Open |

#### 🔗 Dependencies
- **Blocks:** S3 (wiring into harden-gate).

#### ⚠️ Risks & Assumptions
- **Assumption:** FuzeSDLC#14 scripts are the canonical source.
- **Risk:** False positives → allowlist + report-only first pass.

#### 📎 References
- FuzeSDLC#14; `services/billing-service/openapi.yaml`.

---

### 📖 Story: DS-conformance gate script + skills land

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-08-S2 |
| **Parent Epic** | FF-EPIC-08 — SDLC quality gates |
| **Priority** | Medium |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 12 (8 DevOps + 4 Docs) |
| **Tech Layers** | DevOps + Docs |
| **Environment** | FuzeFront repo `scripts/` + `.claude/skills/` + CI |

#### 🧑‍💼 User Story
> As a **platform-governance maintainer**, I want **`gate_ds_conformance.py` plus the `design-system-conformance`
> and `ui-frame-contract` skills** so that **UI work is checked for design-system conformance and built
> against an approved frame**.

#### 📌 Background & Context
Mirrors FuzeSDLC#14: a fast DS-conformance gate (~3s) detecting raw hex/spacing/type outside tokens +
cross-file extraction candidates, plus the two skills. Report-only first pass (advisory).

#### ✅ Acceptance Criteria
1. **Given** the repo **When** `gate_ds_conformance.py` runs **Then** it reports raw-value debt (currently 182) + cross-file extraction candidates (currently 16) advisorily (≤ a few seconds).
2. **Given** the skills **When** present in `.claude/skills/` **Then** `design-system-conformance` + `ui-frame-contract` are loadable and documented.
3. **Edge case:** **Given** a token-based value **When** scanned **Then** it is NOT flagged (only raw hex/spacing/type out of tokens is).
4. **Error case:** **Given** an unparsable component file **When** scanned **Then** the gate reports it without crashing the job.

#### 🔲 Definition of Done
- [ ] `scripts/gate_ds_conformance.py` runs fast via git ls-files
- [ ] `.claude/skills/design-system-conformance` + `.claude/skills/ui-frame-contract` present
- [ ] Mirrors FuzeSDLC#14 (no drift)
- [ ] Report-only/advisory (does not break CI in first pass)

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| DevOps | Port `gate_ds_conformance.py` from FuzeSDLC#14 | 8 | Open |
| Docs | Add `design-system-conformance` + `ui-frame-contract` skills | 4 | Open |

#### 🔗 Dependencies
- **Blocks:** S3 (wiring), S4 (frontend agent references the frame skill).

#### ⚠️ Risks & Assumptions
- **Assumption:** The base DS token set is the reference for conformance.
- **Risk:** Advisory volume (182) overwhelms → keep advisory until debt is burned down, then ratchet.

#### 📎 References
- FuzeSDLC#14; `frontend-design` skill.

---

### 📖 Story: Wire the new gates into harden-gate.yml + autofix coverage

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-08-S3 |
| **Parent Epic** | FF-EPIC-08 — SDLC quality gates |
| **Priority** | Medium |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 8 (4 DevOps + 4 QA) |
| **Tech Layers** | DevOps |
| **Environment** | `.github/workflows/harden-gate.yml` + `claude-ci-autofix.yml` |

#### 🧑‍💼 User Story
> As a **platform-governance maintainer**, I want **`gate-pagination` + `gate-ds-conformance` jobs added to
> `harden-gate.yml` (report-only) and `claude-ci-autofix.yml` covering "Harden Gate"** so that **the gates
> run in CI and failures get auto-fix delegation**.

#### 📌 Background & Context
Adds the two gate jobs (`|| true` report-only first pass) and extends the autofix workflow to cover the
Harden Gate workflow.

#### ✅ Acceptance Criteria
1. **Given** a PR **When** harden-gate runs **Then** `gate-pagination` + `gate-ds-conformance` jobs run report-only and do not block the merge.
2. **Given** the Harden Gate workflow fails **When** `claude-ci-autofix.yml` triggers **Then** it delegates a fix (loop-guarded by branch prefix).
3. **Edge case:** **Given** report-only mode **When** a gate "finds" debt **Then** the job is green (`|| true`) — only enforced later.
4. **Error case:** **Given** an autofix loop risk **When** the autofix branch triggers CI **Then** the branch-prefix loop guard prevents recursion.

#### 🔲 Definition of Done
- [ ] `gate-pagination` + `gate-ds-conformance` jobs in `harden-gate.yml` (report-only)
- [ ] `claude-ci-autofix.yml` covers "Harden Gate"
- [ ] Loop guard preserved
- [ ] **Rollback Plan:** trigger = a gate job breaks CI despite `|| true` → revert the two job additions; harden-gate returns to prior contexts
- [ ] **Security Checklist:** workflow permissions least-priv · no secrets in gate jobs · autofix scoped + loop-guarded · report-only confirmed

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| DevOps | Add the two gate jobs (report-only) + extend autofix to Harden Gate | 4 | Open |
| QA | Confirm jobs run report-only + autofix triggers + loop guard | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** S1, S2. **Related:** FF-EPIC-07 (ruleset gate-context set; autofix coverage).

#### ⚠️ Risks & Assumptions
- **Assumption:** harden-gate.yml exists (from FF-EPIC-07-S1 / PR #93).
- **Risk:** Adding to required contexts prematurely blocks merges → keep report-only until ratchet.

#### 📎 References
- `harden-gate.yml`; `claude-ci-autofix.yml`.

---

### 📖 Story: Update agent definitions with frame / pagination / DS-onboarding steps

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-08-S4 |
| **Parent Epic** | FF-EPIC-08 — SDLC quality gates |
| **Priority** | Medium |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 8 (4 Docs + 4 Docs-verify) |
| **Tech Layers** | Docs / Governance |
| **Environment** | `.claude/agents/` on FuzeFront |

#### 🧑‍💼 User Story
> As a **platform-governance maintainer**, I want **the backend/test/contract-designer/frontend(+test)
> agent defs updated with the pagination, frame-contract, and bidirectional DS-onboarding steps** so that
> **the domain agents enforce the new standards automatically**.

#### 📌 Background & Context
Applies the FuzeSDLC#14 agent deltas: backend/test (pagination implement+verify), contract-designer
(pagination-in-contract + gate-on-frames), frontend-engineer (UI-frame design step, cursor-wired list UI,
base-DS owner receiving graduations + bidirectional onboarding), frontend-test-engineer (Playwright-against-frames).

#### ✅ Acceptance Criteria
1. **Given** the agent defs **When** updated **Then** backend + test carry pagination implement/verify steps and contract-designer carries pagination-in-contract + gate-on-frames.
2. **Given** the frontend defs **When** updated **Then** frontend-engineer has the UI-frame design step + cursor-wired list UI + base-DS onboarding, and frontend-test-engineer has Playwright-against-frames.
3. **Edge case:** **Given** an existing agent instruction **When** the delta is applied **Then** it merges without contradicting prior scope (no conflicting "do/don't").
4. **Error case:** **Given** a drift from L0 FuzeSDLC#14 **When** reviewed **Then** the delta matches L0 (mismatch is a fail).

#### 🔲 Definition of Done
- [ ] Agent defs updated to FuzeSDLC#14 parity
- [ ] `doc-validity` / governance-reconciliation check passes (no L0 drift)
- [ ] No contradictory scope introduced
- [ ] PR rebased + ready for deploy-window merge

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| Docs | Apply backend/test/contract-designer/frontend(+test) agent deltas | 4 | Open |
| Docs | Verify parity with L0 FuzeSDLC#14 (governance-reconciliation) | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** S2 (frame/DS skills referenced by the frontend deltas).

#### ⚠️ Risks & Assumptions
- **Assumption:** L0 FuzeSDLC#14 agent deltas are final.
- **Risk:** Agent-instruction drift across repos → reconcile against L0, not ad hoc.

#### 📎 References
- FuzeSDLC#14; `governance-reconciliation` skill; `.claude/agents/`.
