# Building on FuzeFront

How a downstream product runs **on top of** the FuzeFront platform: register a
micro-frontend into the host shell, consume the shared `@fuzefront/*` packages,
sign users in and authorize them through the **FuzeFront Security API**, and call
the platform API.

FuzeFront is a **Module-Federation host shell** ("runtime fabric"): a dark-default
dashboard that discovers, mounts, and fuses remote micro-frontends ("apps") into
one runtime experience. Your product is one of those apps.

---

## 1. Register a Module-Federation app

The shell discovers apps at runtime via the platform API — **no build-time
dependency** on your app. Your app exposes a federated module; you register its
`remoteEntry.js` URL + scope/module with the shell.

### 1a. Expose your app as a remote (Vite)

```ts
// vite.config.ts (your micro-frontend)
import federation from '@originjs/vite-plugin-federation'

export default {
  plugins: [
    federation({
      name: 'myApp',                 // becomes the `scope`
      filename: 'remoteEntry.js',
      exposes: { './App': './src/App.tsx' },  // becomes the `module`
      shared: ['react', 'react-dom'], // MUST be shared singletons with the host
    }),
  ],
  build: { target: 'esnext' },
}
```

Serve the build with permissive CORS so the shell (a different origin) can fetch
`remoteEntry.js`.

### 1b. Register it with the platform

```bash
curl -X POST https://app.fuzefront.com/api/apps/register \
  -H 'Authorization: Bearer <jwt>' \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "My App",
    "integrationType": "module-federation",
    "remoteUrl": "https://my-app.example.com/assets/remoteEntry.js",
    "scope": "myApp",
    "module": "./App"
  }'
```

Fields (`integrationType` is one of `module-federation` | `iframe` |
`web-component` | `spa`):

| field | meaning |
|---|---|
| `name` | display name in the shell |
| `integrationType` | how the shell mounts it |
| `remoteUrl` | URL of `remoteEntry.js` (module-federation) or the page (iframe) |
| `scope` | the `name` from your federation config |
| `module` | the exposed key, e.g. `./App` |

Apps can self-register on boot and send heartbeats; the SDK wraps this. The shell
loads the remote on demand using `@originjs/vite-plugin-federation`. React /
React-DOM are shared singletons for performance, so keep your React major in step
with the host.

---

## 2. Consume the `@fuzefront/*` packages

FuzeFront publishes reusable packages **privately to GitHub Packages** under the
`@fuzefront` (and `@izzywdev`) scopes. Consumers authenticate with a scoped
`.npmrc` + a `GITHUB_TOKEN`/PAT that has `read:packages`.

```ini
# .npmrc (in the consuming repo; do NOT commit the token)
@fuzefront:registry=https://npm.pkg.github.com
@izzywdev:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

| package | what it gives you |
|---|---|
| `@fuzefront/shared` | shared types, Kafka `TOPICS` constant + `FuzeEvent<T>` envelope, typed producer/consumer helpers |
| `@izzywdev/fuzefront-api-client` | generated TypeScript client for the platform API (auth, apps, health) |
| `@izzywdev/fuzefront-sdk-react` | React SDK for self-registration, heartbeat, and host context |

If you publish your own reusable package, follow the same convention:
`publishConfig` → `https://npm.pkg.github.com` with `access: restricted`, never
public npm.

### Kafka events

If your service consumes/produces platform events, use the shared constants
rather than string literals:

```ts
import { TOPICS, FuzeEvent } from '@fuzefront/shared'
// e.g. TOPICS.IDENTITY_USER_CREATED, TOPICS.NOTIFY_EMAIL_REQUESTED
```

Topics are prefixed (`identity.*`, `notify.*`, `billing.*`) and pre-created in
prod by the chart's `kafka-topics-job`. Add new topics there + to the shared
constant together.

---

## 3. Authentication (Security API)

Sign users in through the **FuzeFront Security API** (`/api/v1/security/*`,
same-origin) and the `@fuzefront/security-client` types — never a vendor SDK or
identity host. The platform brokers everything server-side; the browser only ever
transits `app.fuzefront.com` and (for social login) the social provider's own
consent host.

Consumer AuthN endpoints:

- `GET /api/v1/security/methods` — capability descriptor (which sign-in methods
  are available); replaces the legacy `oidcConfigured` boolean.
- `POST /api/v1/security/session` — password login → `SessionResult`
  (`authenticated` or `mfa_required`).
- `GET /api/v1/security/social/{provider}/start` → provider consent →
  `GET /api/v1/security/social/callback` returns a single-use `?code=`, which you
  exchange at `POST /api/v1/security/session/exchange` (no token in the URL).
- `POST /api/v1/security/signup` — server-brokered account creation.
- `GET /api/v1/security/session` — the current stable `Identity` ("me");
  `DELETE /api/v1/security/session` — logout.

Resolve every caller to the stable `Identity`
(`{ userId, tenantId, roles, authMode, … }`) via the Security API — **do not**
parse the JWT or fetch a JWKS. `Identity` is invariant across the token-format
migration. See
[`docs/consumers/onboarding-authn-authz.md`](../consumers/onboarding-authn-authz.md)
for the step-by-step recipe.

---

## 4. Authorization (Security API)

Authorize actions by asking the Security API for a decision — never a local role
cache or a policy SDK. `POST /api/v1/security/authz/check` is authoritative and
fail-closed (`{ allow: false }` on any error):

1. `POST /api/v1/security/authz/check` with
   `{ subject, tenant, resource: { type, key? }, action }` → `{ allow }`.
   Batch with `/authz/bulk-check`; read effective grants with
   `/authz/permissions?subject&tenant`.
2. Manage roles/membership via `/authz/grants` (tenant-wide RBAC or
   resource-scoped ReBAC) and `/tenants/*`.
3. Multi-tenant: authorization is isolated **per tenant**; a role in one tenant
   does not carry to another. If `identity.tenantId` is `null`, fail closed.

> **Status:** AuthN is live; the AuthZ endpoints (`/authz/*`, `/tenants/*`) are
> contract-frozen and generated into the client but not yet wired in the Security
> service — build against them now and gate behind a flag until the AuthZ rollout
> lands. Full detail:
> [`docs/consumers/authn-authz-integration.md`](../consumers/authn-authz-integration.md).

---

## 5. Calling the platform API

- **Base URL**: `https://app.fuzefront.com/api` (prod). In-cluster, the frontend
  nginx proxies `/api` + `/socket.io` to the backend Services. The browser API
  base defaults to same-origin — never hardcode `http://…` (mixed-content under
  TLS).
- **Auth**: `Authorization: Bearer <token>` — a FuzeFront-minted session or M2M
  token from the Security API (§3). Consume the normalized `Identity`, not raw claims.
- **Health**: `GET /api/health` → `{ status, database, ... }` (used by the prod
  smoke check).
- **Client**: prefer `@izzywdev/fuzefront-api-client` over hand-rolled fetch — it
  tracks the API surface and types.

```ts
import { FuzeFrontClient } from '@izzywdev/fuzefront-api-client'
const client = new FuzeFrontClient({ baseUrl: window.location.origin, token })
const apps = await client.apps.list()
```

---

## 6. Design language

FuzeFront is **dark-default** with the **"fuse seam"** motif (indigo→cyan gradient
marking where the shell joins hosted content). If you build UI that renders inside
the shell, align to the **fuse seam design system** (`design-system/`): reuse its
tokens/components, don't hard-code colors/spacing/type, and extend the system
rather than one-off styling.

---

## See also

- Operational deployment runbook: `docs/deployment/CONTABO_DEPLOYMENT.md`
- Module Federation deep-dive: `docs/guides/MODULE_FEDERATION_GUIDE.md`
- Developer guide: `docs/guides/DEVELOPER_GUIDE.md`
