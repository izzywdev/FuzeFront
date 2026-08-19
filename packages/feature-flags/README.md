# @fuzefront/feature-flags

OpenFeature-based feature-flags client for FuzeFront, wrapping the **Unleash**
provider behind a thin, framework-agnostic Fuze API with **graceful degradation
to caller-supplied defaults** when Unleash is unreachable.

- Public evaluation surface is **OpenFeature** (server + web SDKs).
- The Unleash provider is wrapped behind OpenFeature; flag reads NEVER throw —
  on a down/not-ready provider, a missing flag, or a type mismatch they return
  the default you pass.

## Entry points

| Import | Surface | OpenFeature SDK | Unleash provider |
| --- | --- | --- | --- |
| `@fuzefront/feature-flags` | server (Node services) — default | `@openfeature/server-sdk` | `unleash-openfeature-provider-server` (wraps `unleash-client`) |
| `@fuzefront/feature-flags/web` | browser / micro-frontends | `@openfeature/web-sdk` | `@openfeature/unleash-web-provider` (wraps `unleash-proxy-client`) |

Provider modules are **dynamically imported** at `init()` time, so a missing or
unreachable provider can never crash module load — it degrades to defaults.

> The two Unleash provider packages are declared as **`optionalDependencies`**:
> if a version fails to resolve they are skipped (npm install does not fail) and
> the package still builds and degrades to defaults. A consuming service that
> wants live flags should ensure the matching provider is installed (it normally
> is, transitively). The OpenFeature SDKs are hard `dependencies`.

## Usage (server)

```ts
import { init, getBoolean, setContext, close } from '@fuzefront/feature-flags';

await init(
  {
    url: process.env.UNLEASH_URL!,            // e.g. http://fuzefront-unleash.fuzefront.svc.cluster.local:4242/api
    clientToken: process.env.UNLEASH_CLIENT_TOKEN!,
    appName: 'task-manager',
    refreshIntervalSec: 15,
    readyTimeoutMs: 5000,                     // init() resolves within this even if Unleash is down
  },
  { environment: 'production', orgId: 'org-1', userId: 'user-42', app: 'task-manager' },
);

const enabled = await getBoolean('new-checkout', /* default */ false);
const variant = await getString('greeting', 'hello');
const limit = await getNumber('max-items', 25);

// Update context (e.g. on tenant switch); re-evaluates against the new context.
await setContext({ environment: 'production', orgId: 'org-2', userId: 'user-99' });

await close(); // on shutdown
```

## Usage (web)

```ts
import { init, getBoolean } from '@fuzefront/feature-flags/web';

await init({
  url: 'https://app.fuzefront.dev/api/frontend', // Unleash front-end/proxy endpoint
  clientToken: '<frontend-token>',
  appName: 'shell',
});

if (await getBoolean('new-nav', false)) { /* ... */ }
```

## Connection contract

- **url**: the Unleash server API base ending in `/api` for the server entry
  (e.g. `http://fuzefront-unleash.fuzefront.svc.cluster.local:4242/api`); the
  Unleash front-end/proxy endpoint for the web entry.
- **clientToken**: sourced from the `UNLEASH_CLIENT_TOKEN` env var (a client API
  token for the server, a front-end token for the browser). Inject via
  env/SealedSecret — never hard-code.

The Unleash service itself (Helm chart / deployment) is owned by the deploy
slice; this package only consumes it.

## Evaluation-context conventions

The Fuze `FuzeFlagsContext` maps onto OpenFeature's `EvaluationContext` with
FIXED key names so Unleash strategy constraints target them deterministically:

| Fuze field | OpenFeature mapping | Notes |
| --- | --- | --- |
| `userId` | `targetingKey` | Drives stickiness / gradual rollout. |
| `environment` | custom field `environment` | e.g. `production` / `development`. |
| `orgId` | custom field `orgId` | Tenant/org id; constrain on `orgId`. |
| `tenantId` | custom field `tenantId` | Explicit tenant alias. |
| `app` | custom field `app` | Consuming app name. |
| any extra key | custom field (same key) | Primitives passed through; objects stringified. |

When writing Unleash strategy constraints, target the context fields above by
these exact names (e.g. constraint on context field `orgId` IN `[org-vip]`).

## Graceful degradation

- `init()` is bounded by `readyTimeoutMs` (default 5000 ms). It resolves within
  that window even if Unleash is unreachable or the provider never becomes
  ready — it does not hang and does not throw.
- Every `getBoolean` / `getString` / `getNumber` wraps evaluation in try/catch
  and returns the supplied default on any error, missing flag, type mismatch,
  or `PROVIDER_NOT_READY`.

## Build & test

```bash
npm run build       # tsup -> dist/{index,web}.{js,cjs,d.ts}
npm test            # jest (ts-jest) — runs fully offline, no real Unleash
npm run type-check  # tsc --noEmit
```

Tests use OpenFeature's `InMemoryProvider` for the happy path and a mocked /
hanging / erroring provider for the degradation path, so the suite is
network-free and deterministic.

License: UNLICENSED (private, GitHub Packages `@fuzefront` scope).
