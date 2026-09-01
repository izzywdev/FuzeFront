# `@fuzefront/config-client`

Typed client for the FuzeFront **config-service** — namespaced, hierarchical
key/value configuration with typed key metadata.

Derived by hand from [`services/config-service/openapi.yaml`](../services/config-service/openapi.yaml)
v1.0.0. **That spec is the frozen contract; this package is a projection of it.**
If the two disagree, the spec wins and this package is the bug.

> Delivered by **FFRNT-153** (FF-EPIC-17-S1). The Python client is FFRNT-259 and
> is generated from the same spec; the served Swagger UI is FFRNT-258. All three
> are projections of one contract — none of them is a second source of truth.

## Install

```bash
npm install @izzywdev/fuzefront-config-client
```

> **Published name.** `@fuzefront/config-client` is the *workspace-internal* name and is **not installable** —
> the `@fuzefront` scope does not exist on GitHub. The published package is **`@izzywdev/fuzefront-config-client`**
> (latest `1.0.0`). To keep the short specifier used in the examples below, alias it in your
> `package.json`: `"@fuzefront/config-client": "npm:@izzywdev/fuzefront-config-client@^1.0.0"`.


Private to the **`@izzywdev`** scope on GitHub Packages; you need a scoped
`.npmrc` and a token.

## Use

```ts
import { ConfigClient, isNotModified, isConfigApiError } from '@fuzefront/config-client'

const config = new ConfigClient({
  // MUST be same-origin in the browser. An absolute host breaks under TLS with
  // a mixed-content block the moment the environment changes.
  baseUrl: '/api/config',
  token: () => session.accessToken,
})

const resolved = await config.getEffectiveConfig('fuzefront.chat', {
  scopeType: 'org',
  scopeId: orgId,
})
```

### Read the provenance, not just the value

Every entry says where its value came from and whether this caller may change
it. A form built from `value` alone looks correct and misrepresents its own
contents — it cannot distinguish a value set here from one inherited, and it
will offer an editable input for a setting the server will refuse to write.

```ts
if (!isNotModified(resolved)) {
  for (const entry of resolved.entries) {
    if (entry.locked) {
      // An ancestor pinned this. `lockedBy` names which one, so the UI can say
      // "Locked by your portal" instead of greying the field with no reason.
      render(entry, { disabled: true, badge: `Locked by ${entry.lockedBy?.scopeType}` })
    } else if (entry.source.scopeType !== 'org') {
      render(entry, { badge: `Inherited from ${entry.source.scopeType}` })
    } else {
      render(entry, { badge: 'Set here' })
    }
  }
}
```

### Writes are atomic

A batch either applies completely or not at all, so a settings page never
half-saves.

```ts
await config.writeConfigValues({
  namespace: 'fuzefront.chat',
  scope: { scopeType: 'org', scopeId: orgId },
  operations: [
    { key: 'ui.theme.density', op: 'set', value: 'compact' },
    // `unset` falls back to the parent and keeps tracking it. Writing the
    // parent's current value instead would pin a copy that stops following it.
    { key: 'ui.sidebar.collapsed', op: 'unset' },
  ],
  expectedVersion: resolved.version, // optimistic concurrency
})
```

### Two refusals worth distinguishing

```ts
try {
  await config.writeConfigValues(request)
} catch (error) {
  if (!isConfigApiError(error)) throw error

  if (error.isLockedByAncestor) {
    // Policy: an ancestor scope locked this key. `error.lockedBy` names it.
    // Retrying will not help.
  } else if (error.isVersionConflict) {
    // Collision: somebody else saved first. Re-read at `error.currentVersion`
    // and merge — do NOT blind-retry, which would overwrite their change.
  }
}
```

`error.code` is the thing to branch on. `error.message` is human-facing and may
change without a contract version bump. A response that is not a contract
response at all — an ingress 502, a proxy timeout, an HTML error page — reports
`UNKNOWN` rather than being mapped onto a real contract code, because guessing
would send the caller down the wrong recovery path.

### Cheap polling

`getEffectiveConfig` takes an `If-None-Match` version and answers
{@link NotModified} when nothing changed. The version tracks the **resolved
view**, so a change made at an ancestor scope invalidates it too — a version
that tracked only this scope's own rows would let inherited changes go
undetected.

## This is not the feature-flag system

Unleash owns feature flags. **Configuration** is durable, typed, user- and
tenant-authored settings. **Flags** are rollout, targeting, kill-switches and
experiments, authored by engineering. Reaching for a config key where a flag
belongs is how a codebase ends up with two flag systems and no clear owner —
see the `feature-flags` skill.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run build` | Dual ESM + CJS build with declarations (tsup) |
| `npm run type-check` | `tsc --noEmit` |
| `npm run lint:contract` | Spectral-lints the frozen spec against the service's stricter ruleset |

CI lints every `services/*/openapi.yaml` with Spectral's default ruleset and
boots a Prism mock of it, so this contract is covered without any workflow
change. `lint:contract` runs the **stricter** per-service ruleset — the one that
makes operation metadata and property descriptions errors rather than hints.
