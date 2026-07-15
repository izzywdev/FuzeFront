# AuthN contract-test suite (independent verification)

Independent, spec-first verification of the FuzeFront Security API **AuthN** slice
against the **frozen** contract `packages/security/openapi.yaml` (PR #243).

Authored by `test-engineer` — this suite verifies the implementation; it does not
implement it. A failing test against a real bug is a valid deliverable.

## What it asserts

- **Contract conformance** for every `/api/v1/security/*` AuthN endpoint:
  session CRUD + `session/exchange`, social `start`/`callback` (302 semantics),
  `signup`, `methods`, the `SessionResult` MFA-step-up discriminated union, the
  MFA factor lifecycle (enroll → activate → remove, recovery codes), MFA login
  step-up (challenge → verify), email/phone verification, and M2M tokens.
  Response bodies are validated against the spec component schemas with Ajv
  (OpenAPI 3.1 / JSON-Schema 2020-12).
- **Provider-swap proof** (`provider-swap.contract.test.ts`): the full path runs
  through a second, independent `IdentityProvider` (`AltIdentityProvider`) with a
  different token format/storage — proving no consumer-visible vendor coupling.
- **Boundary / neutrality** (`boundary.contract.test.ts`): no AuthN response,
  redirect, or body references `auth.fuzefront.com` or names a vendor; social
  `start` 302 targets a FuzeFront-owned (or Google) host only.
- **Fail-closed**: bad credentials/expired code/unknown token →
  `401` / `{ active: false }`, never permissive.
- **Pagination gate** (`pagination.contract.test.ts`): every AuthN endpoint is
  genuinely `x-pagination: exempt` (bounded/singleton); the spec's paginated
  collections (AuthZ Phase 2) correctly encode the `{ items, page }` +
  nullable-`nextCursor` envelope. The **runtime cursor-walk** targets those
  AuthZ endpoints and is flagged `it.todo` — out of this AuthN suite's scope.

## Subject under test — mock now, real impl later

`harness.ts` resolves what the assertions run against:

- **`SECURITY_BASE_URL` set** → runs the identical assertions over HTTP against a
  real running implementation (ephemeral, FuzeInfra-pinned base services +
  mocked external SaaS — never prod). This is the objective backend gate.
- **unset** (default) → an in-process **contract-mock** reference app
  (`referenceApp.ts`) driven by `MockIdentityProvider`. This keeps the suite
  runnable and proves the contract is satisfiable through the neutral interface
  before the backend lands.

`referenceApp.ts` + `mockIdentityProvider.ts` are **test fixtures**, not the
product.

## Run

```bash
# contract-mock (default)
npm test -w backend/security -- security-api

# against a live implementation
SECURITY_BASE_URL=https://<ephemeral-host> npm test -w backend/security -- security-api
```
