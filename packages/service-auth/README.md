# @fuzefront/service-auth

Runtime **service-to-service (machine) auth** for the FuzeFront family.

FuzeFront's own consumer docs used to say: "call the same-origin Security API
with your own fetch/HTTP layer." That meant every consuming service hand-rolled
its own ~15-line introspection call — and one of them was going to get the one
subtle part wrong: **`POST /api/v1/security/tokens/introspect` ALWAYS answers
HTTP 200.** An inactive/expired/revoked token still comes back `200 { active:
false }`. A caller that checks `res.ok` / `status === 200` instead of the
`active` boolean in the body fails **open**.

This package is the one implementation everyone imports instead, bound to the
frozen contract in
[`@fuzefront/security-client`](https://github.com/izzywdev/FuzeFront/tree/master/packages/security)
(`packages/security/openapi.yaml`): `POST /api/v1/security/tokens` (issue) and
`POST /api/v1/security/tokens/introspect` (verify). It never talks to the
vendor identity provider behind those endpoints — only to FuzeFront.

## Install

```bash
npm install @izzywdev/fuzefront-service-auth        # + express, if you use the middleware
```

> **Published name.** `@fuzefront/service-auth` is the *workspace-internal* name and is **not installable** —
> the `@fuzefront` scope does not exist on GitHub. The published package is **`@izzywdev/fuzefront-service-auth`**
> (latest `0.1.1`). To keep the short specifier used in the examples below, alias it in your
> `package.json`: `"@fuzefront/service-auth": "npm:@izzywdev/fuzefront-service-auth@^0.1.1"`.

## The two halves

### 1. Caller — obtain a machine token

```ts
import { createServiceAuthClient } from '@fuzefront/service-auth'

const auth = createServiceAuthClient({
  baseUrl: process.env.FUZEFRONT_API_URL!, // e.g. http://backend:3001/api
  clientId: process.env.SERVICE_CLIENT_ID!,
  clientSecret: process.env.SERVICE_CLIENT_SECRET!,
  // scope: 'invoices:read invoices:write',
})

async function callDownstream() {
  const token = await auth.getToken() // cached; refreshed BEFORE it expires
  return fetch('https://billing.internal/invoices', {
    headers: { authorization: `Bearer ${token}` },
  })
}
```

- The token is cached in memory and reused until it's within
  `refreshMarginSeconds` (default 30s) of its `expiresIn` — refresh happens
  proactively on the next `getToken()` call, never reactively after a 401.
- Concurrent `getToken()` calls during a refresh share **one** in-flight
  request (single-flight), so N callers racing a refresh never turn into N
  requests against the issuance endpoint.
- Call `auth.invalidate()` to force a fresh token on the next call (e.g. if a
  downstream call ever does get a 401 with this token, invalidate and retry
  once — don't loop).

### 2. Resource server — verify an incoming machine token

```ts
import express from 'express'
import { createMachineTokenVerifier, requireMachineAuth } from '@fuzefront/service-auth'

const verifier = createMachineTokenVerifier({
  baseUrl: process.env.FUZEFRONT_API_URL!,
})

const app = express()
app.use(
  '/internal',
  requireMachineAuth({
    verifier,
    // Optional: wire in a real policy decision once the /authz/* routes are
    // live for machine principals. Until then, omit `authorize` and this is
    // authentication-only gating (any verified machine identity passes).
    // authorize: async (identity, req) =>
    //   authzClient.check(
    //     { subject: identity.subject, tenant: identity.tenantId!, resource: { type: 'invoice' }, action: 'read' },
    //     bearerFromReq(req),
    //   ).then(d => d.allow),
  }),
)

app.get('/internal/invoices', (req, res) => {
  res.json({ calledBy: req.machineIdentity!.subject })
})
```

- `verifyMachineToken(token)` throws `ServiceAuthError` for every failure mode
  — never returns a permissive identity. That includes: token inactive
  (`active: false`, even though the HTTP status was 200), network error,
  timeout, non-200 status, unparsable body, a body missing `active`.
- The middleware never calls `next()` for a request that didn't pass: `401`
  for anything authentication-shaped (no token, garbage header, verification
  failure), `403` for an `authorize` hook that returned `false` **or threw**
  (a hook that can't decide is treated as a denial, same as everywhere else in
  this package).
- Positive introspection results are cached briefly (`cacheTtlSeconds`,
  default 5s, capped by the token's own `exp`) to avoid hammering the
  introspection endpoint on hot paths. **Negative results are never cached at
  any setting** — a revocation is visible on the very next call.

## Guarantees worth knowing

- **Fail-closed everywhere.** Every ambiguity — network error, timeout,
  malformed body, a missing/mistyped `active` — is a denial (`ServiceAuthError`
  thrown, or `401`/`403` from the middleware). There is no "allow on error"
  path in this package.
- **Branches on the body, never on HTTP status**, for introspection. This is
  the one property the whole package exists to get right — see
  `tests/verifier.test.ts`'s first test.
- **Single-flight token refresh.** A stampede of callers refreshing at the
  same instant makes exactly one request, not N.

## Error codes

| Code | Where | Meaning |
|---|---|---|
| `MISCONFIGURED` | client/verifier/middleware construction | missing required options |
| `TOKEN_REQUEST_FAILED` | client | issuance request failed (network, non-2xx) |
| `MALFORMED_RESPONSE` | client/verifier | response body didn't match the contract |
| `NO_TOKEN` | verifier/middleware | no/empty token presented |
| `INTROSPECTION_UNAVAILABLE` | verifier | network error, timeout, or unexpected non-200 from introspect |
| `TOKEN_INACTIVE` | verifier | introspection answered `{ active: false }` |
| `FORBIDDEN` | middleware | `authorize` hook denied or threw |

## Types

Request/response shapes (`TokenIssueRequest`, `TokenIssueResponse`,
`TokenIntrospectRequest`, `TokenIntrospection`) are re-exported from the
generated `@fuzefront/security-client` — this package never restates the wire
contract, only builds runtime behavior on top of it.
