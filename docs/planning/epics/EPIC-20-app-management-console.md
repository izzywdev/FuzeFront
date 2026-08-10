---
key: FF-EPIC-20
title: App Management Console — list, detail/settings, and installations admin UI
label: [fuzefront, platform, design-system-first, permit-gated, needs-jira-upload]
github: TBD
status: ready
priority: High
domain: Frontend / Platform
---

## 🎯 Epic: App Management Console

| Field | Value |
|-------|-------|
| **Epic ID** | FF-EPIC-20 |
| **Domain** | Frontend / Platform |
| **Priority** | High |
| **Owner** | Orchestrator (design via `product-designer`, build via `frontend-engineer`, API gaps via `backend-engineer`) |
| **Target Release** | Next deploy window |
| **Effort Estimate** | L |
| **GitHub** | TBD (no issue yet) |

---

### 📌 Problem Statement
> The app-registry backend exists (`backend/applications/src/app-registry/` — register/activate/suspend,
> list/get with BOLA + visibility filtering, manifest schema) and app scope-levels/installations landed
> on master (migration `017_app_scope_levels_and_installations`), but there is **no admin UI to manage
> apps**. The frontend has only `frontend/src/platform/appRegistry.tsx` — a read-only menu of activated
> apps. An operator cannot, from the UI, see the full list of registered apps, edit an app's
> settings/attributes, drive its lifecycle, or view/manage where it is installed. This is a gap between
> FF-EPIC-04 (which owns register→activate and the shell menu) and FF-EPIC-14 (which owns per-portal
> *catalog curation*, i.e. which apps appear in a portal) — neither delivers a full app detail/settings/
> installations management surface.

### 🎯 Goal
> A platform admin can, from a design-system-first console: list and search all apps with their lifecycle
> state and visibility; open an app to view and edit its settings/attributes and drive its lifecycle
> (activate/suspend); and view and manage the app's installations/scopes — all Permit-gated and
> fail-closed, against the existing app-registry + installations APIs (with any missing API surfaced as a
> `backend-engineer` sub-task, contract-first).

### 👥 Target Personas
- **Platform Admin** — root FuzeFront staff who governs the global app catalog: registers/curates apps,
  edits their settings/attributes, drives lifecycle, and manages installations.
- **App Owner (org admin)** — manages the apps their organization owns (settings/attributes/installations)
  within the BOLA/Permit boundary — never another org's apps.

### ✅ Features In Scope
- [ ] Feature 1: **App list view** — all apps the caller may see (BOLA/Permit-filtered), with lifecycle
      state (`registered`/`activated`/`suspended`), visibility, owning org, search/filter, paginated.
- [ ] Feature 2: **App detail + settings/attributes editor** — view/edit an app's manifest-backed
      settings and attributes (display name, icon, visibility, routing/entry, config), plus lifecycle
      actions (activate/suspend), Permit-gated, with optimistic-safe validation and error states.
- [ ] Feature 3: **Installations/scopes management** — view and manage where an app is
      installed/scoped (orgs/portals + scope level), leveraging the existing app scope-levels/
      installations backend; add/remove an installation, fail-closed on authz.
- [ ] Feature 4: **Design-first frames** — `design/frames/app-management/**` (the source-of-truth spec)
      declaring the flows, screens, states (loading/empty/error/permission-denied), and build inventory,
      approved before any UI is written.
- [ ] Feature 5: **Independent e2e** — Playwright against the approved frames (RED-first) as the pre-prod
      gate; console-clean runtime validation.

### 🚫 Out of Scope
- **Per-portal catalog curation** (which apps appear in a given portal) — FF-EPIC-12 (backend) +
  FF-EPIC-14-S3 (portal-admin console UI).
- **Register→activate "Add application" flow + shell app menu** — FF-EPIC-04.
- **App marketplace / approval workflow** — future epic.
- **App-level billing/metering** — FF-EPIC-15 / separate.

### 🏗️ High-Level Architecture Notes
> Design-first: `product-designer` authors `design/frames/app-management/**` (index + ordered screens +
> `tokens.css` + `manifest.json`) declaring the build inventory; merging the approved frames triggers
> RED Playwright specs, then the `frontend-engineer` build. UI is a design-system-first private UI
> package (no raw hex/spacing/type — extend `@fuzefront/design-system`). The console drives the existing
> `backend/applications/src/app-registry` list/get/lifecycle API and the app scope-levels/installations
> API (migration 017); any missing read/write endpoint (e.g. an app-settings PATCH or an installations
> list/mutate route) is added contract-first by `backend-engineer` as a sub-task — Permit-gated, BOLA-safe,
> paginated per `governance/pagination-standard.md`, and rate-limited. Real authorization stays in Permit;
> the app list/detail/installations reads reuse the app-registry's existing BOLA filter so an app owner
> never sees another org's apps. No new tenancy model — this is an admin surface over existing data.

### 📊 Success Metrics
| Metric | Current Baseline | Target |
|--------|-----------------|--------|
| UI to list all apps with lifecycle state | None (read-only menu of activated apps) | Yes — searchable, paginated, BOLA-filtered |
| UI to edit an app's settings/attributes + drive lifecycle | None | Yes — Permit-gated, validated, with error states |
| UI to view/manage an app's installations/scopes | None | Yes — fail-closed on authz |
| Cross-org app visibility leak (org A edits/sees org B's app) | N/A (no UI) | 0 — reuses the app-registry BOLA filter |

### 📋 Child Stories
| Story ID | Summary | Status |
|----------|---------|--------|
| FF-EPIC-20-S1 | App-management design frames (design-first, source of truth) | Open |
| FF-EPIC-20-S2 | App list view (search/filter, lifecycle, paginated, BOLA-filtered) | Open |
| FF-EPIC-20-S3 | App detail + settings/attributes editor + lifecycle actions | Open |
| FF-EPIC-20-S4 | Installations/scopes management | Open |
| FF-EPIC-20-S5 | Independent Playwright e2e + console-clean runtime validation | Open |

### 🔗 Dependencies
- **Blocked By:** — (the app-registry + installations backend already exist on master).
- **Blocks:** — (this is an admin surface; nothing depends on it).
- **Related:** FF-EPIC-04 (register/activate + shell menu), FF-EPIC-12 (per-portal catalog),
  FF-EPIC-14 (admin consoles — portal-admin catalog curation); existing frames
  `design/frames/federated-apps/` (the Add-application flow, distinct from this management console).

### 📎 References
- App registry: `backend/applications/src/app-registry/service.ts` (`list`/`canRead`/lifecycle),
  `manifest.schema.ts`.
- Installations/scopes: `backend/src/migrations/017_app_scope_levels_and_installations.ts`.
- Read-only precedent: `frontend/src/platform/appRegistry.tsx`.
- Design-first pipeline: `docs/planning/design-first-ui-pipeline.md`; frame precedent:
  `design/frames/portal-admin-consoles/`, `design/frames/federated-apps/`.

---

## Stories

### 📖 Story: App-management design frames are authored and approved

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-20-S1 |
| **Parent Epic** | FF-EPIC-20 — App Management Console |
| **Priority** | High |
| **Tech Layers** | Design |

#### 🧑‍💼 User Story
> As a **Platform Admin**, I want **approved, navigable design frames for the app-management console** so
> that **the app list, detail/settings, and installations UI is specified and gated before any code is
> written** (per the design-first pipeline).

#### 📌 Background & Context
`product-designer` is the sole author of `design/frames/app-management/**`. Merging the approved frames is
the gate that triggers the RED Playwright specs and the `frontend-engineer` build. Frames must show the
real states (loading, empty, error, permission-denied), not only the happy path.

#### ✅ Acceptance Criteria
1. **Given** the app-management requirement **When** `product-designer` authors the frames **Then**
   `design/frames/app-management/` exists (`index.html` + ordered `01-*.html` screens + `tokens.css` +
   `manifest.json`) covering the three flows (list, detail/settings, installations) and passes
   `gate-ds-conformance`, `gate-frames-schema`, `gate-frames-stamped`.
2. **Given** the frames **When** reviewed **Then** each flow shows loading, empty, error, and
   permission-denied states — not only the happy path — and the manifest declares the build inventory
   (flows / React components / npm packages).
3. **Edge case:** **Given** an app in `suspended` state and an app with no editable settings **When**
   framed **Then** both are represented (disabled/limited actions), not assumed always-editable.
4. **Error case:** **Given** a caller without Permit authority on an app **When** framed **Then** a
   permission-denied state is shown (no edit affordances), matching the fail-closed API behavior.

#### 📋 Sub-Tasks
| Type | Summary | Points |
|------|---------|--------|
| UX/UI | Author `design/frames/app-management/**` (3 flows + states + build inventory) | 8 |
| UX/UI | Frames-only PR + design-first CI gates green; owner approval per flow | 2 |

---

### 📖 Story: App list view

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-20-S2 |
| **Parent Epic** | FF-EPIC-20 — App Management Console |
| **Priority** | High |
| **Tech Layers** | Frontend (+ Backend if a list gap exists) |

#### 🧑‍💼 User Story
> As a **Platform Admin**, I want **a searchable, paginated list of all apps I'm allowed to see, with
> their lifecycle state, visibility, and owning org** so that **I can find and open any app to manage it**.

#### ✅ Acceptance Criteria
1. **Given** apps exist **When** I open the console **Then** I see a paginated list (per
   `governance/pagination-standard.md`) filtered by the app-registry BOLA rules — I never see an app I
   have no authority over.
2. **Given** the list **When** I search/filter by name/state/visibility **Then** results update
   accordingly, with an explicit empty state when nothing matches.
3. **Edge case:** **Given** a very large catalog **When** I page through **Then** the cursor walks the
   full set deterministically (no duplicates/skips).
4. **Error case:** **Given** the list request fails **When** it errors **Then** an error state with retry
   is shown, never a blank/hung screen (console-clean).

#### 📋 Sub-Tasks
| Type | Summary | Points |
|------|---------|--------|
| Frontend | App list UI (design-system-first), search/filter, pagination, states | 8 |
| Backend | (if needed) list/query params the UI requires, Permit-gated + paginated | 4 |
| QA | List + BOLA-filter + pagination + empty/error state tests | 4 |

---

### 📖 Story: App detail + settings/attributes editor + lifecycle

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-20-S3 |
| **Parent Epic** | FF-EPIC-20 — App Management Console |
| **Priority** | High |
| **Tech Layers** | Full-Stack |

#### 🧑‍💼 User Story
> As a **Platform Admin / App Owner**, I want **to open an app and view/edit its settings and attributes
> (display name, icon, visibility, routing/entry, config) and drive its lifecycle (activate/suspend)** so
> that **I can manage an app without direct DB access**.

#### ✅ Acceptance Criteria
1. **Given** an app I'm authorized to manage **When** I edit a setting/attribute and save **Then** the
   change persists via a Permit-gated API and the detail view reflects it; validation errors are shown
   inline (no silent drop).
2. **Given** a `registered` app **When** I activate it **Then** it transitions to `activated` (and the
   reverse for suspend), reflected without a full reload; built-ins (e.g. Clock) are non-deletable.
3. **Edge case:** **Given** an app with no editable settings or in a state where an action is invalid
   **When** viewed **Then** the affordance is disabled/hidden, not a broken save.
4. **Error case:** **Given** I lack Permit authority on the app **When** I open detail **Then** it's
   read-only / permission-denied (fail-closed), never an edit form that 403s only on save.

#### 📋 Sub-Tasks
| Type | Summary | Points |
|------|---------|--------|
| Backend | App settings/attributes read + PATCH (contract-first), Permit-gated, BOLA-safe, rate-limited | 8 |
| Frontend | App detail + settings/attributes editor + lifecycle actions (states, validation) | 8 |
| QA | Edit/save + lifecycle + permission-denied + validation-error tests | 4 |

---

### 📖 Story: Installations / scopes management

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-20-S4 |
| **Parent Epic** | FF-EPIC-20 — App Management Console |
| **Priority** | Medium |
| **Tech Layers** | Full-Stack |

#### 🧑‍💼 User Story
> As a **Platform Admin**, I want **to view and manage where an app is installed/scoped (orgs/portals +
> scope level)** so that **I can control an app's reach without editing the database directly**.

#### ✅ Acceptance Criteria
1. **Given** an app **When** I open its installations tab **Then** I see its current installations/scopes
   (org/portal + scope level), paginated, Permit-filtered.
2. **Given** authority **When** I add or remove an installation **Then** it persists via a Permit-gated
   API, reflected in the list; idempotent add (no duplicate installation rows).
3. **Edge case:** **Given** an installation targeting a suspended/removed portal or org **When** listed
   **Then** it's shown with a clear status rather than a crash/blank.
4. **Error case:** **Given** I lack authority to change an installation **When** I try **Then** the action
   is denied fail-closed (403), no partial state.

#### 📋 Sub-Tasks
| Type | Summary | Points |
|------|---------|--------|
| Backend | Installations list + add/remove (contract-first), Permit-gated, paginated, rate-limited | 8 |
| Frontend | Installations/scopes management UI (states) | 8 |
| QA | Installations list + add/remove idempotency + authz-denied tests | 4 |

---

### 📖 Story: Independent e2e + console-clean runtime validation

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-20-S5 |
| **Parent Epic** | FF-EPIC-20 — App Management Console |
| **Priority** | High |
| **Tech Layers** | QA |

#### 🧑‍💼 User Story
> As a **release manager**, I want **independent Playwright e2e proving the app list/detail/settings/
> installations flows work against the approved frames, plus a console-clean runtime pass** so that **the
> console is verified end-to-end, not just unit-tested**.

#### ✅ Acceptance Criteria
1. **Given** the approved frames **When** the RED specs are written first **Then** they fail before the
   implementation exists and go green as each flow is built.
2. **Given** the built UI **When** rendered in real Chromium (Chrome DevTools MCP) **Then** the console is
   clean — 0 errors, 0 CSP/mixed-content violations, 0 failed app requests, or each remaining message
   explained (the `ui-runtime-validation` gate).
3. **Edge case:** **Given** the permission-denied and error states **When** e2e runs **Then** they are
   asserted, not only the happy path.
4. **Error case:** **Given** a runtime console error **When** found **Then** it is reported as a bug, never
   patched by QA.

#### 📋 Sub-Tasks
| Type | Summary | Points |
|------|---------|--------|
| QA | RED-first Playwright specs per flow against the approved frames | 8 |
| QA | Console-clean runtime validation (Chrome DevTools MCP) pre/post-prod | 4 |
