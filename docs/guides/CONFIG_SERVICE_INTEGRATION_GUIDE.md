# Building on config-service

How a FuzeFront service or micro-frontend consumes the **config-service** —
namespaced, hierarchical key/value configuration with typed key metadata and
provenance-carrying resolution. Delivered by **FF-EPIC-17**; this guide is
its last story, **FFRNT-260 (FF-EPIC-17-S11)**.

config-service owns exactly two things: a **catalog of key definitions**
(metadata, shipped by the owning app) and a **sparse set of values**
(overrides per scope). It is **not** the feature-flag system — see
[§9](#9-this-is-not-the-feature-flag-system).

The frozen contract is
[`services/config-service/openapi.yaml`](../../services/config-service/openapi.yaml).
Everything below is a paraphrase of it plus the two client packages that
project it; if this guide and the contract ever disagree, **the contract
wins** and this guide is the bug.

---

## 0. Status today — read this first

Before anything else: **config-service is not deployed anywhere**, and
**neither client package is installable via its published name yet**. This
section says exactly what exists and what doesn't, so nothing below reads as
a promise of a live endpoint.

**What's real, verified against `master`:**

- The frozen contract (`services/config-service/openapi.yaml`) and every
  route/handler that implements it (`services/config-service/src/`).
- Both client packages' source (`config-client/src/`,
  `packages/config-client-py/src/`), fully implemented against that contract.
- The Helm chart (`deploy/helm/fuzefront/templates/config-service-*.yaml`).
- The Swagger UI code, mounted at `/docs` on the service itself
  ([§10](#10-swagger--the-try-it-console)).

**What's not:**

- **The service isn't running anywhere.** `configService.enabled: false` in
  both `deploy/helm/fuzefront/values.yaml` (local/kind) and
  `deploy/helm/fuzefront/values-prod.yaml` (Contabo k3s), and
  `values-prod.yaml` pins `image.tag: ""`. Enabling it is a Helm/Argo change —
  out of this guide's scope (`devops-engineer` / a deploy window), not
  something a consumer can do from application code.
- **No ingress route exists for it either.** The contract's
  `servers: /api/config` entry is the intended same-origin path, but nothing
  in `deploy/helm/fuzefront/templates/` proxies `/api/config` to the service
  yet — that's a second, independent piece of wiring from `enabled: true`.
- **`@fuzefront/config-client` (Node) IS published — under its real name.**
  Verified 2026-09-01: `@izzywdev/fuzefront-config-client@1.0.0` resolves from
  GitHub Packages. `@fuzefront/config-client` is the workspace-internal name and
  is not installable (the `@fuzefront` scope does not exist on GitHub), which is
  what made this look unpublished. Historical note: GitHub Packages
  publishing (`packages-publish.yml`) builds its list from the root
  `package.json`'s `workspaces` array, and `config-client` is not currently
  in it — which is why `npm install @fuzefront/config-client` does not resolve.
  Install the published name instead; see [§2](#2-install).
- **`fuzefront-config-client` (Python) has no release tag pushed.** The wheel
  builds and installs locally (`pip install -e packages/config-client-py`,
  which is how every code sample in this guide was actually verified — see
  the footer), but no `config-client-py-v*` tag has ever been pushed, so
  `pip install` from a GitHub Release is **unproven**, not merely "not yet
  done." Don't assume the URL in [§2](#2-install) resolves until someone has
  confirmed it does.

None of this blocks *writing* code against the clients now — both are stable,
contract-derived, and this guide's examples are checked against their real
exported symbols (see the verification note at the bottom). It blocks running
that code against a live instance until the deploy and publish gaps above are
closed.

---

## 1. The model

A value resolves down the chain **`default → platform → portal → org →
user`**, where `default` comes from the key definition itself (always
present — every key resolves to *something*) and each tier above it is
optional and sparse. Two rules govern how a tier's value beats another:

- **`precedence`** (declared per key): `most-specific-wins` (default — the
  user's value beats the org's) or `least-specific-wins` (the org's value
  beats the user's). Both directions produce the identical response shape;
  no consumer branches on which one is in effect.
- **`locked`** (independent of precedence): a value written with
  `locked: true` beats every tier beneath it *regardless* of `precedence`,
  and resolves with `editable: false`. A write beneath an active lock is
  refused server-side with `409 LOCKED_BY_ANCESTOR`
  ([§7](#7-two-refusals-worth-distinguishing)). Locking hard-pins one value;
  precedence is the ordering rule for the whole chain — they are deliberately
  two different mechanisms.

**A read returns provenance, not a bare value.** Every resolved entry carries
`source` (which scope actually supplied it), `locked`, `lockedBy`, and
`editable` alongside `value`. This is the single most important thing to get
right as a consumer — see [§4](#4-read-effective-config--and-its-provenance).

> **Known gap in today's resolution, honestly stated.** The contract
> describes a full 4-tier chain, and both clients + the resolver engine
> (`services/config-service/src/resolver/resolve.ts`) implement it correctly
> *given* a chain. But **`GET /v1/config`'s route handler does not yet
> assemble the full ancestor chain** — per its own doc comment
> (`services/config-service/src/routes/config-read.routes.ts`,
> `buildScopeChain`), it resolves only `platform` plus the exact scope you
> query, because config-service doesn't own the portal/org/user membership
> hierarchy (that lives in `backend`) and the context-resolution middleware
> that would supply it, **FF-EPIC-10, has not shipped** (all three of its
> stories are `Open`). Concretely: reading at `scopeType: 'user'` today
> resolves `platform → user` — it does **not** walk through that user's
> `org` or `portal` in between, so an org-level lock will not be honoured
> against a user-scope read yet. The write path (`buildWriteChain` in
> `services/config-service/src/services/scope-chain.ts`) does slightly
> better — it fills in `portal`/`org` from the *caller's own JWT claims* when
> present — but documents the same limitation for a caller whose token
> doesn't carry the relevant claim. Don't build a mental model of "any
> ancestor can lock any descendant today"; build one of "platform can lock
> anything, and a tier can lock its own literal children when you query that
> tier directly." This is a real, currently-shipped gap, not a hypothetical
> edge case — track it against FF-EPIC-10 rather than assuming it will
> silently resolve itself.

---

## 2. Install

```bash
# Node — private to the @izzywdev scope on GitHub Packages. Same scoped-.npmrc
# convention as every other published package — see
# docs/guides/BUILDING_ON_FUZEFRONT.md § 2. (@fuzefront/config-client is the
# workspace-internal name and is NOT installable.)
npm install @izzywdev/fuzefront-config-client
```

```bash
# Python — distributed as a GitHub Release asset, same mechanism as
# packages/identity-py (GitHub Packages has no PyPI-style registry). See § 0:
# no release tag has been pushed yet, so this URL is unverified.
pip install https://github.com/izzywdev/FuzeFront/releases/download/config-client-py-v1.0.0/fuzefront_config_client-1.0.0-py3-none-any.whl
```

**Base URL, once the service is enabled and routable:**

| Caller | `base_url` / `baseUrl` |
|---|---|
| Browser / shell (Node client) | `/api/config` — same-origin, per the contract's `servers` entry. **Never** an absolute host: the shell is served over TLS behind an ingress, and a hard-coded host triggers a mixed-content block the moment the environment changes. |
| In-cluster server-side (Python client, or Node used server-side) | `http://fuzefront-config-service:3011` — the chart's Service DNS name and port (`deploy/helm/fuzefront/values.yaml`: `configService.port: 3011`, part of the family's port map — 3001 backend … 3011 config-service, chosen to avoid collision). The Python client's own `PORT` comes from this same value at deploy time (the in-image default of `3009` baked into `services/config-service/Dockerfile`/`src/config.ts` is always overridden by the chart's explicit `PORT` env). |

---

## 3. Register a namespace + key definitions

An app registers its own namespace and declares the keys it owns. Both calls
are idempotent — safe to run unconditionally at startup.

> Sections 3–8 read as one continuous walkthrough: the `config`/`client`
> instance and the `org_scope`/`resolved` variables introduced here and in
> [§4](#4-read-effective-config--and-its-provenance) are reused (not
> redeclared) in the sections after, and imports accumulate across sections
> rather than repeating in every block — every symbol used is exported from
> the top-level package (`@fuzefront/config-client` /
> `fuzefront_config_client`), never a submodule path.

```ts
import { ConfigClient } from '@fuzefront/config-client'

const config = new ConfigClient({
  baseUrl: '/api/config', // same-origin — see § 0/§ 2
  token: () => session.accessToken,
})

await config.createNamespace({
  namespace: 'fuzefront.chat',
  displayName: 'Chat',
  description: 'Settings for the chat micro-frontend.',
  ownerAppId: appId,
})

await config.registerKeyDefinitions('fuzefront.chat', {
  complete: true, // the WHOLE catalog — an omitted key gets deprecated, not deleted
  keys: [
    {
      key: 'ui.theme.density',
      displayName: 'Message density',
      valueType: 'enum',
      enumValues: ['comfortable', 'compact'],
      defaultValue: 'comfortable',
      allowedScopes: ['platform', 'portal', 'org', 'user'],
      precedence: 'most-specific-wins',
    },
  ],
})
```

```python
from fuzefront_config_client import (
    ConfigClient, KeyDefinitionInput, KeyDefinitionManifest,
    Precedence, ScopeType, ValueType,
)

client = ConfigClient(
    base_url="http://fuzefront-config-service:3011",  # in-cluster — see § 2
    token=lambda: session.access_token,
)

client.create_namespace(
    "fuzefront.chat",
    "Chat",
    description="Settings for the chat micro-frontend.",
    owner_app_id=app_id,
)

client.register_key_definitions(
    "fuzefront.chat",
    KeyDefinitionManifest(
        complete=True,  # the WHOLE catalog — an omitted key gets deprecated, not deleted
        keys=[
            KeyDefinitionInput(
                key="ui.theme.density",
                display_name="Message density",
                value_type=ValueType.ENUM,
                enum_values=["comfortable", "compact"],
                default_value="comfortable",
                allowed_scopes=[
                    ScopeType.PLATFORM, ScopeType.PORTAL, ScopeType.ORG, ScopeType.USER,
                ],
                precedence=Precedence.MOST_SPECIFIC_WINS,
            ),
        ],
    ),
)
```

`registerKeyDefinitions`/`register_key_definitions` returns
`{created, updated, deprecated, unchanged}` — which keys were new, which had
metadata changes (stored **values** are always preserved across a metadata
update), which were dropped from a `complete` manifest (deprecated, never
deleted — deleting would destroy every tenant's stored value for that key),
and which matched exactly (a no-op).

### Key-definition flags, what each one means

| Flag | Meaning |
|---|---|
| `isSystem` (`is_system`) | Platform-owned. Metadata is immutable to everyone else, and only the platform may write a value for it. |
| `isHidden` (`is_hidden`) | Never rendered in the editor and **omitted from ordinary reads entirely** — server-side, not a client-side filter. Visible only to a platform administrator passing `includeHidden=true`. |
| `isSecret` (`is_secret`) | Encrypted at rest, masked on read, excluded from export. `value` is always `null`; `isSet`/`is_set` reports only whether *something* is stored. |
| `isReadonly` (`is_readonly`) | Displayed but not editable at any tier — `editable` is `false` even with no lock in play. |
| `precedence` | Which end of the chain wins: `most-specific-wins` (default) or `least-specific-wins`. See [§1](#1-the-model). |
| `requiresRestart` (`requires_restart`) | Changing it does not take effect in running consumers until they restart; the editor warns accordingly. Purely informational to a consumer — the service does not enforce it. |

---

## 4. Read effective config — and its provenance

```ts
import { ConfigClient, isNotModified } from '@fuzefront/config-client'

const resolved = await config.getEffectiveConfig('fuzefront.chat', {
  scopeType: 'org',
  scopeId: orgId,
})

if (!isNotModified(resolved)) {
  for (const entry of resolved.entries) {
    if (entry.locked) {
      // An ancestor pinned this. `lockedBy` names which one — never render a
      // generic "can't edit" with no reason.
      render(entry, { disabled: true, badge: `Locked by ${entry.lockedBy?.scopeType}` })
    } else if (entry.source.scopeType !== 'org') {
      render(entry, { badge: `Inherited from ${entry.source.scopeType}` })
    } else {
      render(entry, { badge: 'Set here' })
    }
  }
}
```

```python
org_scope = Scope(scope_type=ScopeType.ORG, scope_id=org_id)
resolved = client.get_effective_config("fuzefront.chat", org_scope)

if not is_not_modified(resolved):
    for entry in resolved.entries:
        if entry.locked:
            render(entry, disabled=True, badge=f"Locked by {entry.locked_by.scope_type.value}")
        elif entry.source.scope_type != ScopeType.ORG:
            render(entry, badge=f"Inherited from {entry.source.scope_type.value}")
        else:
            render(entry, badge="Set here")
```

**Read the provenance, not just the value.** A form built from `value` alone
looks correct and misrepresents its own contents: it cannot tell a value set
at *this* scope from one inherited from an ancestor, and it will offer an
editable input for a setting the server will refuse to write. Every entry
carries `source`, `locked`, `lockedBy`, `lockReason`, and `editable`
specifically so a UI doesn't have to guess.

### Worked example

Reading `ui.theme.density` at `scopeType: 'org'` (chain = `platform → org`,
per the [known gap](#1-the-model) above — this table is accurate to what the
service actually resolves today, not the full 4-tier chain the contract
eventually describes):

| Scenario | `value` | `source` | `locked` | `lockedBy` | `editable` |
|---|---|---|---|---|---|
| Nothing set anywhere | `"comfortable"` (the definition's `defaultValue`) | `{scopeType: 'platform', scopeId: null}` | `false` | `null` | `true` |
| An org-level value is set | `"compact"` | `{scopeType: 'org', scopeId: 'org_1'}` | `false` | `null` | `true` |
| The platform locked the key (`lockReason: 'compliance'`) | the platform's locked value | `{scopeType: 'platform', scopeId: null}` | `true` | `{scopeType: 'platform', scopeId: null}` | `false` |

This mirrors `services/config-service/tests/resolver/resolve.test.ts`
exactly — including the detail that "nothing set anywhere" reports `source`
as `platform`, not a synthetic `default`: the wire `ScopeType` enum has no
`default` member, so the least-specific real tier stands in for it.

---

## 5. `unset` vs pinning the parent's current value — two different operations

These look identical the moment you make them and diverge the moment the
parent changes. Collapsing them into one "reset" control is the single
likeliest consumer bug here, per
`services/config-service/src/routes/config.write.ts`'s own doc comment.

```ts
// unset: removes THIS scope's override. Resolution keeps tracking whatever
// the parent resolves to next, forever — including future changes to it.
await config.writeConfigValues({
  namespace: 'fuzefront.chat',
  scope: { scopeType: 'org', scopeId: orgId },
  operations: [{ key: 'ui.theme.density', op: 'unset' }],
  expectedVersion: resolved.version,
})

// pin: writes the parent's CURRENT value as a copy at this scope. It stops
// tracking the parent from this moment on — a later parent change does
// nothing here.
await config.writeConfigValues({
  namespace: 'fuzefront.chat',
  scope: { scopeType: 'org', scopeId: orgId },
  operations: [{ key: 'ui.theme.density', op: 'set', value: 'comfortable' }],
  expectedVersion: resolved.version,
})
```

```python
# unset: keeps tracking the parent, forever.
client.write_config_values(ConfigWriteRequest(
    namespace="fuzefront.chat",
    scope=org_scope,
    operations=[ConfigOperation(key="ui.theme.density", op=ConfigOperationType.UNSET)],
    expected_version=resolved.version,
))

# pin: copies the parent's current value and stops following it.
client.write_config_values(ConfigWriteRequest(
    namespace="fuzefront.chat",
    scope=org_scope,
    operations=[ConfigOperation(
        key="ui.theme.density", op=ConfigOperationType.SET, value="comfortable",
    )],
    expected_version=resolved.version,
))
```

If your UI offers a single "Reset to default" button, know which of these two
it performs — and say so in the label, because nothing in the response shape
tells the two apart after the fact.

---

## 6. Writing values atomically

`writeConfigValues`/`write_config_values` applies a **batch** of `set` /
`unset` / `lock` / `unlock` operations to one scope as a single transaction:
every operation succeeds, or none do, and the response names every failing
operation. A settings page saving twenty keys must never half-save.

```ts
await config.writeConfigValues({
  namespace: 'fuzefront.chat',
  scope: { scopeType: 'org', scopeId: orgId },
  operations: [
    { key: 'ui.theme.density', op: 'set', value: 'compact' },
    { key: 'ui.sidebar.collapsed', op: 'unset' },
  ],
  expectedVersion: resolved.version, // optimistic concurrency — see § 7
  reason: 'Org admin changed density preference', // recorded in the audit trail
})
```

```python
client.write_config_values(ConfigWriteRequest(
    namespace="fuzefront.chat",
    scope=org_scope,
    operations=[
        ConfigOperation(key="ui.theme.density", op=ConfigOperationType.SET, value="compact"),
        ConfigOperation(key="ui.sidebar.collapsed", op=ConfigOperationType.UNSET),
    ],
    expected_version=resolved.version,
    reason="Org admin changed density preference",
))
```

---

## 7. Two refusals worth distinguishing

A write is refused with `409` for one of two, semantically different,
reasons — and a bulk write is also refused with `422 SCOPE_NOT_ALLOWED` if a
key is addressed at a scope its `allowedScopes` excludes.

```ts
import { isConfigApiError } from '@fuzefront/config-client'

try {
  await config.writeConfigValues(request)
} catch (error) {
  if (!isConfigApiError(error)) throw error

  if (error.isLockedByAncestor) {
    // POLICY: an ancestor scope locked this key. `error.lockedBy` names it.
    // Retrying will not help — the write needs the lock removed, or a
    // different scope, not a retry loop.
  } else if (error.isVersionConflict) {
    // COLLISION: somebody else saved first. Re-read at `error.currentVersion`
    // and merge. Do NOT blind-retry the original write — that overwrites
    // whatever the concurrent editor just saved.
  }
}
```

```python
from fuzefront_config_client import ConfigApiError

try:
    client.write_config_values(request)
except ConfigApiError as error:
    if error.is_locked_by_ancestor:
        # POLICY refusal. error.locked_by names the ancestor. Retrying will
        # not help.
        ...
    elif error.is_version_conflict:
        # COLLISION. Re-read at error.current_version and merge. NEVER
        # blind-retry -- it silently overwrites a concurrent editor's change.
        ...
```

`error.code`/`.code` is what to branch on — `error.message` is human-facing
and may change without a contract version bump. And a response that isn't a
contract response at all (an ingress `502`, a proxy timeout, an HTML error
page) surfaces as `"UNKNOWN"` from both clients rather than being guessed
onto a real contract code — mapping it onto, say, `VERSION_CONFLICT` would
send the caller down the wrong recovery path, so both `config-client/src/errors.ts`
and `packages/config-client-py/src/fuzefront_config_client/errors.py` refuse
to guess.

---

## 8. Caching: the ETag/version poll (what exists today)

`GET /v1/config` returns an `ETag`. Send it back as `If-None-Match`; an
unchanged resolved view answers `304` with no body.

```ts
const poll = await config.getEffectiveConfig(
  'fuzefront.chat',
  { scopeType: 'org', scopeId: orgId },
  resolved.version, // the ETag from the previous read
)
if (isNotModified(poll)) {
  // nothing changed — keep using the previous `resolved`
} else {
  resolved = poll
}
```

```python
poll = client.get_effective_config(
    "fuzefront.chat", org_scope, if_none_match=resolved.version,
)
if is_not_modified(poll):
    pass  # nothing changed -- keep using the previous `resolved`
else:
    resolved = poll
```

The version tracks the **resolved view**, not just rows this exact scope
owns — so a change at an ancestor scope also changes it, within the limits
of whichever chain the route actually resolved (see the
[known gap](#1-the-model) above: today that's `platform` + the scope you
queried). A version that tracked only the exact scope's own rows would let
inherited changes go undetected.

> **`config.changed` invalidation events are NOT shipped.** They're planned
> as `FF-EPIC-18-S4` (`docs/planning/epics/EPIC-18-configuration-trust-and-operations.md`)
> — status `Open`, no code anywhere in this repo publishes or consumes them
> (`shared/src/kafka/types.ts`'s `TOPICS` constant has no config-domain
> entry). **The ETag/version poll above is the only cache-invalidation
> mechanism that exists today.** Don't build a consumer that assumes an
> event will arrive to tell it something changed — poll, or accept that a
> cached value is only as fresh as your last poll.

---

## 9. This is not the feature-flag system

Quoting `packages/feature-flags/flag-registry.yaml`'s own entry for
`fuzefront.platform.config-management` directly:

> Gates CONSUMERS reading their configuration FROM config-service
> (FF-EPIC-17-S8) — whether a FuzeFront service resolves its settings
> through `GET /v1/config` vs. its own pre-existing configuration source.
> Does NOT gate config-service's own existence: `/health` always answers
> and the `/v1/*` read+write surface is never 503'd by this flag.

So: `GET /health` on config-service always answers (and surfaces its own
evaluation of this flag as `configManagementEnabled`, informational only —
never affecting the status code). The flag decides whether *your* service
reads its settings from config-service yet; it says nothing about whether
config-service is up. Default `false`, owner `backend-engineer`.

And the boundary itself, stated plainly: **configuration is durable, typed,
user- and tenant-authored settings. Flags are rollout, targeting,
kill-switches and experiments, authored by engineering.** Reaching for a
config key where a flag belongs is how a codebase ends up with two flag
systems and no clear owner — see `.claude/skills/feature-flags/SKILL.md`.

---

## 10. Swagger — the try-it console

Mounted at `/docs` on the service itself (`services/config-service/src/app.ts`
→ `src/routes/docs.routes.ts`), alongside the raw spec at `/docs/openapi.json`
and `/docs/openapi.yaml` (both served from the same parsed copy of the
committed `openapi.yaml` — no second source that could drift).

- **Authenticated-developer only, not public.** Every route under `/docs` is
  behind the same `requireAuth` that gates `/v1/*` — an unauthenticated
  caller gets `401`, not the docs page. It reuses the normal same-origin
  session; there's no separate docs-specific auth path.
- **Try-it is read-only in production.** Swagger UI is configured with
  `supportedSubmitMethods: ['get']`, so the Execute button does not exist on
  `POST`/`PUT` operations. **This is a UI-side control only** — it hides a
  button in the browser; it does not make the server refuse a write. The
  real boundary is unchanged underneath: every write still goes through
  `requireAuth` + Permit. It exists to prevent an *accidental* write
  (fat-fingering Execute against a live org), not a privilege-escalation risk
  — there isn't one here, because the console can only ever reach what the
  caller's own token already authorizes.
- **Write exploration happens off this route.** CI's `contract-tests` job
  (`.github/workflows/ci.yml`) already boots a Prism mock of every committed
  `openapi.yaml`, this one included, to prove the spec is servable — you can
  do the same locally against generated example responses (not real
  resolution logic) without needing a running service:

  ```bash
  npx @stoplight/prism-cli@5.8.1 mock services/config-service/openapi.yaml
  ```

  This is a spec-shaped sandbox, not the real resolver — its answers are
  generated examples, not an actual scope-chain resolution.

Given [§0](#0-status-today--read-this-first), `/docs` itself is only
reachable once the service is actually deployed and routable — there is
nothing to browse to yet.

---

## 11. Authorization

Every operation is Permit-gated on the acting principal — reads are scoped
(a caller reading a scope they have no authority over gets `403` and learns
nothing about whether that scope exists), and writes additionally
distinguish *write* authority from *lock* authority: being able to set a
value at your own scope does not imply being able to lock it against the
scopes beneath you.

**An id is never a capability.** "The caller knew the id" is never
sufficient — authorization comes from the token and Permit, exactly per
`governance/identifier-standard.md`'s standing corollary. config-service's
own ids (`cns_…` namespaces, `ckd_…` key definitions) are opaque past their
prefix and carry no access implication by themselves.

---

## See also

- The frozen contract: [`services/config-service/openapi.yaml`](../../services/config-service/openapi.yaml)
- Node client source + README: [`config-client/`](../../config-client/README.md)
- Python client source + README: [`packages/config-client-py/`](../../packages/config-client-py/README.md)
- Identifier standard: [`governance/identifier-standard.md`](../../governance/identifier-standard.md)
- Feature-flags skill: `.claude/skills/feature-flags/SKILL.md`
- The epic this closes: [`docs/planning/epics/EPIC-17-configuration-service-core.md`](../planning/epics/EPIC-17-configuration-service-core.md)
- Cache-invalidation roadmap: [`docs/planning/epics/EPIC-18-configuration-trust-and-operations.md`](../planning/epics/EPIC-18-configuration-trust-and-operations.md)
- Platform-wide consumer conventions: [`docs/guides/BUILDING_ON_FUZEFRONT.md`](BUILDING_ON_FUZEFRONT.md)

---

*Verification: every Node snippet above was type-checked with `tsc` against
the real `config-client/src/` exports and executed with `ts-node` (network
calls fail against an unreachable port, as expected with no service running —
a `TypeError`/wrong-symbol failure would not have been swallowed). Every
Python snippet was executed against a real editable install
(`pip install -e packages/config-client-py`) the same way. No live
config-service instance exists to call end-to-end (§ 0), so these checks
prove the client-side contract, not a full request/response round trip.*
