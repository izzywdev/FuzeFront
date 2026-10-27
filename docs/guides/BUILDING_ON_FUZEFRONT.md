# Building on FuzeFront

How a downstream product runs **on top of** the FuzeFront platform: register a
micro-frontend into the host shell, consume the shared platform packages,
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
  // If your app runs in the SAME cluster as the shell, it is served at
  // https://<shell-host>/apps/<slug>/ — see "Serving the remote" below. `base`
  // MUST match that prefix or remoteEntry.js loads and every chunk it imports
  // 404s against the shell's own bundle.
  base: '/apps/myapp/',
  plugins: [
    federation({
      name: 'myApp',                 // becomes the `scope`
      filename: 'remoteEntry.js',
      exposes: { './App': './src/App.tsx' },  // becomes the `module`
      // MUST match the host's shared config EXACTLY — explicit singletons on
      // the same React major. The bare `['react','react-dom']` shorthand does
      // NOT set `singleton`, which lets your remote load its own React copy and
      // die on "Invalid hook call" in the browser, with nothing in CI to catch
      // it.
      shared: {
        react: { singleton: true, requiredVersion: '^19.0.0' },
        'react-dom': { singleton: true, requiredVersion: '^19.0.0' },
      },
    }),
  ],
  build: { target: 'esnext' },
}
```

### Serving the remote — prefer the shell's own origin

The browser fetches `remoteEntry.js`, so **cluster-internal DNS
(`*.svc.cluster.local`) is not an option** — the browser cannot resolve it.

If your app runs in the same cluster as the shell, do **not** publish the remote
on its own public hostname. Give it a same-origin mount instead: an Ingress in
**your app's own namespace** (an Ingress may only target a Service in its own
namespace; Traefik watches all namespaces and merges rules per host) that
publishes `/apps/<slug>/*` on the shell's host and strips the prefix before
proxying to your ClusterIP Service. See
`FuzeQuality/deploy/helm/fuzequality/templates/ingress.yaml` for a working
example.

That buys three things a separate public hostname does not:

* **No second trip through the public edge.** The asset is served in-cluster
  rather than hairpinning out to the CDN and back.
* **No Cloudflare Access wall.** Hosts under `*.prod.fuzefront.com` sit behind
  the admin Zero-Trust app, which answers an asset request with an **HTML login
  page** — the federation runtime then fails with "Failed to fetch dynamically
  imported module", which reads like a build problem and is not one.
* **No CORS.** Same origin as the shell, so no cross-origin headers to maintain.

Only a remote genuinely hosted **outside** the cluster needs its own absolute
URL — and then it must serve permissive CORS so the shell can fetch it.

### 1b. Register it with the platform

```bash
curl -X POST https://app.fuzefront.com/api/apps/register \
  -H 'Authorization: Bearer <jwt>' \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "My App",
    "integrationType": "module-federation",
    "remoteUrl": "/apps/myapp/assets/remoteEntry.js",
    "scope": "myApp",
    "module": "./App"
  }'
```

`remoteUrl` accepts either a **same-origin absolute path** (preferred for
in-cluster apps, as above — the same value works on the prod host, a tenant
wildcard host, and localhost) or an absolute `http(s)` URL for a remote hosted
outside the cluster. Protocol-relative values (`//host/…`) and any non-http
scheme are rejected: a browser resolves them off-origin, which would run someone
else's module inside the shell's origin.

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

**Not building a Module-Federation remote?** `integrationType: 'web-component'`
mounts a framework-agnostic custom element instead, with no shared-React
constraint — see [`WEB_COMPONENT_INTEGRATION.md`](WEB_COMPONENT_INTEGRATION.md)
for the minimal manifest, the exact custom-element/bundle contract the shell
expects, a runnable example, and how it trades off against `iframe` and Module
Federation.

> **This `POST /api/apps/register` flow has no `slug` field** — it is a separate,
> older registration path (`backend/src/routes/apps.ts`) from the manifest-based
> app registry (`registration/manifest.json` + `@fuzefront/onboarding-kit`) that
> owns the `slug`/`name`/`menuLabel` naming convention. If your product needs menu
> placement, an authz policy, or a billing profile, register via the kit instead —
> see [`docs/mfe-self-registration.md`](../mfe-self-registration.md) — and read the
> naming rule in the root `CLAUDE.md` § "`slug`, display name, and the federated
> serve path are THREE INDEPENDENT questions" before choosing your `slug` or `name`.

**The host is on React 19 and Node 24 (Active LTS). These are minimums, not targets:**

- Your federation `shared` block must declare `requiredVersion: '^19.0.0'` for both
  `react` and `react-dom` — **identical to the host**. If it differs, your remote
  quietly loads its own React copy and fails at runtime with "Invalid hook call";
  nothing in your build or the host's CI will warn you first.
- Your app needs `react`/`react-dom` `^19.2.0` and `@types/react(-dom)` `^19.2.0`.
- Build on Node `>=24.0.0` / npm `>=10.0.0`. The published `@izzywdev/fuzefront-*` packages
  peer-depend on `react@^19.0.0`, so a React 18 consumer fails peer resolution outright.

---

## 1c. Register an iframe app

Not every integration needs Module Federation. `integration.type: "iframe"` embeds
your app's own page, unmodified, in a sandboxed `<iframe>` — no shared React
runtime, no federation build step, no `remoteEntry.js` at all. A full, runnable
example (a one-file app + the manifest that registers it) lives in
[`docs/examples/iframe-integration/`](../examples/iframe-integration/README.md).

### Smallest valid registration payload

```json
{
  "manifestVersion": "1",
  "slug": "iframe-example",
  "name": "Iframe Example",
  "menuLabel": "Iframe Example",
  "mode": "portal",
  "integration": {
    "type": "iframe",
    "url": "http://localhost:5180/"
  }
}
```

`integration.url` is the only field an iframe integration adds over the bare
minimum of `manifestVersion` / `slug` / `name` / `menuLabel` / `mode` — no
`remoteEntry`, `scope`, or `module` (those are module-federation-only). Like
`remoteUrl` for Module Federation (§1b), `url` accepts a same-origin absolute
path or an absolute `http(s)` URL; a `javascript:` or protocol-relative value is
rejected for the same reason — it would run inside the shell's own origin.

### When iframe is preferable to Module Federation

| Use iframe when… | Use Module Federation when… |
|---|---|
| Your app is not built with Vite/webpack, or isn't JS at all (a legacy server-rendered app, a third-party embed, a different framework entirely) | Your app is a React 19 SPA and can share the host's React/React-DOM singleton |
| You want **hard isolation** — your app's CSS/globals/event listeners must never collide with the shell's or another app's | You want a seamless, same-document experience (shared router, shared design-system components, no visible frame boundary) |
| Your app already runs standalone at its own URL and you don't want to add a federation build step just to appear in the shell | You're already maintaining a federation `shared` block and want tight integration (e.g. passing React context across the boundary) |
| You're prototyping or embedding something you don't control the source of | Performance matters and you want to avoid the extra HTTP round-trip + frame overhead |

### Isolation, auth, and routing caveats

- **Isolation is real, in both directions.** The shell renders the iframe with
  `sandbox="allow-scripts allow-same-origin allow-forms allow-popups"` (see
  `frontend/src/components/FederatedAppLoader.tsx` and
  `StandaloneAppSurface.tsx`). Your page runs in its own browsing context: it
  cannot read the shell's DOM, globals, or design-system CSS, and the shell
  cannot reach into yours. This is the main reason to pick iframe over MF —
  but it also means you get **none** of the shell's shared UI for free; your
  page renders exactly what you give it, full width/height inside the frame.
- **No shared auth context.** A Module-Federation remote runs in the *same*
  JS realm as the host, so the shell writes the current user, org, and a
  `getAccessToken()` resolver onto `window.__FRONTFUSE_CONTEXT__` before
  mounting it (§3 below). An iframe is a separate realm — that object is
  **never** injected into it. If your app needs to know who's signed in, you
  must establish that yourself: typically the host posts a short-lived token
  via `window.postMessage` after the frame loads, and your page listens for
  it (see the commented example in
  [`docs/examples/iframe-integration/app/index.html`](../examples/iframe-integration/app/index.html)).
  Never assume the iframe inherits the shell's session cookie — treat your
  app as a standalone origin that happens to be framed.
- **Routing is whatever your page already does.** The shell doesn't drive
  your app's internal navigation the way it can coordinate routes with an MF
  remote; the iframe's `src` is a fixed URL and everything after that is your
  app's own router. Deep-linking *into* a specific in-app route from the
  shell's URL is not wired up for iframe apps — if you need that, either add
  it via `postMessage` (host tells the frame which route to show) or
  reconsider whether Module Federation is the better fit.

---

## 2. Consume the shared packages

FuzeFront publishes reusable packages **privately to GitHub Packages** under the
**`@izzywdev`** scope. Consumers authenticate with a scoped `.npmrc` + a
`GITHUB_TOKEN`/PAT that has `read:packages`.

> **`@fuzefront` is not a scope you can install from.** It is the *workspace-internal*
> name FuzeFront's own monorepo uses, resolved by npm-workspace symlink. There is no
> `fuzefront` user or organisation on GitHub (`gh api users/fuzefront` and
> `gh api orgs/fuzefront` both 404), so `npm install @fuzefront/…` returns 404 and always
> has. Every workspace package is *published* as `@izzywdev/fuzefront-<name>`. The family
> rule is FuzeSDLC `governance/naming-and-addressing.md` § "The npm package scope".

```ini
# .npmrc (in the consuming repo; do NOT commit the token)
@izzywdev:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

Packages that are **published and installable today** (verified against the registry
on 2026-09-01 — `gh api "users/izzywdev/packages?package_type=npm&per_page=100"`):

| install this | workspace name | what it gives you |
|---|---|---|
| `@izzywdev/fuzefront-shared` | `@fuzefront/shared` | shared types, Kafka `TOPICS` constant + `FuzeEvent<T>` envelope, typed producer/consumer helpers |
| `@izzywdev/fuzefront-core` | `@fuzefront/core` | Express-side transactional-outbox middleware (`enqueueEvent` + relay) |
| `@izzywdev/fuzefront-security-client` | `@fuzefront/security-client` | generated TypeScript client for the platform security/identity API |
| `@izzywdev/fuzefront-design-system` | `@fuzefront/design-system` | the "fuse seam" design system — tokens + primitives |
| `@izzywdev/fuzefront-auth` | `@fuzefront/auth` | Authentik/Permit-backed authN/authZ verifier + Express middleware (Python services: `fuzefront-auth`, a GitHub Release wheel, see `packages/auth-py/README.md`) |
| `@izzywdev/fuzefront-service-auth` | `@fuzefront/service-auth` | service-to-service (client-credentials) auth |

The full list is 24 packages; enumerate it rather than guessing a name — the mapping is
**not** mechanically derivable (`@izzywdev/repo-digester-client` carries no `fuzefront-`
prefix).

**Not published — do not write installs for these.** `@fuzefront/sdk-react` and
`@fuzefront/api-client` have appeared in this guide and in the root README as if they
were installable; neither exists in the registry under any scope. Treat them as
roadmap, not as available packages.

If you want to keep the short `@fuzefront/…` specifier in your import statements, alias
it in your `package.json` — this is the pattern several consumer repos already use:

```jsonc
"dependencies": {
  "@fuzefront/shared": "npm:@izzywdev/fuzefront-shared@^1.0.0",
  "@fuzefront/auth":   "npm:@izzywdev/fuzefront-auth@^0.4.0"
}
```

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

### Entity identifiers — your service mints its own, and never accepts one

Family standard: **`governance/identifier-standard.md`** (baseline §4.2), enforced
by `gate-identifier`. This applies to your service too, not just the platform.

**The rule is two rules**, and either alone leaves a hole:

1. **Your service mints the ids for entities it owns.** A create body must never
   accept an `id`/`uuid` for the resource being created, and must set
   `additionalProperties: false`. Fields naming an entity that *already exists*
   (`organizationId`, `userId`) are references, not identity — those are fine.
2. **Every polymorphic reference carries its type**, and no lookup resolves a bare id.

Rule 1 alone still loses to an attacker who *learns* an id rather than choosing
one; rule 2 alone leaves id-squatting and cross-tenant grafting standing. And a
standing corollary you must not design around: **an id is never a capability** —
authorization comes from the token and Permit, never from "the caller knew the id".

Ids are `cus_01h455vb4pex5vsknk084sn02q` on the wire (type prefix + UUIDv7 in
base32) and a native 16-byte `uuid` column underneath. **Treat them as opaque past
the prefix** — never parse further, never assume a length. FuzeFront reserves the
right to change id length exactly as Stripe and GitHub have.

```ts
import { mintId, assertRef, toUuid, graphCreate } from '@izzywdev/fuzefront-identity'

const orderId = mintId('order')                 // ord_01h455…  — the ONLY constructor
assertRef('organization', body.organizationId)  // offline type check; throws on mismatch
await db.insert({ id: toUuid(orderId), … })     // native uuid column
```

```python
from fuzefront_identity import mint_id, assert_ref, to_uuid, GraphCreateMiddleware
```

Mount the middleware once and your routes implement none of this:

```ts
app.use(express.json())
app.use(graphCreate({ aggregate: new Set(['order', 'orderLine']) }))   // Express
```
```python
app.add_middleware(GraphCreateMiddleware, aggregate={"order", "order_line"})  # ASGI
```

It rejects a client-supplied `id` with **422**, resolves `lid:` graph references to
freshly-minted ids, and merges `idMap` into the JSON response.

**Creating linked entities in one request** — label each node with a document-scoped
`lid` and reference it as `"lid:<n>"`; the response carries `idMap` from each `lid`
to its real id. (`order`/`orderLine` below are illustrative — **your entity types
must be added to the prefix registry first**, and a prefix is permanent once
shipped, so choose it as deliberately as a table name.)

```jsonc
// request
{ "type": "order", "lid": "1", "lines": [ { "type": "orderLine", "lid": "2", "orderId": "lid:1" } ] }
// response
{ "status": "created", "idMap": { "1": "ord_01h455…", "2": "orl_01h456…" } }
```

**Two constraints to design around, not discover later:**

- **Mount the middleware AFTER your JSON body parser and AFTER any raw-body webhook
  route.** Provider webhook payloads (Stripe, and most others) carry an `id`, so a
  webhook reaching this middleware 422s your entire provider integration.
- **A `lid` graph is scoped to one service's aggregate.** You cannot create entities
  another service owns in the same request — a graph spanning services can't be
  created atomically. Reference them by their existing ids instead.

**TypeScript gets an enforcement Python doesn't.** `EntityId<T>` is a branded type,
so a raw string off `req.body` will not compile against a repository taking
`EntityId<'order'>`, and an `EntityId<'order'>` is not assignable to
`EntityId<'invoice'>`. Type your repository signatures with it. Python has no
equivalent and relies on the runtime boundary plus the gate, so Python services need
**more** review discipline here, not less.

> **Both packages are published.** `@izzywdev/fuzefront-identity` is live on GitHub
> Packages — add the `.npmrc` scoped registry block from §2 above and install
> normally. The Python wheel (`fuzefront-identity`) publishes on `identity-py-v*`
> tags and is available as a GitHub Release asset. To install from a Release:
> `pip install https://github.com/izzywdev/FuzeFront/releases/download/identity-py-v1.0.0/fuzefront_identity-1.0.0-py3-none-any.whl`.

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
- `POST /api/v1/security/signup` — server-brokered account creation. Body is
  `{ email, password, name?, turnstileToken? }` (contract 1.1.0: one `name`, no
  `firstName`/`lastName`; errors include `CAPTCHA_FAILED` 400 and
  `PASSWORD_POLICY` 422). `GET /api/v1/security/signup/email-available` backs the
  inline check, and `GET /methods` advertises `captcha`/`passwordPolicy`. The
  stricter behaviour is gated by `fuzefront.auth.experience` (default OFF); see
  [`AUTH_EXPERIENCE_SIGNUP.md`](./AUTH_EXPERIENCE_SIGNUP.md).
- `GET /api/v1/security/session` — the current stable `Identity` ("me");
  `DELETE /api/v1/security/session` — logout.

Resolve every caller to the stable `Identity`
(`{ userId, tenantId, roles, authMode, … }`) via the Security API — **do not**
parse the JWT or fetch a JWKS. `Identity` is invariant across the token-format
migration. See
[`docs/consumers/onboarding-authn-authz.md`](../consumers/onboarding-authn-authz.md)
for the step-by-step recipe.

### Checking that a session is still live (backend services)

A FuzeFront session token stays cryptographically valid until its `exp` (24h)
even after the user logs out or revokes the device; only FuzeFront's session
store knows. A backend that verifies session tokens itself
(`@izzywdev/fuzefront-auth` ≥ 0.4.0 / Python `fuzefront-auth` ≥ 0.2.0, in
`legacy-hs256` mode) therefore **refuses a token that names a session** unless
you supply a `sessionValidator` (`session_validator` in Python). Build it on
`POST /api/v1/security/sessions/validate`:

- **Caller:** a service, not a user. Send a workload token (see
  `@izzywdev/fuzefront-service-auth`) whose scope includes `sessions:validate`.
  A user session token is rejected (401), and a token without the scope is 403.
- **Body:** `{ "userId": "...", "sessionId": "...", "tenantId": "..." }`, taken
  from the token's `userId`, `sessionId` and `tid` claims after you have verified
  its signature. Nothing else is accepted. `tenantId` may be omitted only for a
  token with no `tid` (single-tenant deployments).
- **Answer:** `200 { "active": true }` only for a live session that belongs to
  that user. An unknown, revoked, expired or wrong-user session is the same
  `200 { "active": false }`, with no reason.
- **Tenants.** Every tenant's sessions share one signing secret and the package
  verifiers do not look at `tid`, so this call is where the tenant boundary is
  enforced for you. When multi-tenant identity is on, a session is active only
  for the tenant that minted it: call the security service on **the host that
  belongs to your own tenant** (the tenant is chosen from the request `Host`), and
  send the token's `tid` as `tenantId`. A token minted for another tenant, or
  one with no `tid`, comes back inactive.
- **An outage must throw, not return `false`.** A `503` (or any non-2xx, or a
  network error) means "could not check", not "revoked". Let the validator raise;
  the auth package turns that into a retryable 503 for your caller. Returning
  `false` on error would sign every user out whenever the session store blinks.
  Treat anything other than a strict `active === true` as inactive.

```ts
const sessionValidator = async (userId: string, sessionId: string, claims: Record<string, unknown>) => {
  const res = await fetch(`${SECURITY_SERVICE_URL}/api/v1/security/sessions/validate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${await auth.getToken()}` },
    body: JSON.stringify({ userId, sessionId, tenantId: claims.tid }), // undefined is omitted
  })
  if (!res.ok) throw new Error(`session validity check failed: ${res.status}`) // outage or misconfig: throw
  return (await res.json()).active === true
}
```

```python
def session_validator(user_id, session_id, claims):
    body = {"userId": user_id, "sessionId": session_id}
    if claims.get("tid"):  # omit it rather than send null, which is a 400
        body["tenantId"] = claims["tid"]
    r = httpx.post(
        f"{SECURITY_SERVICE_URL}/api/v1/security/sessions/validate",
        json=body,
        headers={"Authorization": f"Bearer {service_token()}"},
        timeout=3,
    )
    r.raise_for_status()  # non-2xx raises: the package answers 503, never "revoked"
    return r.json().get("active") is True
```

If you cannot call it, the only alternative is the explicit opt-out
(`allowUnvalidatedSessions: true` / `allow_unvalidated_sessions=True`), which
knowingly accepts that a logged-out session keeps working for up to 24h.

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

## 7. Internationalization & RTL (bi-directional layout)

FuzeFront ships with Hebrew and Arabic as first-class languages alongside
English — not a translation extra, so a remote mounted into the shell must
render correctly when the user switches to one of them.

**The shell owns direction; your remote does not set `dir` itself.** When the
active language's direction is RTL (Hebrew, Arabic), the shell applies
`dir="rtl"` on `<html>` via `@fuzefront/i18n`'s centralized direction manager.
Your remote inherits that `dir` from the document — it should never read the
current language and branch on it to flip its own layout.

What that means for your component code:

```css
/* Wrong — physical properties don't mirror under RTL */
.card {
  margin-left: 1rem;
  padding-right: 1.5rem;
  text-align: left;
}

/* Right — logical properties flip automatically with <html dir> */
.card {
  margin-inline-start: 1rem;
  padding-inline-end: 1.5rem;
  text-align: start;
}
```

If your remote renders strings of its own (rather than only composing
platform UI), consume the shared runtime instead of rolling your own i18next
setup:

```tsx
import { useT, useDir } from '@fuzefront/i18n'

function AppCard() {
  const { t } = useT()
  const dir = useDir(i18nInstance) // only needed for direction-aware logic
  // beyond what logical properties cover, e.g. choosing a directional icon
  return <span>{t('card.title')}</span>
}
```

A component only needs `useDir` when it has to branch on direction itself —
e.g. swapping a chevron icon's orientation. Plain layout/spacing should never
need it; logical properties handle that for free.

Verify the behavior, don't just assume it: switch the shell's language
selector to עברית (Hebrew) and confirm your remote's layout mirrors — no
clipped text, no icons pointing the wrong way, no fixed-width elements that
only worked left-to-right.

See `packages/i18n/README.md` for the full API (`I18nProvider`,
`LanguageSelector`, `attachDirectionManager`, the language registry) and
`docs/CONTRIBUTOR_START_HERE.md` for RTL-focused first contributions.

> **Known gap, not yet fixed here:** `design-system/readme.md` (the base
> design system's own developer-facing doc) does not mention RTL or logical
> properties at all, even though the primitives it ships are expected to
> follow this convention. That is a real gap worth its own follow-up issue —
> it is out of scope for this guide, which covers consuming apps, not the
> base design system itself.

---

## See also

- Operational deployment runbook: `docs/deployment/CONTABO_DEPLOYMENT.md`
- Module Federation deep-dive: `docs/guides/MODULE_FEDERATION_GUIDE.md`
- Web Component integration (minimal example, custom-element contract,
  trade-offs vs. iframe/MF): `docs/guides/WEB_COMPONENT_INTEGRATION.md`
- Minimal runnable iframe integration example: `docs/examples/iframe-integration/README.md`
- Developer guide: `docs/guides/DEVELOPER_GUIDE.md`
- Consuming durable, typed settings from config-service (not the feature-flag
  system): `docs/guides/CONFIG_SERVICE_INTEGRATION_GUIDE.md`
- Shared i18n runtime + RTL/LTR direction management: `packages/i18n/README.md`
