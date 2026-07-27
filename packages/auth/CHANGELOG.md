# Changelog — @fuzefront/auth

All notable changes to this contract are documented here. This package is
versioned independently; bump on every interface change (SemVer — the major is
the contract-stability guarantee consumers may assert on).

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
