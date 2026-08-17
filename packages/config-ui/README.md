# `@fuzefront/config-ui`

Configuration Management Console UI for FuzeFront's `config-service` —
settings editor, admin key catalog, and secret + audit surfaces — on the
fuse-seam design system. Built against `design/frames/config-management/**`
(FF-EPIC-19-S3/S4) and the frozen `services/config-service/openapi.yaml` v1.0.0
via `@fuzefront/config-client`.

## What's real vs. anticipated

This package's data-fetching is fully controlled by the host (identical to
`@fuzefront/identity-ui`'s flow components): every flow here renders whatever
state its props describe, and never calls `fetch` itself. That split matters
because **not everything the frames render has a shipped endpoint yet**:

| Surface | Contract status |
| --- | --- |
| Namespaces, key definitions, effective config read/write | **Real** — `GET/PUT /v1/config`, `GET /v1/namespaces*` (frozen spec) |
| Secret masking (`isSet`, never `value`) | **Real** — part of `EffectiveConfigEntry` today |
| Secret **reveal** (`ConfigSecretAuditFlow`'s reveal dialog, `SecretField`'s `onReveal`) | **Anticipated** (FF-EPIC-18-S1) — `POST /v1/config/secrets/reveal` does not exist in the frozen contract. `SecretField` renders no Reveal button at all unless the host passes both `canReveal` AND `onReveal`; omit both until the endpoint ships. |
| Change history (`ConfigSecretAuditFlow`) | **Anticipated** (FF-EPIC-18-S2) — `GET /v1/config/history` does not exist yet. The host must supply `entries` from wherever it sources them (a stub, a future client method) — this package has no opinion on where they come from. |
| Revert (`onRevert`) | **Anticipated** (FF-EPIC-18-S3) — modeled as a replayed `set`/`unset` through the existing `PUT /v1/config`, never a new endpoint or a history rewrite. |
| 4-tier scope chain resolution (`platform → portal → org → user`) | **Partial** — `buildScopeChain` (FF-EPIC-10, backend) resolves only `platform` + the exact scope queried today. `KeyDefinitionDetail`'s `chain` prop and `ConfigSettingsEditorFlow`'s `chain`/`nameOf` are built for the CONTRACT's shape (four tiers); wiring a real 4-tier resolution is the host's job once that middleware exists. Until then a host may pass a partial chain (e.g. `platform` + the active scope only). |

None of this was verified end-to-end: `configService.enabled: false` in this
environment, so nothing here has been exercised against a live backend. See
the PR description for what WAS verified (type-check, build, component tests
with a mocked `ConfigClient` boundary).

## Consuming

```tsx
import { ConfigClient } from '@fuzefront/config-client'
import { ConfigSettingsEditorFlow, ConfigI18nProvider } from '@fuzefront/config-ui'

const client = new ConfigClient({ baseUrl: '/api/config', token: getActiveAuthToken })

<ConfigI18nProvider locale={locale}>
  <ConfigSettingsEditorFlow
    chain={chain}
    activeScope={activeScope}
    namespace={namespace}
    entries={entries}
    version={version}
    nameOf={scope => resolveDisplayName(scope)}
    onSubmit={input => client.writeConfigValues({ namespace, scope: activeScope, ...input })}
    onReRead={async () => {
      const fresh = await client.getEffectiveConfig(namespace, activeScope)
      if (isNotModified(fresh)) throw new Error('unexpected 304 during conflict re-read')
      return { entries: fresh.entries, version: fresh.version }
    }}
    onSecretWrite={(key, op, value) =>
      client.writeConfigValues({ namespace, scope: activeScope, operations: [{ key, op, value }] }).then(() => {})
    }
    nameOf={...}
  />
</ConfigI18nProvider>
```

## Feature flags

Gated behind `fuzefront.config.management-console` (`/config`),
`fuzefront.config.key-catalog` (`/admin/config/catalog`), and
`fuzefront.config.secrets-audit` (`/admin/config/keys/:key/history`) — all
default OFF, per `design/frames/config-management/manifest.json`'s
`build.flows[].featureFlag`. This package does not read flags itself
(`@fuzefront/feature-flags` is a host-shell concern); the host gates which
route/component renders.

## Hidden keys

`ConfigSettingsEditorFlow` performs **no client-side filtering** of `entries`
— it renders exactly what the host passes. Hidden-key omission is a server
guarantee (`GET /v1/config` never sends `isHidden` keys to non-platform-admin
callers); a client-side `filter(e => !e.isHidden)` here would satisfy a visual
review while still shipping the data to the browser, which is the exact
failure mode `design/frames/config-management/03-editor-states.html`
(hidden-absent) exists to catch.
