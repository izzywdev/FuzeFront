---
key: FF-EPIC-04
title: Federated App Platform implementation (registry API + menu substitution + built-in Clock + register→activate e2e + standalone)
label: [fuzefront, platform, design-system-first, contract-first, paginated, permit-gated]
github: https://github.com/izzywdev/FuzeFront/issues/122
status: ready
priority: Critical
domain: Platform
---

## 🎯 Epic: Federated App Platform implementation

| Field | Value |
|-------|-------|
| **Epic ID** | FF-EPIC-04 |
| **Domain** | Platform |
| **Priority** | Critical |
| **Owner** | Orchestrator (fan-out vs merged contract #107: backend/frontend/devops/frontend-test) |
| **Target Release** | Next deploy window |
| **Effort Estimate** | XL |
| **GitHub** | [#122](https://github.com/izzywdev/FuzeFront/issues/122) |

---

### 📌 Problem Statement
> The App Manifest + app-registry OpenAPI + Kafka `app.*` schemas + `@fuzefront/app-registry-client` + the
> HTML approval frames are merged on master (PR #107) and the frames are **approved**, but the platform
> behind the contract is unbuilt: there is no registry/lifecycle API, no app menu, no register→activate
> flow, no menu substitution, no built-in Clock, and no standalone mode. The host shell cannot yet mount
> federated apps, which is FuzeFront's core value proposition.

### 🎯 Goal
> A federated app can be registered from its manifest, activated, and appear in the app menu (e.g.
> "FuzeMarket" → "Market"); the built-in Clock ships out of the box; apps can substitute the side menu
> or run standalone — all against the frozen #107 contract.

### 👥 Target Personas
- **End user** — picks federated apps from the app menu and uses them inside the portal.
- **App developer** — registers an app via its manifest and sees it activate in the shell.
- **Platform operator** — relies on the lifecycle state machine + events for governance.

### ✅ Features In Scope
- [ ] Feature 1: app-registry backend — register-from-manifest, lifecycle state machine (`registered → activated → suspended`), list/get with visibility/role filtering, emit Kafka `app.registered/activated/suspended/heartbeat`, persist manifest (migration), Permit-scoped + BOLA + paginated; built-ins (Clock) non-deletable.
- [ ] Feature 2: shell app menu (icon + label for registered+activated apps) + "Add application" register→activate flow.
- [ ] Feature 3: menu substitution (federated app takes over the side menu) with a host-owned, non-removable "return to portal" control.
- [ ] Feature 4: standalone (non-portal) mode routing for apps that opt out of portal chrome.
- [ ] Feature 5: built-in Clock federated remote module (slug `clock`, label "Clock") shipped + deployed.
- [ ] Feature 6: E2E — register "FuzeMarket" → appears as "Market" → activate → load; Playwright against the approved frames as the pre-prod gate.

### 🚫 Out of Scope
- Changing the App Manifest contract — it is frozen (#107); amend the contract PR if found wrong, never diverge.
- Building actual third-party apps beyond the built-in Clock + the FuzeMarket e2e fixture.
- Per-product authn/authz provisioning — that is FF-EPIC-05 (plugs into the manifest `auth` section).

### 🏗️ High-Level Architecture Notes
> Contract-first against merged #107. Backend uses the generated `@fuzefront/app-registry-client` types as
> the single source of App/Manifest types (deprecate the duplicated frontend `App` type). Module-Federation
> host shell mounts remotes; same-origin API base; Permit-gated; paginated lists. Clock ships as a real
> federated remote (devops: image in release matrix + Helm/Argo, or static-host the remote).

### 📊 Success Metrics
| Metric | Current Baseline | Target |
|--------|-----------------|--------|
| Federated apps mountable in shell | 0 | register→activate→load works e2e |
| Built-in Clock present out of the box | No | Yes (seeded, non-deletable) |
| Duplicated frontend `App` type | Present | Removed (single client type) |
| Playwright pre-prod gate vs approved frames | None | Green |

### 📋 Child Stories
| Story ID | Summary | Status |
|----------|---------|--------|
| FF-EPIC-04-S1 | app-registry backend: register + lifecycle + events | Open |
| FF-EPIC-04-S2 | App menu + register→activate flow (single client type) | Open |
| FF-EPIC-04-S3 | Menu substitution + return-to-portal control | Open |
| FF-EPIC-04-S4 | Standalone (non-portal) mode routing | Open |
| FF-EPIC-04-S5 | Built-in Clock federated remote + deploy | Open |
| FF-EPIC-04-S6 | E2E register→"Market"→activate + frames pre-prod gate | Open |

### 🔗 Dependencies
- **Blocked By:** PR #107 merged (DONE — contract frozen).
- **Related:** FF-EPIC-05 (manifest `auth` section is the integration seam for per-product authn/authz).

### 📎 References
- GitHub issue: https://github.com/izzywdev/FuzeFront/issues/122
- Merged contract PR #107; approved frames `design/frames/federated-apps/`; `@fuzefront/app-registry-client`

---

## Stories

### 📖 Story: Platform can register an app and drive its lifecycle

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-04-S1 |
| **Parent Epic** | FF-EPIC-04 — Federated App Platform |
| **Priority** | Critical |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 24 (8 BE-routes + 8 BE-events + 4 DB + 4 QA) |
| **Tech Layers** | Backend + Data tier |

#### 🧑‍💼 User Story
> As an **app developer**, I want to **register my app from its manifest and have it move through
> `registered → activated → suspended`** so that **the platform can govern and surface my app**.

#### 📌 Background & Context
Implements the `/api/v1/app-registry` routes against the frozen #107 contract: register-from-manifest,
the lifecycle state machine, list/get with visibility/role filtering, Kafka `app.*` events, manifest
persistence (migration). Built-ins (Clock) are non-deletable.

#### ✅ Acceptance Criteria
1. **Given** a valid app manifest **When** POSTed to register **Then** the app is persisted in `registered` state and an `app.registered` Kafka event is emitted.
2. **Given** a registered app **When** activated **Then** it transitions to `activated`, emits `app.activated`, and appears in list/get filtered by visibility/role.
3. **Edge case:** **Given** the built-in Clock **When** a delete is attempted **Then** it is rejected (built-ins non-deletable).
4. **Error case:** **Given** an invalid lifecycle transition (e.g. `suspended → registered`) or a manifest failing contract validation **When** attempted **Then** it returns 400/409 with a typed error and emits no event.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Backend unit tests passing, coverage ≥ 80%
- [ ] Routes match the frozen #107 OpenAPI; events match the `app.*` Zod schemas
- [ ] Migration ordered + idempotent; Permit-scoped + BOLA + paginated (`gate-pagination`)
- [ ] Built-ins seeded + non-deletable (verified)

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| Backend | `/api/v1/app-registry` register/get/list (visibility+role filter) + lifecycle state machine | 8 | Open |
| Backend | Emit `app.registered/activated/suspended/heartbeat` Kafka events | 8 | Open |
| Backend | Manifest persistence migration + Clock seed (non-deletable) | 4 | Open |
| QA | Unit tests: register, transitions, invalid transition, built-in delete-guard | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** #107 (merged). **Blocks:** S2, S6.

#### ⚠️ Risks & Assumptions
- **Assumption:** Kafka + the `app.*` Zod schemas from #107 are available.
- **Risk:** Lifecycle/event drift → validate strictly against the frozen schemas (drift = test fail).

#### 📎 References
- #107 contract; `@fuzefront/app-registry-client`.

---

### 📖 Story: User can add and activate an app from the app menu

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-04-S2 |
| **Parent Epic** | FF-EPIC-04 — Federated App Platform |
| **Priority** | Critical |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 20 (4 UX + 8 FE + 4 FE-types + 4 QA) |
| **Tech Layers** | Frontend |

#### 🧑‍💼 User Story
> As an **end user**, I want **the app menu to show registered+activated apps and an "Add application"
> flow to register→activate** so that **I can discover and enable federated apps from the shell**.

#### 📌 Background & Context
Renders the app menu (icon + label) bound to `@fuzefront/app-registry-client`, with the register→activate
flow. The duplicated frontend `App` type is removed in favor of the generated client type.

#### ✅ Acceptance Criteria
1. **Given** activated apps **When** the user opens the app menu **Then** each shows its icon + label (e.g. "Market" for a FuzeMarket manifest).
2. **Given** the "Add application" flow **When** the user registers then activates an app **Then** it appears in the menu without a full reload.
3. **Edge case:** **Given** no activated apps **When** the menu opens **Then** an empty state with the "Add application" CTA is shown.
4. **Error case:** **Given** registration fails validation **When** submitted **Then** an inline error from the typed client response is shown — never a silent no-op.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] RTL + a11y tests passing, coverage ≥ 80%
- [ ] Bound to `@fuzefront/app-registry-client`; duplicated `App` type removed
- [ ] `gate-ds-conformance` green (fuse-seam tokens)
- [ ] Matches the approved frames

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| UX Task | App-menu + add-application design vs approved frames + fuse-seam tokens | 4 | Open |
| Frontend | App menu render + register→activate flow (mock server from contract) | 8 | Open |
| Frontend | Replace duplicated `App` type with the generated client type | 4 | Open |
| QA | RTL: menu render, add-flow, empty, error states | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** #107 (client). Builds against a contract mock; not blocked on S1.

#### ⚠️ Risks & Assumptions
- **Assumption:** Approved frames at `design/frames/federated-apps/` are the UI source of truth.
- **Risk:** Type-removal ripples → coordinate the single client type across menu + substitution.

#### 📎 References
- Approved frames; `@fuzefront/app-registry-client`.

---

### 📖 Story: A federated app can substitute the side menu with a guaranteed return to portal

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-04-S3 |
| **Parent Epic** | FF-EPIC-04 — Federated App Platform |
| **Priority** | High |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 16 (4 UX + 8 FE + 4 QA) |
| **Tech Layers** | Frontend |

#### 🧑‍💼 User Story
> As an **end user**, I want **a federated app to take over the side menu while always giving me a way back
> to the portal** so that **immersive apps work without trapping me**.

#### 📌 Background & Context
Menu substitution lets an activated app own the side menu; the host injects a non-removable
"return to portal" control so the user is never stranded.

#### ✅ Acceptance Criteria
1. **Given** an app that requests menu substitution **When** it is active **Then** the side menu is replaced by the app's menu plus a host-owned "return to portal" control.
2. **Given** the user clicks "return to portal" **When** invoked **Then** the host menu is restored and the user is back in portal chrome.
3. **Edge case:** **Given** an app tries to hide/remove the return control **When** rendered **Then** the control remains (host-owned, non-removable).
4. **Error case:** **Given** the substituting app fails to load its menu **When** mounting **Then** the host falls back to the portal menu with an error toast — never a blank navigation.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] RTL + a11y tests passing (incl. return-control persistence)
- [ ] `gate-ds-conformance` green
- [ ] Matches approved frames
- [ ] Return-to-portal verified non-removable

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| UX Task | Substitution + return-control design vs frames | 4 | Open |
| Frontend | Menu-substitution mechanism + host-owned return control + fallback | 8 | Open |
| QA | RTL: substitution, return, non-removable guard, load-failure fallback | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** S2 (app menu).

#### ⚠️ Risks & Assumptions
- **Assumption:** Remotes expose a menu contract per the manifest.
- **Risk:** App escapes the chrome → host owns the return control absolutely.

#### 📎 References
- Approved frames; Module-Federation host shell.

---

### 📖 Story: Apps can run in standalone (non-portal) mode

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-04-S4 |
| **Parent Epic** | FF-EPIC-04 — Federated App Platform |
| **Priority** | Medium |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 12 (8 FE + 4 QA) |
| **Tech Layers** | Frontend |

#### 🧑‍💼 User Story
> As an **app developer**, I want **my app to run in standalone mode using FuzeFront infra (auth/billing/api)
> but without portal chrome** so that **landing pages and full-bleed apps render cleanly**.

#### 📌 Background & Context
Supports `mode: standalone` manifest apps that opt out of portal chrome while still using platform infra.

#### ✅ Acceptance Criteria
1. **Given** a `mode: standalone` app **When** routed to **Then** it renders without portal chrome (no side menu/header) while retaining auth/billing/api access.
2. **Given** a standalone app needs auth **When** an unauthenticated user lands **Then** they are sent through the platform auth flow and back.
3. **Edge case:** **Given** a standalone route under deep-link **When** loaded directly **Then** it renders standalone (does not flash portal chrome first).
4. **Error case:** **Given** a standalone app fails to mount **When** loading **Then** a standalone error page is shown (no broken portal shell).

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] RTL tests passing (standalone render, auth round-trip, deep-link, error)
- [ ] `gate-ds-conformance` green
- [ ] Same-origin API base retained in standalone mode

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| Frontend | Standalone routing/layout (no chrome) + infra access wiring | 8 | Open |
| QA | RTL: standalone render, auth round-trip, deep-link, mount-failure | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** S1 (manifest `mode`), S2 (app routing).

#### ⚠️ Risks & Assumptions
- **Assumption:** Manifest carries a `mode` field per #107.
- **Risk:** Chrome flash on deep-link → resolve mode before first paint.

#### 📎 References
- #107 manifest `mode`.

---

### 📖 Story: Built-in Clock app ships and appears in the menu out of the box

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-04-S5 |
| **Parent Epic** | FF-EPIC-04 — Federated App Platform |
| **Priority** | Medium |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 16 (8 FE-remote + 4 DevOps + 4 QA) |
| **Tech Layers** | Frontend + DevOps |

#### 🧑‍💼 User Story
> As an **end user**, I want **a built-in Clock app present in the app menu out of the box** so that **the
> federated-app platform demonstrates value with zero setup**.

#### 📌 Background & Context
Ships a real federated remote module for the seeded `clock` manifest (slug `clock`, label "Clock") and
deploys it (image in release matrix + Helm/Argo, or static-host the remote).

#### ✅ Acceptance Criteria
1. **Given** a fresh install **When** the app menu opens **Then** the built-in "Clock" app is present and activated by default.
2. **Given** the Clock app is selected **When** loaded **Then** the federated remote module mounts and renders a working clock.
3. **Edge case:** **Given** the Clock remote is temporarily unavailable **When** selected **Then** a graceful "app unavailable" state is shown (menu still works).
4. **Error case:** **Given** an attempt to delete the built-in Clock **When** made **Then** it is rejected (built-in non-deletable, ties to S1).

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Clock remote builds + mounts via Module Federation
- [ ] Deployed via GitOps (image in release matrix or static-hosted + Helm/Argo)
- [ ] Seeded as non-deletable built-in (with S1)
- [ ] `gate-ds-conformance` green on the Clock UI

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| Frontend | Build Clock federated remote module (fuse-seam tokens) | 8 | Open |
| DevOps | Deploy Clock remote (release matrix/Helm/Argo or static host) | 4 | Open |
| QA | E2E: Clock present + mounts; unavailable state | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** S1 (seed + non-deletable), S2 (menu).

#### ⚠️ Risks & Assumptions
- **Assumption:** Module-Federation remote hosting is available locally + prod.
- **Risk:** Remote URL under TLS/ingress → same-origin/relative remote entry.

#### 📎 References
- Seeded `clock` manifest; Module-Federation host shell.

---

### 📖 Story: E2E proves register→"Market"→activate and frames are the pre-prod gate

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-04-S6 |
| **Parent Epic** | FF-EPIC-04 — Federated App Platform |
| **Priority** | High |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 16 (8 e2e-flow + 8 e2e-frames) |
| **Tech Layers** | Frontend test (independent) |

#### 🧑‍💼 User Story
> As a **release manager**, I want **independent Playwright e2e proving a new app (FuzeMarket → "Market")
> registers→activates→loads, plus Playwright against the approved frames** so that **the platform is
> verified by someone other than the implementer before merge**.

#### 📌 Background & Context
Independent verification (frontend-test-engineer) — register a FuzeMarket fixture, confirm it appears as
"Market", activate and load it; and run Playwright against the approved frames at
`design/frames/federated-apps/` as the pre-prod merge gate.

#### ✅ Acceptance Criteria
1. **Given** a FuzeMarket manifest fixture **When** the e2e registers + activates it **Then** it appears in the app menu as "Market" and loads.
2. **Given** the approved frames **When** Playwright runs against them **Then** the implemented UI matches the frames as the pre-prod gate (gate fails on drift).
3. **Edge case:** **Given** a re-run **When** the same app is registered twice **Then** the e2e asserts idempotent/duplicate handling (no double menu entry).
4. **Error case:** **Given** activation fails **When** the e2e drives it **Then** the test asserts the UI surfaces the error (not a silent pass).

#### 🔲 Definition of Done
- [ ] Independent e2e authored by frontend-test-engineer (not the implementer)
- [ ] register→"Market"→activate→load passes
- [ ] Playwright-against-frames pre-prod gate green
- [ ] Wired into CI as a merge gate
- [ ] Post-prod smoke variant noted for after deploy

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| QA | Playwright e2e: register FuzeMarket → "Market" → activate → load (+ duplicate, error) | 8 | Open |
| QA | Playwright against approved frames as pre-prod gate + CI wiring | 8 | Open |

#### 🔗 Dependencies
- **Blocked By:** S1, S2 (and S3/S5 for full coverage). Runs after frontend-engineer.

#### ⚠️ Risks & Assumptions
- **Assumption:** Frames are stable + approved (they are, per #107).
- **Risk:** Flaky federated-remote loading in e2e → deterministic fixtures + waits.

#### 📎 References
- `design/frames/federated-apps/`; Playwright-against-frames standard (#108).
