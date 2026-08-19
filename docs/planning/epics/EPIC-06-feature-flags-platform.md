---
key: FF-EPIC-06
title: Feature flags — deploy Unleash (FuzeFront-hosted) + build @fuzefront/feature-flags (OpenFeature) client
label: [fuzefront, feature-flags, platform, devops]
github: https://github.com/izzywdev/FuzeFront/issues/116
status: ready
priority: Medium
domain: Platform
---

## 🎯 Epic: Feature Flags platform (Unleash + @fuzefront/feature-flags)

| Field | Value |
|-------|-------|
| **Epic ID** | FF-EPIC-06 |
| **Domain** | Platform |
| **Priority** | Medium |
| **Owner** | Orchestrator (`devops-engineer` for Unleash deploy; `backend-engineer` for the client pkg; `feature-flags-engineer` owns taxonomy/admin) |
| **Target Release** | Next deploy window (PR only — no prod deploy) |
| **Effort Estimate** | L |
| **GitHub** | [#116](https://github.com/izzywdev/FuzeFront/issues/116) |

---

### 📌 Problem Statement
> The feature-flags governance layer (agent + skill) exists (PR #111 / FuzeSDLC #17) but the runtime is
> missing: there is no deployed Unleash and no `@fuzefront/feature-flags` client. Until both land, teams
> cannot wrap risky work in flags, the family has no shared flag service, and the "default OFF + test both
> states" discipline cannot be enforced at runtime.

### 🎯 Goal
> FuzeFront hosts Unleash (consuming `fuzeinfra-postgres`) and publishes a private `@fuzefront/feature-flags`
> OpenFeature client so the family can manage and consume flags through one service.

### 👥 Target Personas
- **Platform operator** — runs the FuzeFront-hosted Unleash.
- **Feature-flags engineer** — administers flags + taxonomy.
- **Family-product developer** — consumes `@fuzefront/feature-flags` to gate features.

### ✅ Features In Scope
- [ ] Feature 1: Unleash Deployment+Service (`unleashorg/unleash-server`, pinned version, EXTERNAL image — not in release matrix), gated by `unleash.enabled` (default false).
- [ ] Feature 2: Dedicated `unleash` database + least-priv role on `fuzeinfra-postgres` via a pre-install bootstrap Job (billing-db-bootstrap pattern); secrets (DATABASE_URL + admin token + client token) in a SealedSecret `unleash-secrets`.
- [ ] Feature 3: Admin UI internal/admin-gated only (never public-unauthenticated); optional Edge/proxy or documented server-API + client-token path.
- [ ] Feature 4: Argo umbrella wiring (`unleash.enabled` gate) + `values-prod.yaml` entries + node-2 affinity + chart README documenting the connection endpoint+token.
- [ ] Feature 5: `@fuzefront/feature-flags` client — OpenFeature server+web SDK + Unleash provider, thin API (init + getBoolean/getString/getNumber), Fuze evaluation-context conventions, graceful degradation, private publish + tests.

### 🚫 Out of Scope
- Triggering a prod deploy — PR only; human merges in a deploy window.
- The governance agent + skill — already in PR #111 / FuzeSDLC #17.
- Migrating existing feature gates to Unleash — that is per-feature work in the consuming epics.

### 🏗️ High-Level Architecture Notes
> Unleash self-hosted, FuzeFront-hosted, consuming `fuzeinfra-postgres` (consumer model — FuzeFront does
> not provision the DB engine). DB role via a pre-install bootstrap Job (follow `billing-db-bootstrap`).
> SDK = OpenFeature + Unleash provider wrapped in `@fuzefront/feature-flags`. Evaluation context:
> `environment`, org/tenant id, user id, app (per the `feature-flags` skill). Degrade to defaults when
> Unleash is unreachable. EXTERNAL Unleash image — do NOT add to `release.yml`'s build matrix.

### 📊 Success Metrics
| Metric | Current Baseline | Target |
|--------|-----------------|--------|
| Unleash reachable in-cluster (gated) | None | Deployed behind `unleash.enabled` |
| `@fuzefront/feature-flags` published privately | No | Yes (restricted, GitHub Packages) |
| Graceful degradation when Unleash down | n/a | Returns defaults, no crash |
| Admin UI exposure | n/a | Internal/admin-gated only (not public) |

### 📋 Child Stories
| Story ID | Summary | Status |
|----------|---------|--------|
| FF-EPIC-06-S1 | Unleash Helm Deployment+Service (gated, pinned, external image) | Open |
| FF-EPIC-06-S2 | Unleash DB bootstrap Job + SealedSecret | Open |
| FF-EPIC-06-S3 | Argo umbrella wiring + values-prod + chart README | Open |
| FF-EPIC-06-S4 | @fuzefront/feature-flags OpenFeature client + publish | Open |

### 🔗 Dependencies
- **Related:** PR #111 / FuzeSDLC #17 (governance agent+skill already landed); `feature-flags` skill in `.claude/skills/feature-flags/`.
- **Blocked By:** `fuzeinfra-postgres` availability (consumer model).

### 📎 References
- GitHub issue: https://github.com/izzywdev/FuzeFront/issues/116
- `deploy/helm/fuzefront/`; `billing-db-bootstrap` pattern; `deploy/scripts/seal-secret.sh`

---

## Stories

### 📖 Story: Deploy FuzeFront-hosted Unleash behind an enabled gate

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-06-S1 |
| **Parent Epic** | FF-EPIC-06 — Feature Flags platform |
| **Priority** | Medium |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 12 (8 DevOps + 4 QA) |
| **Tech Layers** | DevOps |

#### 🧑‍💼 User Story
> As a **platform operator**, I want **a Helm Deployment+Service for `unleashorg/unleash-server` (pinned,
> gated by `unleash.enabled`)** so that **Unleash runs in FuzeFront's cluster without entering the build
> matrix or exposing the admin UI publicly**.

#### 📌 Background & Context
Unleash is an EXTERNAL image — pinned to a concrete version, gated `unleash.enabled` (default false), and
must NOT be added to `release.yml`'s build matrix. Admin UI internal/admin-gated only.

#### ✅ Acceptance Criteria
1. **Given** the chart with `unleash.enabled=true` **When** rendered **Then** a Deployment+Service for the pinned `unleashorg/unleash-server` version is produced.
2. **Given** `unleash.enabled=false` **When** rendered **Then** no Unleash resources are created (clean gate).
3. **Edge case:** **Given** the admin UI **When** exposed **Then** it is internal/admin-gated only — not reachable public-unauthenticated.
4. **Error case:** **Given** a missing pinned version (image tag unset) **When** rendered **Then** templating fails fast (no `:latest` drift).

#### 🔲 Definition of Done
- [ ] Helm lint + kubeconform (strict) green
- [ ] Image is external + pinned; NOT in `release.yml` build matrix
- [ ] `unleash.enabled` gate verified both states
- [ ] Admin UI exposure internal/admin-gated only

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| DevOps | Unleash Deployment+Service+values (pinned, `unleash.enabled` gate, internal admin) | 8 | Open |
| QA | helm lint + kubeconform + enabled/disabled render checks | 4 | Open |

#### 🔗 Dependencies
- **Blocks:** S2, S3.

#### ⚠️ Risks & Assumptions
- **Assumption:** A compatible Unleash version exists for the Postgres in use.
- **Risk:** Accidental public admin exposure → ClusterIP/internal-only + auth.

#### 📎 References
- `deploy/helm/fuzefront/`.

---

### 📖 Story: Provision the Unleash database + secrets via a bootstrap Job

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-06-S2 |
| **Parent Epic** | FF-EPIC-06 — Feature Flags platform |
| **Priority** | Medium |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 12 (4 DB + 4 DevOps-secret + 4 QA) |
| **Tech Layers** | Data tier + DevOps |

#### 🧑‍💼 User Story
> As a **platform operator**, I want **a dedicated `unleash` database + least-priv role on
> `fuzeinfra-postgres` and a SealedSecret holding the DB URL + tokens** so that **Unleash has isolated,
> credential-safe storage following the billing-db-bootstrap pattern**.

#### 📌 Background & Context
Pre-install bootstrap Job creates the `unleash` database + least-priv role on `fuzeinfra-postgres`.
Secrets — DATABASE_URL, `INIT_ADMIN_API_TOKENS`, and a client API token — go in a per-service SealedSecret
`unleash-secrets` (placeholders committed; real seal documented via `deploy/scripts/seal-secret.sh`).

#### ✅ Acceptance Criteria
1. **Given** the pre-install hook **When** it runs **Then** a `unleash` database + least-priv role are created on `fuzeinfra-postgres` (idempotent).
2. **Given** the SealedSecret `unleash-secrets` **When** applied **Then** DATABASE_URL + admin token + client token are available to the Unleash pod.
3. **Edge case:** **Given** the database/role already exist **When** the Job re-runs **Then** it is idempotent (no error, no duplicate role).
4. **Error case:** **Given** the SealedSecret is absent **When** the pod starts **Then** it fails fast (no keyless/credential-less start).

#### 🔲 Definition of Done
- [ ] Bootstrap Job follows the `billing-db-bootstrap` pattern; idempotent
- [ ] SealedSecret `unleash-secrets` placeholders committed; seal step documented
- [ ] Least-priv role verified (no superuser)
- [ ] Helm lint + kubeconform green

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| Backend | Pre-install bootstrap Job: `unleash` DB + least-priv role (idempotent) | 4 | Open |
| DevOps | SealedSecret `unleash-secrets` scaffold + seal-step docs | 4 | Open |
| QA | Render + idempotency checks; missing-secret fail-fast | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** S1. **Related:** database-engineer owns the DB role/migration mechanics.

#### ⚠️ Risks & Assumptions
- **Assumption:** `fuzeinfra-postgres` reachable + the bootstrap superuser pattern is available.
- **Risk:** Leaking real tokens in git → commit placeholders only; seal out-of-band.

#### 📎 References
- `billing-db-bootstrap`; `deploy/scripts/seal-secret.sh`.

---

### 📖 Story: Wire Unleash into Argo + values-prod + document the connection

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-06-S3 |
| **Parent Epic** | FF-EPIC-06 — Feature Flags platform |
| **Priority** | Medium |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 8 (4 DevOps + 4 Docs) |
| **Tech Layers** | DevOps + Docs |

#### 🧑‍💼 User Story
> As a **platform operator**, I want **Unleash wired into Argo (gated) with `values-prod.yaml` entries,
> node-2 affinity, and a chart README documenting the endpoint+token** so that **it syncs via GitOps and
> consumers know how to connect**.

#### 📌 Background & Context
Argo umbrella wiring under the `unleash.enabled` gate, prod values, node affinity, and README docs for the
client connection endpoint + token.

#### ✅ Acceptance Criteria
1. **Given** Argo sync with `unleash.enabled=true` in prod values **When** reconciled **Then** Unleash is created and healthy.
2. **Given** the chart README **When** read **Then** it documents the connection endpoint + which token the `@fuzefront/feature-flags` client uses.
3. **Edge case:** **Given** `unleash.enabled=false` in prod values **When** synced **Then** Argo creates no Unleash resources (and does not drift).
4. **Error case:** **Given** wrong node affinity **When** scheduled **Then** the pod stays Pending visibly (not silently mis-scheduled) — documented in the README troubleshooting.

#### 🔲 Definition of Done
- [ ] Argo umbrella wiring under the `unleash.enabled` gate
- [ ] `values-prod.yaml` entries + node-2 affinity
- [ ] Chart README documents endpoint + client token
- [ ] No hand-deploy (GitOps only); no unintended prod sync until enabled

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| DevOps | Argo wiring + values-prod entries + node-2 affinity | 4 | Open |
| Docs | Chart README: connection endpoint + client-token usage + troubleshooting | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** S1, S2.

#### ⚠️ Risks & Assumptions
- **Assumption:** Argo umbrella present; node-2 exists in prod.
- **Risk:** Enabling in prod triggers a real deploy → keep default off; human enables in a deploy window.

#### 📎 References
- Argo umbrella; `values-prod.yaml`.

---

### 📖 Story: Build and publish the @fuzefront/feature-flags OpenFeature client

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-06-S4 |
| **Parent Epic** | FF-EPIC-06 — Feature Flags platform |
| **Priority** | Medium |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 16 (8 BE + 4 BE-publish + 4 QA) |
| **Tech Layers** | Backend / Package |

#### 🧑‍💼 User Story
> As a **family-product developer**, I want **a private `@fuzefront/feature-flags` client wrapping
> OpenFeature + the Unleash provider with a thin API and graceful degradation** so that **I can gate
> features consistently and safely across the family**.

#### 📌 Background & Context
OpenFeature server + web SDK + Unleash provider, wrapped in a thin API (`init(context)` +
`getBoolean/getString/getNumber` with defaults). Fuze evaluation-context conventions (`environment`,
org/tenant id, user id, app). Degrades to defaults when Unleash is unreachable. Private publish + tests.

#### ✅ Acceptance Criteria
1. **Given** `init(context)` with a Fuze evaluation context **When** a flag is read via `getBoolean/getString/getNumber` **Then** the correct value (or provided default) is returned.
2. **Given** Unleash is reachable **When** a flag is evaluated **Then** targeting uses the context conventions (`environment`, org/tenant, user, app).
3. **Edge case:** **Given** an unknown flag key **When** read **Then** the supplied default is returned (no throw).
4. **Error case:** **Given** Unleash is unreachable **When** a flag is read **Then** the client degrades gracefully to defaults and does not crash the consumer.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Unit tests for BOTH reachable + degraded states, coverage ≥ 80%
- [ ] Server + web SDK paths covered
- [ ] Private `publishConfig` (GitHub Packages, `@fuzefront`, restricted) + `repository.directory`, wired into packages-publish
- [ ] Evaluation-context conventions match the `feature-flags` skill

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| Backend | `@fuzefront/feature-flags` (OpenFeature + Unleash provider, thin API, degradation) | 8 | Open |
| Backend | Private publish-config + packages-publish wiring | 4 | Open |
| QA | Unit tests: reachable, degraded, unknown-key default, context targeting | 4 | Open |

#### 🔗 Dependencies
- **Related:** S3 (documents the endpoint+token the client uses). Can build/test against a local/mock Unleash.

#### ⚠️ Risks & Assumptions
- **Assumption:** OpenFeature Unleash provider is stable for both server + web.
- **Risk:** Browser token exposure → web SDK uses a scoped client token / Edge proxy, never an admin token.

#### 📎 References
- `feature-flags` skill (`.claude/skills/feature-flags/`); npm private publishing convention.
