---
key: FF-EPIC-17
title: Personal identity, root membership & portal/Employee reconciliation — drop personal orgs, unify the org tree, formalize Employee
label: [fuzefront, identity, security, platform, design-system-first, paginated, permit-gated, contract-first, needs-jira-upload]
github: TBD
status: ready
priority: Critical
domain: Identity / Security
---

## 🎯 Epic: Personal identity, root membership & portal/Employee reconciliation

| Field | Value |
|-------|-------|
| **Epic ID** | FF-EPIC-17 |
| **Domain** | Identity / Security (spans Platform / Frontend) |
| **Priority** | Critical |
| **Owner** | Orchestrator (`backend-engineer` for the identity slice; `product-designer` → `frontend-engineer` for the six UI flows; appsec-reviewer gates authz) |
| **Target Release** | Next deploy window (migration touches `master` deploy-on-push) |
| **Effort Estimate** | XL |
| **GitHub** | TBD (no issue yet — file the `@claude` delegation thread when implementation starts) |
| **Plan of record** | `/root/.claude/plans/as-you-can-see-glimmering-rabbit.md` |

---

### 📌 Problem Statement
> Today `signup` creates a `type='personal'` org per user and does **not** make the user a member of the
> root "FuzeFront" org, so every user is a **GUEST** of the platform they just joined — confirmed live via
> `/organizations` showing `👋 GUEST` / "You're not a member of this organization" for the root org
> (`frontend/src/pages/OrganizationPage.tsx:331,503`, shipped by #529). This is correct for the *current*
> model but the model itself is wrong for the intended product: FuzeFront wants the mainstream shape
> (Slack/GitHub) where user identity is the base principal, signup makes you a member of the platform root,
> and orgs are opt-in tenants. Separately, the Multi-Tenant Portal initiative (FF-EPIC-09/11/14) was
> designed around a **new, separate `portals` table** (`portals.organization_id` FK, `users.home_portal_id`
> FK to `portals.id`) — but the owner has since decided portals should **not** be a separate entity: a
> portal is just an org that is a direct child of the platform root. Left unreconciled, engineering would
> build two competing tenancy models in parallel. Finally, "Employee" (FuzeOne/platform staff who manage
> customer orgs cross-org, per FF-EPIC-05's ReBAC `org-admin`-on-root derivation) has no formal name, role
> catalog entry, or console — it exists only as an implicit consequence of the ReBAC schema.

### 🎯 Goal
> Every user is a literal `member` of the root "FuzeFront" org on signup (root GUEST state disappears);
> the `type='personal'` org is retired non-destructively; the multi-tenant-portal initiative is unified
> onto `organizations + parent_id` (no separate portal entity); "Employee" is a named, scoped role
> (ReBAC `org-admin`-on-root, no per-org membership); and all six UI flows this reconciliation requires —
> personal/org/portal context switcher, root/portal member directory, per-org members reconciled with
> `authz-admin`, portal-management console, Employee cross-org console, and "my orgs & sub-orgs" — are
> designed (frames-first) and built.

### 👥 Target Personas
- **Root owner / Master Admin** — sees the platform root with a `MEMBER` badge (never `GUEST`); runs the
  portal-management console over all second-level portal orgs.
- **Regular person** — a personal (non-org) identity; a `member` of root by default; can create/own orgs.
- **Employee** — platform staff (ReBAC `org-admin`-on-root); operates cross-org from a dedicated console,
  never holds a per-org membership row in a customer org.
- **Person with org(s)** — switches between a **Personal** context and an **active-org** context over the
  org(s)/sub-orgs they belong to.

### ✅ Features In Scope
- [ ] Feature 1: **Provisioning** — drop `type='personal'` org creation; upsert a root
      `organization_memberships(role='member', status='active')` row on signup and on the auth self-heal
      paths, behind `fuzefront.identity.root-membership` (default OFF).
- [ ] Feature 2: **Migration** — backfill a root `member` row for every existing user; reclassify
      `type='personal'` → `type='organization'` non-destructively (nothing deleted; personal-scope app
      installs are keyed to `userId`, unaffected).
- [ ] Feature 3: **Org-tree unification for portals** — reconcile FF-EPIC-09's `portals`/`portal_domains`
      design and FF-EPIC-11's `users.home_portal_id` FK onto `organizations + parent_id`: a portal is an
      org whose `parent_id` = the platform root, carrying tenant attributes (domain/branding/catalog/
      reseller-billing) that ordinary sub-orgs lack. No separate portal-service entity.
- [ ] Feature 4: **Employee formalization** — a named "Employee" role = ReBAC `org-admin`-on-root, surfaced
      in the role catalog, operating cross-org without a per-org membership row.
- [ ] Feature 5: **Six UI flows** (frames-first, per `CLAUDE.md`'s design-first gate):
      1. Personal identity + org/portal context switcher (root shows `MEMBER`; reconciles
         `OrganizationPage`'s local `<select>` with the canonical persisted `UserMenu` switcher).
      2. Root/portal member directory ("members of root = everyone"; paginated/searchable).
      3. Per-org members & roles reconciled with the `authz-admin` frames, including hiding above-org
         (parent/root) ReBAC principals.
      4. Portal-management console (root owner) — reconciled onto org-tree endpoints.
      5. Employee cross-org staff console.
      6. "My orgs & sub-orgs" single-active-org view.

### 🚫 Out of Scope
- Building the six UI flows' visual design itself — that is `product-designer`'s frames work (S3), gated
  by `gate-ds-conformance` / `gate-frames-schema` / `gate-frames-stamped`; this epic tracks it, does not
  design it.
- Re-litigating the ReBAC parent→child derivation mechanics — owned by FF-EPIC-05 (S4); this epic only
  formalizes the Employee *name* and *console* on top of that existing derivation.
- FF-EPIC-12 (per-portal app catalog), FF-EPIC-13 (white-label branding), FF-EPIC-15 (reseller billing),
  FF-EPIC-16 (custom domains) internals — unaffected by this reconciliation beyond the schema pointer
  change from `portals.id` to `organizations.id` (tracked in S7).
- Granular Employee staff tiers (beyond the single ReBAC `org-admin`-on-root scope) — a later authz design
  if the business wants finer-grained platform-staff roles.

### 🏗️ High-Level Architecture Notes
> **Which backend is live:** there are two near-identical backends — `backend/security/src/**` (split
> service; serves identity-ui `/roles` + members routes) and `backend/src/**` (monolith; has the
> `permit_org_parent` step + portal-scoped members). Confirm which serves prod `/api/organizations` and
> signup provisioning before implementing S1, and mirror into the other if both deploy (`release.yml`
> builds both images) — this is the first sub-task of S1, not an assumption.
>
> **Provisioning:** `organizationProvisioning.ts` (`ensurePersonalOrg` / `runInternalProvision`, both
> copies: `backend/src/services/organizationProvisioning.ts` and
> `backend/security/src/services/organizationProvisioning.ts`) and the auth self-heal hooks
> (`backend/security/src/routes/auth.ts` OIDC callback + local/password login) upsert the root membership
> idempotently via `assignOrganizationRole(...)` (`backend/src/utils/permit/role-assignment.ts`) so the
> Permit tenant role tracks the row — root id is the pinned `ROOT_ORG_ID` from
> `backend/src/migrations/015_seed_root_platform_organization.ts`.
>
> **Org list already works:** `GET /api/organizations` already returns `user_role` (#529,
> `frontend/src/pages/OrganizationPage.tsx:34`); with root membership, root resolves to `user_role='member'`
> and the GUEST state (`OrganizationPage.tsx:331,503`) disappears — no server code change expected there,
> only a regression test.
>
> **Portal = org-tree node:** superseding FF-EPIC-09-S1's standalone `portals`/`portal_domains` tables and
> FF-EPIC-11-S1's `users.home_portal_id → portals.id` FK. Portal identity becomes: an `organizations` row
> whose `parent_id` = the platform root org id, flagged as a tenant root (e.g. `is_portal_root boolean` or
> equivalent on `organizations`, or a thin `organization_portal_attributes(organization_id PK, domain,
> branding jsonb, catalog jsonb, billing_mode, identity_policy jsonb)` extension table — final column
> placement decided at build time, but the **identifying FK is `organizations.id`, never a new base
> table**). `users.home_portal_id` (FF-EPIC-11-S1) is retargeted to the nearest portal-root ancestor
> derived from `organization_memberships` + `organizations.parent_id`, not a separate `portals.id`.
>
> **Employee:** the existing ReBAC `org-admin`-on-root derivation (`backend/src/services/rootOrgAdmin.ts`,
> `backend/src/permit/schema.ts`) gets a named role-catalog entry (`Employee`) surfaced wherever roles are
> listed, and an explicit "no per-org membership row" contract distinguishing it from a customer-org member.
>
> **UI:** `frontend/src/components/WorkspaceProvisioningGate.tsx`, `frontend/src/lib/shared.tsx`
> (`setActiveOrganization`, line ~260), `frontend/src/components/UserMenu.tsx`,
> `frontend/src/pages/OrganizationPage.tsx` (local `<select>` at line ~231) are the frontend touch points —
> all gated behind the design-first pipeline (frames must be approved and merged before any of these files
> change).
>
> **Flags:** `fuzefront.identity.root-membership` (S1/S2, default OFF, locked name); `fuzefront.identity.
> personal-context` (S4, default OFF, per the in-progress `identity-context-switcher` frames'
> `contract.featureFlag`) gates the Personal-context switcher UI; reuses `fuzefront.platform.multi-tenant-
> portals` (FF-EPIC-09-S4) as the master switch for portal-org-tree work (S7); a new `fuzefront.identity.
> employee-console` (S8/S9, default OFF) for the Employee role + console. Real authz stays in Permit —
> every flag here is rollout convenience only, never the authz decision.

### 📊 Success Metrics
| Metric | Current Baseline | Target |
|--------|-----------------|--------|
| New/existing users showing `GUEST` on the root org | 100% (confirmed live, #529) | 0% — root always resolves `user_role='member'` |
| `type='personal'` orgs created on new signup | 100% of signups | 0% (flag ON); existing personal orgs reclassified `organization`, none deleted |
| Portal identity modeled as a separate base table | Yes (FF-EPIC-09-S1 design) | No — portal = `organizations` row with `parent_id` = platform root |
| "Employee" role discoverable in the role catalog | No (implicit ReBAC only) | Yes — named entry, cross-org, zero per-org membership rows |
| Of the 6 UI flows, flows with an approved frame before implementation starts | 0 of 6 | 6 of 6 (`gate-frames-first` enforced) |

### 📋 Child Stories
| Story ID | Summary | Status |
|----------|---------|--------|
| FF-EPIC-17-S1 | Provisioning: drop personal org, upsert root membership (flagged) | Open |
| FF-EPIC-17-S2 | Migration: backfill root membership + reclassify personal orgs | Open |
| FF-EPIC-17-S3 | Designer frames: switcher, member directory, per-org reconciliation, portal console, Employee console, my-orgs view | Open |
| FF-EPIC-17-S4 | Personal identity + org/portal context switcher + "my orgs & sub-orgs" view | Open |
| FF-EPIC-17-S5 | Root/portal member directory (paginated/searchable) | Open |
| FF-EPIC-17-S6 | Per-org members & roles reconciled with `authz-admin`, hiding above-org principals | Open |
| FF-EPIC-17-S7 | Portal-management console reconciled onto the org tree | Open |
| FF-EPIC-17-S8 | Formalize Employee = ReBAC `org-admin`-on-root | Open |
| FF-EPIC-17-S9 | Employee cross-org staff console | Open |

### 🔗 Dependencies
- **Blocked By:** — (S1/S2 are foundational; S3 frames are authored against these decisions, not against
  unmerged implementation).
- **Reconciles / supersedes:**
  - **FF-EPIC-03** (Security/Org-management UI) — S1/S2 (permissions + members list) are unaffected and
    stay the source of truth for per-org role/member management; this epic's S6 only adds the
    "hide above-org principals" AC explicitly and extends the same `authz-admin` frames. No duplication.
  - **FF-EPIC-05** (Multi-product authn/authz) — S4 (ReBAC FuzeOne-root parent→child derivation) is
    consumed, not re-implemented; this epic's S8 only names/surfaces it as "Employee". No duplication.
  - **FF-EPIC-09** (Portal core) — S1's `portals`/`portal_domains` schema design and S3's portal CRUD API
    are **superseded** by this epic's S7 (org-tree unification); S2 (resumable provisioning pipeline
    pattern) and S4 (master flag) are reused as-is. See the reconciliation note added to
    `EPIC-09-portal-core.md`.
  - **FF-EPIC-11** (Tenant-scoped identity) — S1's `users.home_portal_id → portals.id` FK is **superseded**
    by S7's org-ancestry derivation; S2/S3/S5/S6 (scoping enforcement, invitations, cross-portal login
    rejection, flag) are unaffected in behavior, only in what `home_portal_id` resolves against. See the
    reconciliation note added to `EPIC-11-tenant-scoped-identity.md`.
  - **FF-EPIC-14** (Admin consoles UI) — S1's frames and S2's master-admin portal console are unaffected in
    UX but their contract (`@fuzefront/portal-client` against `services/portal-service/openapi.yaml`) is
    **superseded** by org-tree endpoints from this epic's S7; S9 (Employee console) is new work this epic
    adds to that console family. See the reconciliation note added to `EPIC-14-admin-consoles-ui.md`.
- **Blocks:** FF-EPIC-09-S3, FF-EPIC-11-S1, FF-EPIC-14-S2 should not merge their superseded portions until
  S7 lands (or land them and file a fast-follow migration — orchestrator's call at build time).

### 📎 References
- Plan of record: `/root/.claude/plans/as-you-can-see-glimmering-rabbit.md`
- `frontend/src/pages/OrganizationPage.tsx` (GUEST state, local `<select>`); `frontend/src/lib/shared.tsx`
  (`setActiveOrganization`); `frontend/src/components/UserMenu.tsx`
- `backend/src/services/organizationProvisioning.ts`; `backend/security/src/services/organizationProvisioning.ts`;
  `backend/security/src/routes/auth.ts`
- `backend/src/migrations/015_seed_root_platform_organization.ts` (`ROOT_ORG_ID`)
- `backend/src/services/rootOrgAdmin.ts`; `backend/src/permit/schema.ts`;
  `backend/src/utils/permit/resource-instances.ts`; `backend/src/utils/permit/role-assignment.ts`
- Frames: `design/frames/authz-admin/**`, `design/frames/portal-admin-consoles/**` (both currently
  **unapproved** — `"approved": false` on every flow in both manifests)
- `.claude/skills/feature-flags/`

---

## Stories

### 📖 Story: Provisioning drops the personal org and grants root membership on signup

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-17-S1 |
| **Parent Epic** | FF-EPIC-17 — Personal identity, root membership & portal/Employee reconciliation |
| **Priority** | Critical |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 20 (4 BE-discovery + 8 BE + 4 BE-mirror + 4 QA) |
| **Tech Layers** | Backend |

#### 🧑‍💼 User Story
> As a **regular person**, I want **to become a `member` of the root "FuzeFront" org the moment I sign up
> or log in, without a personal org being created for me**, so that **I see myself as MEMBER, not GUEST, of
> the platform I just joined**.

#### 📌 Background & Context
Confirms which backend serves prod signup provisioning first (`backend/security/src/**` vs
`backend/src/**`), then in `organizationProvisioning.ts` (`ensurePersonalOrg` / `runInternalProvision`,
both copies) and the auth self-heal hooks (`backend/security/src/routes/auth.ts`), upserts
`organization_memberships(user, ROOT_ORG_ID, role='member', status='active')` idempotently via
`assignOrganizationRole(...)` and stops creating `type='personal'` orgs — all behind
`fuzefront.identity.root-membership` (default OFF).

#### ✅ Acceptance Criteria
1. **Given** the flag `fuzefront.identity.root-membership` is ON **When** a new user signs up **Then** a
   root `organization_memberships` row (`role='member'`, `status='active'`) is created and no
   `type='personal'` org is created for them.
2. **Given** the flag is ON **When** an existing user without a root membership logs in (OIDC callback or
   local/password) **Then** the self-heal path upserts the root membership idempotently (no duplicate row
   on repeated logins).
3. **Edge case:** **Given** the flag is OFF (default) **When** a user signs up or logs in **Then** today's
   behavior (personal org creation, no root membership) is unchanged — zero regression.
4. **Error case:** **Given** both `backend/security/src/**` and `backend/src/**` provisioning copies exist
   **When** only one is confirmed live in prod **Then** the change lands in the live one first and is
   mirrored into the other before this story is marked done — never left inconsistent between the two.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Backend unit + integration tests passing, coverage ≥ 80%
- [ ] Both flag states (ON/OFF) explicitly tested
- [ ] Change mirrored into both `backend/src/**` and `backend/security/src/**` if both deploy
- [ ] Root-membership upsert uses `assignOrganizationRole(...)` so Permit tracks the row (appsec-reviewer pass)
- [ ] `fuzefront.identity.root-membership` registered in the flag taxonomy (owner + removal criterion)

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| Backend | Confirm live provisioning backend (security vs monolith) via ingress/nginx routing | 4 | Open |
| Backend | Root-membership upsert in `ensurePersonalOrg`/`runInternalProvision` + auth self-heal hooks, flagged | 8 | Open |
| Backend | Mirror change into the non-live backend copy if both deploy | 4 | Open |
| QA | Tests: flag ON creates root membership + no personal org (idempotent on repeat login); flag OFF unchanged | 4 | Open |

#### 🔗 Dependencies
- **Blocks:** FF-EPIC-17-S2 (migration assumes this provisioning path exists), FF-EPIC-17-S4 (switcher UI
  reads the new `user_role='member'` state).

#### ⚠️ Risks & Assumptions
- **Assumption:** `assignOrganizationRole(...)` already handles idempotent Permit tenant-role assignment.
- **Risk:** Two near-identical backend copies drifting — mitigate by mirroring in the same PR, not a
  follow-up.

#### 📎 References
- `backend/security/src/services/organizationProvisioning.ts`; `backend/src/services/organizationProvisioning.ts`;
  `backend/security/src/routes/auth.ts`; `backend/src/utils/permit/role-assignment.ts`

---

### 📖 Story: Existing users and orgs are migrated to the new model, non-destructively

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-17-S2 |
| **Parent Epic** | FF-EPIC-17 — Personal identity, root membership & portal/Employee reconciliation |
| **Priority** | Critical |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 16 (8 BE + 4 BE + 4 QA) |
| **Tech Layers** | Backend |
| **Labels** | `deploy-window` |

#### 🧑‍💼 User Story
> As the **root owner**, I want **every existing user backfilled with a root membership and every existing
> `type='personal'` org non-destructively reclassified to `organization`**, so that **the platform-wide
> switch to root membership doesn't leave any existing account behind or lose data**.

#### 📌 Background & Context
Ordered, idempotent migration in `backend/security/src/migrations/` + `backend/src/migrations/`: (a)
backfill a root `member` row for every user missing one; (b) reclassify `type='personal'` →
`type='organization'` (default; nothing deleted — personal-scope app installs are keyed to `userId`, not
the org). Deprecates use of the `'personal'` enum value but keeps it for back-compat. Runs on deploy —
land in a deploy window per `master`'s deploy-on-push posture.

#### ✅ Acceptance Criteria
1. **Given** a production-shaped database with existing users and `type='personal'` orgs **When** the
   migration runs **Then** every user missing a root membership gets one, and every `type='personal'` org
   is reclassified to `type='organization'` — zero rows deleted.
2. **Given** the migration completes **When** a previously-personal org is queried **Then** its data
   (settings, app installs keyed to `userId`) is unchanged; only the `type` column differs.
3. **Edge case:** **Given** a user record whose org cannot be resolved at migration time **When** the
   backfill runs **Then** that user still gets a root membership (root membership is universal and doesn't
   depend on org resolution) rather than being skipped.
4. **Error case:** **Given** the migration is run twice **When** it re-runs against an already-migrated
   database **Then** it is a no-op — no duplicate root-membership rows, no re-reclassification errors,
   proven by running the migration on a scratch DB and re-running it.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Migration unit tests passing, coverage ≥ 80%
- [ ] Idempotency proven: run + re-run on a scratch DB with no diff
- [ ] Reclassify-vs-delete-if-empty decision documented in the migration changelog (reclassify is the
      recommended, non-destructive default per the locked decision)
- [ ] Merged and deployed only inside a deploy window (`master` is deploy-on-push)

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| Backend | Migration: backfill root `member` row for every existing user (both `backend/src` + `backend/security/src`) | 8 | Open |
| Backend | Migration: reclassify `type='personal'` → `type='organization'`, deprecate enum value (keep for back-compat) | 4 | Open |
| QA | Idempotency test (run + re-run, scratch DB) + backfill/reclassify assertions | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-17-S1 (provisioning path this migration complements).
- **Related:** `deploy-window` label — coordinate merge timing with the orchestrator.

#### ⚠️ Risks & Assumptions
- **Assumption:** Reclassify (not delete-if-empty) is the confirmed strategy — every existing user ends up
  owning a former-personal org while new users won't; acceptable, noted in release comms.
- **Risk:** A large `users`/`organizations` table backfill could lock under load — mitigate with a
  batched/backgroundable backfill rather than a single UPDATE.

#### 📎 References
- `backend/security/src/migrations/`; `backend/src/migrations/`

---

### 📖 Story: Designer frames for all six reconciled identity/portal/Employee flows

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-17-S3 |
| **Parent Epic** | FF-EPIC-17 — Personal identity, root membership & portal/Employee reconciliation |
| **Priority** | Critical |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 8 (8 UX) |
| **Tech Layers** | Design / UX |

#### 🧑‍💼 User Story
> As a **product-designer**, I want **every screen touched by this reconciliation — the personal/org/portal
> switcher, root/portal member directory, per-org members reconciliation, portal-management console,
> Employee console, and the my-orgs view — designed across all states before any code is written**, so
> that **no implementer invents UX or architecture the frames didn't already approve**.

#### 📌 Background & Context
`product-designer` is the **sole** author of `design/frames/**`. This is a **frames-ONLY PR** — no
`frontend/src/**` changes. As of this backlog update, `product-designer` has **already started** three new
frame sets in parallel with this ticket (`design/frames/identity-context-switcher/`,
`design/frames/member-directory/`, `design/frames/employee-console/` — all currently in-progress/
unapproved), alongside extending the two existing (also currently unapproved) sets —
`design/frames/authz-admin/**` (per-org members reconciliation, hiding above-org principals) and
`design/frames/portal-admin-consoles/**` (portal console reconciled onto the org tree). This story tracks
that work to completion/approval; it does not restart it. `identity-context-switcher` explicitly reconciles
`OrganizationPage.tsx`'s local `<select>` with `UserMenu.tsx`'s canonical `setActiveOrganization`
(`frontend/src/lib/shared.tsx`) and `WorkspaceProvisioningGate.tsx`. Gates S4–S9.

#### ✅ Acceptance Criteria
1. **Given** the six flows in scope **When** `product-designer` completes the frames **Then**
   `design/frames/identity-context-switcher/` (personal/org/portal switcher + my-orgs view),
   `design/frames/member-directory/` (root/portal member directory), and
   `design/frames/employee-console/` (Employee cross-org console) each have a complete `manifest.json` +
   `tokens.css` + ordered frame HTML declaring the build inventory; `design/frames/authz-admin/` and
   `design/frames/portal-admin-consoles/` gain their respective reconciliation states.
2. **Given** the frames are complete **When** `gate-frames-schema`, `gate-ds-conformance`, and
   `gate-frames-stamped` run in CI **Then** all three pass for every touched/added frame set.
3. **Edge case:** **Given** a user with zero orgs beyond root, and a root/portal directory with zero
   non-root members yet **When** the frames render those screens **Then** explicit empty states are
   included, not just populated-table happy paths.
4. **Error case:** **Given** a non-Employee/non-Master-Admin reaching the Employee console or portal
   console **When** the frames are authored **Then** an access-denied/hidden state is included per surface,
   matching the fail-closed authz model these consoles enforce.

#### 🔲 Definition of Done
- [ ] PR is frames-only — no `frontend/src/**` or `packages/*-ui/**` changes
- [ ] `gate-ds-conformance` green
- [ ] `gate-frames-schema` green
- [ ] `gate-frames-stamped` green
- [ ] Build inventory declared in each `manifest.json` (all five touched/new frame sets) and rendered in each `index.html`
- [ ] Owner approved per flow (switcher can be approved independently of the Employee console)
- [ ] PM verified all Acceptance Criteria against the published frames

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| UX Task | Complete/finalize `design/frames/identity-context-switcher/`, `design/frames/member-directory/`, `design/frames/employee-console/` (in progress) + extend `design/frames/authz-admin/**` and `design/frames/portal-admin-consoles/**`; loading/empty/error/access-denied states + build inventory in every manifest | 8 | Open |

#### 🔗 Dependencies
- **Blocked By:** — (frames are authored against this epic's decisions, not against unmerged
  implementation of S1/S2/S7/S8).
- **Blocks:** FF-EPIC-17-S4, S5, S6, S7, S9.

#### ⚠️ Risks & Assumptions
- **Assumption:** The reconciled org-tree contract (portal = org with `parent_id`) is stable enough to
  design against even before S7 merges.
- **Risk:** Five frame sets (three new + two extended) risk reviewer overload — mitigate via the
  CLAUDE.md per-flow approval model (one ready flow never waits on an unready sibling).

#### 📎 References
- `design/frames/identity-context-switcher/manifest.json`; `design/frames/member-directory/`;
  `design/frames/employee-console/`; `design/frames/authz-admin/manifest.json`;
  `design/frames/portal-admin-consoles/manifest.json`
- `frontend/src/pages/OrganizationPage.tsx`; `frontend/src/components/UserMenu.tsx`; `frontend/src/lib/shared.tsx`

---

### 📖 Story: A person switches between their Personal identity and any org/portal they belong to

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-17-S4 |
| **Parent Epic** | FF-EPIC-17 — Personal identity, root membership & portal/Employee reconciliation |
| **Priority** | High |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 20 (8 FE + 8 FE + 4 QA) |
| **Tech Layers** | Frontend |

#### 🧑‍💼 User Story
> As a **person with org(s)**, I want **a single canonical context switcher between my Personal identity and
> any org/sub-org I belong to (with a "my orgs & sub-orgs" single-active-org view), and to see the platform
> root as MEMBER rather than GUEST**, so that **I have one consistent, trustworthy way to know which
> identity/context I'm acting as, instead of two inconsistent switchers**.

#### 📌 Background & Context
Today there are **two** switchers: `OrganizationPage.tsx`'s local `<select>` (line ~231, component-local
state, doesn't persist) and the canonical persisted `UserMenu` switcher (`lib/shared.tsx
setActiveOrganization`, line ~260). This story retires the local `<select>` in favor of the canonical
switcher, adds a **Personal** (non-org) context option, adds a "my orgs & sub-orgs" single-active-org list
view, and — once FF-EPIC-17-S1/S2 ship — the root org resolves `user_role='member'` so the `GUEST` badge
(`OrganizationPage.tsx:331`) and "You're not a member of this organization" copy (`:503`) never render for
root.

#### ✅ Acceptance Criteria
1. **Given** a signed-in user **When** they open the context switcher **Then** it shows Personal, the
   platform root (badge `MEMBER`, never `GUEST`), and every org/sub-org they belong to — sourced from the
   canonical `UserMenu`/`setActiveOrganization` state, not a second local `<select>`.
2. **Given** a user selects an org/sub-org **When** the switch completes **Then** `OrganizationPage`
   reflects the same active context as `UserMenu` (single source of truth) and the choice persists across
   navigation/reload.
3. **Edge case:** **Given** a user belongs only to root (no other orgs) **When** they open "my orgs &
   sub-orgs" **Then** it shows just root with `MEMBER`, not an empty/broken list.
4. **Error case:** **Given** the root-membership backfill (S2) has not yet reached a given legacy account
   **When** that account opens `/organizations` **Then** the UI fails closed to a clear "membership
   pending" state — never a raw GUEST/error page — while the self-heal login path (S1) catches it up.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] RTL tests passing, coverage ≥ 80%
- [ ] `gate-ds-conformance` green
- [ ] Matches approved `design/frames/identity-context-switcher` frame from S3 — designer sign-off
- [ ] `OrganizationPage`'s local `<select>` removed in favor of the canonical switcher (no dual state)
- [ ] Console-clean per `ui-runtime-validation` (0 console errors)
- [ ] PM verified all Acceptance Criteria on staging

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| Frontend | Retire `OrganizationPage` local `<select>`; add Personal context to `UserMenu`/`setActiveOrganization`; root MEMBER badge | 8 | Open |
| Frontend | "My orgs & sub-orgs" single-active-org view | 8 | Open |
| QA | RTL: switcher single-source-of-truth, root MEMBER not GUEST, my-orgs view, membership-pending fail-closed | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-17-S3 (approved frames); FF-EPIC-17-S1/S2 (root membership must exist for the
  MEMBER badge to be true, not cosmetic).

#### ⚠️ Risks & Assumptions
- **Assumption:** `UserMenu`'s `setActiveOrganization` persistence mechanism can be extended to a
  "Personal" pseudo-context without a schema change.
- **Risk:** Removing the local `<select>` could regress any test/flow that depended on it — audit
  `frontend/src/__tests__/OrganizationPage.membership.test.tsx` before removal.

#### 📎 References
- `frontend/src/pages/OrganizationPage.tsx`; `frontend/src/components/UserMenu.tsx`;
  `frontend/src/lib/shared.tsx`; `frontend/src/__tests__/OrganizationPage.membership.test.tsx`

---

### 📖 Story: Root/portal member directory — "members of root/portal" is a searchable user directory

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-17-S5 |
| **Parent Epic** | FF-EPIC-17 — Personal identity, root membership & portal/Employee reconciliation |
| **Priority** | High |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 20 (8 BE + 8 FE + 4 QA) |
| **Tech Layers** | Full-Stack |
| **Labels** | `paginated` |

#### 🧑‍💼 User Story
> As a **root owner / Portal Admin**, I want **a paginated, searchable directory of every member of the
> root org (or my portal)** so that **I can browse "everyone on the platform / in my portal" without it
> being an unbounded, unpaginated dump — since with literal membership rows, "members of root" now
> literally means everyone**.

#### 📌 Background & Context
Once FF-EPIC-17-S1/S2 make every user a literal root member, the existing per-org members list
(FF-EPIC-03-S2) — designed for a bounded org's member count — is the wrong shape for "everyone on the
platform." This story adds a distinct member-**directory** endpoint and screen, extending
`packages/security/openapi.yaml` + `@fuzefront/security-client` and the `authz-admin` frames from S3, gated
by `gate-pagination`.

#### ✅ Acceptance Criteria
1. **Given** a root owner **When** they open the root member directory **Then** it lists every root member
   (name, email, joined date), cursor-paginated per `gate-pagination`, with no duplicates across pages.
2. **Given** a search query **When** entered **Then** the directory filters server-side (not a full-list
   client-side filter) and remains paginated on the filtered result set.
3. **Edge case:** **Given** a portal (not root) with a handful of direct members **When** its directory is
   opened **Then** it correctly scopes to that portal's membership only — the directory is portal-relative,
   not always the global root.
4. **Error case:** **Given** a non-owner/non-Master-Admin requests the root directory **When** the request
   is made **Then** it is denied (403) fail-closed — the directory is a privileged, not public, surface.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Backend + RTL tests passing, coverage ≥ 80%
- [ ] `gate-pagination` green on the new directory endpoint
- [ ] Server-side search verified (not a client-side full-list filter)
- [ ] BOLA/authz verified (appsec-reviewer pass) — 403 for non-privileged callers
- [ ] Matches approved `design/frames/member-directory` frame from S3 — designer sign-off

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| Backend | Root/portal member-directory endpoint (paginated, server-side search, Permit-gated) | 8 | Open |
| Frontend | Directory UI (search, pagination, empty/error states) | 8 | Open |
| QA | Tests: pagination no-dup, server-side search, portal-relative scoping, non-privileged 403 | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-17-S1/S2 (root membership must exist), FF-EPIC-17-S3 (approved frames).
- **Related:** FF-EPIC-03-S2 (distinct: per-org bounded members list vs. this platform-wide/portal-wide
  directory — no duplication, different endpoint and different UI surface).

#### ⚠️ Risks & Assumptions
- **Assumption:** `packages/security/openapi.yaml` can add a directory endpoint without breaking the
  existing `GET /members` contract.
- **Risk:** "Everyone" at scale (thousands of root members) makes an unpaginated/unindexed query
  expensive — mitigate with a DB index on the membership/search columns before this ships.

#### 📎 References
- `packages/security/openapi.yaml`; `design/frames/authz-admin/manifest.json`

---

### 📖 Story: Per-org members reconciled with `authz-admin` — above-org principals stay hidden

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-17-S6 |
| **Parent Epic** | FF-EPIC-17 — Personal identity, root membership & portal/Employee reconciliation |
| **Priority** | Medium |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 8 (4 BE + 4 QA) |
| **Tech Layers** | Backend |

#### 🧑‍💼 User Story
> As a **sub-org owner**, I want **my org's member list to show only my org's direct members — never
> parent/root admins who derive access via ReBAC but hold no membership row in my org** so that **my
> members list stays an accurate picture of who I invited, not an inflated list of everyone with
> inherited platform access**.

#### 📌 Background & Context
Per the locked decision, this is largely satisfied **by omission** already: FF-EPIC-03-S1/S2's members list
reads direct `organization_memberships` rows only, and parent/root ReBAC admins have no membership row in a
child org. This story makes that guarantee **explicit** — adds the AC and a regression test to
FF-EPIC-03-S2's existing endpoint rather than duplicating it, and extends the `authz-admin` frames (S3)
with an explicit "above-org principals hidden" state so the guarantee is visible in the design artifact,
not just implied by query shape.

#### ✅ Acceptance Criteria
1. **Given** a sub-org with 3 direct members and a parent/root org-admin with ReBAC-derived access to that
   sub-org **When** the sub-org's Members list is opened **Then** exactly 3 members are shown — the
   parent/root admin never appears as a row.
2. **Given** the same sub-org **When** the parent/root admin actually acts on the sub-org (e.g., via the
   Employee console, S9) **Then** their action is still authorized via ReBAC derivation — hiding them from
   the *list* never means hiding them from *authorization*.
3. **Edge case:** **Given** a parent/root admin is *also* separately invited as a direct member of the
   sub-org **When** the list renders **Then** they appear exactly once (as a direct member), not twice and
   not as a "derived" row.
4. **Error case:** **Given** a member-list query accidentally joins through the ReBAC derivation table
   instead of `organization_memberships` directly **When** caught by the regression test **Then** the test
   fails loudly — this AC is the guard against that regression.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Regression test added to `FF-EPIC-03-S2`'s members-list test suite, passing
- [ ] `design/frames/authz-admin` "above-org principals hidden" state present (from S3) and matched
- [ ] No new endpoint introduced — this is a guard on the existing FF-EPIC-03-S2 endpoint
- [ ] Dedup verified for the direct-member + ReBAC-derived-admin overlap case (AC3)
- [ ] appsec-reviewer confirms the derivation table is never joined into the members-list query

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| Backend | Explicit query-shape assertion: members list reads `organization_memberships` only, never the ReBAC derivation table | 4 | Open |
| QA | Regression test: parent/root admin hidden from sub-org list but still authorized via ReBAC; dedup on direct+derived overlap | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-17-S3 (approved frame state); FF-EPIC-03-S1/S2 (the endpoint this extends).
- **Related:** FF-EPIC-05-S4 (the ReBAC derivation this story confirms is list-invisible but auth-visible).

#### ⚠️ Risks & Assumptions
- **Assumption:** FF-EPIC-03-S2's members-list query already joins only `organization_memberships` (per
  the plan's "satisfied by omission" analysis) — verify at build time rather than assuming blind.
- **Risk:** A future refactor could accidentally start joining the ReBAC table for "convenience" and
  silently reintroduce inflated member lists — the regression test in this story is the permanent guard.

#### 📎 References
- FF-EPIC-03-S1/S2 (`docs/planning/epics/EPIC-03-security-org-management-ui.md`)
- `design/frames/authz-admin/manifest.json`

---

### 📖 Story: Portal-management console reconciled onto the org tree

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-17-S7 |
| **Parent Epic** | FF-EPIC-17 — Personal identity, root membership & portal/Employee reconciliation |
| **Priority** | High |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 20 (8 BE + 8 FE + 4 QA) |
| **Tech Layers** | Full-Stack |
| **Labels** | `contract-first`, `deploy-window` |

#### 🧑‍💼 User Story
> As the **root owner**, I want **the portal-management console to list/create/suspend/resume every
> second-level org child of the platform root — using the unified organizations+parent_id tree, not a
> separate `portals` table** so that **"portal" stays one concept (an org) instead of two competing
> tenancy models**.

#### 📌 Background & Context
Supersedes FF-EPIC-09-S1's standalone `portals`/`portal_domains` schema and FF-EPIC-09-S3's
`services/portal-service/openapi.yaml` CRUD contract (referenced as "anticipated" in
`design/frames/portal-admin-consoles/manifest.json`). Portal CRUD becomes org-tree operations: "list
portals" = "list orgs where `parent_id` = platform root and the portal-root attribute is set"; "create
portal" = "create an org with `parent_id` = platform root + tenant attributes"; "suspend" = an org-level
status flip. Reuses the resumable provisioning backbone pattern from `organizationProvisioning.ts`
(same pattern FF-EPIC-09-S2 specified, now targeting the org tree instead of a `portals` row).

#### ✅ Acceptance Criteria
1. **Given** a Master Admin calls the portal-list endpoint **When** the request is processed **Then** it
   returns orgs where `parent_id` = the platform root and the portal-root attribute is set — no `portals`
   table is queried or exists.
2. **Given** a Master Admin creates a new portal **When** the request succeeds **Then** an `organizations`
   row is created with `parent_id` = platform root and tenant attributes (domain/branding/catalog/
   reseller-billing) attached — reusing the same resumable provisioning backbone pattern as ordinary org
   provisioning.
3. **Edge case:** **Given** the root "FuzeFront" org itself **When** the portal list is queried **Then**
   root is never listed as a child of itself (it has no `parent_id`) — only true second-level portals
   appear.
4. **Error case:** **Given** a non-platform-admin calls any portal CRUD endpoint **When** authorized
   **Then** Permit denies it fail-closed (403) — same ReBAC parent→child derivation as everywhere else,
   never a separate/weaker portal-specific authz path.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Backend + RTL tests passing, coverage ≥ 80%
- [ ] OpenAPI updated: `services/portal-service/openapi.yaml` marked superseded/removed;
      portal CRUD folded into the organizations contract; `@fuzefront/portal-client` regenerated or retired
- [ ] `design/frames/portal-admin-consoles/manifest.json`'s "anticipated" portal-service contract entry
      updated to point at the org-tree endpoints
- [ ] Matches approved frame from S3 — designer sign-off
- [ ] No prod deploy without a deploy window (touches `master` deploy-on-push surfaces)

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| Backend | Portal CRUD as org-tree operations (parent_id=root + tenant-attribute extension); retire the standalone `portals` table design | 8 | Open |
| Frontend | Master-admin portal console wired to the org-tree endpoints (supersedes FF-EPIC-14-S2's anticipated `@fuzefront/portal-client`) | 8 | Open |
| QA | Contract + authz tests: list/create/suspend on org-tree, root-not-self-listed, non-admin 403 | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-17-S3 (approved frames); FF-EPIC-09-S2's provisioning-backbone pattern (reused,
  not FF-EPIC-09-S1's schema).
- **Supersedes:** FF-EPIC-09-S1 (portals/portal_domains schema), FF-EPIC-09-S3 (portal-service CRUD API),
  FF-EPIC-11-S1's `home_portal_id → portals.id` FK target (retargets to org ancestry).
- **Blocks:** FF-EPIC-14-S2 (master-admin portal console) should consume this contract, not the superseded
  one.

#### ⚠️ Risks & Assumptions
- **Assumption:** Tenant attributes (domain/branding/catalog/reseller-billing) can live as an
  `organizations`-keyed extension table without breaking FF-EPIC-12/13/15/16's existing designs against
  `portals.id` — each of those epics' schema references need a follow-up FK retarget (tracked, not done in
  this story).
- **Risk:** If FF-EPIC-09-S1/S3 or FF-EPIC-11-S1 have already merged against the standalone `portals`
  table before this story starts, this becomes a migration (not a greenfield design) — confirm merge state
  at build time.

#### 📎 References
- `backend/src/services/organizationProvisioning.ts`; `backend/src/migrations/004_create_organizations_table.ts`
- `design/frames/portal-admin-consoles/manifest.json` (`anticipated` → `@fuzefront/portal-client` entry)
- FF-EPIC-09-S1/S2/S3 (`docs/planning/epics/EPIC-09-portal-core.md`)

---

### 📖 Story: "Employee" is formalized as a named, scoped platform-staff role

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-17-S8 |
| **Parent Epic** | FF-EPIC-17 — Personal identity, root membership & portal/Employee reconciliation |
| **Priority** | Medium |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 12 (8 BE + 4 QA) |
| **Tech Layers** | Backend |

#### 🧑‍💼 User Story
> As **FuzeOne staff**, I want **my existing cross-org ReBAC `org-admin`-on-root authority to be named
> "Employee" in the role catalog** so that **the platform has one recognizable term for "platform staff who
> operate across every org without joining any of them," instead of an implicit consequence of a schema
> only engineers can see**.

#### 📌 Background & Context
This story does **not** reimplement ReBAC derivation — FF-EPIC-05-S4 already implements FuzeOne-root
parent→child derivation. It surfaces that existing derivation as a named role: anyone with ReBAC
`org-admin`-on-root is labeled "Employee" wherever roles are listed (role catalog, permissions screens,
member/directory rows), and formalizes the contract that Employees hold **zero** `organization_memberships`
rows in customer orgs — their access is always derived, never a membership.

#### ✅ Acceptance Criteria
1. **Given** a user with ReBAC `org-admin`-on-root **When** the role catalog is queried **Then** they are
   labeled "Employee" alongside (not replacing) the underlying ReBAC role key.
2. **Given** an Employee **When** their org memberships are inspected across every customer org **Then**
   zero `organization_memberships` rows exist for them in any customer org — their access is 100% derived.
3. **Edge case:** **Given** a user is both an Employee (root ReBAC admin) and a direct member of one
   specific customer org (e.g., they were separately invited) **When** the role catalog is queried **Then**
   both are shown distinctly (Employee-derived + direct-member), never merged into one ambiguous row.
4. **Error case:** **Given** an attempt to grant "Employee" by inserting a customer-org membership row
   directly (bypassing the root ReBAC grant) **When** validated **Then** it is rejected — Employee status
   can only be granted via the root ReBAC assignment, never faked via a membership row.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] Backend unit tests passing, coverage ≥ 80%
- [ ] Role catalog surfaces "Employee" consistently across every screen that lists roles
- [ ] Zero-membership-rows invariant covered by a regression test (appsec-reviewer pass)
- [ ] `fuzefront.identity.employee-console` flag registered (default OFF) gating the label rollout

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| Backend | Surface "Employee" label wherever ReBAC `org-admin`-on-root is resolved; role-catalog entry | 8 | Open |
| QA | Tests: zero-membership invariant, Employee+direct-member distinct rendering, membership-row-bypass rejection | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** — (consumes FF-EPIC-05-S4's already-implemented derivation).
- **Blocks:** FF-EPIC-17-S9 (the console this role powers).

#### ⚠️ Risks & Assumptions
- **Assumption:** FF-EPIC-05-S4's parent→child ReBAC derivation is merged/available to build against.
- **Risk:** Confusing "Employee" (a UI label) with a new authz primitive — it is a name over an existing
  derivation, never a new Permit resource/role type.

#### 📎 References
- `backend/src/services/rootOrgAdmin.ts`; `backend/src/permit/schema.ts`
- FF-EPIC-05-S4 (`docs/planning/epics/EPIC-05-multi-product-authn-authz.md`)

---

### 📖 Story: Employee cross-org staff console

| Field | Value |
|-------|-------|
| **Story ID** | FF-EPIC-17-S9 |
| **Parent Epic** | FF-EPIC-17 — Personal identity, root membership & portal/Employee reconciliation |
| **Priority** | Medium |
| **Sprint** | [TBD — sprint planning] |
| **Story Points** | 16 (8 FE + 4 BE + 4 QA) |
| **Tech Layers** | Full-Stack |

#### 🧑‍💼 User Story
> As an **Employee**, I want **a console that lists every portal/org I can act on cross-org — without ever
> showing me a per-org membership I don't hold** so that **I can support any tenant from one place, the way
> the ReBAC derivation already technically allows, but with an actual front door**.

#### 📌 Background & Context
Consumes FF-EPIC-17-S8's formalized Employee role and FF-EPIC-17-S7's org-tree portal listing. Distinct
from the Master-Admin portal-management console (S7/FF-EPIC-14-S2 — full CRUD authority): the Employee
console is a **support/visibility** surface across orgs, not a create/suspend authority surface (that stays
Master-Admin-only). Depends on the approved and merged frames from S3.

#### ✅ Acceptance Criteria
1. **Given** an authenticated Employee **When** they open the console **Then** they see every portal/org
   they can act on via ReBAC derivation — sourced from the org tree, never from a per-org membership list
   (they have none).
2. **Given** an Employee selects a specific org **When** they act on it (e.g., view its members) **Then**
   the action is authorized via the same ReBAC parent→child derivation Permit already enforces — the
   console is a UI over existing authority, not a new authority grant.
3. **Edge case:** **Given** an Employee with no support activity yet **When** the console loads **Then** an
   empty/onboarding state renders — never a blank or broken screen.
4. **Error case:** **Given** a non-Employee (e.g., an ordinary org member) reaches the console route **When**
   the page loads **Then** it renders an access-denied state (Permit-gated, fail-closed) — the route is
   never silently reachable.

#### 🔲 Definition of Done
- [ ] Code reviewed and approved (min. 1 reviewer)
- [ ] RTL unit tests passing, coverage ≥ 80%
- [ ] `gate-ds-conformance` green
- [ ] Authz-hidden-for-non-Employee verified (appsec-reviewer pass)
- [ ] Matches approved `design/frames/employee-console` frame from S3 — designer sign-off
- [ ] Console-clean per `ui-runtime-validation` (0 console errors)
- [ ] PM verified all Acceptance Criteria on staging

#### 📋 Sub-Tasks
| Type | Summary | Points | Status |
|------|---------|--------|--------|
| Backend | Cross-org listing endpoint scoped to ReBAC-derived authority only (no membership-row dependency) | 4 | Open |
| Frontend | Employee console UI: cross-org list, per-org drill-in, empty/access-denied states | 8 | Open |
| QA | RTL + authz-hidden-for-non-Employee test + console-clean check | 4 | Open |

#### 🔗 Dependencies
- **Blocked By:** FF-EPIC-17-S3 (approved frames); FF-EPIC-17-S8 (Employee role formalized);
  FF-EPIC-17-S7 (org-tree portal listing this console consumes).
- **Related:** FF-EPIC-14-S2 (Master-Admin portal console — full CRUD authority, distinct from this
  support/visibility console).

#### ⚠️ Risks & Assumptions
- **Assumption:** The cross-org listing endpoint can reuse FF-EPIC-17-S7's org-tree query shape rather
  than a third bespoke query path.
- **Risk:** Scope creep toward Master-Admin-equivalent authority — this console must stay read/support-
  scoped; any mutating action beyond that belongs in the Master-Admin console (S7/FF-EPIC-14-S2), not here.

#### 📎 References
- FF-EPIC-17-S7, FF-EPIC-17-S8
- `design/frames/employee-console/`
