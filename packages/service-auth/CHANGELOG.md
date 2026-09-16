# Changelog — @fuzefront/service-auth

All notable changes to this package are documented here. Versioned
independently; bump on every interface change (SemVer — the major is the
contract-stability guarantee consumers may assert on).

## 0.1.3 — `baseUrl` is documented and tested as origin-only

### Fixed

- Every `baseUrl` example across `verifier.ts`, `client.ts`, and `README.md`
  showed a trailing `/api` (e.g. `https://app.fuzefront.com/api`), even though
  `TOKEN_PATH` (`/api/v1/security/tokens`) and `INTROSPECT_PATH`
  (`/api/v1/security/tokens/introspect`) are FIXED constants this package
  appends to `baseUrl` itself. A caller that followed the documented example
  produced a double `/api/api/v1/...` path, which 404s — and because every
  ambiguity in this package is a denial (by design), that 404 surfaced as a
  silent, indistinguishable-from-normal `TOKEN_REQUEST_FAILED` /
  `INTROSPECTION_UNAVAILABLE`, not a loud misconfiguration error. No shipped
  runtime code was wrong (the fixed-path-append logic was always correct);
  only the docs described the wrong input, and the test suite's own fixtures
  (`baseUrl: 'http://security.local/api'`) reproduced the same mistake
  without ever asserting the URL `fetch` was actually called with, so this
  was invisible to CI.
- `verifier.ts` / `client.ts` JSDoc now states **"ORIGIN ONLY — no `/api`
  suffix"** with the double-`/api` failure mode spelled out; `README.md`'s
  two usage examples now read from `SECURITY_SERVICE_URL` (matching the env
  var name payment-service and other in-cluster consumers actually use)
  instead of the never-defined `FUZEFRONT_API_URL`.
- `tests/verifier.test.ts` / `tests/client.test.ts`: fixtures switched to
  origin-only `baseUrl`s, plus new tests asserting the FULL constructed URL
  `fetch` is called with (both packages), and that a trailing slash on
  `baseUrl` is stripped rather than producing a double slash. This closes the
  blind spot — a regression to a `/api`-suffixed `baseUrl` example, or to
  broken trailing-slash handling, now fails the suite instead of passing
  silently.

No behavior change: the URL-construction logic (`base.replace(/\/+$/, '')` +
fixed path) was already correct before this release.

## 0.1.2 — `@fuzefront/security-client` is a devDependency, not a runtime dependency

### Fixed

- `@fuzefront/security-client` moved from `dependencies` to `devDependencies`.
  It is used ONLY as a type-only import (`import type { components }` in
  `src/types.ts`) to derive the `TokenIntrospection`/`TokenIssue*` types from the
  frozen contract; nothing in the compiled `dist/*.js` requires it at runtime.

  Declaring it as a runtime `dependency` was actively wrong for consumers: the
  workspace-internal name `@fuzefront/security-client` is not published, so any
  consumer installing this package would either fail to resolve it or — for a
  `file:`-linked consumer that copies only `dist/` — trip
  `scripts/check-dockerfile-lockfile.mjs` (R3), which correctly flags "declares a
  runtime dependency that won't reach the image". The type stays available to the
  package's own `tsup` build (devDependencies are present at build time); the
  emitted `.d.ts` still references it, so strict-mode type consumers provide the
  package themselves, exactly as before.

### Changed

- The optional `express` peer range is now `^4.22.2 || ^5.0.0`, was `^4.22.2`.

  Express 5 consumers could not install this package AT ALL. Reproduced against
  FuzeX's design-frames backend tier (`express@^5.2.1`):

  ```
  npm error Could not resolve dependency:
  npm error peer express@"^4.22.2" from @izzywdev/fuzefront-service-auth@0.1.0
  ```

  `peerDependenciesMeta.express.optional: true` does not help here — optional
  suppresses auto-INSTALL, but npm still enforces the range against an express
  the consumer already has, so the install hard-fails. The middleware only uses
  Express's `Request`/`Response`/`NextFunction` types and calls `next()`; nothing
  in it is 4.x-specific.

- The dependency on `@fuzefront/security-client` is now the range `^0.8.0`
  instead of the exact pin `0.8.0`. No runtime behaviour changes — the
  dependency is types-only (the compiled `dist/index.js` contains no
  `require` of it), so this is purely an install-graph fix.

  Why it mattered: `security-client` is already a direct dependency of six
  other packages in the family (`auth-ui`, `identity-ui`, `portal-admin-ui`,
  `account-security-ui`, `packages/security`, FuzeQuality), all of which
  declare it as `^0.8.0`. An exact pin here cannot dedupe against a caret
  range that resolves to any other 0.8.x, so a consumer depending on BOTH
  this package and `security-client` got two copies installed side by side —
  two sets of types, and cross-package type errors that read as unrelated to
  their cause. That is the same class of failure PR #841 addressed ("three
  peer ranges excluded the security-client version we ship").

  The caret form also MATCHES the family's existing convention rather than
  introducing a new one: every other consumer already declares `^0.8.0`.

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
