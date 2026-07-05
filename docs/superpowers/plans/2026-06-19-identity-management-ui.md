# Identity Management UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable `@fuzefront/identity-ui` React package that provides a complete user / permissions / invitation management UI for organizations. The package is consumed by the host shell (`frontend/`) and future FuzeFront products. It renders custom UI on top of the fuse-seam design system (no Permit Elements), wires to the existing backend org/membership routes + a new `organization_invitations` table, and delegates email delivery to the email-service via `notify.email.requested` Kafka events. The v1 scope covers: member table with role assignment, single + bulk/CSV invite modal, pending-invite list with resend/revoke, and empty/loading/error states.

**Note on coordination:** API-token management screens will also live in `@fuzefront/identity-ui`. That plan has not been written yet; reserve the `ApiTokens*` component namespace and export it from the package public API as a stub so the package API does not have to break when the api-tokens plan lands.

---

## 1. Capability Statement & Hard Requirements

| Requirement | Detail |
|---|---|
| Roles | `owner` / `admin` / `member` / `viewer` mapped 1:1 to Permit.io roles |
| Invitations | Email + role; pending list; resend / revoke; bulk (multi-email textarea + CSV upload) |
| Email delivery | Via `notify.email.requested` Kafka event → email-service (see `2026-06-19-kafka-foundation-email-service.md`) |
| Persistence | New `organization_invitations` table in Postgres; token column is hashed |
| Permission gating | Host passes `userRole` prop; package enforces read-only for `viewer` + owner-only for role demotion of another owner |
| Theming | CSS custom properties only — the host's `[data-theme]` attribute propagates into the package's shadow-DOM-free components |
| i18n | React context provider bundles `en` and `he`; RTL layout via `dir="rtl"` on the root element |
| Accessibility | WCAG 2.1 AA — keyboard-navigable table, focus trap in modals, `aria-live` on status changes |
| Bundle | CommonJS + ESM dual outputs; no bundled Tailwind — consumers import the design-system CSS tokens |
| No lock-in | Clean exit: all Permit calls go through the existing `backend/src/utils/permit/` helpers; the package never calls Permit directly |

---

## 2. Library & Architecture Review

### 2a. Build vs Permit Elements

| Criterion | Permit Elements (prebuilt) | Custom on fuse-seam (chosen) |
|---|---|---|
| **Fit** | Covers user/role management but imposes Permit's own styling system. Cannot consume `--accent-color`, `--seam`, or fuse-seam tokens without fighting their CSS-in-JS layer. No CSV invite flow. No i18n. | Full control. Every atom is a fuse-seam component. CSV, bulk flow, he/RTL, and the exact permission model all fit natively. |
| **Maturity** | Stable, backed by Permit.io. | We build it; maintenance burden is ours. Offset: the components are simple CRUD forms — no novel algorithms. |
| **License** | Permit SDK: MIT. But Permit Elements is closed-source SaaS UI embedded via iframe/CDN — no audit. | MIT (same as the repo). |
| **Footprint** | ~200 KB gzipped iframe payload + SDK overhead. | ~12–20 KB gzipped for the component tree (no charting, no framework duplication). |
| **DX / types** | Props-based config via `<UserManagement />` wrapper; limited composability. | Full TypeScript generics, storybook-able, testable in isolation. |
| **Lock-in** | Tight to Permit's tenant model. Migrating off requires a complete UI rewrite. | Permit is an implementation detail of the backend; the package depends only on our own HTTP API. |
| **a11y** | Not documented; iframe model makes keyboard focus management hard. | We control the focus model. |

**Recommendation: Build.** Justification: Permit Elements would give us a working UI in ~1 day but at the cost of brand fidelity, i18n, CSV import, and auditability. Given that we already have `RoleBadge`, `Button`, `Input`, `Select` in the design system — and the backend already exposes the right endpoints — building on top of these primitives is the correct call. The design-system investment is only valuable if new UI features actually use it. Permit Elements would be the right call if this were a one-off admin tool rather than a customer-facing, multi-product package.

**Runner-up:** Permit Elements — reconsider only if requirements change to allow Permit-hosted UI and brand fidelity requirements are dropped.

---

### 2b. Data-Grid: TanStack Table v8 vs hand-rolled

| Criterion | TanStack Table v8 | Hand-rolled `<table>` |
|---|---|---|
| **Fit** | Sorting, filtering, pagination, virtualization, a11y patterns built in. Headless (no style opinions). | Full control but we rebuild sort/filter/pagination from scratch. |
| **Maturity** | v8 stable, MIT, 24 k GitHub stars, active releases. | N/A |
| **Bundle** | ~12 KB gzipped (headless, no styles). | ~3–5 KB but we write + test every feature. |
| **DX** | TypeScript generics for row shape. Works with fuse-seam tokens. | Simple for < 50 rows; brittle at scale or when export/sort needed. |

**Recommendation: TanStack Table v8.** The members table has sortable columns (name, email, role, joined date) and pagination; TanStack Table handles these without re-implementing well-tested logic. Pin at `@tanstack/react-table@8.21.3`.

---

### 2c. Form Validation: React Hook Form + Zod vs Formik + Yup

| Criterion | React Hook Form 7 + Zod 3 | Formik 2 + Yup |
|---|---|---|
| **Fit** | Uncontrolled inputs, minimal re-renders, first-class Zod resolver via `@hookform/resolvers`. | Controlled inputs, more re-renders, mature but heavier. |
| **Bundle** | RHF ~9 KB + Zod already a workspace dep (0 extra). | Formik ~15 KB + Yup ~14 KB = ~29 KB. |
| **DX** | `useForm<InviteFormData>()` with full TypeScript inference. | Similar but more verbose. |

**Recommendation: React Hook Form 7 + Zod 3.** Zod is already in `@fuzefront/shared`; zero incremental cost. Pin `react-hook-form@7.56.4`, `@hookform/resolvers@3.10.0`.

---

### 2d. CSV Parsing: PapaParse vs native `File.text()` + split

| Criterion | PapaParse 5 | Manual split |
|---|---|---|
| **Fit** | Handles quoted fields, CRLF, BOM, streaming. RFC 4180 compliant. | Fine for simple `email,role\n` files; breaks on quoted commas. |
| **Bundle** | ~25 KB gzipped. | ~0.2 KB. |
| **Risk** | None (MIT, stable). | User CSV with quoted fields silently corrupts the email list. |

**Recommendation: PapaParse.** Real-world CSVs from HR systems always have quoted fields. Pin `papaparse@5.5.2`, `@types/papaparse@5.3.15`.

---

## 3. Package Boundary: `@fuzefront/identity-ui`

```
packages/identity-ui/               ← NEW workspace package
  package.json                      (@fuzefront/identity-ui, 0.1.0)
  tsconfig.json
  vite.config.ts                    (library mode, dual CJS+ESM)
  src/
    index.ts                        ← public API (see §4)
    components/
      MembersTable/
        MembersTable.tsx            ← TanStack Table members grid
        MembersTable.test.tsx
        columns.ts                  ← column definitions
      RoleSelect/
        RoleSelect.tsx              ← DS Select wrapper + permission gating
        RoleSelect.test.tsx
      InviteModal/
        InviteModal.tsx             ← tabs: Single | Bulk/CSV
        InviteModal.test.tsx
        SingleInviteForm.tsx
        BulkInviteForm.tsx
        CsvUploadZone.tsx           ← drag-drop + PapaParse
      PendingInvitesList/
        PendingInvitesList.tsx
        PendingInvitesList.test.tsx
        PendingInviteRow.tsx
      IdentityPage/
        IdentityPage.tsx            ← tabbed page: Members | Pending | (API Tokens stub)
        IdentityPage.test.tsx
      EmptyState/
        EmptyState.tsx              ← empty/loading/error variants
      ApiTokens/
        ApiTokensStub.tsx           ← placeholder; real impl in separate plan
    hooks/
      useMembers.ts                 ← data fetching + mutation
      useInvitations.ts
      useRoleChange.ts
    api/
      identityClient.ts             ← thin wrappers over fetch/axios; no Permit
    i18n/
      IdentityI18nProvider.tsx
      locales/
        en.ts
        he.ts
    types.ts                        ← shared TS interfaces
  tests/
    e2e/
      invite-flow.spec.ts           ← Playwright invite → accept smoke test
```

**Root workspace change:** Add `"packages/identity-ui"` to the `workspaces` array in root `package.json`.

**Host shell mount point:** `frontend/src/pages/OrganizationPage.tsx` replaces its current `MembersManagement` import with `<IdentityPage organizationId={currentOrg.id} userRole={currentOrg.user_role} />`.

### Public API (`src/index.ts`)

```typescript
// Page-level
export { IdentityPage }             // main mount point for host shell
export type { IdentityPageProps }

// Composable atoms (for embedding in custom layouts)
export { MembersTable }
export { InviteModal }
export { PendingInvitesList }
export { RoleSelect }
export { EmptyState }

// API stubs (to be filled by api-tokens plan)
export { ApiTokensStub as ApiTokensPage }

// i18n
export { IdentityI18nProvider }
export type { IdentityLocale, IdentityMessages }

// Types
export type { Member, Invitation, OrgRole, IdentityApiClient }
```

---

## 4. Component Inventory & Specs

All components consume tokens from `design-system/tokens/` only — no hardcoded hex values.

### 4a. `MembersTable`

**Purpose:** Sortable, paginated list of active org members with inline role-assignment and removal.

**Props:**
```typescript
interface MembersTableProps {
  organizationId: string
  members: Member[]
  loading?: boolean
  error?: string | null
  userRole: OrgRole
  onRoleChange: (memberId: string, role: OrgRole) => Promise<void>
  onRemove: (memberId: string) => Promise<void>
}
```

**States / Variants:**

| State | Rendering |
|---|---|
| `loading` | 5-row skeleton (animated `--bg-quaternary` shimmer, `--duration-slow` pulse) |
| `error` | `EmptyState` variant `error` with retry CTA |
| `empty` | `EmptyState` variant `empty-members` — dashed border `--border-color`, Space Grotesk heading, secondary text, invite CTA |
| `idle` | TanStack Table; columns below |

**Columns:**
| Column | Token / Component | Sort |
|---|---|---|
| Avatar + Name | `Avatar` (DS `components/core/Avatar.jsx`), `--font-display` `--text-sm` | yes (lastName) |
| Email | `--font-sans` `--text-sm` `--text-secondary` | yes |
| Role | `RoleBadge` (DS `components/access/RoleBadge.jsx`) + `RoleSelect` (owner-only disabled) | yes |
| Status | `StatusPill` (DS `components/feedback/StatusPill.jsx`) with `active` → `--success-color`, `pending` → `--warning-color` | no |
| Joined | `--font-mono` `--text-2xs` `--text-tertiary` | yes |
| Actions | Remove `IconButton` variant `ghost` + `danger` hover, permission-gated |

**a11y:** `role="grid"`, `aria-sort` on column headers, focus ring on `RoleSelect` via `--ring` token, remove button `aria-label="Remove {name}"`.

---

### 4b. `RoleSelect`

**Purpose:** Inline `<select>` that maps to Permit roles. Disabled when caller's `userRole` is `viewer` or when target member's role is `owner`.

**Props:**
```typescript
interface RoleSelectProps {
  value: OrgRole
  disabled?: boolean
  onChange: (role: OrgRole) => void
  callerRole: OrgRole           // gates which roles can be assigned
}
```

**Token usage:** Wraps DS `components/forms/Select.jsx`. Border `--border-color`, focus `--accent-color` ring `--accent-soft`, background `--bg-secondary`. Option labels include icon SVG from `RoleBadge`.

**Variants:** `idle`, `loading` (spinner inline, opacity 0.6), `error` (shake animation `--ease-out`).

---

### 4c. `InviteModal`

**Purpose:** Two-tab dialog: **Single** (one email + role) and **Bulk** (textarea multi-email or CSV file).

**Props:**
```typescript
interface InviteModalProps {
  organizationId: string
  open: boolean
  onClose: () => void
  onSuccess: (count: number) => void
  defaultRole?: OrgRole
}
```

**Anatomy:**
- Dialog: `position: fixed`, `--bg-tertiary` background, `--radius-xl` (16px), `--shadow-lg`, `--seam` top border `::before` 2px (matches `.auth-form` pattern).
- Focus trap via `inert` on siblings (native HTML5 approach, no lib required).
- Close on Escape + backdrop click.

**Single tab:**
- `Input` (DS form/Input.jsx) for email, `type="email"` validation via Zod `z.string().email()`.
- `Select` (DS form/Select.jsx) for role: Admin / Member / Viewer (Owner not invitable).
- Submit = DS `Button` variant `primary` fullWidth. Loading state replaces text with spinner.
- Success: `Toast` (DS feedback/Toast.jsx) `variant="success"` auto-dismiss 4s.
- Error: `Input` `error` prop wired to RHF `fieldState.error.message`.

**Bulk tab:**
- `<textarea>` (styled with DS Input tokens) accepting newline-separated emails or paste.
- Drag-drop zone (`CsvUploadZone`) for `.csv` files. Drop target background `--accent-soft`, dashed border `--accent-color 2px`.
- PapaParse parses uploaded CSV: detects `email` column or falls back to first column.
- Role selector for all-batch role assignment.
- Preview list: parsed emails in a scrollable `--bg-quaternary` box, `--font-mono` `--text-2xs`, with `--error-color` highlight for invalid format rows.
- Submit disabled until at least one valid email.
- On success: `Toast` with count `"Invited 12 members"`.

**a11y:** `role="dialog"`, `aria-modal="true"`, `aria-labelledby` heading ID, `aria-live="polite"` on result summary.

---

### 4d. `PendingInvitesList`

**Purpose:** Table of invitations with `status = 'pending'`, with resend and revoke per row.

**Props:**
```typescript
interface PendingInvitesListProps {
  organizationId: string
  invitations: Invitation[]
  loading?: boolean
  userRole: OrgRole
  onResend: (invitationId: string) => Promise<void>
  onRevoke: (invitationId: string) => Promise<void>
}
```

**Columns:** Email | Role (`RoleBadge`) | Invited (`--font-mono` `--text-2xs`) | Expires | Actions.

**Row states:**
- Idle: Resend `IconButton ghost` + Revoke `IconButton ghost danger`.
- Resending: inline spinner on Resend; row `opacity: 0.7`.
- Revoked: row animates `opacity → 0` over `--duration-slow` then removes from list (optimistic update).
- Expired: `StatusPill` `variant="error"` on the date cell; Resend enabled, Revoke enabled.

**Empty state:** `EmptyState variant="no-pending"` — seam-styled divider + "No pending invitations" in `--text-tertiary`.

---

### 4e. `EmptyState`

**Purpose:** Consistent empty/loading/error rendering across all identity views.

```typescript
type EmptyStateVariant =
  | 'empty-members'
  | 'no-pending'
  | 'error'
  | 'loading'
  | 'no-orgs'

interface EmptyStateProps {
  variant: EmptyStateVariant
  onAction?: () => void
  actionLabel?: string
  message?: string
}
```

**Design:** `--radius-lg` box, `--border-color` dashed 2px (empty variants), `--shadow-xs` (error variant). Heading `--font-display` `--text-xl`. Subtext `--text-secondary`. CTA uses DS `Button variant="primary"`. Loading shows a `SeamDivider` (DS brand) animated shimmer.

---

### 4f. `IdentityPage`

**Purpose:** Top-level tabbed page that the host shell drops in. Owns data fetching via `useMembers` + `useInvitations`.

```typescript
interface IdentityPageProps {
  organizationId: string
  userRole: OrgRole
  apiClient?: IdentityApiClient     // optional override for tests
  locale?: 'en' | 'he'
  onMembersChange?: () => void      // callback for host re-sync
}
```

**Tabs:** Members | Pending Invitations | API Tokens (stub, renders `ApiTokensStub`).

**Tab bar:** Styled with `.help-tab` pattern from `index.css` — `--accent-color` active indicator, `--border-color` bottom border. Carries seam line as tab separator.

**Layout:** `max-width: var(--container-max)`, `padding: var(--space-8)`.

---

## 5. New Design System Additions

The following must be added to `design-system/` (new component files + DS manifest entries):

| New DS component | Purpose |
|---|---|
| `components/overlay/Modal.jsx` + `.d.ts` | Generic accessible modal shell (focus trap, backdrop, seam top-border). Used by InviteModal. |
| `components/data/DataTable.jsx` + `.d.ts` | Headless-ready table shell: `<thead>` sort icons, `<tbody>` skeleton rows, empty slot. Wraps TanStack Table rendering. |
| `components/forms/Textarea.jsx` + `.d.ts` | Multi-line input matching `Input` tokens; used by bulk invite. |
| `components/forms/FileDropZone.jsx` + `.d.ts` | Drag-drop file target; accent-color dashed border on hover; accepts file type hint. |

New tokens to add to `design-system/tokens/spacing.css`:
```css
--modal-max-w: 560px;
--modal-max-w-lg: 720px;
```

New token to add to `design-system/tokens/colors.css`:
```css
--drop-active: rgba(110, 92, 255, 0.18);   /* FileDropZone hover fill */
```

All four new components require entries in `design-system/_ds_manifest.json` under `"components"`.

---

## 6. Backend Endpoints Needed

### Existing endpoints (reconcile — already implemented)

| Method + Path | Notes |
|---|---|
| `GET /api/organizations/:id/members` | Returns `OrganizationMember[]` with nested `user` object. Already implemented. |
| `POST /api/organizations/:id/members` | Single invite (creates membership row `status=pending`). Already implemented. |
| `PUT /api/organizations/:id/members/:memberId` | Role change. Already implemented. |
| `DELETE /api/organizations/:id/members/:memberId` | Remove. Already implemented. |

### New endpoints needed (Plan B)

The `organization_invitations` table does not yet exist. The following must be added:

**Migration: `009_create_organization_invitations_table.ts`**

```sql
CREATE TABLE organization_invitations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invited_by   UUID NOT NULL REFERENCES users(id),
  email        TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'member',
  token_hash   TEXT NOT NULL UNIQUE,   -- bcrypt hash of the magic-link token
  status       TEXT NOT NULL DEFAULT 'pending', -- pending | accepted | revoked | expired
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at  TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ
);
CREATE INDEX ON organization_invitations(organization_id, status);
CREATE INDEX ON organization_invitations(email, status);
```

**New routes in `backend/src/routes/organizations.ts`:**

| Method + Path | Auth / Permission | Body / Response |
|---|---|---|
| `GET /api/organizations/:id/invitations` | `authenticateToken` + member of org | `Invitation[]` filtered by `status=pending` by default; `?status=all` |
| `POST /api/organizations/:id/invitations` | `UserManagement:invite` permission | `{ email, role }` → creates invitation row, emits `notify.email.requested` |
| `POST /api/organizations/:id/invitations/bulk` | `UserManagement:invite` | `{ invitations: [{email, role}][] }` → batch up to 50; returns `{ created, skipped, errors }` |
| `POST /api/organizations/:id/invitations/:invId/resend` | `UserManagement:invite` | Resets `expires_at`, emits new email event |
| `DELETE /api/organizations/:id/invitations/:invId` | `UserManagement:invite` | Soft-revokes: sets `status=revoked`, `revoked_at=NOW()` |
| `POST /api/invitations/accept/:token` | Public (no auth) | Validates token vs hash, creates active membership, marks `accepted_at` |

**Email integration:** Each invitation-creation route emits a `notify.email.requested` Kafka event with `templateName: 'org-invite'` and `vars: { orgName, inviterName, role, acceptUrl }`. This reuses the `org-invite.ts` template already planned in the email-service plan (`2026-06-19-kafka-foundation-email-service.md`).

**Bulk endpoint logic:** Deduplicate by email within the batch; skip emails that already have an active membership or non-revoked pending invitation (return in `skipped`); wrap in a DB transaction.

---

## 7. Host Shell Mount

**File:** `frontend/src/pages/OrganizationPage.tsx`

Replace the current `MembersManagement` tab content with:
```tsx
import { IdentityPage, IdentityI18nProvider } from '@fuzefront/identity-ui'

// Inside the "members" tab:
<IdentityI18nProvider locale={locale}>
  <IdentityPage
    organizationId={currentOrg.id}
    userRole={currentOrg.user_role ?? 'viewer'}
    onMembersChange={() => loadMembers(currentOrg.id)}
  />
</IdentityI18nProvider>
```

The existing `MembersManagement.tsx` component is **deprecated** (kept for reference until `@fuzefront/identity-ui` reaches feature parity, then deleted).

**Frontend vite.config.ts:** Add `@fuzefront/identity-ui` to Vite's `optimizeDeps.include` and ensure Module Federation's shared scope includes it.

---

## 8. Theming & i18n

### Theming

The package does **not** bundle any CSS. Consumers must import the design system token CSS:
```ts
// In host or in the package's peer-dep docs:
import '@fuzefront/design-system/tokens/colors.css'
import '@fuzefront/design-system/tokens/spacing.css'
import '@fuzefront/design-system/tokens/typography.css'
```

The host shell's `[data-theme="dark"|"light"]` attribute is inherited automatically (CSS custom properties cascade). The package checks `document.documentElement.dataset.theme` in no-op fallback only.

### i18n

```typescript
// packages/identity-ui/src/i18n/locales/en.ts
export const en = {
  members: { title: 'Members', empty: 'No members yet', invite: 'Invite member', ... },
  invitations: { pending: 'Pending', resend: 'Resend', revoke: 'Revoke', ... },
  roles: { owner: 'Owner', admin: 'Admin', member: 'Member', viewer: 'Viewer' },
  csv: { dragDrop: 'Drag a CSV file here', ... },
}
// packages/identity-ui/src/i18n/locales/he.ts
// Hebrew strings + dir="rtl" applied to the IdentityPage root div
```

`IdentityI18nProvider` uses React context. All text in the package is consumed via `useIdentityI18n()` hook. Components never have hardcoded English strings.

---

## 9. TDD Task Breakdown

### Phase 1 — Package scaffold + DS additions (no functionality)
- [ ] **Task 1.1** — Create `packages/identity-ui/` workspace skeleton: `package.json`, `tsconfig.json`, `vite.config.ts` (library mode, dual CJS+ESM), `src/index.ts` (empty exports). Add to root `workspaces`. **Verification:** `npm install` from root resolves `@fuzefront/identity-ui`.
- [ ] **Task 1.2** — Add `Modal`, `DataTable`, `Textarea`, `FileDropZone` to `design-system/`. Add manifest entries. Write prompt-md for each. **Verification:** DS build (`node design-system/build.mjs`) passes; new components render in DS cards.
- [ ] **Task 1.3** — Add new tokens (`--modal-max-w`, `--drop-active`) to `design-system/tokens/`. **Verification:** Tokens appear in `_ds_manifest.json` after rebuild.

### Phase 2 — Types + API client
- [ ] **Task 2.1** — Write `packages/identity-ui/src/types.ts`: `Member`, `Invitation`, `OrgRole`, `IdentityApiClient` interface. No logic. **Verification:** `tsc --noEmit` passes.
- [ ] **Task 2.2** — Implement `identityClient.ts` wrapping the five existing endpoints + the six new invitation endpoints. **Verification:** Unit tests mock `fetch`; each method sends the correct HTTP method + path.

### Phase 3 — Backend: invitations table + routes
- [ ] **Task 3.1** — Migration `009_create_organization_invitations_table.ts`. **Verification:** `npm run migrate` succeeds; `psql \d organization_invitations` shows expected schema.
- [ ] **Task 3.2** — Add `GET /api/organizations/:id/invitations`. **Verification:** Integration test returns empty array for new org; returns pending invitations after POST.
- [ ] **Task 3.3** — Add `POST /api/organizations/:id/invitations` (single). Emit `notify.email.requested` (fire-and-forget, don't block). **Verification:** Integration test creates row; `status=pending`; `token_hash` is non-null and not equal to the raw token.
- [ ] **Task 3.4** — Add `POST /api/organizations/:id/invitations/bulk`. **Verification:** Integration test sends 5 emails; returns `{created:5, skipped:0, errors:[]}`. Duplicate email in same batch is skipped.
- [ ] **Task 3.5** — Add `POST /api/organizations/:id/invitations/:invId/resend` + `DELETE` (revoke). **Verification:** Resend updates `expires_at`; revoke sets `status=revoked`.
- [ ] **Task 3.6** — Add `POST /api/invitations/accept/:token` (public). **Verification:** Valid token → active membership created; invalid/expired token → 401.

### Phase 4 — UI components
- [ ] **Task 4.1** — `EmptyState` component. **Verification:** Vitest renders all variants; snapshot test; a11y via `@testing-library/jest-dom` accessible name check.
- [ ] **Task 4.2** — `RoleSelect`. **Verification:** Test that `owner` target disables select; test that `viewer` callerRole disables all options; test onChange fires with correct value.
- [ ] **Task 4.3** — `MembersTable` (columns, sort, loading skeleton, empty state). **Verification:** Test sorts by name; test renders skeleton (5 rows with correct aria); test Remove button hidden when callerRole=viewer.
- [ ] **Task 4.4** — `SingleInviteForm` + validation. **Verification:** Test submits valid email+role; test shows validation error on invalid email; test loading state on submit.
- [ ] **Task 4.5** — `CsvUploadZone` + PapaParse. **Verification:** Test parses `email,role\n` CSV; test parses CSV with BOM; test shows error for rows with invalid email format; test file-type rejection for `.txt`.
- [ ] **Task 4.6** — `BulkInviteForm` (textarea + CSV). **Verification:** Test adds emails from textarea; test preview list; test submit calls `identityClient.bulkInvite`.
- [ ] **Task 4.7** — `InviteModal` (tabs, focus trap, close). **Verification:** Test tab switching; test Escape closes modal; test aria-modal attribute; test focus is trapped inside modal.
- [ ] **Task 4.8** — `PendingInvitesList` + optimistic revoke. **Verification:** Test revoke row disappears immediately; test Resend calls API; test expired status pill color.
- [ ] **Task 4.9** — `IdentityPage` tabs + data hooks. **Verification:** Test renders Members tab by default; test Pending tab shows PendingInvitesList; test API Tokens tab shows stub.
- [ ] **Task 4.10** — `IdentityI18nProvider` + Hebrew locale. **Verification:** Test Hebrew strings render; test `dir="rtl"` attribute on root; test English fallback for missing keys.

### Phase 5 — Host shell integration
- [ ] **Task 5.1** — Update `frontend/src/pages/OrganizationPage.tsx` to use `<IdentityPage>`. Deprecate `MembersManagement.tsx` with JSDoc comment. **Verification:** `npm run dev` in frontend; Organization page loads Members tab without console errors.
- [ ] **Task 5.2** — E2E Playwright test: invite flow. **Verification:** See §10.

### Phase 6 — Package publish readiness
- [ ] **Task 6.1** — Vite library build produces `dist/index.js` (CJS) + `dist/index.mjs` (ESM) + `dist/index.d.ts`. **Verification:** `npm run build` in `packages/identity-ui` exits 0; `dist/` contains both formats.
- [ ] **Task 6.2** — Add `@fuzefront/identity-ui` to Skaffold + Helm values (not as a deployed service — it's a frontend package — but document the version bump process). **Verification:** n/a (documentation only).

---

## 10. Verification: E2E Playwright Invite → Accept Flow

**File:** `packages/identity-ui/tests/e2e/invite-flow.spec.ts`

```typescript
test('admin can invite a user and invitee can accept', async ({ page, context }) => {
  // 1. Admin logs in → opens org Members tab
  await page.goto('/login')
  await page.fill('[name=email]', 'admin@fuzefront.dev')
  await page.fill('[name=password]', 'admin123')
  await page.click('[type=submit]')
  await page.goto('/organization')
  await page.click('text=Members')

  // 2. Open invite modal → single invite
  await page.click('text=Invite member')
  await expect(page.locator('[role=dialog]')).toBeVisible()
  await page.fill('[name=email]', 'newuser@example.com')
  await page.selectOption('[name=role]', 'member')
  await page.click('text=Send Invite')
  await expect(page.locator('[role=status]')).toContainText('Invited')

  // 3. Pending invites tab shows the invitation
  await page.click('text=Pending Invitations')
  await expect(page.locator('text=newuser@example.com')).toBeVisible()

  // 4. Accept invitation via token (intercept email link from DB or API)
  const { token } = await page.evaluate(async () => {
    const res = await fetch('/api/organizations/test-org-id/invitations', {
      headers: { Authorization: `Bearer ${localStorage.getItem('authToken')}` }
    })
    const data = await res.json()
    return data[0] // get raw token from test helper endpoint
  })
  const newPage = await context.newPage()
  await newPage.goto(`/invitations/accept/${token}`)
  await expect(newPage.locator('text=You have joined')).toBeVisible()

  // 5. Admin sees member as active
  await page.click('text=Members')
  await expect(page.locator('text=newuser@example.com')).toBeVisible()
  await expect(page.locator('[data-testid="status-active"]')).toBeVisible()
})
```

---

## 11. Open Questions

1. **Invitation accept UX:** Should accepting an invitation auto-log-in the user (if they already have an account) or redirect to a "create account" flow for new users? Authentik is the IdP — need to decide whether the accept endpoint creates an Authentik user or just trusts that the user already exists.

2. **`organization_invitations` vs current `status=pending` in `organization_memberships`:** The existing `MembersManagement` component shows pending members from `organization_memberships.status='pending'`. With the new `organization_invitations` table, these two concepts diverge. Decision needed: should pending invitations remain in `organization_memberships` (no new table) or migrate to a separate table with a proper token-hash column? The plan above assumes a separate table (cleaner security model — hashed tokens, expiry, audit columns). Confirm before Task 3.1.

3. **Bulk invite ceiling:** The plan caps bulk invites at 50 per request. Confirm the limit or remove it. If removed, rate-limiting at the route level becomes essential.

4. **RTL layout for Hebrew:** `dir="rtl"` on the `IdentityPage` root div is sufficient for most column reversal, but TanStack Table column ordering may also need to be reversed. Verify with a Hebrew-speaking reviewer.

5. **`@fuzefront/identity-ui` version in Helm:** Since this is a frontend package bundled into the host shell image, there is no separate Kubernetes deployment. The version is implicit in the `fuzefront-frontend` image. Confirm this is the intended shipping model (no CDN/micro-frontend lazy-load for the identity package).

6. **API Tokens stub:** The prompt says "coordinate with the api-tokens plan." That plan does not exist yet. Confirm whether the api-tokens plan should be written before or after this UI plan is implemented.

---

## 12. File Map Summary

### New files
| Path | Description |
|---|---|
| `packages/identity-ui/package.json` | Package manifest (`@fuzefront/identity-ui`) |
| `packages/identity-ui/tsconfig.json` | TypeScript config |
| `packages/identity-ui/vite.config.ts` | Library build config |
| `packages/identity-ui/src/index.ts` | Public API barrel |
| `packages/identity-ui/src/types.ts` | Shared TypeScript interfaces |
| `packages/identity-ui/src/api/identityClient.ts` | HTTP API wrappers |
| `packages/identity-ui/src/components/MembersTable/*` | Members grid |
| `packages/identity-ui/src/components/RoleSelect/*` | Role assignment control |
| `packages/identity-ui/src/components/InviteModal/*` | Single + bulk invite modal |
| `packages/identity-ui/src/components/PendingInvitesList/*` | Pending invites + resend/revoke |
| `packages/identity-ui/src/components/EmptyState/*` | Empty/loading/error states |
| `packages/identity-ui/src/components/IdentityPage/*` | Page-level tabbed container |
| `packages/identity-ui/src/components/ApiTokens/ApiTokensStub.tsx` | Stub for upcoming api-tokens plan |
| `packages/identity-ui/src/hooks/useMembers.ts` | Members data hook |
| `packages/identity-ui/src/hooks/useInvitations.ts` | Invitations data hook |
| `packages/identity-ui/src/hooks/useRoleChange.ts` | Role mutation hook |
| `packages/identity-ui/src/i18n/IdentityI18nProvider.tsx` | i18n context |
| `packages/identity-ui/src/i18n/locales/en.ts` | English strings |
| `packages/identity-ui/src/i18n/locales/he.ts` | Hebrew strings |
| `packages/identity-ui/tests/e2e/invite-flow.spec.ts` | Playwright E2E test |
| `backend/src/migrations/009_create_organization_invitations_table.ts` | DB migration |
| `design-system/components/overlay/Modal.jsx` | New DS Modal component |
| `design-system/components/overlay/Modal.d.ts` | TypeScript types |
| `design-system/components/overlay/Modal.prompt.md` | DS prompt doc |
| `design-system/components/data/DataTable.jsx` | New DS DataTable shell |
| `design-system/components/data/DataTable.d.ts` | TypeScript types |
| `design-system/components/forms/Textarea.jsx` | New DS Textarea |
| `design-system/components/forms/Textarea.d.ts` | TypeScript types |
| `design-system/components/forms/FileDropZone.jsx` | New DS FileDropZone |
| `design-system/components/forms/FileDropZone.d.ts` | TypeScript types |

### Modified files
| Path | Change |
|---|---|
| `package.json` (root) | Add `"packages/identity-ui"` to `workspaces` |
| `backend/src/routes/organizations.ts` | Add 6 invitation routes |
| `frontend/src/pages/OrganizationPage.tsx` | Mount `<IdentityPage>` in Members tab |
| `design-system/_ds_manifest.json` | Add 4 new component entries + 2 tokens |
| `design-system/tokens/spacing.css` | Add `--modal-max-w`, `--modal-max-w-lg` |
| `design-system/tokens/colors.css` | Add `--drop-active` |
