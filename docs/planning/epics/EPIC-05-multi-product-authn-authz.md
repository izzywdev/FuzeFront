---
key: FF-EPIC-05
title: Multi-product authn/authz — consumer (e.g. FuzeMarket) integration: OIDC client + per-product Permit policy + ReBAC + consumer docs
label: [fuzefront, identity, security, permit-gated, contract-first]
github: https://github.com/izzywdev/FuzeFront/issues/115
status: ready
priority: High
domain: Identity / Security
---

## 🎯 Epic: Multi-product authentication & authorization

| Field | Value |
|-------|-------|
| **Epic ID** | FF-EPIC-05 |
| **Domain** | Identity / Security |
| **Priority** | High |
| **Owner** | Orchestrator (`backend-engineer` + `docs-maintainer`; appsec-reviewer gates authz) |
| **Target Release** | Next deploy window (PR only — no prod deploy) |
| **Effort Estimate** | XL |
| **GitHub** | [#115](https://github.com/izzywdev/FuzeFront/issues/115) |

---

### 📌 Problem Statement
> Consumer products (e.g. FuzeMarket) cannot yet onboard their own identity + authorization onto the
> FuzeFront platform. AuthZ today is Permit RBAC, per-tenant, with a fixed resource set; there is no way
> for a product to declare its own resources/actions/roles, no per-product OIDC client provisioning, and
> the decided ReBAC org hierarchy (FuzeOne as root) is not implemented. Without this, the platform cannot
> host multiple products.

### 🎯 Goal
> A consumer product (worked example: FuzeMarket) onboards — gets an Authentik OIDC client, declares its
> own namespaced Permit resources/actions/roles which merge into the env, and its users are authorized
> against them within the ReBAC FuzeOne-root org hierarchy.

### 👥 Target Personas
- **Consumer-product developer** — onboards a product (FuzeMarket) declaring auth + authz policy.
- **FuzeOne staff** — root-org admins managing child (customer) tenants via ReBAC.
- **Product end user** — gets SSO + role-based access to product resources (Listing/Order/Cart).

### ✅ Features In Scope
- [ ] Feature 1: Design doc `docs/consumers/authn-authz-integration.md` — architecture + end-to-end onboarding flow + ReBAC hierarchy.
- [ ] Feature 2: Per-product Authentik OIDC client provisioning driven by the manifest `auth` section (redirect URIs/scopes/claims; trust model).
- [ ] Feature 3: Per-product Permit policy-declaration schema (namespaced keys e.g. `fuzemarket.Listing`); extend `sync-permit-schema.ts` to merge per-product resources/actions/roles; product permission-check path; role assignment.
- [ ] Feature 4: ReBAC parent→child derivation (FuzeOne root) in the Permit schema + provisioning.
- [ ] Feature 5: Consumer onboarding guide `docs/consumers/onboarding-authn-authz.md` (FuzeMarket worked example).
- [ ] Feature 6: Update `fuzefront-expert` agent with the consumer authn/authz integration knowledge.

### 🚫 Out of Scope
- Triggering a prod deploy — land via PR; human merges in a deploy window.
- Building FuzeMarket itself — FuzeMarket is the worked example/fixture, not a deliverable here.
- Replacing Permit — authz stays Permit; this extends the schema-merge + ReBAC.

### 🏗️ High-Level Architecture Notes
> **The integration seam for consumers is the FuzeFront Security API (`/api/v1/security/*`, contract
> `packages/security/openapi.yaml`) and the `@fuzefront/security-client` types — NOT any vendor.** Consumers
> authenticate via `/session`, `/signup`, `/social/{provider}/start`, `/session/exchange`, `/methods` and
> authorize via `/authz/check` + `/authz/grants` + `/tenants/*`, always resolving to the stable `Identity`.
> The identity engine and the authorization engine are swappable server-side implementations hidden behind
> the `IdentityProvider` / `AuthorizationProvider` adapters — their vendor names never appear in any
> consumer-facing surface. Internally: namespaced per-product resource keys avoid collisions;
> `sync-permit-schema.ts` merges a product's submitted policy into the policy env; ReBAC makes FuzeOne the
> root/parent tenant so FuzeOne staff manage child customer tenants (parent→child derivation). The manifest
> `auth`/`authz` sections (from #107) remain the declarative provisioning input, but the runtime consumer
> contract is the Security API, not the manifest or a vendor SDK. Tests cover schema-merge + a sample
> FuzeMarket policy.
>
> **Status note:** AuthN is shipped first behind `/api/v1/security/*`; the AuthZ endpoints (`/authz/*`,
> `/tenants/*`) are contract-frozen and generated into the client but not yet wired in the Security
> service — the consumer docs mark them "coming".

### 📊 Success Metrics
| Metric | Current Baseline | Target |
|--------|-----------------|--------|
| Products able to declare own authz policy | 0 | ≥1 (FuzeMarket) merged + checked |
| Per-product OIDC client provisioning | Manual/none | Manifest-driven |
| ReBAC FuzeOne-root hierarchy implemented | No | Yes (parent→child derivation) |
| Consumer onboarding doc + expert update | Missing | Present |

### 📋 Child Stories
| Story ID | Summary | Status |
|----------|---------|--------|
| FF-EPIC-05-S1 | Authn/authz integration design doc + ReBAC model | Open |
| FF-EPIC-05-S2 | Per-product Authentik OIDC client provisioning | Open |
| FF-EPIC-05-S3 | Per-product Permit policy-declaration schema + merge | Open |
| FF-EPIC-05-S4 | ReBAC FuzeOne-root parent→child derivation | Open |
| FF-EPIC-05-S5 | Consumer onboarding guide + fuzefront-expert update | Open |

### 🔗 Dependencies
- **Related:** FF-EPIC-04 (manifest `auth` section is the seam); FF-EPIC-03 (consumes the role model — must not be duplicated there).
- **Blocked By:** #107 manifest `auth` section (frozen).

### 📎 References
- GitHub issue: https://github.com/izzywdev/FuzeFront/issues/115
- Permit schema `backend/security/src/permit/schema.ts`; sync `backend/security/src/permit/sync-permit-schema.ts`; checks `backend/src/utils/permit/permission-check.ts`; `deploy/helm/fuzefront/values-prod.yaml` `authentik` block

---

## Stories

### 📖 Story: Document the multi-product authn/authz architecture and ReBAC model

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-05-S1 |
| **Parent Epic** | FF-EPIC-05 — Multi-product authn/authz |
| **Priority** | High (gate) |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 8 (8 Docs) |
| **Tech Layers** | Docs / Design |

#### 🧑‍💼 User Story
> As a **consumer-product developer**, I want **a design doc describing the end-to-end onboarding flow and
> the ReBAC hierarchy** so that **I understand how my product gets SSO + authz before any code is written**.

#### 📌 Background & Context
This design doc is the gate: it defines how a consumer integrates **through the FuzeFront Security API
(`/api/v1/security/*`) and `@fuzefront/security-client`** — capability discovery + sign-in/up + session
(AuthN) and `authz/check` + grants + tenant/role management (AuthZ), all resolving to the stable
`Identity`, with the identity/authorization engines hidden behind server-side adapters. It also covers the
internal provisioning (manifest `auth`/`authz` → per-product policy merge) and the FuzeOne-root ReBAC
hierarchy. Subsequent stories implement against it. (Delivered as `docs/consumers/authn-authz-integration.md`
+ `docs/consumers/onboarding-authn-authz.md`.)

#### ✅ Acceptance Criteria
1. **Given** the requirements **When** the doc is authored at `docs/consumers/authn-authz-integration.md` **Then** it covers the full register→provision→consume flow and the ReBAC FuzeOne-root hierarchy.
2. **Given** the doc **When** reviewed **Then** it specifies the namespaced resource-key convention (e.g. `fuzemarket.Listing`) and the token/identity trust model.
3. **Edge case:** **Given** two products declaring same-named resources **When** documented **Then** the namespacing rule shows how collisions are avoided.
4. **Error case:** **Given** a product submits an invalid policy **When** documented **Then** the doc states the rejection/validation behavior of the merge step.

#### 🔲 Definition of Done
- [ ] Doc reviewed and approved (min. 1 reviewer)
- [ ] `doc-validity` check passes (links resolve, no TBDs left unflagged)
- [ ] Covers flow + ReBAC + namespacing + trust model
- [ ] Referenced by S2–S5 as the spec

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| Docs | Author `docs/consumers/authn-authz-integration.md` (flow + ReBAC + namespacing + trust) | 8 | Open |

#### 🔗 Dependencies
- **Blocks:** S2–S5 (implementation spec).

#### ⚠️ Risks & Assumptions
- **Assumption:** ReBAC FuzeOne-root decision is confirmed by the owner (it is).
- **Risk:** Permit RBAC-only-per-tenant limitation → doc must state how ReBAC derivation is modeled.

#### 📎 References
- Permit ABAC/ReBAC decision (memory); #107 manifest `auth`.

---

### 📖 Story: A product gets its own Authentik OIDC client from its manifest

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-05-S2 |
| **Parent Epic** | FF-EPIC-05 — Multi-product authn/authz |
| **Priority** | High |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 16 (8 BE + 4 BE-trust + 4 QA) |
| **Tech Layers** | Backend |

#### 🧑‍💼 User Story
> As a **consumer-product developer**, I want **the platform to provision an Authentik OIDC client for my
> product from the manifest `auth` section** so that **my users get SSO without manual Authentik setup**.

#### 📌 Background & Context
The manifest `auth` section (redirect URIs/scopes/claims) drives per-product Authentik OIDC application/
client provisioning; defines the token/identity trust model.

#### ✅ Acceptance Criteria
1. **Given** a manifest with an `auth` section **When** the product is provisioned **Then** an Authentik OIDC application/client is created with the declared redirect URIs/scopes/claims.
2. **Given** the provisioned client **When** a product user logs in **Then** they complete SSO and receive a token the platform trusts per the documented model.
3. **Edge case:** **Given** a re-provision of the same product **When** run **Then** the OIDC client is updated idempotently (no duplicate clients).
4. **Error case:** **Given** invalid redirect URIs in the manifest **When** provisioning **Then** it is rejected with a typed validation error (no partial/insecure client created).

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Backend unit tests passing, coverage ≥ 80%
- [ ] Provisioning idempotent; trust model matches S1 doc
- [ ] appsec-reviewer pass (redirect-URI validation, scope minimization)
- [ ] No prod deploy (PR only)

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| Backend | Manifest-`auth`-driven Authentik OIDC client provisioning (idempotent) | 8 | Open |
| Backend | Token/identity trust-model wiring + validation | 4 | Open |
| QA | Tests: provision, re-provision idempotency, invalid-redirect rejection | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** S1 (design); #107 manifest `auth`.

#### ⚠️ Risks & Assumptions
- **Assumption:** Authentik API supports programmatic OIDC app creation.
- **Risk:** Over-broad scopes → enforce least-privilege scope/claim declarations.

#### 📎 References
- `values-prod.yaml` `authentik` block; backend OIDC code.

---

### 📖 Story: A product declares its own Permit resources/actions/roles that merge into the env

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-05-S3 |
| **Parent Epic** | FF-EPIC-05 — Multi-product authn/authz |
| **Priority** | High |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 20 (8 BE-schema + 8 BE-check + 4 QA) |
| **Tech Layers** | Backend |

#### 🧑‍💼 User Story
> As a **consumer-product developer**, I want **to submit a namespaced policy (e.g. `fuzemarket.Listing`
> with roles seller/buyer/market-admin) that merges into Permit** so that **my users are authorized against
> my own resources without colliding with platform or other products**.

#### 📌 Background & Context
Extends `sync-permit-schema.ts` to merge per-product resources/actions/roles (namespaced keys) into the
Permit env, adds a permission-check path for product resources, and supports role assignment for product
users. Worked example: FuzeMarket Listing/Order/Cart with seller/buyer/market-admin.

#### ✅ Acceptance Criteria
1. **Given** a product submits a namespaced policy **When** `sync-permit-schema` runs **Then** the product's resources/actions/roles are merged into the Permit env without overwriting platform or other-product entries.
2. **Given** a product user with a role **When** a product resource is checked **Then** the permission-check path returns the correct allow/deny for that namespaced resource.
3. **Edge case:** **Given** two products declaring the same local resource name **When** merged **Then** namespacing keeps them distinct (`p1.Listing` vs `p2.Listing`).
4. **Error case:** **Given** a malformed/unnamespaced policy **When** submitted **Then** the merge rejects it with a validation error and the env is unchanged (no partial merge).

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Backend unit tests passing incl. a sample FuzeMarket policy, coverage ≥ 80%
- [ ] Merge is additive + idempotent; never clobbers existing schema
- [ ] permission-check path covers product resources (appsec-reviewer pass)
- [ ] No prod deploy (PR only)

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| Backend | Per-product policy schema + extend `sync-permit-schema.ts` merge (namespaced, additive) | 8 | Open |
| Backend | Product-resource permission-check path + role assignment | 8 | Open |
| QA | Tests: merge, collision-via-namespacing, malformed-policy rejection, sample FuzeMarket policy | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** S1 (design). **Related:** FF-EPIC-03 consumes the role model (no duplication).

#### ⚠️ Risks & Assumptions
- **Assumption:** Permit env supports many resources/roles per env.
- **Risk:** A bad merge corrupts the live schema → additive + validated + idempotent, never clobber.

#### 📎 References
- `sync-permit-schema.ts`; `schema.ts`.

---

### 📖 Story: ReBAC FuzeOne-root hierarchy enables parent→child tenant management

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-05-S4 |
| **Parent Epic** | FF-EPIC-05 — Multi-product authn/authz |
| **Priority** | High |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 16 (8 BE + 4 BE-provision + 4 QA) |
| **Tech Layers** | Backend |

#### 🧑‍💼 User Story
> As a **FuzeOne staff member**, I want **FuzeOne to be the root org whose staff can manage all child
> (customer) tenants** so that **the platform team can administer customer orgs through a ReBAC hierarchy**.

#### 📌 Background & Context
Implements the decided ReBAC org hierarchy: FuzeOne is the root/parent tenant; permission derivation flows
parent→child so FuzeOne staff inherit management over customer tenants.

#### ✅ Acceptance Criteria
1. **Given** the ReBAC schema **When** provisioned **Then** FuzeOne is the root tenant and customer tenants are its children.
2. **Given** a FuzeOne staff member with a root role **When** they act on a child tenant **Then** the permission derives via the parent→child relationship and is allowed.
3. **Edge case:** **Given** a customer-tenant admin **When** they attempt to act on a sibling tenant **Then** it is denied (no lateral derivation).
4. **Error case:** **Given** a misconfigured hierarchy (orphan tenant) **When** checked **Then** the system fails safe to deny (never silently allow) and surfaces the misconfig.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Backend unit tests passing (parent→child allow, sibling deny, orphan fail-safe), coverage ≥ 80%
- [ ] ReBAC derivation modeled in the Permit schema + provisioning
- [ ] Fail-safe-to-deny verified (appsec-reviewer pass)
- [ ] No prod deploy (PR only)

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| Backend | ReBAC parent→child relationship in Permit schema (FuzeOne root) | 8 | Open |
| Backend | Tenant-hierarchy provisioning (root + child registration) | 4 | Open |
| QA | Tests: parent→child allow, sibling deny, orphan fail-safe | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** S1 (design), S3 (schema-merge path).

#### ⚠️ Risks & Assumptions
- **Assumption:** Permit ReBAC features support relationship-derived roles.
- **Risk:** Money-path authz must never DB-fallback (PDP gotchas) → fail-safe to deny.

#### 📎 References
- Permit PDP prod gotchas (memory); Permit ReBAC.

---

### 📖 Story: Consumer onboarding guide + fuzefront-expert update

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-05-S5 |
| **Parent Epic** | FF-EPIC-05 — Multi-product authn/authz |
| **Priority** | Medium |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 8 (4 Docs + 4 Docs-agent) |
| **Tech Layers** | Docs |

#### 🧑‍💼 User Story
> As a **consumer-product developer**, I want **a step-by-step onboarding guide (FuzeMarket worked example)
> and an updated `fuzefront-expert` agent** so that **I can onboard a product end-to-end and future agents
> know the integration model**.

#### 📌 Background & Context
Captures the operational steps for a product to onboard (the FuzeMarket worked example) and updates the
repo expert agent with the new consumer authn/authz knowledge.

#### ✅ Acceptance Criteria
1. **Given** the implemented flow **When** the guide is authored at `docs/consumers/onboarding-authn-authz.md` **Then** it gives step-by-step onboarding using FuzeMarket as the worked example.
2. **Given** the new knowledge **When** `fuzefront-expert` is updated **Then** it documents how products onboard, the policy-declaration schema, and the ReBAC model.
3. **Edge case:** **Given** a developer follows the guide **When** they reach a decision point (scopes/roles) **Then** the guide provides concrete defaults/examples, not just abstractions.
4. **Error case:** **Given** a common onboarding failure (bad redirect URI / unnamespaced policy) **When** documented **Then** the guide includes a troubleshooting section mapping symptom→fix.

#### 🔲 Definition of Done
- [ ] Docs reviewed and approved (min. 1 reviewer)
- [ ] `doc-validity` check passes
- [ ] `fuzefront-expert.md` updated + consistent with S1 design doc
- [ ] FuzeMarket worked example end-to-end
- [ ] Troubleshooting section present

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| Docs | Author `docs/consumers/onboarding-authn-authz.md` (FuzeMarket worked example + troubleshooting) | 4 | Open |
| Docs | Update `.claude/agents/fuzefront-expert.md` with consumer authn/authz knowledge | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** S2, S3, S4 (documents the implemented behavior).

#### ⚠️ Risks & Assumptions
- **Assumption:** FuzeMarket fixture exists from FF-EPIC-04 e2e.
- **Risk:** Doc drift from implementation → author last, after S2–S4 land.

#### 📎 References
- `.claude/agents/fuzefront-expert.md`; S1 design doc.
