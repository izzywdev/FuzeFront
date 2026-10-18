# Changelog — @izzywdev/fuzefront-auth

All notable changes to this contract are documented here. This package is
versioned independently; bump on every interface change (SemVer — the major is
the contract-stability guarantee consumers may assert on).

## 0.4.0 — legacy-hs256 rejects unvalidated session tokens by default

### Changed (BREAKING for `legacy-hs256` consumers)

- A `legacy-hs256` token that names a `sessionId` is now **refused** with
  `AuthError` `VERIFIER_UNAVAILABLE` (500, a deployment misconfiguration) unless a
  `sessionValidator` is configured. Previously such tokens authenticated until
  `exp` even after a logout or device revoke. The resolver is never called for a
  refused token.
- **Migrating:** supply `sessionValidator(userId, sessionId, claims)` (resolve
  `true` while the session is active), or, if the service genuinely cannot reach
  the session store, set `allowUnvalidatedSessions: true` to keep the old
  behaviour deliberately. Tokens that name no session are unaffected;
  `federated-jwks` is unaffected.

### Added

- `LegacyHs256Config.sessionValidator`, `LegacyHs256Config.allowUnvalidatedSessions`,
  and the `SessionValidator` type. Only `true` keeps a session alive (anything else
  is 401 `EXPIRED`); a throwing/rejecting validator is a retryable 503
  `VERIFIER_UNAVAILABLE` with a fixed message. It runs before the resolver.
- `Identity.sessionId` (optional) carries the validated session id. The validator runs
  only for a token that names a session. `allowUnvalidatedSessions` opts out only for
  a literal `true`.
- `requireAuth({ optional: true })` now degrades only client credential failures (4xx)
  to anonymous. A 5xx (session-validator / resolver outage, misconfigured verifier)
  is surfaced instead of silently becoming an anonymous request.
- A present-but-malformed `sessionId` claim is `MALFORMED` rather than being
  treated as "no session".
- `AUTH_CONTRACT_VERSION` 0.2.0 → 0.3.0. The Python peer `fuzefront-auth` 0.2.0
  ships the same rule (`allow_unvalidated_sessions`, `session_validator`).

## 0.3.1 — legacy-hs256 refuses narrowed `kind` tokens

### Fixed

- `legacy-hs256` verifier accepted `fuze-org-session` / `fuze-workload` /
  `fuze-delegation` tokens (they share `JWT_SECRET`) and, with a resolver wired,
  hydrated the holder with a user's full roles and tenant. It now throws
  `AuthError` `INVALID_AUDIENCE` (401) when the `kind` claim is present, before
  the resolver runs. Matches `backend/src/middleware/auth.ts` (resolves #1518).

## 0.3.0 — Subject ABAC attribute write (`setAttributes`)

### Added

- `AuthzClient.setAttributes(req, token)` — MERGES scalar ABAC attributes
  (string/number/boolean) onto a subject's record in the authorization
  provider's own store, via `PATCH /api/v1/security/authz/subjects/{subjectType}/{subjectKey}/attributes`.
  Distinct from `grant`: a grant assigns a role, this writes plain data the
  provider's own policies read directly (e.g. a billing plan tier / seat
  count gating feature access). Only the named keys are written; the
  subject's other attributes are untouched.
- New types: `SubjectType`, `SubjectRef`, `AttributeValue`,
  `SetAttributesRequest`, `SetAttributesResult`.
- `AUTHZ_CONTRACT_VERSION` 0.1.0 → 0.2.0.

### Security properties made explicit

- **THIS IS A WRITE, NOT A DECISION.** Deliberately the OPPOSITE of
  `check`/`bulkCheck`'s fail-closed-returns-`false` contract: `setAttributes`
  NEVER resolves on failure. Every transport error, timeout, and non-200
  throws `AuthzError` — a provider outage must never look like a successful
  write to a caller (e.g. billing entitlement sync) deciding whether to retry.

## 0.2.0 — Runtime implementation + provider-neutral rename

### Added — the package now WORKS (resolves #117)

Until now this shipped as a contract freeze: every entry point threw
`VERIFIER_UNAVAILABLE`, so no consumer could actually verify a token or gate a
route. The public signatures are unchanged — code written against the frozen
types keeps compiling — they simply do something now.

- `createVerifier` / `verifyToken` — real verification via `jose` (one dep covers
  HS256 today and RS256/JWKS for the federated target).
  - `legacy-hs256`: today's FuzeFront session token; optional `OutOfBandResolver`
    hydrates the `tenantId`/`roles` the token does not carry.
  - `federated-jwks`: RS256/ES256 against the issuer's JWKS, with `iss`/`aud`
    validation and OIDC discovery when `jwksUri` is omitted. JWKS cached per
    issuer.
- `requireAuth` / `requireRoles` / `requireTenant` — real Express middleware.
  `requireAuth` never calls `next()` on an unauthenticated request; guards answer
  403 (authz) rather than 401 (authn) so clients are not sent into login loops.
- 31 tests, weighted toward the denial paths: algorithm confusion, forged
  signature, expiry, wrong issuer/audience, missing subject, resolver failure,
  and unresolved-tenant.

### Security properties made explicit

- **Algorithms are pinned per mode.** Unpinned `algorithms` is what allows
  `alg: none` and RS256-public-key-as-HMAC-secret attacks.
- **`tenantId: null` is UNRESOLVED, never a wildcard** — `requireTenant` denies.
- **A resolver failure denies** instead of returning empty roles, which would be
  indistinguishable from a real permission decision and would mask an outage.
- Still **never mints tokens**; in `federated-jwks` mode a consumer holds no
  signing key at all.


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
