# Changelog — @fuzefront/security-client

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
