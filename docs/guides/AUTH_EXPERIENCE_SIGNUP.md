# Auth-experience signup redesign

The redesigned FuzeFront signup, and what a consumer of the Security API has to
change to talk to it. Everything here is gated by one release flag,
**`fuzefront.auth.experience`**, which is **default OFF** in code, in
`packages/feature-flags/flag-registry.yaml`, and in the frontend build.

- Operating it: [`docs/runbooks/auth-experience-rollout.md`](../runbooks/auth-experience-rollout.md)
- Captcha setup: [`docs/runbooks/turnstile-setup.md`](../runbooks/turnstile-setup.md)
- Contract of record: [`packages/security/openapi.yaml`](../../packages/security/openapi.yaml)
  (`@fuzefront/security-client` **1.1.0**) and its
  [`CHANGELOG.md`](../../packages/security/CHANGELOG.md)
- Approved design: [`design/frames/auth-experience/`](../../design/frames/auth-experience/index.html)
- The UI package: [`packages/auth-ui/README.md`](../../packages/auth-ui/README.md)

> Scope of the flag: it covers more than signup (the public `/signup/verify`,
> `/verify/email` and `/reset` routes, the "Forgot password?" link and the
> post-signup check-inbox redirect are behind it too — see the flag's entry in
> `flag-registry.yaml`). This page covers the **signup** surface.

## What the new signup does

With the flag ON, signup mode in `AuthPanel` renders `SignUpFlow`
(`packages/auth-ui/src/components/signup/SignUpFlow.tsx`) instead of the legacy
form. Sign-in is untouched.

| Capability | Behaviour |
|---|---|
| **Single `name`** | One optional full-name field replaces first/last. It maps to the identity store's single `name`, so it is i18n-safe (mononyms, family-name-first orderings). Server limit: a string of at most 255 characters. |
| **Live email availability** | Debounced `GET /v1/security/signup/email-available?email=`. **Fail-open**: any error renders "couldn't check" and never blocks submit. "Taken" is advisory; the `409` from `POST /signup` is the authority. |
| **Password strength + requirements checklist** | Per-rule checklist and strength meter driven by `AuthMethods.passwordPolicy` from `GET /v1/security/methods`. If the descriptor carries no policy, the UI falls back to the same defaults the server uses (12+ characters, upper, lower, digit, symbol); the server still enforces its own policy. |
| **Confirm password** | Live match indicator; submit stays disabled until it matches. |
| **Cloudflare Turnstile** | Rendered only when `AuthMethods.captcha` is present; submit stays disabled until a token exists; the widget resets after every failed submit (tokens are single-use). See [Turnstile setup](../runbooks/turnstile-setup.md). |
| **Honest error states** | `409` email exists -> "sign in instead"; `422 PASSWORD_POLICY` -> weak-password state; `400 CAPTCHA_FAILED` -> Turnstile failed state; `503` -> "Continue with Google" plus retry; `429` -> rate-limited; MFA-required hand-off. |

All copy is injected by the host from `locales/<lng>/common.json` (`auth.*`);
`auth-ui` imports no i18n library.

### What the flag changes on each side

Two independent halves read the same flag key but are switched in different
places (see the [rollout runbook](../runbooks/auth-experience-rollout.md)).

| Surface | Flag OFF (default) | Flag ON |
|---|---|---|
| **Backend** `POST /v1/security/signup` | Pre-1.0.0 behaviour: legacy `firstName`/`lastName` are still joined into a display name, `name` is accepted, no password-policy check, no captcha, no strict body check. | Strict body: only `email`, `password`, `name`, `turnstileToken`, `tenantName`, `bindToken` are accepted; **any other field (including `firstName`/`lastName`) -> `400 MALFORMED`**. Server-side password policy (`422 PASSWORD_POLICY`). Turnstile verified when configured. |
| **Backend** `GET /v1/security/signup/email-available` | `404` (indistinguishable from a missing route). | Served, rate-limited, fail-open. |
| **Backend** `GET /v1/security/methods` | No `passwordPolicy`, no `captcha`. | `passwordPolicy` always present; `captcha` present only when Turnstile is fully configured. |
| **Frontend** signup form | Legacy form, sending the single `name` field (it no longer sends `firstName`/`lastName`). | `SignUpFlow` as described above, plus the verify/reset routes and post-signup check-inbox redirect. |

Source: `backend/security/src/routes/security.ts` (signup handler, methods
handler), `backend/security/src/identity/flags.ts`,
`packages/auth-ui/src/flags.ts`.

The backend flag is evaluated **pre-auth** with only `app` and `environment` as
context (there is no user or org yet), so it rolls out per environment, not per
user. If the flag client is missing or errors, it resolves to OFF.

## Contract migration: `@fuzefront/security-client` 1.0.0 -> 1.1.0 (and 0.12.0 -> 1.0.0)

The signup contract changed in two steps. A consumer coming from 0.12.0 needs
both. Versions below are exact: `info.version` in `openapi.yaml`,
`SECURITY_CONTRACT_VERSION` in `src/types.ts` and `package.json` `version` all
read `1.1.0`.

### `SignupRequest` (breaking in 1.0.0)

```yaml
SignupRequest:            # additionalProperties: false
  email:          string (format: email)
  password:       string
  name:           string   # optional; REPLACES firstName + lastName
  turnstileToken: string   # optional in the schema; required server-side when captcha is configured
  tenantName:     string   # optional (unchanged)
  bindToken:      string   # optional (unchanged; invitation signup)
```

`firstName` and `lastName` were **removed**. Because the schema is
`additionalProperties: false`, a request that still sends them is invalid
against the contract, and a backend with the flag ON rejects it with
`400 MALFORMED`.

`turnstileToken` cannot be a static "required" constraint: whether it is
required depends on server configuration (`AuthMethods.captcha`), not on another
field of the body. It is enforced server-side, fail-closed.

### Error shapes on `POST /v1/security/signup`

All error bodies are `ErrorBody` (`{ error: string, code: SecurityErrorCode }`).

| Status | `code` | When | Added in |
|---|---|---|---|
| 201 | n/a | Account created; `LoginResponse` (`token`, `sessionId`, `user`). | existing |
| 400 | `MALFORMED` | Malformed body, invalid email, empty password, over-long `name`, or an unsupported field (flag ON). | existing |
| 400 | `CAPTCHA_FAILED` | Turnstile token missing, invalid, expired or replayed. Prompt for a fresh captcha and retry. | **1.1.0** |
| 409 | `CONFLICT` | An account with that email already exists. | existing |
| 422 | `PASSWORD_POLICY` | Password fails the authoritative policy. Distinct from 409 and 503. | **1.1.0** (declared on this operation; the code already existed) |
| 503 | `PROVIDER_UNAVAILABLE` | Identity provider unavailable, **or Cloudflare could not be reached to verify the token** (fail-closed, retryable; `Retry-After: 5`). Never `CAPTCHA_FAILED`. | existing |

The server checks the password policy **before** the captcha, so a weak-password
retry does not consume the single-use Turnstile token.

### New endpoint: `GET /v1/security/signup/email-available?email=`

Public (no bearer). `200` -> `{ "available": boolean }`; `400 MALFORMED` for a
missing/invalid email; `429 RATE_LIMITED` (20 requests / minute / IP, shared with
the older `GET /v1/security/email-available`). The email is trimmed and
lowercased server-side.

- **Fail-open client contract**: treat any non-200 as "unknown" and never block
  submit on it. The server itself answers `200 { "available": true }` if the
  identity provider errors.
- **Not captcha-gated.** The control against enumeration is the per-IP rate
  limit; a captcha cannot gate a per-keystroke call because Turnstile tokens are
  single-use. The 1.0.0 text that claimed captcha gating was corrected in 1.1.0.
- With the backend flag OFF this path returns `404`.
- The older `GET /v1/security/email-available` (response also echoes `email`)
  still exists; the two paths share one handler. Consolidation is an open
  owner/orchestrator decision, not done.

### `AuthMethods` additions (1.0.0, additive)

`GET /v1/security/methods` may now include:

```jsonc
{
  "passwordPolicy": {              // present when the backend flag is ON
    "minLength": 12, "requireUpper": true, "requireLower": true,
    "requireDigit": true, "requireSymbol": true
  },
  "captcha": {                     // present ONLY when Turnstile is configured
    "provider": "turnstile",
    "siteKey": "<public site key>"
  }
}
```

The values above for `passwordPolicy` are the server's current built-in default
(`backend/security/src/services/passwordPolicy.ts`); it is not read from the
identity store. `captcha` never carries the secret.

Both are optional on `AuthMethods`: **absent `captcha` means "do not show a
widget and do not send a token."**

### `SecurityErrorCode`

The hand-authored union in `src/types.ts` is now in lockstep with the
`ErrorBody.code` enum. It gained `CAPTCHA_FAILED` plus previously drifted values
(`REDIRECT_URI_NOT_ALLOWED`, `TOKEN_EXPIRED`, `TOKEN_INVALID`, `PASSWORD_POLICY`,
`LAST_FACTOR`, `NO_PASSWORD`, `RATE_LIMITED`). A `switch` over the union that
had an exhaustiveness check will need new cases.

### Updating a signup caller

`@fuzefront/security-client` ships **types** (and `SECURITY_CONTRACT_VERSION`),
not an HTTP client; you keep your own `fetch`/axios call and type it with the
package.

Before (0.12.0):

```ts
await fetch('/api/v1/security/signup', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password, firstName, lastName, tenantName }),
})
```

After (1.1.0):

```ts
import type {
  AuthMethods,
  SecurityErrorCode,
  components,
} from '@fuzefront/security-client'

type SignupRequest = components['schemas']['SignupRequest']
type LoginResponse = components['schemas']['LoginResponse']
type ErrorBody = components['schemas']['ErrorBody']

export type SignupOutcome =
  | { ok: true; session: LoginResponse }
  | { ok: false; status: number; code: SecurityErrorCode | undefined; message: string }

export async function signup(
  fullName: string,
  email: string,
  password: string,
  methods: AuthMethods,
  turnstileToken?: string,
): Promise<SignupOutcome> {
  // One `name`; never firstName/lastName.
  const body: SignupRequest = { email, password }
  if (fullName.trim()) body.name = fullName.trim()
  // Send the token only when the server advertises a captcha.
  if (methods.captcha && turnstileToken) body.turnstileToken = turnstileToken

  const res = await fetch('/api/v1/security/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (res.status === 201) return { ok: true, session: (await res.json()) as LoginResponse }

  const err = (await res.json().catch(() => ({}))) as Partial<ErrorBody>
  return { ok: false, status: res.status, code: err.code, message: err.error ?? res.statusText }
}

// Branch on `code`, not on the message:
//   CAPTCHA_FAILED   (400) -> reset the widget, ask for a fresh token, retry
//   PASSWORD_POLICY  (422) -> show the checklist, let the user retry
//   CONFLICT         (409) -> offer sign-in instead
//   PROVIDER_UNAVAILABLE (503) -> retry later / offer social login
```

Checklist for a consumer:

1. Replace `firstName`/`lastName` with one optional `name` (join them yourself
   if you must keep two inputs: the server no longer does it for you when the
   flag is ON).
2. Call `GET /v1/security/methods`; render a Turnstile widget with
   `captcha.siteKey` only if `captcha` is present, and send the resulting
   `turnstileToken`.
3. Render the password rules from `passwordPolicy` instead of hard-coding them.
4. Handle `400 CAPTCHA_FAILED` and `422 PASSWORD_POLICY` as distinct,
   retryable states; do not collapse them into a generic 400.
5. If you add live availability, call `GET /v1/security/signup/email-available`
   on a debounce and fail open.

> Until the backend flag is ON in your environment the old shape still works
> (`firstName`/`lastName` are joined into a display name) but the new endpoint
> returns `404` and `methods` carries no `passwordPolicy`/`captcha`. Do not ship
> a client that *only* works with the flag ON until the
> [rollout](../runbooks/auth-experience-rollout.md) has reached your target
> environment.

## What is and is not done

Verified in this branch's code and tests:

- Contract 1.1.0, generated client, backend signup/availability/methods
  behaviour behind the flag, the `auth-ui` `SignUpFlow` and the host wiring in
  `frontend/src/pages/LoginPage.tsx`, with unit/route tests.

Not done / tracked separately (do not read this guide as saying otherwise):

- **Real-browser runtime validation** (Chrome DevTools MCP console-clean pass
  under TLS with the Module-Federation shell) of the new signup is not recorded
  as done.
- **Playwright e2e** for the new signup flow is shipped under `frontend/tests/`
  (`auth-experience-signup*.spec.ts`), but is **not yet wired into the CI e2e
  workflow** and carries a few open findings (tracked separately); treat it as
  authored, not yet gating.
- **Turnstile production keys are pending.** The Helm chart now wires the
  `TURNSTILE_*` env (default OFF — see the Turnstile runbook); until the owner
  provisions the Cloudflare keys and sets `securityService.turnstile.siteKey` +
  the sealed secret, production serves no captcha.
- The `design/frames/auth-experience/manifest.json` feature-level `approved`
  is still `false` (per-flow approvals are recorded in `build.flows`).
- This documentation change does not flip the flag in any environment; whether
  it is ON anywhere is operational state this page cannot attest to.
