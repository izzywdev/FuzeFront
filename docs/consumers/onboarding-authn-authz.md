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
- You can read a GitHub Packages token (`read:packages`) to install a private
  **`@izzywdev/fuzefront-*`** package (below). Note the scope: `@fuzefront` is a
  workspace-internal name and is **not** a registry scope — no `fuzefront` user or
  org exists on GitHub, so `npm install @fuzefront/…` 404s regardless of the token.

---

## Step 0 — Install `@fuzefront/security-client`

The client is published to GitHub Packages. Until this repo moves to the
`fuzefront` org, it ships under the owner scope as
**`@izzywdev/fuzefront-security-client`** and is consumed via an npm **alias**, so
your imports stay `@fuzefront/security-client`. Add a scoped `.npmrc` (do **not**
commit a token — use an env var / CI secret):

```ini
# .npmrc
@izzywdev:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

Alias the canonical import name to the published package in your `package.json`,
then install:

```jsonc
// package.json
"dependencies": {
  "@fuzefront/security-client": "npm:@izzywdev/fuzefront-security-client@^0.1.0"
}
```

```bash
npm install
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

> **Status:** the AuthZ endpoints below are **live** in the Security service
> (`backend/security/src/routes/authz.ts`, mounted at `/api/v1/security` —
> merged izzywdev/FuzeFront#272) — this banner previously said "not yet live"
> after AuthN shipped first; that has been true since mid-2026 and this doc
> was simply stale. `Authorization: Bearer <token>` accepts EITHER a
> FuzeFront human session token OR a machine `client_credentials` token (S2S
> — see `docs/runbooks/s2s-client-credentials.md` step 5) — same routes, same
> shapes, resolved caller identity differs. You no longer need your own
> feature flag to gate these calls.

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

## Step 4b — Declare the roles you are checking (`registration/policy.json`)

Step 4 checks `Listing:update`. Something has to have told the platform that
`Listing` and `update` and `seller` exist. That something is a file in **your**
repo — you never call a policy vendor, and you never open a PR against FuzeFront.

Ship `registration/policy.json` next to your `manifest.json`, using **bare** keys:

```json
{
  "name": "FuzeMarket",
  "resources": [
    { "key": "Listing", "name": "Listing",
      "actions": { "read": { "name": "Read" }, "update": { "name": "Update" } } }
  ],
  "roles": [
    { "key": "seller", "name": "Seller", "permissions": ["Listing:read", "Listing:update"] }
  ]
}
```

`register.sh` (from `@fuzefront/onboarding-kit`, running as your init container)
`PUT`s it to `/api/v1/app-registry/apps/{slug}/policy` on every deploy. The platform
namespaces your keys as `<slug>_<Key>` — `fuzemarket_Listing`, `fuzemarket_seller` —
so your `Listing` never collides with another product's, then merges them into the
platform schema and pushes that to the policy provider.

Rules the platform enforces, in the order they will bite you:

1. **Keys are bare and contain no `_`.** `_` is the namespace separator. Write
   `VaultAsset`, never `Vault_Asset`, and never `fuzemarket_Listing`.
2. **The document is strict.** Any key other than `product` / `name` / `resources` /
   `roles` is a `400`. That includes a well-meant `$comment`.
3. **Every `Resource:action` in a role must resolve inside this same file.** A
   reference to something you did not declare does not error at runtime — the role is
   created and simply grants nothing.
4. **`product`, if you include it, must equal your manifest slug.** Omit it and the
   slug is used.

Validate it in your own CI, so a mistake fails your build rather than an init
container at deploy:

```bash
npx fuzefront-validate-policy registration/policy.json
```

### Acceptance is not propagation

A `200` from the policy endpoint means **validated and stored**. It is pushed to the
policy provider by the platform's schema sync, which runs on FuzeFront backend boot
and as a post-install/post-upgrade job — so between your deploy and that sync, your
roles exist in the registry and deny in production.

To see what the last sync actually applied:

```bash
curl -s https://app.fuzefront.com/health | jq .permit
```

- `outcome: "ok"` and your slug in `registeredProducts` — your policy is live.
- your slug in `rejectedProducts` — it was stored but failed validation at sync
  time; the `reason` says why, and **your product currently has no roles**.
- `outcome: "registry_unavailable"` — a platform-side problem; no product policy was
  applied. Raise it against FuzeFront, not your own service.

If `authz/check` denies everything for a role you know you declared, check this
endpoint **before** debugging your own code.

---

## Step 5 — Manage tenants, members, roles, and grants

Assign roles and manage org membership through the same live API used in Step 4.

> A **machine (S2S) caller** hitting `POST`/`DELETE /authz/grants` must hold the
> `authz:admin` scope on its token, or the request is rejected `403 FORBIDDEN`
> — grant/revoke mutate the authorization graph platform-wide, so only a small,
> explicitly-provisioned set of operator service accounts should carry that
> scope (see `docs/runbooks/s2s-client-credentials.md` step 5). `authz/check`
> has no such restriction: any authenticated caller — human or machine — may
> ask it a question, since a check can't change what's true. Human callers are
> unaffected by this gate.

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
| `authz/check` always `{ allow: false }` | Fail-closed on error/PDP-unreachable, a malformed request, or your policy never declared the role/resource/action | Check `subject`/`tenant`/`resource.type`/`action` are all set; confirm your `policy.json` declares them (Step 4b); check server logs for `authz: check errored — denying`. |
| A machine (S2S) caller's `authz/check` gets `401` | The bearer token is neither a valid FuzeFront session nor a valid `client_credentials` token | Confirm the token was issued via the `client_credentials` grant against Authentik and hasn't expired — see `docs/runbooks/s2s-client-credentials.md`. |
| A machine (S2S) caller's `POST`/`DELETE /authz/grants` gets `403 FORBIDDEN` | The token's `scope` claim is missing `authz:admin` | Grant/revoke require it; `check` does not. Re-provision the service account with `authz:admin` in its scopes if it is meant to be an authorization operator. |
| One role denies everything, others work | The role references a resource/action your `policy.json` never declared — it grants nothing, silently | `npx fuzefront-validate-policy registration/policy.json` (Step 4b). |
| **Every** role denies, right after a deploy | Your policy was stored but not yet synced, or the sync dropped it | `curl -s <host>/health \| jq .permit` — look for your slug in `registeredProducts` vs `rejectedProducts` (Step 4b). |
| Your slug is in neither list on `/health` | `register.sh` never submitted the policy — an old vendored copy has no policy step, or the file is misnamed | The file must be exactly `registration/policy.json`; re-vendor `register.sh` from `@fuzefront/onboarding-kit`. |
| `identity.tenantId` is `null` | Legacy token mode, tenant unresolved | Fail closed on tenant-scoped authz; do not default a tenant. |
| Social login loops / no `code` | Absolute or cross-origin `redirectTo` | Use a **same-origin, app-relative** `redirectTo`; absolute URLs are rejected. |
| `npm install` **404** for `@fuzefront/*` | Wrong package name — that scope does not exist on GitHub | Install `@izzywdev/fuzefront-<name>` instead. |
| `npm install` 401/403 for `@izzywdev/*` | Missing scoped `.npmrc` / token | Add the `@izzywdev:registry` line + a valid `GITHUB_TOKEN` with `read:packages`. |
| Tempted to parse the JWT / fetch JWKS | Wrong layer | Resolve identity via `GET /session` (or `/tokens/introspect`); consume `Identity`. |

---

## Checklist

- [ ] `@fuzefront/security-client` installed via a scoped `.npmrc` (token not committed).
- [ ] Same-origin `/api/v1/security/*` reachable (no absolute API host hard-coded).
- [ ] Sign-in UI rendered from `GET /methods` (no provider assumptions).
- [ ] Login/signup handles the `authenticated` **and** `mfa_required` `SessionResult`.
- [ ] Identity resolved via `GET /session` — no raw JWT/JWKS parsing.
- [ ] `tenantId === null` fails closed on tenant-scoped authz.
- [ ] `registration/policy.json` declares every resource/action/role you check, with bare keys.
- [ ] `npx fuzefront-validate-policy registration/policy.json` runs in your CI.
- [ ] Your vendored `register.sh` actually submits it (grep for `apps/${SLUG}/policy`).
- [ ] Your slug appears in `registeredProducts` on the platform's `/health` → `permit`.
- [ ] Every protected action re-checked via `POST /authz/check` (AuthZ-rollout gated).
- [ ] Roles/grants managed via `/authz/grants` + `/tenants/*`, not a vendor SDK.
</content>
