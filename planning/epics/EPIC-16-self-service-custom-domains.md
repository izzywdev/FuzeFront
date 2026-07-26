---
key: FF-EPIC-16
title: Self-Service Custom Domains — portal admins attach subdomains, paths, and custom domains
label: [fuzefront, platform, devops, feature-flag, needs-jira-upload]
github: TBD
status: ready
priority: Medium
domain: Platform / DevOps
---

## 🎯 Epic: Self-Service Custom Domains

| Field | Value |
|-------|-------|
| **Epic ID** | FF-EPIC-16 |
| **Domain** | Platform / DevOps |
| **Priority** | Medium |
| **Owner** | Orchestrator (delegated to `backend-engineer` + `devops-engineer` + `frontend-engineer`) |
| **Target Release** | Next available sprint after FuzeInfra delegation lands |
| **Effort Estimate** | M |
| **GitHub** | TBD |

---

### 📌 Problem Statement
> Tenants can only be reached at fixed hosts today. There is no self-service way to attach
> `corpabc.fuzefront.com`, a path (`app.fuzefront.com/p/corpabc`), or a customer-owned domain (CNAME'd
> to us) with verification and TLS — the Lovable/Replit-style addressing model the product needs for a
> credible white-label reseller offering is entirely missing.

### 🎯 Goal
> A portal admin adds a subdomain, path, or custom domain from their own console; custom domains verify
> via DNS TXT and get TLS issued automatically, with status surfaced in the UI end-to-end; routing is
> handled by the portal-context resolver, with the underlying wildcard DNS/TLS/ingress infrastructure
> provided by FuzeInfra.

### 👥 Target Personas
- **Portal Admin** — wants their portal reachable at a branded domain without filing an infra ticket.
- **Master Admin** — needs domain status visible platform-wide to support tenants and spot stuck verifications.

### ✅ Features In Scope
- [ ] Feature 1: Domain verification flow — generate a `_fuzefront-verify` DNS TXT token, verify endpoint, `verification_status` state machine.
- [ ] Feature 2: TLS status surfacing + FuzeInfra integration — request/poll TLS issuance through the FuzeInfra-provided mechanism, `tls_status` state machine.
- [ ] Feature 3: Custom-domain self-service UI — portal-admin add-domain flow with verification/TLS status shown for all states.
- [ ] Feature 4: `fuzefront.platform.portal-domains` feature flag, default OFF.

### 🚫 Out of Scope
- FuzeInfra internals — wildcard DNS, TLS issuance mechanics, ingress controller configuration. These are owned by FuzeInfra and reached only via `@claude` delegation, never edited or operated from this repo.
- A per-tenant Helm release or per-domain infrastructure provisioning — routing must resolve entirely through the existing portal-context resolver (FF-EPIC-10), not new infra per domain.
- Domain transfer/ownership disputes — out of scope for self-service; escalate to Master Admin support flow.

### 🏗️ High-Level Architecture Notes
> `portal_domains` rows (schema landed in FF-EPIC-09: `portal_id`, `domain` unique, `kind`
> subdomain|path|custom, verification/tls status) drive this epic end to end — no new domain table is
> introduced here, only the state-machine transitions and the UI on top of it. Verification: generate a
> `_fuzefront-verify.<domain>` TXT token, poll for it, flip `verification_status` accordingly. TLS is
> requested via whatever mechanism FuzeInfra exposes (Cloudflare custom hostnames preferred, or
> cert-manager as a fallback) — this repo only polls `tls_status`, it does not implement certificate
> issuance. Routing for a verified domain uses the FF-EPIC-10 `resolvePortalContext` resolver
> (Host/path/custom → portal, fail-closed to root/404/suspended) — **no Helm release per domain**, ever.
> **HARD DEPENDENCY:** the wildcard DNS + custom-hostname/cert capability this epic polls against does
> not exist in this repo and must be delegated to FuzeInfra via `@claude` before Story 2 can complete;
> see Dependencies below.

### 📊 Success Metrics
| Metric | Current Baseline | Target |
|--------|-----------------|--------|
| Portals reachable only at fixed hosts | 100% | 0% for portals that opt into a custom domain |
| Median time from "domain added" to "verified + TLS live" | N/A (no self-service today) | [Establish baseline in Sprint 1] |
| Support tickets for domain setup | N/A (currently manual/infra-ticket only) | −100% (fully self-service) |

### 📋 Child Stories
| Story ID | Summary | Status |
|----------|---------|--------|
| FF-EPIC-16-S1 | Domain verification flow | Open |
| FF-EPIC-16-S2 | TLS status surfacing + FuzeInfra integration | Open |
| FF-EPIC-16-S3 | Custom-domain self-service UI | Open |
| FF-EPIC-16-S4 | Feature flag fuzefront.platform.portal-domains | Open |

### 🔗 Dependencies
- **Blocked By:** FuzeInfra wildcard DNS + custom-hostname/certificate capability — **not yet delegated**; must be requested from FuzeInfra via `@claude` cross-repo delegation before FF-EPIC-16-S2 can complete (this repo cannot implement TLS issuance itself, only poll the mechanism FuzeInfra exposes). Also blocked by FF-EPIC-09 (`portal_domains` schema) and FF-EPIC-10 (portal-context resolver that will route verified domains).
- **Related:** FF-EPIC-14 (master-admin/portal-admin consoles surface domain status alongside this epic's UI).
- **Blocks:** none downstream known at authoring time.

### 📎 References
- `portal_domains` schema: FF-EPIC-09 — `docs/planning/epics/EPIC-09-portal-core.md`
- Portal-context resolver: FF-EPIC-10 — `docs/planning/epics/EPIC-10-portal-context-resolution.md`
- Ingress (single host today): `deploy/helm/fuzefront/templates/ingress.yaml`
- White-label precedent: `docs/planning/locked-app-mode.md`

---

## Stories

### 📖 Story: Portal admin can verify domain ownership via DNS TXT

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-16-S1 |
| **Parent Epic** | FF-EPIC-16 — Self-Service Custom Domains |
| **Priority** | Medium |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 12 (8 BE + 4 QA) |
| **Tech Layers** | Backend |

#### 🧑‍💼 User Story
> As a **Portal Admin**, I want to **prove I own a domain by adding a DNS TXT record** so that
> **FuzeFront will only route traffic for domains I actually control**.

#### 📌 Background & Context
`portal_domains` rows already carry a `kind=custom` state from FF-EPIC-09; this story adds the
verification token generation and the poll/verify endpoint that transitions `verification_status`
through its state machine (pending → verifying → verified/failed/expired).

#### ✅ Acceptance Criteria
1. **Given** a Portal Admin adds a custom domain **When** the domain row is created **Then** a unique `_fuzefront-verify.<domain>` TXT token is generated and `verification_status=pending`.
2. **Given** the correct TXT record is published **When** the verify endpoint is polled/invoked **Then** DNS is queried, the token match succeeds, and `verification_status` transitions to `verified`.
3. **Edge case:** **Given** a token that is not yet published or has propagation delay **When** verification is attempted **Then** the status remains `verifying` (not `failed`) and the flow retries rather than dead-ending on a transient DNS lookup miss.
4. **Error case:** **Given** a verification token that is never published within the allowed window **When** the window elapses **Then** `verification_status` transitions to `expired`, the domain does not route any traffic, and the admin can regenerate a new token to retry.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Unit tests written and passing (coverage ≥ 80%)
- [ ] Functional tests passing on staging (real DNS TXT lookup against a test domain)
- [ ] Verification endpoint documented (OpenAPI)
- [ ] PM verified all Acceptance Criteria on staging
- [ ] Deployed to staging and smoke-tested

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| Backend | Generate TXT token; verify endpoint (DNS lookup); `verification_status` state-machine transitions (pending/verifying/verified/failed/expired) | 8 | Open |
| QA | Verify happy-path + failed + expired-token test (including propagation-delay edge case) | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-09 (`portal_domains` schema).

#### ⚠️ Risks & Assumptions
- **Assumption:** DNS TXT lookups from the backend are reliable enough for polling without needing an external DNS-check service.
- **Risk:** DNS propagation delay causing false "failed" reads — mitigated by AC3's explicit `verifying` (not `failed`) transient state.

#### 📎 References
- `portal_domains` schema: FF-EPIC-09 — `docs/planning/epics/EPIC-09-portal-core.md`.

---

### 📖 Story: Verified domain gets TLS issued and its status surfaced

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-16-S2 |
| **Parent Epic** | FF-EPIC-16 — Self-Service Custom Domains |
| **Priority** | Medium |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 16 (8 BE + 4 DevOps + 4 QA) |
| **Tech Layers** | Full-Stack / DevOps |

#### 🧑‍💼 User Story
> As a **Portal Admin**, I want to **see my verified custom domain get a valid TLS certificate
> automatically** so that **my customers reach my portal over HTTPS without any manual certificate work
> on my part**.

#### 📌 Background & Context
Once a domain is `verified` (S1), TLS issuance must be requested and polled through whatever mechanism
FuzeInfra exposes (Cloudflare custom hostnames preferred, or cert-manager as fallback). **This story has
a hard dependency on the FuzeInfra wildcard + custom-hostname capability, which must be requested via
`@claude` cross-repo delegation before this story's backend/DevOps sub-tasks can be implemented** — this
repo integrates against that capability, it does not build TLS issuance itself.

#### ✅ Acceptance Criteria
1. **Given** a `verified` custom domain **When** TLS issuance is requested against the FuzeInfra-provided mechanism **Then** `tls_status` transitions to `issuing`, then to `active` once the certificate is confirmed live.
2. **Given** an `active` TLS status **When** the domain is queried through the portal-context resolver **Then** the resolver treats it as routable (paired with `verification_status=verified`).
3. **Edge case:** **Given** TLS issuance is still in progress **When** the portal is accessed at the custom domain **Then** the FuzeInfra-side fallback/interim behavior is respected (no route is exposed as "active" from FuzeFront's side until `tls_status=active`, avoiding a mixed-content/cert-mismatch window).
4. **Error case:** **Given** TLS issuance fails (e.g. rate-limited by the CA, or the FuzeInfra capability reports an error) **When** the poll detects the failure **Then** `tls_status` transitions to `failed` with the reason surfaced, and the domain is not treated as routable — fail-closed, never silently serving on an invalid/missing cert.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Unit tests written and passing (coverage ≥ 80%)
- [ ] Integration contract with FuzeInfra's custom-hostname/cert capability documented and verified against a real (or staging) FuzeInfra environment
- [ ] Functional tests passing on staging
- [ ] PM verified all Acceptance Criteria on staging
- [ ] Deployed to staging and smoke-tested

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| Backend | Request/poll TLS issuance via the FuzeInfra-provided mechanism; `tls_status` state-machine transitions (issuing/active/failed) | 8 | Open |
| DevOps | Wire `portal_domains` to the FuzeInfra custom-hostname/cert capability (integration contract only — FuzeInfra internals delegated via `@claude`) | 4 | Open |
| QA | TLS status transition test + routing-reachability test (active domain resolves; issuing/failed domains do not) | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** FuzeInfra wildcard DNS + custom-hostname/certificate capability — **hard dependency, delegated via `@claude`, not yet available**. Also blocked by FF-EPIC-16-S1 (`verification_status=verified` is the precondition for requesting TLS).
- **Blocked By:** FF-EPIC-10 (portal-context resolver must exist to consult `tls_status`/`verification_status` when routing).

#### ⚠️ Risks & Assumptions
- **Assumption:** FuzeInfra will expose a stable integration contract (API or shared state) for custom-hostname/cert status that this repo can poll — to be confirmed in the `@claude` delegation response, not assumed unilaterally.
- **Risk:** This story cannot start its DevOps/Backend integration sub-tasks until the FuzeInfra delegation lands — sequencing risk to the whole epic's timeline; the delegation should be filed as early as possible, ideally in parallel with FF-EPIC-16-S1.

#### 📎 References
- Ingress (single host today): `deploy/helm/fuzefront/templates/ingress.yaml`. FuzeInfra delegation: cross-repo `@claude` issue (to be filed).

---

### 📖 Story: Portal admin manages custom domains from a self-service UI

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-16-S3 |
| **Parent Epic** | FF-EPIC-16 — Self-Service Custom Domains |
| **Priority** | Medium |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 12 (8 FE + 4 QA) |
| **Tech Layers** | Frontend |

#### 🧑‍💼 User Story
> As a **Portal Admin**, I want to **add a domain and watch its verification/TLS status update in my
> console** so that **I always know exactly what to do next without contacting support**.

#### 📌 Background & Context
Surfaces the S1/S2 state machines in the UI, design-system-first, covering every status combination
(pending/verifying/verified/failed/expired × issuing/active/failed) so a stuck domain is always
self-explanatory.

#### ✅ Acceptance Criteria
1. **Given** a Portal Admin on the domains page **When** they add a domain **Then** the required TXT record (name + value) is displayed clearly with a copy action, and the new domain appears with `pending` status.
2. **Given** a domain progresses through verification and TLS issuance **When** status changes **Then** the UI reflects each transition (pending → verifying → verified, then issuing → active) without requiring a manual page refresh.
3. **Edge case:** **Given** a domain has zero domains added yet **When** the page loads **Then** an empty state with a clear "add your first domain" CTA is shown.
4. **Error case:** **Given** a domain's verification or TLS status is `failed`/`expired` **When** the page renders **Then** the specific failure reason is shown along with a "retry" action — never a silent stuck row with no explanation.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] RTL unit tests (a11y + states) passing, coverage ≥ 80%
- [ ] `gate-ds-conformance` green — no raw hex/spacing/type
- [ ] All status-combination states verified against staging data (mocked + real)
- [ ] PM verified all Acceptance Criteria on staging
- [ ] Deployed to staging and smoke-tested

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| Frontend | Portal-admin add-domain + verification/TLS status UI (all states: pending/verifying/verified/failed/expired × issuing/active/failed, empty state) | 8 | Open |
| QA | RTL domain-status states test (every status combination) | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-16-S1 (verification API) and FF-EPIC-16-S2 (TLS status API) — the UI needs both endpoints to render real state.

#### ⚠️ Risks & Assumptions
- **Assumption:** Status polling (rather than push/websocket) is acceptable for this first iteration given domain setup is an infrequent, low-frequency admin action.
- **Risk:** The status-combination matrix is large (5 verification states × 3 TLS states) — mitigated by DoD explicitly requiring every combination to be tested, not just the happy path.

#### 📎 References
- `portal_domains` schema: FF-EPIC-09. Design system: `@fuzefront/design-system`.

---

### 📖 Story: Custom domains ship behind a default-OFF feature flag

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-16-S4 |
| **Parent Epic** | FF-EPIC-16 — Self-Service Custom Domains |
| **Priority** | Medium |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 4 (2 BE + 2 QA) |
| **Tech Layers** | Backend |

#### 🧑‍💼 User Story
> As the **platform**, I want to **gate self-service custom domains behind
> `fuzefront.platform.portal-domains`, default OFF** so that **it can be rolled out once the FuzeInfra
> dependency is confirmed working, without affecting existing fixed-host portals**.

#### 📌 Background & Context
Standard flag-wrapping per the repo convention: default OFF, gates server logic, tested in both states.
Particularly important here since this epic depends on an external FuzeInfra capability that may not be
stable at first rollout.

#### ✅ Acceptance Criteria
1. **Given** the flag is OFF **When** any portal-domains endpoint is reached **Then** it behaves exactly as before this epic — portals remain reachable only at their existing fixed hosts.
2. **Given** the flag is ON for a specific portal **When** that portal's admin accesses the domains UI **Then** the full add/verify/TLS flow (S1–S3) is available.
3. **Edge case:** **Given** the flag is toggled ON for a portal that already has `portal_domains` rows from earlier manual/staging testing **When** the flag flips **Then** those rows are picked up and rendered correctly, not re-created.
4. **Error case:** **Given** the FuzeInfra TLS-issuance mechanism is unavailable **When** a portal with the flag ON attempts to add a custom domain **Then** the failure is surfaced clearly in the UI (per S3 AC4) and does not affect the portal's existing fixed-host routing.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Unit tests written and passing for both flag states
- [ ] Flag registered in Unleash under the `fuzefront.platform.*` taxonomy with an owner + removal criterion
- [ ] PM verified all Acceptance Criteria on staging
- [ ] Deployed to staging and smoke-tested

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| Backend | Flag wiring (server + client), default OFF, gates all portal-domains endpoints | 2 | Open |
| QA | Both-states test (OFF = existing fixed-host behavior unchanged; ON = full self-service flow) | 2 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-16-S1 through S3 (the flag gates the whole epic's surface area).

#### ⚠️ Risks & Assumptions
- **Assumption:** `@fuzefront/feature-flags` client is already wired into the backend from prior flag work (e.g. FF-EPIC-09's master flag).
- **Risk:** None beyond the epic's general FuzeInfra dependency, already called out at S2.

#### 📎 References
- Feature-flags skill: `.claude/skills/feature-flags/`. Unleash taxonomy: `fuzefront.platform.portal-domains`.
