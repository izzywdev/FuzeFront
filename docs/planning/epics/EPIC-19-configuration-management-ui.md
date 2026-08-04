---
key: FF-EPIC-19
title: Configuration Management UI — the settings editor and key-catalog console
label: [fuzefront, platform, config-management, design-system-first, design-first, permit-gated, needs-jira-upload]
github: TBD
status: ready
priority: High
domain: Platform
---

## 🎯 Epic: Configuration Management UI

| Field | Value |
|-------|-------|
| **Epic ID** | FF-EPIC-19 |
| **Domain** | Platform |
| **Priority** | High |
| **Owner** | Orchestrator (delegated to `product-designer` → `frontend-test-engineer` → `frontend-engineer`) |
| **Target Release** | Next deploy window (post FF-EPIC-17) |
| **Effort Estimate** | M |

---

### 📌 Problem Statement
> FF-EPIC-17 and FF-EPIC-18 deliver a complete configuration backend reachable only by `curl`. That is
> precisely the failure the design-first pipeline was created to catch — six Security backends shipped
> with no UI and nothing flagged it. A configuration service with no editor is worse than most: its
> entire purpose is to let non-engineers change settings, so an API-only config service delivers none
> of its value. And the hardest parts of this UI are not the inputs — they are communicating *why* a
> setting has its value and *why* some settings cannot be changed, which is invisible in a plain form.

### 🎯 Goal
> Users and admins manage configuration through an editor that shows, for every setting, where its value
> came from, whether it is inherited, whether an ancestor scope has locked it, and what values are valid
> — with system-hidden keys absent entirely, and every state (loading, empty, invalid, locked, conflicted)
> designed rather than improvised.

**DESIGN-FIRST:** per the FuzeFront design-first gate, `product-designer` authors the frames (S1) as a
frames-ONLY PR before any implementation story starts. Merging the approved frames PR is what triggers
S2's RED specs and the S3–S5 build. S1 blocks S2, S3, S4 and S5.

### 👥 Target Personas
- **End User** — edits personal preferences and understands which are inherited or locked.
- **Org Admin** — sets org defaults and sees what the portal above has locked.
- **Portal Admin (super-tenant)** — sets and locks values for the orgs beneath them.
- **Platform Admin** — inspects the whole key catalog, including system and hidden keys.
- **Compliance Reviewer** — reads a setting's change history.

### ✅ Features In Scope
- [ ] Feature 1: Designer frames for the settings editor and key-catalog console covering every state (`design/frames/config-management/**`).
- [ ] Feature 2: RED Playwright specs per approved flow, failing before any implementation exists.
- [ ] Feature 3: `@fuzefront/config-ui` — the settings editor: scope switcher, typed inputs, inheritance badges, locked state, reset-to-inherited.
- [ ] Feature 4: Admin key-catalog view — definitions, system/hidden keys, diff-against-parent.
- [ ] Feature 5: Secret-input and audit-history surfaces.
- [ ] Feature 6: Console-clean runtime validation and post-prod e2e smoke.

### 🚫 Out of Scope
- Any backend behaviour — FF-EPIC-17 and FF-EPIC-18 own it. QA **reports** runtime bugs here, never patches them.
- Import/export and preset *UI* — the API ships in FF-EPIC-18; surfacing it is a follow-up once the core editor is proven.
- Per-app embedded settings panels inside federated remotes — this epic ships the host-shell console; remotes consuming `@fuzefront/config-ui` is a later concern.

### 🏗️ High-Level Architecture Notes
> A new private package `@fuzefront/config-ui`, built design-system-first on `@fuzefront/design-system`
> primitives with no raw hex/spacing/type, consuming the frozen `@fuzefront/config-client` from
> FF-EPIC-17-S1.
>
> **Provenance is the UI.** The editor is not a form over key/value pairs — it is a form over
> *resolved entries*, each carrying `source`, `locked` and `editable`. Every input renders one of:
> "set here", "inherited from <scope>", or "locked by <scope>". A build that ignores provenance
> produces a form that looks right and lies about where values come from.
>
> **Hidden means absent.** `is_hidden` keys must never reach the browser, so the editor filters nothing
> client-side — the API omits them (FF-EPIC-17-S5 AC3). The UI must not have a code path that could
> render one.
>
> **The UI is not the authorization boundary.** Permit decides who may write at a scope; the editor
> reflects that decision by disabling inputs. A disabled input is a courtesy, never a control — the
> server refuses the write regardless (FF-EPIC-17-S6 AC4).

### 📊 Success Metrics
| Metric | Current Baseline | Target |
|--------|-----------------|--------|
| Configuration capabilities reachable only by `curl` | 100% after EPIC-17/18 | 0 for the core editor surfaces |
| Settings shown without indicating their source | N/A | 0 — every entry shows set/inherited/locked |
| Hidden keys reaching the browser | N/A | 0 |
| Playwright specs written RED before implementation | N/A | 100% of flows |
| Console errors / CSP violations on the config console | N/A | 0 (`ui-runtime-validation`) |

### 📋 Child Stories
| Story ID | Summary | Status |
|----------|---------|--------|
| FF-EPIC-19-S1 | Designer frames for the config console (frames-ONLY PR) | Open |
| FF-EPIC-19-S2 | RED Playwright specs per approved flow | Open |
| FF-EPIC-19-S3 | `@fuzefront/config-ui` settings editor | Open |
| FF-EPIC-19-S4 | Admin key-catalog view + diff-against-parent | Open |
| FF-EPIC-19-S5 | Secret-input and audit-history surfaces | Open |
| FF-EPIC-19-S6 | Console-clean runtime validation + post-prod e2e | Open |

### 🔗 Dependencies
- **Blocked By:** FF-EPIC-17-S1 (contract to build against), FF-EPIC-17-S5 (read API), FF-EPIC-17-S6 (write API).
- **Blocked By (S5 only):** FF-EPIC-18-S1 (secrets), FF-EPIC-18-S2/S3 (history + revert).
- **Related:** FF-EPIC-14 (admin consoles — the config console should mount alongside, sharing shell navigation).

### 📎 References
- Design-first pipeline: `docs/planning/design-first-ui-pipeline.md`
- Frames template: `design/frames/_template/`
- UI runtime validation skill: `.claude/skills/ui-runtime-validation/`
- Design-system conformance skill: `.claude/skills/design-system-conformance/`

---

## Stories

### 📖 Story: The config console is designed before it is built

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-19-S1 |
| **Parent Epic** | FF-EPIC-19 — Configuration Management UI |
| **Priority** | High |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 8 (8 UX) |
| **Tech Layers** | UX Design |

#### 🧑‍💼 User Story
> As the **Product Owner**, I want **navigable frames for the config console that I can approve per flow**
> so that **I approve the visual model and the build inventory before implementation, rather than
> reviewing a built UI I can no longer cheaply change**.

#### 📌 Background & Context
`product-designer` — not `frontend-engineer` — authors these, exactly as `contract-designer` owns the API
spec. This is a **frames-ONLY PR**; its merge is the gate for every other story in the epic.
`gate-frames-first` fails any PR touching `frontend/src/**` or `packages/*-ui/**` without an approved
manifest covering the feature.

#### ✅ Acceptance Criteria
1. **Given** the frames PR **When** it is opened **Then** `design/frames/config-management/` contains `index.html`, ordered `NN-*.html` screens, `tokens.css` and a `manifest.json` declaring the flows, components and packages, and `gate-ds-conformance`, `gate-frames-schema` and `gate-frames-stamped` are green.
2. **Given** the frames **When** the owner reviews them **Then** each flow can be approved independently, so a ready flow never waits on an unready sibling.
3. **Edge case:** **Given** the state screens **When** they are reviewed **Then** they show **locked-by-ancestor** (read-only with badge), **inherited-from-parent**, **invalid stored value**, secret already-set (masked), empty namespace, loading and save-conflict — not only the populated happy path.
4. **Error case:** **Given** the PR **When** CI runs **Then** it contains **no** files outside `design/frames/**` — a frames PR that also carries implementation defeats the gate it exists to enforce.

#### 🔲 Definition of Done
- [ ] Frames PR contains only `design/frames/**`
- [ ] `gate-ds-conformance`, `gate-frames-schema`, `gate-frames-stamped` green
- [ ] Every state in AC3 present as a designed screen
- [ ] Build inventory (flows / components / packages) declared in `manifest.json` and rendered in `index.html`
- [ ] Owner approved per flow (`approved: true` stamped)
- [ ] Published to GitHub Pages for review

#### 📋 Sub-Tasks
| Type | Summary | Assignee | Points | Status |
|------|---------|----------|--------|--------|
| UX Design | Author `design/frames/config-management/**` — editor flow, catalog flow, and the full state set | — | 8 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-17-S1 (frames bind to the frozen contract).
- **Blocks:** FF-EPIC-19-S2, S3, S4, S5.

#### ⚠️ Risks & Assumptions
- **Assumption:** The scope switcher (platform/portal/org/user) is a single shared control across both flows.
- **Risk:** Designing only the populated editor produces UI that handles only the populated case — AC3 is the guard, and it is the acceptance criterion most likely to be quietly dropped under time pressure.

#### 📎 References
- Frames template: `design/frames/_template/manifest.json`
- Design-first plan of record: `docs/planning/design-first-ui-pipeline.md`

---

### 📖 Story: The specs are red before the UI exists

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-19-S2 |
| **Parent Epic** | FF-EPIC-19 — Configuration Management UI |
| **Priority** | High |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 8 (8 QA) |
| **Tech Layers** | QA |

#### 🧑‍💼 User Story
> As the **Orchestrator**, I want **Playwright specs written against the approved frames that all fail
> before implementation** so that **the specs measure the design rather than being retrofitted to
> whatever got built**.

#### 📌 Background & Context
Written by `frontend-test-engineer`, independent of the implementer, driven by the frames'
`testHooks[]` selectors. `tests/e2e/billing-invoices/` is the reference triad.

#### ✅ Acceptance Criteria
1. **Given** the approved frames **When** the specs are written **Then** `tests/e2e/config-management/` exists with `frames.spec.ts`, `built-component.spec.ts` and `postprod.smoke.spec.ts` mirroring the reference triad.
2. **Given** the specs before implementation **When** they run against the built component **Then** they are **all red** — a spec that passes before an implementation exists is a broken spec.
3. **Edge case:** **Given** the frames' state screens **When** the specs are written **Then** locked, inherited, invalid-value and save-conflict states are each asserted — not just the happy path.
4. **Error case:** **Given** the specs **When** they are added **Then** they are wired into CI, not merely present in the tree — an unexecuted suite is how chat accumulated 122 tests nobody ran.

#### 🔲 Definition of Done
- [ ] Specs exist for every approved flow and are RED pre-implementation
- [ ] State-screen assertions present per AC3
- [ ] Specs wired into CI and observed running
- [ ] Driven by the frames' declared `testHooks[]` selectors

#### 📋 Sub-Tasks
| Type | Summary | Assignee | Points | Status |
|------|---------|----------|--------|--------|
| QA | `tests/e2e/config-management/` triad against the approved frames, all RED, wired into CI | — | 8 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-19-S1 (approved frames to write against).
- **Blocks:** FF-EPIC-19-S3 (the specs are the definition of done for the build).

#### ⚠️ Risks & Assumptions
- **Assumption:** The frames declare stable `data-*` hooks the specs can bind to.
- **Risk:** Specs written loosely enough to pass against an empty page are not red for the right reason — assert on content, not merely on selector presence.

#### 📎 References
- Reference triad: `tests/e2e/billing-invoices/`

---

### 📖 Story: Users edit settings and see where each value comes from

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-19-S3 |
| **Parent Epic** | FF-EPIC-19 — Configuration Management UI |
| **Priority** | High |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 16 (12 FE + 4 QA) |
| **Tech Layers** | Frontend |

#### 🧑‍💼 User Story
> As an **Org Admin**, I want **a settings editor that shows which values are mine, which are inherited,
> and which are locked above me** so that **I can change what I control and understand why I cannot
> change the rest**.

#### 📌 Background & Context
The core deliverable: `@fuzefront/config-ui`, design-system-first, consuming
`@fuzefront/config-client`. Built until S2's specs go green.

#### ✅ Acceptance Criteria
1. **Given** a namespace at a scope **When** the editor loads **Then** each setting renders a typed input appropriate to its `value_type`, with its display name, description and valid values, grouped by category.
2. **Given** a setting inherited from an ancestor **When** it renders **Then** it shows an "inherited from <scope>" badge and a reset-to-inherited affordance appears only once the user overrides it.
3. **Edge case:** **Given** a setting locked by an ancestor scope **When** it renders **Then** the input is disabled with a "Locked by <scope>" badge and the lock reason, and no save is attempted for it.
4. **Error case:** **Given** a save where the server rejects one key **When** the response returns **Then** no key appears saved in the UI and the failing key is highlighted inline — matching the backend's atomic bulk write rather than showing a partial success the server did not perform.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] S2's Playwright specs green
- [ ] RTL unit tests (states + a11y) passing, coverage ≥ 80%
- [ ] `gate-ds-conformance` green — no raw hex/spacing/type
- [ ] Console-clean runtime validation (Chrome DevTools MCP) — 0 errors
- [ ] `@fuzefront/config-ui` publishes privately to GitHub Packages
- [ ] PM verified all Acceptance Criteria on staging

#### 📋 Sub-Tasks
| Type | Summary | Assignee | Points | Status |
|------|---------|----------|--------|--------|
| Frontend | Package scaffold + design-system primitives extension (foundation PR merged first) | — | 4 | Open |
| Frontend | Editor: scope switcher, typed inputs, inheritance/locked badges, reset-to-inherited, atomic save | — | 8 | Open |
| QA | State coverage + a11y + console-clean validation | — | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-19-S1 (approved frames), FF-EPIC-19-S2 (RED specs), FF-EPIC-17-S5, FF-EPIC-17-S6.
- **Blocks:** FF-EPIC-19-S6.

#### ⚠️ Risks & Assumptions
- **Assumption:** `@fuzefront/design-system` has the form primitives needed; any gap is added to the base via the design-system skill in a foundation PR, never styled one-off in feature code.
- **Risk:** Rendering value-only and ignoring provenance produces a form that looks correct and misrepresents inheritance — AC2/AC3 are the guard.

#### 📎 References
- Design-system conformance: `.claude/skills/design-system-conformance/`
- UI runtime validation: `.claude/skills/ui-runtime-validation/`

---

### 📖 Story: Platform admins inspect the whole key catalog

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-19-S4 |
| **Parent Epic** | FF-EPIC-19 — Configuration Management UI |
| **Priority** | Medium |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 10 (6 FE + 4 QA) |
| **Tech Layers** | Frontend |

#### 🧑‍💼 User Story
> As a **Platform Admin**, I want **to browse every registered key with its metadata and see what a scope
> overrides** so that **I can audit the configuration surface without querying the database**.

#### 📌 Background & Context
The admin counterpart to S3's end-user editor: definitions rather than values, plus the
diff-against-parent view that answers "what has this tenant actually changed".

#### ✅ Acceptance Criteria
1. **Given** the catalog view **When** a platform admin opens it **Then** namespaces and their key definitions are listed with type, default, allowed scopes and flags, searchable by display name and description, and paginated.
2. **Given** a selected scope **When** the diff view is opened **Then** only keys that scope overrides are shown, each with its inherited value alongside its overriding value.
3. **Edge case:** **Given** system and hidden keys **When** a platform admin views the catalog **Then** they are visible and clearly marked as system/hidden — the catalog is the one surface where hidden keys are legitimately shown, and only to platform admins.
4. **Error case:** **Given** a non-platform-admin **When** they attempt to reach the catalog route **Then** access is denied at the route, not merely hidden in navigation — the server refuses the underlying read regardless.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] RTL unit tests (states + a11y) passing, coverage ≥ 80%
- [ ] `gate-ds-conformance` green
- [ ] Console-clean runtime validation — 0 errors
- [ ] Authorization verified server-side, not just in navigation
- [ ] PM verified all Acceptance Criteria on staging

#### 📋 Sub-Tasks
| Type | Summary | Assignee | Points | Status |
|------|---------|----------|--------|--------|
| Frontend | Catalog browser (search, pagination, flag display) + diff-against-parent view | — | 6 | Open |
| QA | System/hidden marking, non-admin route denial, empty/loading/error states | — | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-19-S1, FF-EPIC-17-S5.
- **Blocks:** FF-EPIC-19-S6.

#### ⚠️ Risks & Assumptions
- **Assumption:** A platform-admin-only variant of the catalog read returns hidden keys, distinct from the end-user read that omits them.
- **Risk:** Reusing the end-user read here would either leak hidden keys everywhere or make them invisible to admins — the two reads must stay distinct and separately authorized.

#### 📎 References
- Catalog read API: FF-EPIC-17-S5

---

### 📖 Story: Secrets and change history have their own surfaces

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-19-S5 |
| **Parent Epic** | FF-EPIC-19 — Configuration Management UI |
| **Priority** | Medium |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 10 (6 FE + 4 QA) |
| **Tech Layers** | Frontend |

#### 🧑‍💼 User Story
> As an **Org Admin**, I want **to set a secret setting safely and see who changed a setting and when**
> so that **I can configure integrations and answer questions about past changes without database
> access**.

#### 📌 Background & Context
Surfaces FF-EPIC-18's secrets, audit history and revert. Both are states already designed in S1's frames.

#### ✅ Acceptance Criteria
1. **Given** a secret-typed setting with a value **When** the editor renders it **Then** it shows "set" with a mask and a replace affordance — never the stored value.
2. **Given** a setting at a scope **When** its history is opened **Then** changes are listed newest-first with actor, timestamp and old→new, paginated.
3. **Edge case:** **Given** a secret's history **When** it is viewed **Then** entries show that the value changed without showing either value — the history surface must not become the secret-disclosure path the masked input prevents.
4. **Error case:** **Given** a revert to a value that the current definition rejects **When** it is attempted **Then** the server's refusal is surfaced inline with the reason, and nothing appears reverted in the UI.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] RTL unit tests (states + a11y) passing, coverage ≥ 80%
- [ ] `gate-ds-conformance` green
- [ ] No secret plaintext reachable through any UI path — asserted by test
- [ ] Console-clean runtime validation — 0 errors
- [ ] PM verified all Acceptance Criteria on staging

#### 📋 Sub-Tasks
| Type | Summary | Assignee | Points | Status |
|------|---------|----------|--------|--------|
| Frontend | Masked secret input with replace flow; audit-history panel with revert action | — | 6 | Open |
| QA | Secret never rendered (input + history), revert-refusal surfacing, pagination states | — | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-19-S3, FF-EPIC-18-S1, FF-EPIC-18-S2, FF-EPIC-18-S3.
- **Blocks:** FF-EPIC-19-S6.

#### ⚠️ Risks & Assumptions
- **Assumption:** Reveal-once, if offered at all, is a separately authorized backend operation (FF-EPIC-18-S1) rather than a UI toggle.
- **Risk:** History rendering old→new generically would print secret values — AC3 requires the history component to be secret-aware, not a generic diff renderer.

#### 📎 References
- Secrets: FF-EPIC-18-S1 · History/revert: FF-EPIC-18-S2, FF-EPIC-18-S3

---

### 📖 Story: The config console is verified against the real thing

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-19-S6 |
| **Parent Epic** | FF-EPIC-19 — Configuration Management UI |
| **Priority** | High |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 8 (8 QA) |
| **Tech Layers** | QA |

#### 🧑‍💼 User Story
> As the **Product Owner**, I want **independent verification that the built console matches the approved
> frames and runs clean in a real browser** so that **"done" means observed working, not "the unit tests
> pass"**.

#### 📌 Background & Context
`frontend-test-engineer` verifies independently of the implementer, pre- and post-production. A runtime
console error found here is a bug to **report**, never patched by QA.

#### ✅ Acceptance Criteria
1. **Given** the built console **When** S2's specs run **Then** all are green against both the frames and the built components.
2. **Given** the console rendered in a real Chromium via the Chrome DevTools MCP **When** the editor, catalog and history surfaces are exercised **Then** there are 0 console errors, 0 CSP/mixed-content violations and 0 failed app requests — or every remaining message is explained.
3. **Edge case:** **Given** the console under a tenant host with TLS **When** it loads **Then** the API is reached same-origin with no mixed-content block and no failed Module-Federation remote load.
4. **Error case:** **Given** the post-prod smoke **When** the config service is not yet deployed **Then** the specs self-skip on a health probe and go green automatically once it is live — they must not require someone to remember to un-skip them.

#### 🔲 Definition of Done
- [ ] All S2 specs green against built components
- [ ] Console-clean per `ui-runtime-validation` on every surface
- [ ] Post-prod smoke wired into `post-prod-e2e.yml`, self-skipping and auto-enabling
- [ ] Verified against the approved frames, flow by flow
- [ ] Any runtime defect reported as a bug, not patched by QA

#### 📋 Sub-Tasks
| Type | Summary | Assignee | Points | Status |
|------|---------|----------|--------|--------|
| QA | Frames-vs-built verification + console-clean runtime validation across all surfaces | — | 4 | Open |
| QA | Post-prod smoke wired in, health-probe gated, auto-enabling on deploy | — | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-19-S3, S4, S5.

#### ⚠️ Risks & Assumptions
- **Assumption:** The Chrome DevTools MCP plugin is installed in the verifying session (user/environment-scoped, not committed repo config).
- **Risk:** A post-prod smoke that is skipped and forgotten reports green while verifying nothing — AC4 requires it to enable itself, following the `@authn-pending-deploy` precedent.

#### 📎 References
- UI runtime validation: `.claude/skills/ui-runtime-validation/`
- Self-skipping precedent: `frontend/e2e/post-prod/authn-boundary-smoke.spec.ts`
