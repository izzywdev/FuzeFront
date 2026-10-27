---
title: Authentication and Authorization
description: How your app signs users in with the shared FuzeFront identity and checks permissions through the Security API.
audience: developer
order: 5
owner: "@izzywdev"
lastReviewed: 2026-10-26
status: published
---

# Authentication and Authorization

FuzeFront has one identity for the whole family. **Authentik** provides OIDC single sign-on; **Permit** makes authorization decisions. As an app developer you do not integrate with either directly. You talk to the **FuzeFront Security API**, a stable same-origin surface under `/api/v1/security/*`, and the platform brokers the providers behind it. Providers can change without any change in your code.

The contract is `packages/security/openapi.yaml`; the generated types are in `@fuzefront/security-client`. Step-by-step recipes live in `docs/consumers/onboarding-authn-authz.md` and `docs/consumers/authn-authz-integration.md`.

## Authentication: who is the user

A user signed in to the shell is already authenticated when your remote loads. Do not run your own OIDC flow or redirect users to an identity host. The shell mounts your exposed component with an optional `getToken` prop (`() => string | null`, see `frontend/src/components/FederatedAppLoader.tsx`). Call it when you make a request; do not copy the value into long-lived state, because the portal owns account switching and refresh.

```tsx
export default function App({ getToken }: { getToken?: () => string | null }) {
  // call getToken() per request; it may return null when signed out
}
```

Read the current identity from the Security API on the same origin:

```http
GET /api/v1/security/session
Authorization: Bearer <session token>
```

The response carries a normalized `Identity` (`userId`, `tenantId`, `roles`, `authMode`). Consume that shape rather than parsing a JWT or fetching signing keys. It stays stable when the underlying token format changes.

```ts
import type { Identity } from '@fuzefront/security-client'
```

Related session operations include `POST /api/v1/security/session` (password login), `DELETE /api/v1/security/session` (logout), and server-brokered social login that returns a single-use `code` you exchange at `POST /api/v1/security/session/exchange`. No token is ever placed in a URL. Use `GET /api/v1/security/methods` to learn which sign-in options are enabled instead of assuming them.

`tenantId` can be `null` when a tenant is not yet resolved. Treat that as "deny tenant-scoped actions"; never default it to a tenant.

## Authorization: what the user may do

A valid token **authenticates**; it does not **authorize**. Ask the platform for each decision:

```http
POST /api/v1/security/authz/check
Authorization: Bearer <session token>
Content-Type: application/json

{
  "subject": "<userId>",
  "tenant": "<tenantId>",
  "resource": { "type": "Listing", "key": "listing-123" },
  "action": "update"
}
```

The response is `{ "allow": true }` or `{ "allow": false }`. Any error returns a denial: the API is fail-closed, and your code should be too. For several checks at once use `POST /api/v1/security/authz/bulk-check` (up to 200, results index-aligned with the request).

Declare the resources and roles your product owns in `registration/policy.json`, which registration submits alongside your manifest (see [Registering your app](registering-your-app.md)). Validate it in your CI with `npx fuzefront-validate-policy registration/policy.json`. A policy that references an action it never declares is accepted silently and grants nothing, so the validator is worth running.

## Rules that keep you safe

- **Same-origin only.** Call `/api/v1/security/*` with relative paths. No absolute API hosts, no cross-origin base URL.
- **An id is never a capability.** Knowing a resource id does not entitle the caller to it. Authorization always comes from the token plus a Permit-backed decision.
- **A role record is not an answer.** Role and grant assignments are a rollout convenience; `authz/check` is authoritative. Do not cache roles locally.
- **Fail closed.** Missing identity, null tenant, provider error, or a non-OK response all mean deny.
- **Enforce on the server.** Hiding a button in the UI is not authorization. Check in your own backend before acting.
- **Never log or persist tokens.** In the shell, the portal holds them and owns account selection and refresh.

## Backend and service callers

A product backend verifies the caller by presenting the incoming bearer token to the Security API, or uses `@fuzefront/auth` for Express middleware. Service-to-service calls use client credentials through `@fuzefront/service-auth` rather than a user's token; the machine flow is described in `docs/runbooks/s2s-client-credentials.md`.

If you are stuck in a redirect loop or getting unexpected 401 or 403 responses, see [Troubleshooting](troubleshooting.md). For how users see their sign-in and security settings, see the [Account and security](../user-guide/account-and-security.md) guide.
