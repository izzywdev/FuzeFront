---
key: FF-EPIC-03
title: Security / Org-management UI — permissions, members list, invite user, API key create/revoke
label: [fuzefront, identity, security, design-system-first, paginated, permit-gated]
github: https://github.com/izzywdev/FuzeFront/issues/121
status: ready
priority: High
domain: Identity / Security
---

## 🎯 Epic: Security / Org-management UI

| Field | Value |
|-------|-------|
| **Epic ID** | FF-EPIC-03 |
| **Domain** | Identity / Security |
| **Priority** | High |
| **Owner** | Orchestrator (`frontend-engineer` + `backend-engineer`, appsec-reviewer gates authz) |
| **Target Release** | Next deploy window |
| **Effort Estimate** | L |
| **GitHub** | [#121](https://github.com/izzywdev/FuzeFront/issues/121) |

---

### 📌 Problem Statement
> FuzeFront has org/identity/Permit/API-token backends but the shell is missing the everyday admin UI:
> there is no screen to manage org roles/permissions, list members, invite users, or create/revoke API
> keys. Admins cannot self-serve common org administration, which blocks onboarding and forces
> out-of-band requests.

### 🎯 Goal
> An Org Admin can manage org roles/permissions, view members, invite users, and create/revoke API keys
> from a Settings / Organization area — every action Permit-gated and every list paginated.

### 👥 Target Personas
- **Org Admin** — manages roles, members, invites, and API keys for the active org.
- **Org Member** — accepts an invite and sees their role.

### ✅ Features In Scope
- [ ] Feature 1: Organization permissions screen — list org roles (Permit admin/editor/viewer + product roles), show grants, change a member's role.
- [ ] Feature 2: Members list — name, email, role, status, joined; paginated; org-scoped `GET …/members` (add if missing).
- [ ] Feature 3: Invite user — invite-by-email (create invite → email-service → accept → membership) + UI + states.
- [ ] Feature 4: API keys — list (name, prefix, created, last-used), create (secret shown once, copy, never re-shown), revoke.
- [ ] Feature 5: Shell nav — Settings / Organization area (Members · Permissions · API Keys).

### 🚫 Out of Scope
- Defining the role model itself — that is coordinated with FF-EPIC-05 (multi-product authz); this epic consumes it, never duplicates it.
- Cross-tenant/parent-org management UI — FF-EPIC-05 (ReBAC) owns that.
- SSO/identity-provider configuration UI — separate concern.

### 🏗️ High-Level Architecture Notes
> Reads/writes via the security service + Permit (role assignment). Every action gated by Permit
> (`UserManagement:*`, `Organization:manage`) — **real authz, never a UI/feature flag**. Same-origin API
> base; lists paginated per `gate-pagination`; design-system-first (extend `@fuzefront/design-system`).
> API keys reuse the existing API-token backend (identity #65); add org-scoped endpoints where gaps exist
> (members list, invite, api-key CRUD). Coordinate the role model with FF-EPIC-05.

### 📊 Success Metrics
| Metric | Current Baseline | Target |
|--------|-----------------|--------|
| Org-admin actions available self-serve in UI | 0 of 4 | 4 of 4 (perms, members, invite, keys) |
| API-key secret exposure after creation | n/a | Shown exactly once, never re-shown |
| Permit-gated actions (not UI flags) | n/a | 100% of mutating actions |
| `gate-pagination` on member/key lists | new | Green |

### 📋 Child Stories
| Story ID | Summary | Status |
|----------|---------|--------|
| FF-EPIC-03-S1 | Organization permissions screen (view/change roles) | Open |
| FF-EPIC-03-S2 | Members list (paginated) + GET …/members endpoint | Open |
| FF-EPIC-03-S3 | Invite user by email flow | Open |
| FF-EPIC-03-S4 | API key create / list / revoke | Open |
| FF-EPIC-03-S5 | Settings / Organization nav area | Open |

### 🔗 Dependencies
- **Blocked By:** FF-EPIC-05 (role model — consume, don't duplicate); FF-EPIC-08 (pagination gate).
- **Related:** identity-ui #65; API-tokens backend; email-service (for invites).

### 📎 References
- GitHub issue: https://github.com/izzywdev/FuzeFront/issues/121
- Permit schema: `backend/security/src/permit/schema.ts`; checks: `backend/src/utils/permit/permission-check.ts`

---

## Stories

### 📖 Story: Org Admin can view and change member roles

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-03-S1 |
| **Parent Epic** | FF-EPIC-03 — Security / Org-management UI |
| **Priority** | High |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 20 (4 UX + 4 BE + 8 FE + 4 QA) |
| **Tech Layers** | Full-Stack + Design System |

#### 🧑‍💼 User Story
> As an **Org Admin**, I want to **view my org's roles and what each grants, and change a member's role**
> so that **I can administer access without contacting support**.

#### 📌 Background & Context
Surfaces the Permit role model (admin/editor/viewer + product roles) and allows role assignment via the
security service + Permit. Mutations are Permit-gated (`Organization:manage`).

#### ✅ Acceptance Criteria
1. **Given** an Org Admin **When** they open Permissions **Then** the org's roles and a summary of what each grants are listed.
2. **Given** an Org Admin selects a member **When** they change the member's role **Then** the assignment is written via Permit and reflected after refresh.
3. **Edge case:** **Given** the last admin **When** they attempt to demote themselves **Then** the action is blocked with an explanatory message (org must retain ≥1 admin).
4. **Error case:** **Given** a non-admin user **When** they attempt a role change **Then** Permit denies it (403) and the UI hides/disables the control — authz enforced server-side, not just hidden.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Backend + RTL tests passing, coverage ≥ 80%
- [ ] Permit-gated server-side (appsec-reviewer pass) — not a UI-only guard
- [ ] `gate-ds-conformance` green
- [ ] Role model consumed from FF-EPIC-05 (not duplicated)

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| UX Task | Design permissions screen (roles, grants, member-role control) | 4 | Open |
| Backend | Role-assignment endpoint via Permit + last-admin guard | 4 | Open |
| Frontend | Permissions screen UI + role-change flow + states | 8 | Open |
| QA | API authz (403) + RTL last-admin/edge tests | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-05 (role model).

#### ⚠️ Risks & Assumptions
- **Assumption:** Permit role-assignment API is reachable via the security service.
- **Risk:** Role-model drift with EPIC-05 → consume the shared schema, do not redefine.

#### 📎 References
- `backend/security/src/permit/schema.ts`.

---

### 📖 Story: Org Admin can view a paginated list of org members

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-03-S2 |
| **Parent Epic** | FF-EPIC-03 — Security / Org-management UI |
| **Priority** | High |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 16 (8 BE + 4 FE + 4 QA) |
| **Tech Layers** | Full-Stack |

#### 🧑‍💼 User Story
> As an **Org Admin**, I want to **see my org's members with name, email, role, status, and joined date**
> so that **I have a clear picture of who has access**.

#### 📌 Background & Context
Adds/ensures an org-scoped `GET …/members` (paginated, BOLA-authorized) and the list UI.

#### ✅ Acceptance Criteria
1. **Given** an Org Admin **When** they open Members **Then** members list with name, email, role, status, and joined date.
2. **Given** more members than one page **When** they page **Then** results paginate per `gate-pagination` (cursor) without duplicates.
3. **Edge case:** **Given** a single-member org **When** opened **Then** the list shows just that member (no empty/broken state).
4. **Error case:** **Given** a request for another org's members **When** made **Then** it returns 403 (BOLA) — never another org's members.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Backend + RTL tests passing, coverage ≥ 80%
- [ ] `gate-pagination` green on `GET …/members`
- [ ] BOLA verified (appsec-reviewer pass)
- [ ] Endpoint documented

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| Backend | Org-scoped paginated `GET …/members` (add if missing) | 8 | Open |
| Frontend | Members table UI + pagination + states | 4 | Open |
| QA | API contract (pagination + BOLA 403) + RTL tests | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-08 (pagination gate).

#### ⚠️ Risks & Assumptions
- **Assumption:** Membership data is queryable from the security service.
- **Risk:** Member status semantics (active/invited/suspended) → align with invite flow (S3).

#### 📎 References
- security service membership model.

---

### 📖 Story: Org Admin can invite a user by email

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-03-S3 |
| **Parent Epic** | FF-EPIC-03 — Security / Org-management UI |
| **Priority** | High |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 20 (8 BE + 8 FE + 4 QA) |
| **Tech Layers** | Full-Stack |

#### 🧑‍💼 User Story
> As an **Org Admin**, I want to **invite a user to my org by email** so that **they can join with the
> right role without me sharing credentials**.

#### 📌 Background & Context
Invite-by-email flow: create invite → send via email-service → recipient accepts → membership created.
Backend invite endpoint added if missing; UI form + states.

#### ✅ Acceptance Criteria
1. **Given** an Org Admin **When** they submit an email + role **Then** an invite is created and an email is sent via the email-service.
2. **Given** an invitee with a valid invite link **When** they accept **Then** a membership is created with the invited role and they appear in the Members list as active.
3. **Edge case:** **Given** an email already a member **When** invited **Then** the UI surfaces "already a member" and no duplicate invite is created.
4. **Error case:** **Given** an expired/invalid invite token **When** accepted **Then** acceptance is rejected with a clear "invite expired" message — no membership created.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Backend + RTL tests passing, coverage ≥ 80%
- [ ] Invite endpoint Permit-gated (`UserManagement:*`) — appsec-reviewer pass
- [ ] Email-service integration verified (invite email sent)
- [ ] `gate-ds-conformance` green on the invite form

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| Backend | Invite create + accept endpoints + email-service send + membership | 8 | Open |
| Frontend | Invite form UI + states (sent/already-member/error) | 8 | Open |
| QA | Tests: invite→accept→membership, duplicate, expired token | 4 | Open |

#### 🔗 Dependencies
- **Related:** S2 (members list reflects invited/active status); email-service.

#### ⚠️ Risks & Assumptions
- **Assumption:** email-service can send transactional invite emails.
- **Risk:** Invite link/token security → signed, expiring tokens; never guessable.

#### 📎 References
- email-service; security service membership.

---

### 📖 Story: Org Admin can create, list, and revoke API keys

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-03-S4 |
| **Parent Epic** | FF-EPIC-03 — Security / Org-management UI |
| **Priority** | High |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 20 (8 BE + 8 FE + 4 QA) |
| **Tech Layers** | Full-Stack |

#### 🧑‍💼 User Story
> As an **Org Admin**, I want to **create an API key (shown once), see my keys (name, prefix, created,
> last-used), and revoke a key** so that **I can manage programmatic access securely**.

#### 📌 Background & Context
Wires to the existing API-token backend (identity #65). The full secret is shown exactly once at
creation (copy-to-clipboard) and never re-displayed; only a prefix is stored/shown thereafter.

#### ✅ Acceptance Criteria
1. **Given** an Org Admin **When** they create a key **Then** the full secret is shown once with copy-to-clipboard and a clear "you won't see this again" warning.
2. **Given** existing keys **When** they open API Keys **Then** keys list with name, prefix, created, and last-used (never the full secret).
3. **Edge case:** **Given** a key was just created **When** the user navigates away and returns **Then** the full secret is no longer retrievable (prefix only).
4. **Error case:** **Given** a revoked key **When** it is used to call the API **Then** the call is rejected (401/403) and the key shows "revoked" in the list.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Backend + RTL tests passing, coverage ≥ 80%
- [ ] Secret-shown-once verified (never re-served); secrets stored hashed
- [ ] Endpoints Permit-gated + paginated list (`gate-pagination`)
- [ ] appsec-reviewer pass (BOLA + secret handling)

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| Backend | API-key create/list/revoke endpoints (hash at rest, prefix on read, paginated) | 8 | Open |
| Frontend | API keys UI: create (show-once+copy), list, revoke + states | 8 | Open |
| QA | Tests: show-once, prefix-only on re-read, revoked-key rejected, pagination | 4 | Open |

#### 🔗 Dependencies
- **Related:** identity #65 API-token backend.

#### ⚠️ Risks & Assumptions
- **Assumption:** The API-token backend supports create/revoke; add endpoints only for gaps.
- **Risk:** Secret leakage via logs/responses → hash at rest, redact in logs, return once only.

#### 📎 References
- API-tokens backend (identity #65).

---

### 📖 Story: Settings / Organization nav area ties the admin flows together

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-03-S5 |
| **Parent Epic** | FF-EPIC-03 — Security / Org-management UI |
| **Priority** | Medium |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 8 (4 FE + 4 QA) |
| **Tech Layers** | Frontend |

#### 🧑‍💼 User Story
> As an **Org Admin**, I want **a Settings / Organization area with Members · Permissions · API Keys
> navigation** so that **I can reach every org-admin function from one place**.

#### 📌 Background & Context
Wires the four flows into a coherent shell nav area, design-system-first, Permit-gated visibility.

#### ✅ Acceptance Criteria
1. **Given** an Org Admin **When** they open Settings / Organization **Then** Members, Permissions, and API Keys sub-navigation is visible with the active section indicated.
2. **Given** a sub-section selected **When** the route changes **Then** the corresponding screen renders and the URL is deep-linkable.
3. **Edge case:** **Given** a non-admin member **When** they reach the area **Then** only sections their Permit role allows are shown (others hidden/disabled).
4. **Error case:** **Given** an unknown sub-route **When** loaded **Then** redirect to the default (Members) — no 404 dead-end.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] RTL tests (nav, deep-link, role-based visibility, a11y) passing
- [ ] `gate-ds-conformance` green (DS nav/Tabs primitives)
- [ ] PM verified all AC on staging

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| Frontend | Settings/Organization nav + routing + Permit-based section visibility | 4 | Open |
| QA | RTL nav + deep-link + role-visibility + a11y tests | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** S1–S4 (the sections this nav hosts).

#### ⚠️ Risks & Assumptions
- **Assumption:** DS nav/Tabs primitives exist or will be added to the base DS.
- **Risk:** Visibility-only gating mistaken for authz → real authz stays in Permit server-side.

#### 📎 References
- Shell nav; `@fuzefront/design-system`.
