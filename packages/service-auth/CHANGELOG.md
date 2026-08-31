# Changelog — @fuzefront/service-auth

All notable changes to this package are documented here. Versioned
independently; bump on every interface change (SemVer — the major is the
contract-stability guarantee consumers may assert on).

## 0.1.0 — Initial release

First runtime implementation of S2S (machine-to-machine) auth for the
FuzeFront family, closing the gap left by PR #837 (`@fuzefront/security-client`
shipped generated TYPES for `/api/v1/security/tokens*` but no runtime client
or middleware, so every consumer hand-rolled its own HTTP calls).

### Added

- `createServiceAuthClient` — obtain/cache/auto-refresh a machine bearer token
  via `POST /api/v1/security/tokens`. Refreshes before expiry (safety margin,
  default 30s); concurrent `getToken()` calls during a refresh single-flight
  into one request.
- `createMachineTokenVerifier` — fail-closed introspection via
  `POST /api/v1/security/tokens/introspect`. Branches on the response body's
  `active` boolean, never on HTTP status (introspection always answers 200).
  Every ambiguity — network error, timeout, non-200, malformed/missing
  `active`, missing `subject` — throws `ServiceAuthError` rather than
  returning a permissive identity. Bounded cache for POSITIVE results only
  (never for negative — a revocation is visible on the next call), capped by
  the token's own `exp`.
- `requireMachineAuth` — Express middleware wrapping the verifier: attaches
  `req.machineIdentity`, never calls `next()` on a failed/unauthenticated
  request, and exposes a pluggable `authorize` hook (fail-closed: a throw is a
  denial) as the seam for the `/authz/*` routes once they're live for machine
  principals.
- 27 tests across client/verifier/middleware, weighted toward the fail-closed
  paths — including the one this package exists for: an inactive token with a
  200 response is rejected.
