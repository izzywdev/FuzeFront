---
key: FF-EPIC-13
title: White-Label Shell Branding (portal-scoped topbar, side panel, login)
label: [fuzefront, design-system-first, platform, feature-flag, needs-jira-upload]
github: TBD
status: ready
priority: High
domain: Frontend / Design System
---

## 🎯 Epic: White-Label Shell Branding

| Field | Value |
|-------|-------|
| **Epic ID** | FF-EPIC-13 |
| **Domain** | Frontend / Design System |
| **Priority** | High |
| **Owner** | Orchestrator (delegated to `product-designer` + `frontend-engineer`) |
| **Target Release** | Next deploy window |
| **Effort Estimate** | L |
| **GitHub** | TBD |

---

### 📌 Problem Statement
> Branding (logo, name, colors) is hardcoded in `TopBar.tsx` and static assets, and `ThemeContext`
> only knows light/dark — it has no concept of a portal's identity. A tenant portal (e.g.
> `mendysrobotics`) cannot present its own name, logo, or accent color anywhere in the shell, so it
> cannot be a true white-label copy of FuzeFront even once it exists as a portal.

### 🎯 Goal
> The shell (topbar, side panel, login) renders the active portal's branding — name, logo, favicon,
> accent color — sourced from portal context and applied entirely through design-system token
> overrides (no raw hex), across every state (loading, empty/fallback, error, suspended).

**DESIGN-FIRST:** per the FuzeFront design-first gate, `product-designer` authors the frames (S1) as
a frames-ONLY PR before any implementation story starts. Frames are the source of truth, not PenPot
or Figma.

### 👥 Target Personas
- **Portal End-User** — the tenant's customer; sees the branded shell and login as if it were the
  tenant's own product.
- **Portal Admin** — tenant owner/admin whose portal identity is rendered here (editing that identity
  is FF-EPIC-14, not this epic).

### ✅ Features In Scope
- [ ] Feature 1: Designer frames for the tenant portal shell + white-label login, covering loading,
      empty/fallback, error, and suspended states (`design/frames/white-label-portal/**`).
- [ ] Feature 2: Branding boot in the shell — TopBar, SidePanel, and login consume portal-context
      branding (name/logo/favicon), replacing hardcoded values.
- [ ] Feature 3: Runtime theme-override pipeline — a portal's accent color is applied via
      `@fuzefront/design-system` token CSS-var overrides (never raw hex), extending `ThemeContext`.
- [ ] Feature 4: Console-clean runtime validation of the branded shell under a tenant host, gated
      behind a feature flag.

### 🚫 Out of Scope
- Admin console to **edit** a portal's branding (name/logo/accent inputs, upload) — FF-EPIC-14.
- Per-app theming (federated remotes theming themselves) — shell-level branding only.
- Custom-domain verification/TLS that a branded portal is served on — FF-EPIC-16.

### 🏗️ High-Level Architecture Notes
> Branding is consumed from `GET /api/v1/portal/context` (FF-EPIC-10-S2), which resolves the active
> portal's `branding` jsonb (FF-EPIC-09 `portals` table). Accent/logo/name land as CSS custom
> properties layered **over** `@fuzefront/design-system` tokens — `frontend-engineer` owns
> `design-system/`; no raw hex/px/type anywhere in feature code. Extend the existing `ThemeContext`
> (today light/dark-only) rather than building a parallel theming mechanism. Replace the hardcoded
> branding in `frontend/src/components/TopBar.tsx`. Gate the finished surface with the
> `ui-runtime-validation` skill (console-clean: 0 errors, 0 CSP/mixed-content, 0 failed
> Module-Federation loads). Precedent: `docs/planning/locked-app-mode.md` (Host→app white-label
> resolution design, extended here to Host→portal→branding).

### 📊 Success Metrics
| Metric | Current Baseline | Target |
|--------|-----------------|--------|
| Provisioned tenant portals rendering their own branding | 0% (hardcoded FuzeFront branding for all) | 100% |
| `gate-ds-conformance` on the branded shell | Failing/new | Green |
| Console errors/CSP violations/failed MF loads under a tenant host (Chrome DevTools MCP) | Unknown | 0 |

### 📋 Child Stories
| Story ID | Summary | Status |
|----------|---------|--------|
| FF-EPIC-13-S1 | Designer frames: tenant portal shell + white-label login (all states) | Open |
| FF-EPIC-13-S2 | Branding boot in shell (TopBar/SidePanel/login) | Open |
| FF-EPIC-13-S3 | Theme-override pipeline (accent → DS token CSS-vars) | Open |
| FF-EPIC-13-S4 | Runtime console-clean validation + flag | Open |

### 🔗 Dependencies
- **Blocked By:** FF-EPIC-10-S2 (`GET /api/v1/portal/context` boot endpoint must exist for branding
  to consume); FF-EPIC-09 (`portals.branding` jsonb column + root-portal seed).
- **Related:** FF-EPIC-14 (admin console to **edit** the branding this epic renders); FF-EPIC-09-S4
  (master feature flag `fuzefront.platform.multi-tenant-portals`, reused here rather than a new flag).

### 📎 References
- White-label precedent: `docs/planning/locked-app-mode.md`
- Hardcoded branding today: `frontend/src/components/TopBar.tsx`; registry fetch:
  `frontend/src/platform/appRegistry.tsx`
- Portal context contract: FF-EPIC-10-S2
- Design-first gate + `ui-runtime-validation` skill: `CLAUDE.md`, `.claude/skills/ui-runtime-validation/`

---

## Stories

### 📖 Story: Designer frames — tenant portal shell + white-label login (all states)

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-13-S1 |
| **Parent Epic** | FF-EPIC-13 — White-Label Shell Branding |
| **Priority** | Critical |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 8 (8 UX) |
| **Tech Layers** | Design / UX |

#### 🧑‍💼 User Story
> As a **Portal Admin**, I want **the tenant portal shell and white-label login screen fully designed
> — including every loading, empty/fallback, error, and suspended state — before any code is written**
> so that **engineers build the right white-label experience once, and no tenant sees an unbranded or
> broken shell**.

#### 📌 Background & Context
Per FuzeFront's design-first gate, `product-designer` is the **sole** author of `design/frames/**` and
this is a **frames-ONLY PR** — it contains no `frontend/src/**` changes. This story gates FF-EPIC-13-S2
and S3: implementation cannot start until this PR is approved and merged. This closes the exact gap
that previously let UI-less backends ship: the frames declare the build inventory (flows/components/
packages) that implementation is measured against.

#### ✅ Acceptance Criteria
1. **Given** the white-label portal shell requirement **When** `product-designer` authors the frames
   **Then** `design/frames/white-label-portal/` contains an `index.html` entry, ordered `01-*.html`
   screens, `tokens.css`, and `manifest.json` covering the topbar, side panel, and login screen.
2. **Given** the frames are complete **When** `gate-frames-schema`, `gate-ds-conformance`, and
   `gate-frames-stamped` run in CI on the PR **Then** all three pass.
3. **Edge case:** **Given** a portal has no logo/name configured yet (unset branding on a freshly
   provisioned portal) **When** the frames render that state **Then** a defined default/fallback
   branding frame is included — not just the happy path.
4. **Error case:** **Given** a portal is suspended **When** a user visits its login **Then** a
   "portal suspended" frame is included showing the fail-closed UX (matching FF-EPIC-10's
   `resolvePortalContext` fail-closed behavior) rather than a raw error or blank page.

#### 🔲 Definition of Done
- [ ] PR is frames-only — no `frontend/src/**` or `packages/*-ui/**` changes
- [ ] `gate-ds-conformance` green (frames use fuse-seam tokens only)
- [ ] `gate-frames-schema` green (`manifest.json` schema-valid)
- [ ] `gate-frames-stamped` green
- [ ] Build inventory (flows / React components / npm packages) declared in `manifest.json` and
      rendered in `index.html`
- [ ] Owner approved per flow (shell branding and login can be approved independently)
- [ ] PM verified all Acceptance Criteria against the published frames

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| UX Task | HTML frames `design/frames/white-label-portal/**` — topbar/side panel/login × loading/empty/error/suspended states + build inventory | 8 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-10-S2 (portal-context contract shapes what branding fields the frames must
  design for: name/logo/favicon/accent).
- **Blocks:** FF-EPIC-13-S2, FF-EPIC-13-S3 (implementation cannot start until this PR is approved and
  merged).

#### ⚠️ Risks & Assumptions
- **Assumption:** Portal branding fields (`name`, `logo`, `favicon`, `accent`) are finalized in the
  `portals.branding` jsonb schema (FF-EPIC-09) before frames are authored.
- **Risk:** Frames could quietly include per-app theming — mitigate by scoping strictly to the shell
  (topbar/side panel/login) per this epic's Out of Scope.

#### 📎 References
- Frames: `design/frames/white-label-portal/` (to be created)
- Precedent: `docs/planning/locked-app-mode.md`
- Portal context contract: FF-EPIC-10-S2

---

### 📖 Story: Branding boot in shell

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-13-S2 |
| **Parent Epic** | FF-EPIC-13 — White-Label Shell Branding |
| **Priority** | High |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 12 (8 FE + 4 QA) |
| **Tech Layers** | Frontend |

#### 🧑‍💼 User Story
> As a **Portal End-User**, I want to **see my portal's own name, logo, and favicon in the topbar,
> side panel, and login screen** so that **I recognize the product as our own white-label instance,
> not generic FuzeFront**.

#### 📌 Background & Context
`TopBar.tsx` and the login screen currently hardcode FuzeFront branding and static assets. This story
wires them to consume `GET /api/v1/portal/context` (FF-EPIC-10-S2) instead, matching the approved
frame from FF-EPIC-13-S1.

#### ✅ Acceptance Criteria
1. **Given** an authenticated session against a tenant portal host **When** the shell boots **Then**
   TopBar, SidePanel, and the login screen render the portal's name/logo/favicon from portal context
   per the approved frame.
2. **Given** the portal-context request succeeds **When** branding fields differ per portal **Then**
   two different portals loaded in the same browser session (different hosts) render visibly distinct
   branding without a stale-cache leak from one portal to another.
3. **Edge case:** **Given** a portal has no logo/favicon configured (nulls in `branding` jsonb)
   **When** the shell boots **Then** the FuzeFront default logo/favicon fallback renders per the
   frame's fallback state — never a broken image icon.
4. **Error case:** **Given** the `GET /api/v1/portal/context` request fails or times out **When** the
   shell boots **Then** a defined loading→error state renders (per the frame) with a retry action —
   the shell never silently falls back to unbranded UI without indicating a problem.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] RTL unit tests (a11y + states) passing, coverage ≥ 80%
- [ ] `gate-ds-conformance` green
- [ ] Matches approved `design/frames/white-label-portal` frame — designer sign-off
- [ ] Console-clean self-check (Chrome DevTools MCP) before reporting done
- [ ] PM verified all Acceptance Criteria on staging

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| Frontend | TopBar/SidePanel/login consume portal-context branding (name/logo/favicon), replacing hardcoded values | 8 | Open |
| QA | RTL branding-render + fallback/loading/error state tests | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-13-S1 (approved + merged frames); FF-EPIC-10-S2 (`GET /portal/context` boot
  endpoint).
- **Blocks:** FF-EPIC-13-S4 (console-clean validation covers this surface).

#### ⚠️ Risks & Assumptions
- **Assumption:** FF-EPIC-10-S2 ships before this story starts.
- **Risk:** Favicon swap at runtime has browser-caching quirks — mitigate with a cache-busting query
  param keyed to portal id.

#### 📎 References
- `frontend/src/components/TopBar.tsx`; `frontend/src/platform/appRegistry.tsx`
- Frame: `design/frames/white-label-portal/`

---

### 📖 Story: Theme-override pipeline (portal accent → DS token overrides)

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-13-S3 |
| **Parent Epic** | FF-EPIC-13 — White-Label Shell Branding |
| **Priority** | High |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 16 (8 FE + 4 UX + 4 QA) |
| **Tech Layers** | Frontend + Design System |

#### 🧑‍💼 User Story
> As a **Portal Admin**, I want **my portal's accent color applied consistently across the shell via
> design-system tokens** so that **our brand color shows up everywhere without anyone hand-coding hex
> values**.

#### 📌 Background & Context
Extends `ThemeContext` (currently light/dark-only) with a runtime CSS-var override layer sourced from
`branding.accent`, applied over `@fuzefront/design-system` tokens. `frontend-engineer` owns
`design-system/`; no raw hex/spacing/type is permitted in feature code — a missing primitive is added
to the base DS via the design-system skill, never styled one-off.

#### ✅ Acceptance Criteria
1. **Given** a portal's `branding.accent` color **When** `ThemeContext` initializes **Then** the
   accent is applied as a CSS custom property override layered over DS tokens (no raw hex in
   component code).
2. **Given** the accent override is active **When** any DS primitive (button, link, badge) renders
   **Then** it reflects the portal accent without a page reload.
3. **Edge case:** **Given** a portal accent fails WCAG 2.1 AA contrast against its paired token role
   **When** the pipeline computes the override **Then** it falls back to the nearest AA-compliant DS
   token variant rather than applying a non-compliant color.
4. **Error case:** **Given** `branding.accent` is malformed (invalid CSS color) **When** the
   theme-override pipeline runs **Then** it discards the invalid value and falls back to the default
   DS token — it never crashes the shell.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] RTL unit tests passing, coverage ≥ 80%
- [ ] `gate-ds-conformance` green — zero raw hex/spacing/type
- [ ] a11y contrast verified ≥ 4.5:1 across sample accent values
- [ ] Matches approved frame `tokens.css` — designer sign-off
- [ ] PM verified all Acceptance Criteria on staging

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| Frontend | Portal accent → DS token CSS-var overrides at runtime; extend `ThemeContext` | 8 | Open |
| UX Task | Verify runtime tokens vs approved frame `tokens.css` (`gate-ds-conformance`) | 4 | Open |
| QA | Theme-override + a11y contrast test across accent values | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-13-S1 (frames define the `tokens.css` contract).
- **Related:** FF-EPIC-13-S2 (shares `ThemeContext` boot).

#### ⚠️ Risks & Assumptions
- **Assumption:** DS token roles already have defined AA-safe fallback variants.
- **Risk:** Arbitrary tenant accent colors could clash with DS semantic colors (error/success) —
  mitigate by scoping the override to brand/accent role tokens only, never semantic-state tokens.

#### 📎 References
- `@fuzefront/design-system` tokens
- Frame: `design/frames/white-label-portal/tokens.css`

---

### 📖 Story: Runtime console-clean validation + flag

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-13-S4 |
| **Parent Epic** | FF-EPIC-13 — White-Label Shell Branding |
| **Priority** | High |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 6 (4 QA + 2 Backend) |
| **Tech Layers** | QA + Backend |

#### 🧑‍💼 User Story
> As a **Portal Admin**, I want **the white-label shell to run cleanly (no console errors, CSP
> violations, or failed Module-Federation loads) under my own portal host, and to be able to enable or
> disable this behind a flag** so that **white-label branding never ships broken or unreviewable**.

#### 📌 Background & Context
Per the FuzeFront `ui-runtime-validation` gate, no UI work is done until rendered in a real Chromium
via Chrome DevTools MCP with a clean console. This story closes that loop for the branded shell and
gates it behind the existing `fuzefront.platform.multi-tenant-portals` master flag (FF-EPIC-09-S4)
rather than introducing a new flag.

#### ✅ Acceptance Criteria
1. **Given** the branded shell (S2 + S3) deployed to a tenant host **When** QA runs Chrome DevTools
   MCP against it **Then** the console shows 0 errors, 0 CSP/mixed-content violations, and 0 failed
   Module-Federation remote loads.
2. **Given** `fuzefront.platform.multi-tenant-portals` is OFF **When** any portal loads the shell
   **Then** branding is inert and today's unbranded shell renders unchanged.
3. **Edge case:** **Given** the flag is ON but a portal has partial/broken branding data **When**
   validated **Then** the fallback states from S2's AC3 prevent any console error — verified
   explicitly, not assumed.
4. **Error case:** **Given** a genuine runtime console error is found **When** QA reports it **Then**
   it is filed as a bug and blocks sign-off — QA never silently patches it, per the CLAUDE.md
   runtime-validation gate.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Chrome DevTools MCP console-clean report attached, 0 unexplained messages
- [ ] Both flag states (ON/OFF) verified on staging
- [ ] PM verified all Acceptance Criteria on staging

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| QA | Chrome DevTools MCP console-clean validation under a tenant host (0 errors/CSP/MF-load failures), both flag states | 4 | Open |
| Backend | Wire `fuzefront.platform.multi-tenant-portals` flag to gate branding boot (reuse FF-EPIC-09 master switch, default OFF) | 2 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-13-S2, FF-EPIC-13-S3 (the surfaces being validated); FF-EPIC-09-S4 (the
  master flag being reused).

#### ⚠️ Risks & Assumptions
- **Assumption:** Reusing the FF-EPIC-09 master flag is acceptable rather than a dedicated branding
  flag — revisit if branding needs independent rollout from portal provisioning.
- **Risk:** Module-Federation remote-load failures are environment-specific — mitigate by validating
  against a real kind-fuzeinfra/staging tenant host, not just localhost.

#### 📎 References
- `.claude/skills/ui-runtime-validation/`
- `.claude/skills/feature-flags/`
- FF-EPIC-09-S4
