# Consumer onboarding: authN + authZ (step-by-step)

A recipe for wiring a **consumer product** to FuzeFront authentication and
authorization. You integrate against exactly two things — the **FuzeFront
Security API** (`/api/v1/security/*`) and the **`@fuzefront/security-client`**
types. You never touch an identity or policy vendor.

The running example is **FuzeMarket**: a marketplace product with resources like
`Listing`/`Order`/`Cart` and roles like `seller`/`buyer`/`market-admin`.

For the architecture and trust model, read
[`authn-authz-integration.md`](./authn-authz-integration.md) first.

---

## Prerequisites

- Your product is served **same-origin** with the platform (under
  `app.fuzefront.com` in prod, or local TLS in dev), so `/api/v1/security/*`
  resolves without a cross-origin base URL. Never hard-code an absolute API host.
- You can read a GitHub Packages token to install a private `@fuzefront/*`
  package (below).

---

## Step 0 — Install `@fuzefront/security-client`

The client is published **privately** to GitHub Packages under the `@fuzefront`
scope (`access: restricted`). Add a scoped `.npmrc` (do **not** commit a token —
use an env var / CI secret):

```ini
# .npmrc
@fuzefront:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

```bash
npm install @fuzefront/security-client
```

```ts
import type {
  Identity,
  AuthMethods,
  SessionResult,
  SECURITY_CONTRACT_VERSION,
} from '@fuzefront/security-client'
// generated request/response shapes:
import type { components } from '@fuzefront/security-client'
type LoginResponse = components['schemas']['LoginResponse']
type AuthzCheckRequest = components['schemas']['AuthzCheckRequest']
```

> **The package is types-only.** It ships the OpenAPI-generated TypeScript types
> and the stable hand-authored contract types (the `Identity` keystone). There is
> no `client.login()` / `createClient()` — you call the same-origin Security API
> with your own `fetch`/HTTP layer and let these types make contract drift a
> compile error. (A non-TS consumer just calls the HTTP API directly using
> [`packages/security/openapi.yaml`](../../packages/security/openapi.yaml) as the
> reference.)

---

## Step 1 — Discover capabilities and render the sign-in UI

Call `GET /api/v1/security/methods` and render affordances from the neutral
`AuthMethods` descriptor — never assume a provider:

```ts
const methods: AuthMethods = await fetch('/api/v1/security/methods').then(r => r.json())
// methods.password        → show the email/password form
// methods.social          → e.g. ["google"] → render those buttons
// methods.mfa.enabled      → be ready for an mfa_required SessionResult
// methods.verification     → whether email/SMS ownership verification is offered
```

---

## Step 2 — Sign users in / up

### Password login

```ts
const res: SessionResult = await fetch('/api/v1/security/session', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password }),
}).then(r => r.json())

if (res.status === 'authenticated') {
  saveToken(res.token)              // FuzeFront-minted session token
} else {
  // res.status === 'mfa_required'
  await completeMfa(res.challengeId, res.factors)  // /mfa/challenge → /mfa/verify
}
```

### Social login (server-brokered)

1. Navigate the browser to `GET /api/v1/security/social/google/start`
   (optionally `?redirectTo=/some/app/path`, same-origin only).
2. The platform brokers the provider handshake and returns the browser to your
   app with a single-use `?code=…` (never a token in the URL).
3. Exchange it:

```ts
const res: SessionResult = await fetch('/api/v1/security/session/exchange', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ code }),
}).then(r => r.json())
// same authenticated | mfa_required handling as above
```

The browser only ever sees `app.fuzefront.com` and the provider's own consent
host — no internal identity host.

### Signup

```ts
await fetch('/api/v1/security/signup', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password, firstName, lastName, tenantName }),
}) // 201 → LoginResponse (session established); 409 if the email exists
```

> A valid token **authenticates**; it does **not** authorize. Always re-check
> permissions at your API (Step 4).

---

## Step 3 — Read "who am I" (Identity)

On every authenticated request, resolve the caller to the stable `Identity` via
the platform — do not parse the JWT or fetch a JWKS yourself:

```ts
const { identity, user } = await fetch('/api/v1/security/session', {
  headers: { authorization: `Bearer ${token}` },
}).then(r => r.json())

// identity: Identity
//   identity.userId    → stable subject id (use this as the user id everywhere)
//   identity.tenantId  → tenant/org scope, or null if unresolved
//   identity.roles     → string[]
```

- Use `identity.userId` as the canonical user id — do **not** invent your own.
- If `identity.tenantId` is `null`, **fail closed** on any tenant-scoped
  authorization; never guess a tenant.
- `identity.authMode` (`legacy-hs256` → `federated-jwks`) is informational; your
  code stays the same across the migration because `Identity` is invariant.

For M2M callers, introspect the token instead:
`POST /api/v1/security/tokens/introspect` with `{ token }` → fail-closed
`{ active, subject, tenantId, scope, expiresAt }`.

---

## Step 4 — Authorize actions

> **Status:** the AuthZ endpoints below are **frozen in the contract** and
> generated into the client, but are **not yet live** in the Security service —
> AuthN ships first, AuthZ follows. Type your integration against them now and
> gate the calls behind your own feature flag until the AuthZ rollout lands.

Ask the platform for the decision — never a local role cache and never a policy
SDK. `authz/check` is authoritative and fail-closed (`{ allow: false }` on any
error):

```ts
async function may(subject: string, tenant: string,
                   resourceType: string, action: string, key?: string) {
  const body: AuthzCheckRequest = {
    subject, tenant, resource: { type: resourceType, key }, action,
  }
  const { allow } = await fetch('/api/v1/security/authz/check', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  }).then(r => r.json())
  return allow
}

// guard a route
app.patch('/listings/:id', async (req, res) => {
  if (!(await may(req.identity.userId, req.identity.tenantId!, 'Listing', 'update', req.params.id))) {
    return res.status(403).json({ error: 'forbidden', code: 'FORBIDDEN' })
  }
  // …
})
```

Batch checks with `POST /api/v1/security/authz/bulk-check` (≤ 200, index-aligned
decisions); read a subject's effective permissions with
`GET /api/v1/security/authz/permissions?subject&tenant`.

Expected FuzeMarket outcomes once AuthZ is live:

- a `buyer` calling `Listing:update` → **denied**.
- a `seller` calling `Listing:update` on their listing → **allowed**.
- a `market-admin` calling `Order:refund` → **allowed**.

---

## Step 5 — Manage tenants, members, roles, and grants

Assign roles and manage org membership through the API (again, contract-frozen /
AuthZ-rollout gated):

```ts
// make a user a seller in a tenant (tenant-wide RBAC grant)
await fetch('/api/v1/security/authz/grants', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify({ subject: userId, tenant: tenantId, role: 'seller' }),
})

// scope a grant to one resource instance (ReBAC)
await fetch('/api/v1/security/authz/grants', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify({
    subject: userId, tenant: tenantId, role: 'editor',
    resource: { type: 'Listing', key: 'listing-123' },
  }),
})
```

- Tenants: `GET`/`POST /api/v1/security/tenants`, `GET /tenants/{tenantId}`.
- Members: `GET`/`POST /tenants/{tenantId}/members`,
  `DELETE /tenants/{tenantId}/members/{userId}`,
  `PUT /tenants/{tenantId}/members/{userId}/roles`.
- Roles catalogue: `GET /tenants/{tenantId}/roles`.
- Revoke a grant: `DELETE /authz/grants` by `{ grantId }` or the identity tuple
  (idempotent).

Authorization is **per-tenant** — a role in one tenant does not carry to another.
Grants are convenience; `authz/check` (Step 4) stays the source of truth.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `401` on `/session` GET | Missing/expired token | Send `Authorization: Bearer <token>`; re-login on expiry. |
| `authz/check` always `{ allow: false }` | Fail-closed on error, or the AuthZ rollout isn't live yet | Confirm the AuthZ endpoints are enabled; check `subject`/`tenant`/`resource.type`/`action` are all set. |
| `identity.tenantId` is `null` | Legacy token mode, tenant unresolved | Fail closed on tenant-scoped authz; do not default a tenant. |
| Social login loops / no `code` | Absolute or cross-origin `redirectTo` | Use a **same-origin, app-relative** `redirectTo`; absolute URLs are rejected. |
| `npm install` 401/403 for `@fuzefront/*` | Missing scoped `.npmrc` / token | Add the `@fuzefront:registry` line + a valid `GITHUB_TOKEN`. |
| Tempted to parse the JWT / fetch JWKS | Wrong layer | Resolve identity via `GET /session` (or `/tokens/introspect`); consume `Identity`. |

---

## Checklist

- [ ] `@fuzefront/security-client` installed via a scoped `.npmrc` (token not committed).
- [ ] Same-origin `/api/v1/security/*` reachable (no absolute API host hard-coded).
- [ ] Sign-in UI rendered from `GET /methods` (no provider assumptions).
- [ ] Login/signup handles the `authenticated` **and** `mfa_required` `SessionResult`.
- [ ] Identity resolved via `GET /session` — no raw JWT/JWKS parsing.
- [ ] `tenantId === null` fails closed on tenant-scoped authz.
- [ ] Every protected action re-checked via `POST /authz/check` (AuthZ-rollout gated).
- [ ] Roles/grants managed via `/authz/grants` + `/tenants/*`, not a vendor SDK.
</content>
