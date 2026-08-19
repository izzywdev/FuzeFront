# Changelog — @fuzefront/security-client

## 0.7.0 — Portal CRUD as org-tree operations (FF-EPIC-17-S7, unreleased)

Folds portal management onto the unified organizations+parent_id org tree. A
"portal" is now an `organizations` row whose `parentOrgId` is the platform root
org (`00000000-0000-0000-0000-000000000010`) AND that carries a portal-root
attribute (`isPortalRoot: true`) + tenant attributes (custom domain /
white-label branding / per-portal app catalog / reseller billing) that ordinary
sub-orgs lack — NOT a separate `portals`-table entity.
`SECURITY_CONTRACT_VERSION` 0.6.0 → 0.7.0 (spec `info.version` 0.6.0 → 0.7.0).
**Additive/minor — no existing shape changes.**

### Supersedes (reconciliation, not greenfield)

A standalone `portals` table already ships (migrations `012_create_portals_table`
/ `018_portal_provisioning`, the live `GET /api/v1/admin/portals` route, the
`fuzefront.platform.portals-directory` flag — PR #640/#642) and
`services/portal-service/openapi.yaml` (`@fuzefront/portal-client`). This
contract SUPERSEDES that model:

- `services/portal-service/openapi.yaml` is marked **superseded** (deprecation
  banner + `x-superseded-by`); `@fuzefront/portal-client` should be **retired**
  once the backend fan-out moves to `@fuzefront/security-client` (recommend —
  not executed here).
- `GET /api/v1/admin/portals` (portals-directory) is superseded by
  `GET /api/v1/security/portals`. The backend fan-out **replaces** it, rather
  than running both models in parallel.
- **Storage of the tenant attributes is an owner/orchestrator decision, NOT
  frozen here.** Recommended: an `organizations`-keyed **extension table**
  (additive, non-destructive) rather than migrating off the existing `portals`
  table in place.
- **FK-retarget follow-ups (tracked, not done here):** FF-EPIC-11's
  `home_portal_id → portals.id`, and FF-EPIC-12/13/15/16 references to
  `portals.id`, retarget onto `organizations.id`. Each needs its own migration.

### Added

- **`GET /api/v1/security/portals?limit=&cursor=&status=`**
  (`operationId: listPortals`, tag `portals`) — lists organizations whose
  `parentOrgId` is the platform root AND that carry the portal-root attribute.
  The platform root org is NEVER listed (it has no `parentOrgId`).
  Cursor-paginated per the family standard (`limit` + opaque `cursor`,
  `{ items, page }` envelope). `limit`/`cursor` params + envelope are **inlined**
  (structurally identical to `Limit`/`Cursor`/`PortalPage`) so `gate-pagination`
  — which does not resolve `$ref` — sees them directly. `403 FORBIDDEN` for a
  non-platform-admin, fail-closed via the same Permit ReBAC parent→child
  derivation as the rest of the org tree.
- **`POST /api/v1/security/portals`** (`operationId: createPortal`, tag
  `portals`) — creates an `organizations` row with `parentOrgId` = the platform
  root + tenant attributes, reusing the resumable provisioning backbone (NOT a
  `portals`-table insert). Per the identifier standard the owning service mints
  the org id: `PortalCreate` sets `additionalProperties: false` and declares no
  `id`; the parent is fixed to the platform root by the endpoint (no
  client-supplied parent reference). `409 CONFLICT` on duplicate slug.
- **`GET /api/v1/security/portals/{portalOrgId}`** (`operationId: getPortal`) —
  the portal org + its tenant attributes. `portalOrgId` REFERENCES an existing
  server-minted org (typed id); an id is never a capability.
- **`POST /api/v1/security/portals/{portalOrgId}/suspend`**
  (`operationId: suspendPortal`) / **`.../resume`** (`operationId: resumePortal`)
  — org-level status flips reusing the org status model (`PortalStatus`), not a
  portal-specific state machine. Idempotent. The platform root is not a portal
  and cannot be suspended (`409 CONFLICT`).
- **Schemas:** `Portal`, `PortalCreate`, `PortalPage`, `PortalStatus`,
  `PortalBranding`, `PortalBillingMode`, `PortalAppCatalogMode`; parameter
  `PortalOrgId`; tag `portals`; root `x-supersedes` note.

### Authorization

Every portal op is **platform-admin-only** and fail-closed. A non-platform-admin
gets `403 FORBIDDEN` rendered in place (never a sign-in redirect; only `401`
re-authenticates), derived via the SAME Permit ReBAC parent→child derivation as
every other org surface — never a separate or weaker portal-specific authz path.
An id is never a capability; the decision is the token + Permit.

### Consumers

Exact `@fuzefront/security-client` pins bumped `0.6.0 → 0.7.0` in
`packages/identity-ui`, `packages/auth-ui`, `packages/account-security-ui`
(peer `^0.5.0` ranges unchanged, matching the prior 0.5→0.6 bump).

## 0.6.0 — Employee status + cross-org listing (FF-EPIC-17-S9, unreleased)

Closes the FF-EPIC-17-S9 Employee-console contract gap flagged by the merged
cross-org console UI (PR #673): two server-authoritative reads did not exist,
so the console derived Employee status client-side and could only list its
membership-scoped orgs (a pure Employee — zero membership rows — saw only
root). Both reads are backed by the S8 domain logic `resolveEmployeeStatus`
(PR #655). `SECURITY_CONTRACT_VERSION` 0.5.0 → 0.6.0 (spec `info.version`
0.5.0 → 0.6.0). **Additive/minor — no existing shape changes.**

An **Employee** = FuzeFront platform staff = Permit ReBAC `org-admin` held on
the platform root org (derived down the `parent` org tree), with zero
`organization_memberships` rows in customer orgs — so staff status is NEVER
inferred from membership rows.

### Added

- **`GET /api/v1/security/employee/status`** (`operationId: getEmployeeStatus`,
  tag `organizations`) — server-authoritative Employee status for the calling
  user, backed by `resolveEmployeeStatus`. `isEmployee` comes ONLY from the
  ReBAC `org-admin`-on-root grant, never from membership rows.
  `directOrgMemberships` is informational (the caller's DIRECT customer-org
  memberships, EXCLUDING root; empty for a pure Employee).
  - **Path choice:** `/v1/security/employee/status`, not `/api/employee/status`
    — the `/v1/security/…` prefix is the dominant route convention (every route
    but the one `/organizations/{id}/directory` outlier), keeping consumers on a
    single uniform same-origin base.
  - **Responses:** `200` `EmployeeStatus`; `401` Unauthorized. No `403`: this
    endpoint REPORTS status and does not gate on it — a non-Employee simply gets
    `isEmployee: false`.
  - **Pagination:** `x-pagination: exempt` — a singleton per-caller status;
    `directOrgMemberships` is a bounded per-user set, not user-controlled growth.
- **`GET /api/v1/security/employee/orgs?limit=&cursor=`**
  (`operationId: listEmployeeOrgs`, tag `organizations`) — the org/portal
  subtree an Employee can reach via the ReBAC `org-admin`-on-root grant (root +
  descendants), for the console's CrossOrgExplorer. **ReBAC-authoritative, NOT
  membership-scoped.**
  - **Flat, not a tree:** returns a FLAT paginated list of nodes each carrying
    `parentOrgId`; the client assembles the tree. An explicit nested tree over an
    unbounded org set cannot be paginated (a page boundary cannot split a
    subtree), whereas a forward page-walk to `hasMore: false` reconstructs the
    tree exactly and mirrors the existing directory listing shape.
  - **Pagination (gate-pagination):** cursor-paginated via the family cursor
    `PageInfo` envelope (like `MemberPage`/`TenantPage`) — `limit` (default 50,
    max 200) + opaque `cursor`, `{ items, page }` response. Cursor (not offset)
    because the explorer page-walks the whole subtree; it never needs random
    page access.
  - **Responses:** `200` `EmployeeOrgPage`; `401` Unauthorized; **`403`
    Forbidden** (non-Employee caller — real fail-closed, rendered in place, never
    a re-auth redirect; `code: FORBIDDEN`). An id is never a capability;
    authorization is the token + Permit.
- **Schemas** (client types): `EmployeeStatus`
  (`isEmployee`, `directOrgMemberships: DirectMembershipRef[]`;
  `additionalProperties: false`), `DirectMembershipRef`
  (`orgId` typed-id reference, `orgName`, `role` enum
  `owner|admin|member|viewer`; `additionalProperties: false`),
  `EmployeeOrgNode` (`orgId`/`parentOrgId` typed-id references, `name`, `kind`
  enum `root|portal|organization`, `depth`, optional `memberCount`;
  `additionalProperties: false`), and `EmployeeOrgPage`
  (`{ items, page }` cursor envelope reusing `PageInfo`).
  - **Identifier standard:** no create bodies here (both are GETs). Every
    reference field NAMES its referent type — `orgId`, `parentOrgId` — so no
    bare polymorphic id is resolved (gate-identifier `parentId` would have
    required a `parentType` sibling; `parentOrgId` carries the type in the name).

### Consumer version pins

- Bumped the exact devDependency pin `@fuzefront/security-client` `0.5.0` → `0.6.0`
  in `packages/account-security-ui`, `packages/auth-ui`, and
  `packages/identity-ui`, and regenerated `package-lock.json`, so the workspace
  resolves the local `0.6.0` package (an exact `0.5.0` pin no longer satisfies
  it and would fall back to the registry — the #653 bite). The `^0.5.0`
  peerDependency ranges already accept `0.6.0` and are left unchanged.

## 0.5.0 — Root/portal member directory (unreleased)

Freezes the contract commissioned by the approved FF-EPIC-17 `member-directory`
frames (`design/frames/member-directory/**`, PR #590). With literal root
membership ("members of root = everyone"), a root or portal-root org's member
view is a paginated, server-side-searchable USER DIRECTORY — distinct from the
small-team, cursor-paged tenant member list. `SECURITY_CONTRACT_VERSION`
0.3.0 → 0.5.0 (spec `info.version` 0.4.0 → 0.5.0; the 0.4.0 server-owned
identifier bump, PR #524, was never separately released to this client and is
folded in here). Additive/minor — no existing shape changes.

### Added

- **`GET /api/organizations/{id}/directory?query=&limit=&offset=`**
  (`operationId: listOrganizationDirectory`, tag `organizations`) — the
  paginated, server-side-searchable directory of ALL users of a tenant-root
  org. `{id}` is the platform root org id OR a portal-root org id ("root" is
  relative to the portal; `tenantId` resolves server-side from the org tree).
  - **Pagination (gate-pagination):** offset-paginated — `limit` (default 50,
    max 200) + `offset` (0-based). Deliberately **offset, not cursor**: the
    directory is search-first and page-navigable, unlike the cursor-paged
    `GET /v1/security/tenants/{tenantId}/members`. Search is server-side via
    `query`; the client never fetches the full set to filter locally.
  - **Responses:** `200` `DirectoryPage`; `401` Unauthorized; **`403`
    Forbidden** (non-privileged caller — rendered in place, never a re-auth
    redirect; `code: FORBIDDEN`); `404` NotFound.
- **Schemas** (client types): `DirectoryMember`
  (`userId` typed-id reference, `email`, `displayName`, `joinedAt`, `role`
  enum `owner|admin|member|viewer`, `isSelf`; `additionalProperties: false`)
  and `DirectoryPage` (`{ items, page, pageSize, total }` — a **page-based**
  envelope echoing the 1-based `page`, effective `pageSize`, and true server
  `total` so the UI renders a page-of-pages pager; distinct from the cursor
  `PageInfo` envelope). Response shape matches the frames' `DirectoryPage`
  exactly for the Playwright `data-*` hooks.
- **Components:** parameters `OrganizationId` (path `id`), `Offset`, and
  `DirectoryQuery` (`query`); response `Forbidden` (`FORBIDDEN` was already in
  the `ErrorBody` code enum). New tag `organizations`.

### Wire-vs-frame note

The `member-directory` manifest's `contract.commissionedByApproval` sketches
the request as `?query=&page=&pageSize=`. The **wire params** are `query` +
`limit` + `offset` because `gate-pagination` (baseline §4.1) requires the
literal `limit` + (`cursor`|`offset`) tokens; offset paging IS page navigation,
so this is the same page-based UX. The **response** keeps the frames' exact
`{ items, page, pageSize, total }` (page/pageSize/total are the pager's DOM
inputs — `data-count='total'`, `data-page`), and no `data-*` test hook depends
on request param spelling. The manifest also names the item schema
`DirectoryMember` (used here); the fan-out task's `DirectoryEntry` is an alias
for the same shape.

### Deferred (not in this freeze — separate approval flows)

- **Employee role in the role catalog** and **portal-management CRUD** are
  commissioned by the `employee-console` / `portal-admin-consoles` frames, not
  `member-directory`; they re-enter through a later contract amendment when
  those flows are approved. Employee stays modeled as ReBAC `org-admin`-on-root
  (no membership row), so it is intentionally not a `DirectoryMember.role`.
- **`Member.source` / inherited-access field** — explicitly deferred per the
  reconciliation plan; add when an admin-console frame commissions it.

## 0.3.0 — AuthZ grants (write-side) (unreleased)

Adds the permission/role GRANT endpoints (owner review of PR #243) — the
write-side wrapping the authorization provider's role-assignment + resource-
instance (ReBAC) assignment. `SECURITY_CONTRACT_VERSION` 0.2.0 → 0.3.0.

### Added

- **Grants** under `/api/v1/security/authz/grants`:
  - `POST /authz/grants` — grant a role (and/or permission) to a subject;
    omit `resource` for a tenant-wide (RBAC) grant, include
    `resource: { type, key }` for a resource-instance (ReBAC) grant. Returns
    `Grant`. 201.
  - `DELETE /authz/grants` — revoke by `{ grantId }` OR the identity tuple
    `{ subject, tenant, role, resource? }`. 204, idempotent.
  - `GET /authz/grants?subject=&tenant=&resourceType=&resourceKey=` — list a
    subject's grants; **cursor-paginated** (family `{ items, page }` envelope)
    because a subject may hold grants across many resource instances under ReBAC.
- Descriptions note a grant is a rollout/assignment convenience; `authz/check`
  stays authoritative. Fail-closed.
- Client types: `Grant`, `GrantRequest`, `ResourceRef`. `AuthorizationProvider`
  extended with `grant`, `revoke`, `listGrants` (+ `Grant`/`GrantRequest`/
  `GrantRevokeRequest`/`GrantQuery`).

### Notes

- Provider-agnostic: the first impl wraps Permit.io role-assignment +
  resource-instance assignment (RBAC + ReBAC), named only inside the concrete
  adapter — never in this consumer surface.

## 0.2.0 — MFA + contact verification (unreleased)

Adds two provider-agnostic surfaces to the frozen contract (owner review of
PR #243). `SECURITY_CONTRACT_VERSION` 0.1.0 → 0.2.0.

### Added

- **MFA / 2FA** under `/api/v1/security/mfa` (provider-neutral `totp`/`sms`/
  `email`, `webauthn` reserved): `GET/POST /mfa/factors`,
  `POST /mfa/factors/{factorId}/activate`, `DELETE /mfa/factors/{factorId}`,
  `POST /mfa/recovery-codes`, plus login step-up `POST /mfa/challenge` +
  `POST /mfa/verify`.
- **Step-up result shape:** `POST /session` and `POST /session/exchange` now
  return `SessionResult` — a `status`-discriminated `oneOf` of
  `AuthenticatedSession` (same fields as `LoginResponse` + `status`) and
  `MfaRequiredChallenge` (`challengeId` + offered `factors`). The social
  callback → exchange path inherits this.
- **Contact verification** under `/api/v1/security/verify` (email + phone
  start/confirm, `GET /verify/status`) — distinct from MFA login step-up.
- `AuthMethods` (`GET /methods`) now advertises `mfa: { enabled, types }` and
  `verification: { email, sms }`.
- Client types: `MfaFactorType`, `SessionResult`, `VerificationStatus`, extended
  `AuthMethods`; adapter `IdentityProvider` extended with `listFactors`,
  `enrollFactor`, `activateFactor`, `removeFactor`, `regenerateRecoveryCodes`,
  `challengeMfa`, `verifyMfa`, `startEmailVerification`,
  `confirmEmailVerification`, `startPhoneVerification`,
  `confirmPhoneVerification`, `getVerificationStatus`.

### Notes

- MFA/verification remain provider-agnostic: the identity provider's MFA stages
  and the family email/SMS verification services are the first impls, named only
  inside the concrete adapter, never in this consumer surface.

## 0.1.0 — Contract freeze (unreleased)

Initial **interface freeze** for the provider-agnostic FuzeFront Security API.
Interface + generated client only — implementation is fanned out after this
contract PR merges.

### Added

- `openapi.yaml` (OpenAPI 3.1) — the FuzeFront Security API under
  `/api/v1/security`, provider-neutral, same-origin `/api` base:
  - **AuthN:** `POST/GET/DELETE /session`, `POST /session/exchange`,
    `GET /social/{provider}/start`, `GET /social/callback`, `POST /signup`,
    `GET /methods`.
  - **AuthZ:** `POST /authz/check`, `POST /authz/bulk-check`,
    `GET /authz/permissions`; `/tenants`, `/tenants/{id}` (+members, roles,
    role assignment).
  - **M2M:** `POST /tokens`, `POST /tokens/introspect`.
- Stable, provider-neutral `Identity` keystone + `AuthMethods`, `SocialProvider`,
  `SecurityErrorCode`, `AuthMode` (`legacy-hs256` | `federated-jwks`).
- `SECURITY_CONTRACT_VERSION` export.
- `openapi-typescript` generation wired (`npm run generate` → `src/generated.ts`),
  re-exported from the barrel so consumers import one set of types.
- Cursor pagination (family standard) on the two unbounded collection GETs
  (`/tenants`, `/tenants/{id}/members`); every other collection/singleton GET
  is `x-pagination: exempt` with a reason.
- Private `publishConfig` (GitHub Packages, `@fuzefront`, `access: restricted`) +
  `repository.directory`.

### Notes

- Vendor names appear only in server-side adapter implementations, never in this
  consumer surface (naming rule).
- Adapter swap contracts (`IdentityProvider`, `AuthorizationProvider`) live in
  `backend/security/src/providers/` — interfaces only, no behavior.
