# AuthN + AuthZ integration for consumer products

How a **consumer product** (a product built on the FuzeFront platform — e.g.
**FuzeMarket**) authenticates its users and authorizes their actions **through
the FuzeFront Security API**, without ever talking to an identity or policy
vendor directly.

> Audience: platform engineers extending FuzeFront, and product teams onboarding
> a new consumer product. For the step-by-step recipe see
> [`onboarding-authn-authz.md`](./onboarding-authn-authz.md).

---

## The only two things a consumer knows

1. **The FuzeFront Security API** — a stable, same-origin HTTP surface under
   **`/api/v1/security/*`**. The source of truth is the OpenAPI contract at
   [`packages/security/openapi.yaml`](../../packages/security/openapi.yaml).
2. **The `@fuzefront/security-client` package** — the generated TypeScript types
   for that contract (including the stable `Identity` shape). Install it from
   GitHub Packages (see the onboarding guide) and import its types.

That is the entire integration seam. A consumer never sees, names, or configures
an identity provider, an authorization engine, a JWKS endpoint, or any vendor
SDK. Those are **swappable server-side implementations** hidden behind the
Security API's internal adapters (`IdentityProvider`, `AuthorizationProvider`).
FuzeFront can switch or blend providers for features or cost with **zero**
consumer change.

**Naming rule (strict):** no vendor/product name appears in any consumer-facing
path, type, field, config key, URL, or doc. Open-standard protocol terms
(OIDC/OAuth2/JWKS/PKCE) may appear only where they name a genuine wire protocol
the browser transits — never as a thing you integrate against.

---

## TL;DR

- **AuthN** — sign users in/up and manage their session entirely through
  `/api/v1/security/*` (`/session`, `/signup`, `/social/{provider}/start`,
  `/session/exchange`, `/methods`). For social login the user's browser only
  ever transits `app.fuzefront.com` and, briefly, the social provider's own
  consent host (e.g. `accounts.google.com`) — never a FuzeFront-internal
  identity host.
- **Identity** — every authenticated caller resolves to the stable, normalized
  **`Identity`** (`{ userId, tenantId, roles, authMode, … }`) from
  `@fuzefront/security-client`. It is **invariant across token-format
  migrations**, so your code never parses raw JWTs or fetches JWKS. Read
  "who am I" from `GET /api/v1/security/session`.
- **AuthZ** — ask the platform for decisions with
  `POST /api/v1/security/authz/check` (single) or `/authz/bulk-check`, list
  effective `/authz/permissions`, and manage tenants/members/roles/grants under
  `/authz/grants` and `/tenants/*`. Never call a policy SDK.
- **Fail-closed everywhere** — any verification, provider, or transport error
  yields a denial (401/403) or an explicit error body, never a permissive
  fallback. `authz/check` returns `{ allow: false }` on any error.

---

## 1. Architecture

```
   Consumer product (e.g. FuzeMarket)
   ─ browser SPA ─┐                        ┌───────────────────────────────────┐
                  │  same-origin HTTPS      │        FuzeFront platform          │
                  ▼                        │                                    │
        /api/v1/security/*  ──────────────►│   FuzeFront Security API           │
        (@fuzefront/security-client types) │   (packages/security/openapi.yaml) │
                  ▲                        │        │                           │
   ─ product API ─┘                        │        ▼   internal adapters       │
        Bearer <token>                     │   IdentityProvider  AuthorizationProvider
        authz/check ─────────────────────►│   (identity engine) (policy engine)  │
                                           │        ▲                ▲            │
                                           │   swappable, vendor-hidden           │
                                           └───────────────────────────────────┘
```

- The consumer SPA and the consumer's own API both speak **only** to
  `/api/v1/security/*` on the same origin (`app.fuzefront.com` in prod; local
  TLS locally). Never hard-code an absolute API host — the base is same-origin so
  it works identically local and prod.
- Every request carries `Authorization: Bearer <token>` where the token is a
  **FuzeFront-minted** session or M2M token. Consumers depend on the normalized
  `Identity`, never on the raw claims inside the token.
- The identity engine and the authorization engine live behind server-side
  adapters. Their vendor identity is a server-only implementation detail.

---

## 2. AuthN — authenticate through the Security API

The consumer never runs an OIDC code flow itself and never redirects users to an
identity host. It calls the Security API; the platform brokers everything.

### 2.1 Capability discovery — `GET /api/v1/security/methods`

Returns the neutral `AuthMethods` descriptor so the UI can render the right
affordances (password form, which social buttons, whether MFA / contact
verification are enabled) **without knowing any provider**:

```jsonc
{
  "password": true,
  "social": ["google"],
  "mfa": { "enabled": true, "types": ["totp", "sms", "email"] },
  "verification": { "email": true, "sms": true }
}
```

This replaces the legacy vendor-specific `oidcConfigured` boolean.

### 2.2 Password login — `POST /api/v1/security/session`

Body `{ email, password }`. Returns a **`SessionResult`** — a discriminated union
on `status`:

- `{ status: "authenticated", token, sessionId?, user }` — session established.
- `{ status: "mfa_required", challengeId, factors[] }` — the account has MFA;
  complete step-up via `POST /mfa/challenge` then `POST /mfa/verify` (which
  returns the authenticated `LoginResponse`).

Always narrow on `status` before reading variant fields. Bad credentials
fail-closed with `401`.

### 2.3 Social login — server-brokered, no internal host exposed

1. Send the browser to `GET /api/v1/security/social/{provider}/start`
   (`provider` = `google` today; extensible). Optional same-origin `redirectTo`.
   The platform 302-redirects to the provider's own consent host.
2. The provider returns to `GET /api/v1/security/social/callback`. The platform
   completes the handshake, provisions/links the user, mints a **single-use
   opaque `code`**, and 302-redirects back to the app with `?code=<opaque>`.
   **No token is ever placed in the URL.**
3. The SPA calls `POST /api/v1/security/session/exchange` with `{ code }` and
   gets a `SessionResult` (which may itself be an `mfa_required` challenge).

The browser only ever transits `app.fuzefront.com` and the social provider's
consent host. No FuzeFront-internal identity host is visible or named.

### 2.4 Signup — `POST /api/v1/security/signup`

Body `{ email, password, firstName?, lastName?, tenantName? }`. The user sees
only FuzeFront-branded UI — never a provider's raw enrollment page. On success a
session is established (`201` → `LoginResponse`). `409` if the email exists.

### 2.5 Session lifecycle

- `GET /api/v1/security/session` → `SessionInfo { identity, user }` — the current
  identity ("me"). This is the authoritative source of any out-of-band
  role/tenant hydration.
- `DELETE /api/v1/security/session` — logout; revokes the presented token
  (idempotent, `204`).

### 2.6 MFA and contact verification (provider-agnostic)

- **MFA** (`/mfa/*`): enroll/list/activate/remove factors, regenerate
  recovery codes, and the login step-up pair `/mfa/challenge` + `/mfa/verify`.
  Consumers see only neutral factor `type` values (`totp`/`sms`/`email`, with
  `webauthn` reserved) — never a provider name.
- **Contact verification** (`/verify/*`): email + phone ownership verification,
  distinct from MFA login step-up; `GET /verify/status` returns
  `{ emailVerified, phoneVerified, phone? }`.

### 2.7 Machine-to-machine tokens

- `POST /api/v1/security/tokens` — issue a FuzeFront-owned M2M token
  (client-credentials style) for a provisioned service client.
- `POST /api/v1/security/tokens/introspect` — introspect it; fail-closed
  (`{ active: false }` for unknown/expired).

---

## 3. Identity — the stable keystone

Every authenticated caller resolves to the normalized `Identity` from
`@fuzefront/security-client`:

```ts
import type { Identity } from '@fuzefront/security-client'

// Identity = {
//   userId: string            // stable subject id — always present
//   tenantId: string | null   // tenant/org scope; null when unresolved (legacy mode)
//   roles: string[]           // always an array; [] means "no roles known"
//   email?: string
//   authMode: 'legacy-hs256' | 'federated-jwks'
//   issuedAt?, expiresAt?, issuer?
// }
```

- **Verify tokens via the platform, not by hand.** Do not parse the JWT, do not
  fetch a JWKS, do not trust raw claims. Present the token to the Security API
  (e.g. `GET /session`, or `/tokens/introspect` for M2M) and consume the
  resulting `Identity`.
- **`Identity` is invariant across the token-format migration** (`authMode`
  moves `legacy-hs256` → `federated-jwks`). Your integration does not change when
  the underlying token format does.
- **`tenantId` may be `null`** in legacy token mode when the tenant is not yet
  resolved. Consumers **fail-closed** on tenant-scoped authorization when it is
  null — never default it to a tenant.
- The `userId` is the same stable subject across the whole family, so a role or
  grant the platform assigns applies to your product's checks for the same user.

The contract version is exported as `SECURITY_CONTRACT_VERSION` (currently
`0.3.0`); consumers may assert on the major.

---

## 4. AuthZ — decisions through the Security API

> **Delivery status:** AuthN is shipped first (it closes the acute vendor-leak).
> The AuthZ surface below (`/authz/*`, `/tenants/*`) is **frozen in the contract**
> and generated into the client, but its endpoints are **not yet live** in the
> Security service. Build against the contract/client types now; the endpoints
> light up in the AuthZ rollout that follows AuthN. Treat any AuthZ call as
> "coming" until then and gate it behind your own flag.

A grant/role assignment is a rollout convenience — the **authoritative** answer
to "may this subject do this?" is always `POST /authz/check`, never the presence
of a role record and never a local cache.

### 4.1 Check a single decision — `POST /api/v1/security/authz/check`

```jsonc
// request (AuthzCheckRequest)
{
  "subject": "<userId>",
  "tenant":  "<tenantId>",
  "resource": { "type": "Listing", "key": "listing-123" },  // key optional (ReBAC instance)
  "action":  "update",
  "context": { }                                            // optional
}
// response (AuthzDecision)
{ "allow": true }
```

Fail-closed: any provider/transport error returns `{ allow: false }`.

### 4.2 Bulk + effective permissions

- `POST /api/v1/security/authz/bulk-check` — ordered `checks[]` (≤ 200) →
  `decisions[]` index-aligned with the request.
- `GET /api/v1/security/authz/permissions?subject&tenant` → `PermissionSet`
  (`{ subject, tenant, permissions: ["resource:action", …] }`) — the effective,
  bounded permission set for one subject in one tenant.

### 4.3 Grants (write side) — `/api/v1/security/authz/grants`

- `POST` — grant a `role` (and/or explicit `permission`) to a `subject` within a
  `tenant`. Omit `resource` for a **tenant-wide (RBAC)** grant; include
  `resource: { type, key }` to scope to a **specific resource instance (ReBAC)**.
  Returns the created `Grant`.
- `DELETE` — revoke by `{ grantId }` **or** by the identity tuple
  `{ subject, tenant, role, resource? }` (supply one form). Idempotent (`204`
  even if absent).
- `GET ?subject&tenant` — list a subject's grants (cursor-paginated `GrantPage`,
  because ReBAC grants across many resource instances are potentially unbounded).

### 4.4 Tenants, members, roles — `/api/v1/security/tenants/*`

Neutralized authorization primitives for multi-tenant org management:

| Operation | Endpoint |
| --- | --- |
| List / create tenants | `GET` / `POST /tenants` (list is cursor-paginated) |
| Get a tenant | `GET /tenants/{tenantId}` |
| List / add members | `GET` / `POST /tenants/{tenantId}/members` (list paginated) |
| Remove a member | `DELETE /tenants/{tenantId}/members/{userId}` |
| List roles (bounded catalogue) | `GET /tenants/{tenantId}/roles` |
| Replace a member's roles | `PUT /tenants/{tenantId}/members/{userId}/roles` |

Authorization is **per-tenant**: a role in tenant A does not grant it in tenant
B. Assign per tenant.

---

## 5. Cross-product session handoff — coming

A within-product opaque-`code` exchange exists today for social login
(`/social/callback` → `/session/exchange`, §2.3). A **cross-product** one-time
handoff — where a user already signed in to one Fuze product lands
pre-authenticated in another without re-login — is **not yet available**. When it
ships it will reuse the same opaque single-use-`code` + `/session/exchange`
pattern (no token in the URL). Do not build against it until it is in the
contract; treat it as a future capability.

---

## 6. What lives where

| Concern | Location (source of truth) |
| --- | --- |
| Contract (all paths + schemas) | `packages/security/openapi.yaml` |
| Generated + stable client types | `@fuzefront/security-client` (`packages/security/src/`) |
| `Identity`, `AuthMode`, `AuthMethods`, `Grant`, … | `packages/security/src/types.ts` |
| Contract version | `SECURITY_CONTRACT_VERSION` (`0.3.0`) |

Everything else — which identity engine, which policy engine, JWKS, provider
config — is server-side and **out of the consumer's contract**. If you find
yourself needing a vendor name to integrate, that is a bug in the integration,
not a missing doc.
</content>
</invoke>
