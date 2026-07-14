# Changelog — @fuzefront/security-client

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
