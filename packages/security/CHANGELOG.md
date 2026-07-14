# Changelog — @fuzefront/security-client

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
