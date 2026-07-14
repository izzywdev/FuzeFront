# Changelog — @fuzefront/auth

All notable changes to this contract are documented here. This package is
versioned independently; bump on every interface change (SemVer — the major is
the contract-stability guarantee consumers may assert on).

## 0.2.0 — Provider-neutral rename (unreleased)

Neutralizes the identity-vendor leak in the consumer surface, coincident with
the new provider-agnostic FuzeFront Security API (`@fuzefront/security-client`).

### Changed (BREAKING)

- `AuthMode` value `'oidc-jwks'` → **`'federated-jwks'`** (provider-neutral). The
  `legacy-hs256` value is unchanged.
- `OidcJwksConfig` → **`FederatedJwksConfig`** (`mode: 'federated-jwks'`), with
  all vendor naming stripped and documented as SERVER-INTERNAL wiring config.
  `OidcJwksConfig` is retained as a `@deprecated` type alias for one release.
- `Identity.issuer` and error-code docs no longer name any identity vendor.

### Migration

- Consumers asserting on `authMode === 'oidc-jwks'` update to `'federated-jwks'`.
- Host wiring importing `OidcJwksConfig` should switch to `FederatedJwksConfig`
  and set `mode: 'federated-jwks'` (the alias keeps old imports compiling for now).

## 0.1.0 — Contract freeze (unreleased)

Initial **interface freeze** (resolves #117). Interface only — runtime
verification is a follow-up backend slice.

### Added

- Stable `Identity` shape: `{ userId, tenantId: string | null, roles: string[], authMode, email?, issuedAt?, expiresAt?, issuer?, claims? }`.
  Invariant across the HS256 → OIDC/JWKS migration.
- Pluggable `Verifier` interface with two frozen configs:
  - `legacy-hs256` — verifies FuzeFront's CURRENT HS256 shared-secret token
    (`JWT_SECRET`), with an optional `OutOfBandResolver` to hydrate the
    `tenantId`/`roles` the current token does not carry.
  - `oidc-jwks` — target Authentik RS256/JWKS verifier reading `tenantId`/`roles`
    claims, with issuer/audience validation and OIDC discovery.
- `verifyToken(token, verifier)` and `createVerifier(config)` frozen signatures.
- Express middleware: `requireAuth({ verifier })` (fail-closed 401), `requireRoles(roles, mode)` (403),
  `requireTenant(tenantId)` (403, fail-closed on null tenant). `express` is an OPTIONAL peer dependency.
- `AuthError` + stable `AuthErrorCode` enum; `AuthErrorBody` response shape.
- `AUTH_CONTRACT_VERSION` export.
- OpenAPI 3.1 spec (`openapi.yaml`) documenting the current auth HTTP surface + the `Identity`/error schemas.
- Kafka Zod event schemas in `@fuzefront/shared`: `identity.session.issued`, `identity.session.revoked` (V1).
- Private `publishConfig` (GitHub Packages, `@fuzefront`, `access: restricted`) + `repository.directory`.

### Notes

- The package NEVER mints tokens and is FAIL-CLOSED by default.
- Runtime implementation (jsonwebtoken/jose verification, JWKS fetch, resolver
  wiring) is intentionally NOT included — frozen signatures throw
  `VERIFIER_UNAVAILABLE` (501/500) so the freeze is unmistakable.
