# Building on FuzeFront

How a downstream product runs **on top of** the FuzeFront platform: register a
micro-frontend into the host shell, consume the shared `@fuzefront/*` packages,
sign users in via Authentik OIDC SSO, authorize with Permit scopes, and call the
platform API.

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

## 3. Authentik OIDC SSO

Identity is owned by **Authentik** (`auth.fuzefront.com` in prod). The platform
backend brokers OIDC; your product gets SSO by sending users through the shell's
auth, or by registering your own OIDC client in Authentik.

Backend OIDC endpoints:

- `GET /api/auth/oidc/login` — starts the Authorization Code flow (redirects to
  Authentik).
- `GET /api/auth/oidc/callback` — exchange + session; the backend issues a JWT.
- `POST /api/auth/login` — local JWT login (dev / non-SSO).

Prod OIDC config (from `values-prod.yaml`):

- issuer: `https://auth.fuzefront.com/application/o/fuzefront/`
- redirect: `https://app.fuzefront.com/api/auth/oidc/callback`
- cookie domain: `fuzefront.com` (session shared across `*.fuzefront.com`)

To SSO your own subdomain product, register an OIDC provider/application in
Authentik with your redirect URI, and validate the issued JWT against the same
issuer. Keep your cookie/JWT audience consistent so the shared session works
across the apex.

---

## 4. Permit scopes (authorization)

Authorization is policy-based via **Permit.io** (a PDP runs in-cluster;
`permit.enabled: true` in prod). The backend gates routes with a
`requirePermission(resource, action)` middleware; the SDK degrades gracefully if
no PDP is reachable (permission-gated routes deny).

To authorize your product's actions:

1. Model your resources/actions/roles in the Permit schema (the chart's
   `permit-schema-sync` Job applies the FuzeFront schema on upgrade; extend it
   for your resources).
2. Call the platform API with a JWT; the backend resolves the user + org context
   and checks the PDP.
3. Multi-tenant: permissions are isolated per **organization**; pass/inherit the
   org context so checks are scoped to the right tenant.

---

## 5. Calling the platform API

- **Base URL**: `https://app.fuzefront.com/api` (prod). In-cluster, the frontend
  nginx proxies `/api` + `/socket.io` to the backend Services. The browser API
  base defaults to same-origin — never hardcode `http://…` (mixed-content under
  TLS).
- **Auth**: `Authorization: Bearer <jwt>` from OIDC or local login.
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
