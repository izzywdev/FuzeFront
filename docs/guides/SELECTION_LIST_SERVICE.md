# Selection List Service — Consumer Integration Guide

How a consuming application stores, renders, and manages reference data
(`countries`, `industries`, `ticket-priorities`, …) using the FuzeFront
**selection-list-service** and its TypeScript client
`@fuzeone/selection-list-client`.

The service contract lives at
`services/selection-list-service/openapi.yaml` (**v4.2.0**). This guide is a
companion, not a replacement — the spec is the source of truth for any
discrepancy. Matching clients: `@fuzeone/selection-list-client` **2.2.0** and
`fuzefront-selection-list-client` (Python) **2.2.0**.

> **Status of contract 4.1.0 (shared lists, common lists, forks) — implemented,
> shipped dark.** The service implements all of it
> (`services/selection-list-service/src/{routes/fork.ts,routes/lists.ts,routes/resolve.ts,lib/sharedLists.ts,services/sharedReads.ts,middleware/listAccess.ts}`,
> migration `20261005_000011_shared_lists_and_forks.ts`), but **every user-visible
> part is behind the release flag `fuzefront.selection-lists.shared-lists`
> (default OFF, which additionally requires the master flag
> `fuzefront.selection-lists.service`)**. While the flag is OFF the service
> answers exactly as 4.0.0 in behaviour; see
> [Shared lists, common lists and forks](#shared-lists-common-lists-and-forks-410)
> for the full behaviour and for **what is dark, what needs flags, and what is not
> built** (the UI stages are not merged). Design record:
> [`docs/planning/selection-lists-shared-and-fork.md`](../planning/selection-lists-shared-and-fork.md).
>
> **Contract 4.2.0 (`SelectionList.revision`) is a frozen contract ahead of its
> implementation**: until the service wave lands, responses omit `revision` and a
> client reads that as *unknown*, so a fork cannot yet tell whether it is behind
> its source ([Is a fork behind its source?](#is-a-fork-behind-its-source-420)).
>
> Kafka events and app seeding are covered in
> [`SELECTION_LIST_EVENTS.md`](SELECTION_LIST_EVENTS.md); how seeding is enabled
> safely is in
> [`docs/runbooks/selection-lists-seeding-operations.md`](../runbooks/selection-lists-seeding-operations.md).

---

## Contents

1. [Concepts](#concepts)
2. [Install the client](#install-the-client)
3. [Create the client](#create-the-client)
4. [Feature flag](#feature-flag)
5. [Managing lists and items](#managing-lists-and-items)
6. [Resolving IDs to labels — the hot path](#resolving-ids-to-labels--the-hot-path)
7. [Pagination](#pagination)
8. [Translations](#translations)
9. [Access control](#access-control)
   - [Shared lists, common lists and forks (4.1.0)](#shared-lists-common-lists-and-forks-410)
10. [Authorship and seed provenance](#authorship-and-seed-provenance)
11. [Events and the outbox](#events-and-the-outbox)
12. [Quota](#quota)
13. [Error handling](#error-handling)
14. [Key invariants](#key-invariants)
15. [Interactive API docs](#interactive-api-docs)

---

## Concepts

### Two identifiers — `id` vs `code`

Every item carries both an `id` and a `code`. They are **not interchangeable**.

| Property | `id` | `code` |
|---|---|---|
| Minted by | The service (on create) | The caller (on create, e.g. `"US"`, `"HIGH"`) |
| Persist in your rows? | **Yes — always** | No — never |
| Shown to end users? | No — opaque | No — interop key |
| Mutable after create? | Never | Never |
| Purpose | Foreign key for resolution | Maps to an external vocabulary |

**Persist `id`, not `code`.**  A code is a display/interop concern, not a
primary key.  Storing a code as a foreign key welds your schema to a human
label — if the label or code needs to change, every row is broken.  Storing
the opaque `id` means the service can rename a label, fix a typo, or evolve a
code without touching your data.

### Archive is the default; purge is explicit and irreversible

Reference data is referenced. The default destructive operation is **archive**
(`status: 'archived'`): the item stops appearing in the picker but still
**resolves** — every consumer row holding its `id` keeps rendering a real
label.  `DELETE` without `?purge=true` archives.

`?purge=true` permanently deletes the row.  Purged items appear in the
`missing` array on every future `resolveIds` call — every row that held that
`id` loses its label.  Purge requires `list-owner`.

> **Rule:** always archive first.  Purge only when you need to reclaim quota
> and have verified no row in any consumer holds that item's `id`.

### Translations and locale fallback

Labels live in separate translation rows, never on the entity itself.  Every
list or item representation carries the resolved text plus `resolved_locale`
(the locale the text actually came from) and `is_machine` (whether a machine
translated it).

Resolution order for a request:

1. The `locale` query parameter (if supported).
2. The first supported language in `Accept-Language`.
3. The list's `source_locale`.
4. `en`.

A label is **never null** — a missing translation falls through the chain
rather than returning an empty string.

---

## Install the client

### React UI package — published, install it from the registry

`@fuzeone/selection-lists-ui` ships to GitHub Packages under the owner scope as
**`@izzywdev/fuzeone-selection-lists-ui`** (`0.1.0` is live; verified against
`GET users/izzywdev/packages/npm/fuzeone-selection-lists-ui/versions`). The
rename is not a typo — GitHub Packages requires the npm scope to equal the
account that owns the repository, so `publish-packages.mjs` rewrites every
canonical scope to `@izzywdev/<scope>-*` at publish time. See
[`shared-packages-distribution.md`](./shared-packages-distribution.md) for the
alias mechanism.

```bash
# .npmrc in the consuming repo (the scope is @izzywdev, not @fuzeone)
@izzywdev:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

```jsonc
// package.json — alias it back to the canonical name if you prefer that import
{
  "dependencies": {
    "@fuzeone/selection-lists-ui": "npm:@izzywdev/fuzeone-selection-lists-ui@^0.1.0"
  }
}
```

### TypeScript client — published from the root workspace on merge

`@fuzeone/selection-list-client` ships to GitHub Packages under the owner scope
as **`@izzywdev/fuzeone-selection-list-client`** (same alias rule as the UI
package above). It is published by `packages-publish.yml`, and the whole
mechanism is that `selection-list-client` is a root `package.json`
`workspaces` entry: `publish-packages.mjs --list-json` reads `workspaces` as its
single source of truth and emits one matrix leg per publishable package. A
directory that is not a workspace gets no leg, so the workflow never attempts it
and still goes green (the defect this client had until it was added;
`api-client/` and `sdk/` had it too).

How and when it publishes:

- **Trigger:** a merge to `master` runs `packages-publish.yml`. Its leg for this
  package builds the client and its dependency closure
  (`lerna run build --scope @fuzeone/selection-list-client --include-dependencies`,
  i.e. `tsup`), dry-runs, then publishes `--only` this package.
- **What gates a publish:** the `version` in `selection-list-client/package.json`.
  Publishing is idempotent: a version already in the registry is skipped, never
  overwritten, so an unchanged version is a no-op and a re-run is safe.
  **Versions are bumped in the PR, not by the publish job** (`gate-version`
  enforces the SemVer bump discipline; see
  [`shared-packages-distribution.md`](./shared-packages-distribution.md#versioning)).
  A contract change that alters the client's public surface bumps the client in
  the same PR as the spec.
- **Verify the registry, not the run conclusion:**

  ```bash
  gh api users/izzywdev/packages/npm/fuzeone-selection-list-client/versions --jq '[.[].name]'
  ```

- **Install:** map the `@izzywdev` scope to the registry (see the `.npmrc` above),
  then depend on `@izzywdev/fuzeone-selection-list-client`, or alias it back to the
  canonical name with `"@fuzeone/selection-list-client": "npm:@izzywdev/fuzeone-selection-list-client@^2.0.0"`.
  Inside this repo no mapping is needed: it is an npm workspace and links from the tree.

The Python client is not part of this: it publishes to PyPI through the
tag-triggered `selection-list-client-py-publish.yml`.

To consume a **local, unpublished** build instead (for example to test a change
before it merges):

```bash
# In the selection-list-client directory
cd selection-list-client
npm install
npm run build
npm pack
# → fuzeone-selection-list-client-2.2.0.tgz

# In your consuming package
npm install /path/to/fuzefront/selection-list-client/fuzeone-selection-list-client-2.2.0.tgz
```

**Python client** is in `packages/selection-list-client-py/` and follows the
same pack-and-install pattern until PyPI publication.

---

## Create the client

```ts
import { SelectionListClient } from '@fuzeone/selection-list-client'

// Browser: baseUrl MUST be a same-origin path — never an absolute host.
// Absolute hosts break under TLS ingress and trigger mixed-content blocks.
// Paths include `/v1/...`, so baseUrl is the prefix BEFORE `/v1`: '/api' yields
// `/api/v1/selection-lists`, which is the route the chart's ingress publishes.
const client = new SelectionListClient({
  baseUrl: '/api',
  token: () => getJwt(),          // function so short-lived tokens refresh
  defaultLocale: 'en',            // optional; per-call locale always wins
})
```

### Options

| Option | Type | Required | Notes |
|---|---|---|---|
| `baseUrl` | `string` | Yes | Same-origin path in the browser; absolute URL in server-side callers |
| `token` | `string \| () => string \| Promise<string>` | Yes (all calls) | An **org-scoped** Bearer token (see [Authentication and the org claim](#authentication-and-the-org-claim)). A plain FuzeFront session token carries no org and every call answers `401`. `resolveIds` also requires it |
| `fetch` | `typeof fetch` | No | Inject for tests or non-global runtimes; defaults to `globalThis.fetch` |
| `defaultLocale` | `Locale` | No | Applied to every request that doesn't supply its own |
| `headers` | `Record<string, string>` | No | Merged into every request (tracing IDs, tenant hints) |

### Authentication and the org claim

The service scopes **every** row by organization and takes that organization from **one place only: a claim in the
verified bearer token**. Never a header, query string or body (an `X-Organization-Id` header is ignored).

The token the shell holds after login is a plain **session token** `{ userId, sessionId, tid }`. It authenticates the
user but names **no organization**, and `tid` is *not* one: it is the identity-directory tenant (which Authentik
instance authenticated the user, e.g. `fuzefront`). The service never reads `tid` as an org; treating it as one would put
every user of a directory in one tenant.

To act in an org, exchange the session token for a short-lived **org-scoped token** at the Security API:

```http
POST /api/organizations/{orgId}/session-token
Authorization: Bearer <session token>

200 { "token": "<jwt>", "tokenType": "Bearer", "expiresIn": 900, "organizationId": "<bare uuid>" }
```

The Security API mints it **only after proving the caller's active membership of `{orgId}`** with the same helper
the rest of Security uses (`proveSessionTenant`, `backend/security/src/services/session-tenant.ts`: an `active`
membership row **and** `organizations.is_active = true`; a NULL or false flag matches nothing). `organizationId` may be
the bare UUID or the `org_…` TypeID; `403` for a non-member, a deactivated org and a nonexistent org alike, `503` if the
membership proof itself cannot be completed (never a token), `401` for a revoked/expired session, a foreign-tenant
token, or a token that is not a plain session token. The result is
`{ userId, sessionId, tid, orgId, kind: "fuze-org-session" }`, lifetime at most 15 minutes and never beyond the session's
own expiry. Re-exchange when it lapses: the exchange re-checks the session and the membership, which is how a removed
member or a deactivated org stops being served (the service verifies statelessly and cannot see a later logout, so the
short lifetime is the revocation bound). The shell does this for the UI (`frontend/src/lib/selectionListsAuth.ts`:
cached per session+org, refreshed a minute before expiry, never persisted).

**Why this endpoint exists alongside `POST /api/v1/security/tokens/exchange`.** The exchange added with the
scoped-ownership bootstrap (Security 0.10.0) is a different mechanism for a different caller, so it does not replace
this endpoint; the two share the membership proof and nothing else.

| | `POST /api/organizations/{orgId}/session-token` (this) | `POST /api/v1/security/tokens/exchange` |
|---|---|---|
| Caller | the **end user's browser**, with its own session token | a **service**, authenticated by a Kubernetes workload token (`fuze-workload`, `TokenReview`) holding the requested scopes |
| Input | session token + org in the path | `subjectToken` + `audience: service:<name>` + `scope` + canonical `tenant` selector |
| Output | `{ userId, sessionId, tid, orgId, kind: 'fuze-org-session' }`, 15 min, a bearer the service verifies **statelessly** | `{ sub, aud, scope, tenantId, act, kind: 'fuze-delegation' }`, 5 min, audience-bound, verified by **introspection** behind `x-fuze-delegation` |
| Shared | `proveSessionTenant` for the membership proof | `proveSessionTenant` for the membership proof |

A browser cannot call the delegation exchange (it holds no workload token), and its token names `tenantId`, not an
`orgId` claim this service's stateless bearer check reads. Serving the UI from it would mean routing every
selection-list call through a host-backend proxy that holds a workload identity (the pattern `fuzex-proxy.ts` uses for
FuzeX) and switching this service to introspection-based delegation verification, which is an architecture and
workload-identity (FuzeWorkloadIdentity / Helm) change, not a token swap. Until that is chosen, the end-user path above
is the supported one. The machine path is unaffected and unchanged: the service's own owner bootstrap uses a projected
Kubernetes ServiceAccount token exchanged for a workload token with scope `selection-list:owner-grant`
(`src/lib/machineIdentity.ts`), never a user token.

Both Fuze-minted kinds stay out of each other's lane: this service accepts only a kind-less session or
`fuze-org-session`; `fuze-workload` and `fuze-delegation` are `401` here. The Security API's account routes, and the
delegation exchange's own subject-session check, refuse `fuze-org-session` (it is accepted only by the authz decision
API, which org-scoped services call with it).

What the service accepts (`src/middleware/auth.ts`):

| Rule | Detail |
|---|---|
| Algorithm | `HS256` only, signed with the platform `JWT_SECRET`. HS384/HS512 and `alg: none` are `401` |
| Subject | `userId`, else `sub` |
| Org claim, precedence | `orgId` (what the Security API mints) → `organization_id` (the name this contract's `bearerAuth` publishes) → `organizationId`. Present under several names with different values, or malformed (empty, whitespace, non-string, over 128 chars) → `401`, never guessed. No org claim at all → authenticated but every org route answers `401` |
| Org id form | Bare UUID (`organizations.id`, the authz tenant key) or `org_…` TypeID, used **verbatim**; `wireOrgId()` renders either to the wire TypeID for events and flags |
| Token `kind` | Absent (session) or `fuze-org-session` are accepted. **Any other `kind` is `401`**: `fuze-workload` and `fuze-delegation` tokens are service/act-on-behalf credentials, not users, and verify under the shared secret whenever `DELEGATION_SIGNING_KEY` is unset |

Service-to-service callers that are not acting for a user have no org-scoped token to present; they go through the
Kafka seeding path or the Security API, not these routes.

### Server-side (Node / service-to-service)

```ts
const client = new SelectionListClient({
  baseUrl: 'http://fuzefront-selection-list-service:3008',
  // An org-scoped token (15 min) from the exchange above: pass a function that
  // re-exchanges on expiry, not a static env value.
  token: () => getOrgScopedToken(),
  fetch,   // node-fetch or native fetch (Node 24+)
})
```

The in-cluster Service port is `selectionListService.port` in the Helm values (**3008**).
The process default (`PORT` unset) is **3008** too, so a local run, the image, the chart and (since
contract 4.1.0) the OpenAPI `servers` example all agree.

---

## Feature flag

The service is gated behind release flag `fuzefront.selection-lists.service`
(default OFF). While OFF every `/v1/selection-lists/*` route returns 404 and
the shell hides the UI. In browser code read it with `useFlag` (the key is in
`WEB_EXPOSED_FLAGS`); server-side use the OpenFeature client with the request's
org/user context:

```ts
import { FLAG_KEYS, getClient } from '@fuzefront/feature-flags'

const enabled = await getClient().getBooleanValue(
  FLAG_KEYS.SELECTION_LISTS_SERVICE,
  false, // release flag: fail-safe OFF
  { environment, organizationId, userId, app: 'my-service' },
)
```

There is a **second** flag for seeding, `fuzefront.selection-lists.seed-defaults` (release,
default OFF, **server-side only** — it is not in `WEB_EXPOSED_FLAGS`). It gates both seeding
consumers (platform defaults on `identity.org.created`, and app `selection-lists.seed.requested`)
and the reconciler. Seeding needs **both** flags ON for the organization; either OFF means nothing
is seeded (app requests are answered `seed.failed` / `SEEDING_DISABLED`). Publishing of change
events is **not** behind either seeding flag. All three flags fail closed (no flag client or an
evaluation error reads as OFF) and are created OFF by the `prod-unleash-ops` dispatch
`flags=selection-lists-create`; what any of them is set to **in the live Unleash is not readable from
this repo**.

A **third** flag, `fuzefront.selection-lists.shared-lists` (release, default OFF, server **and**
web-exposed: `FLAG_KEYS.SELECTION_LISTS_SHARED_LISTS` and `WEB_EXPOSED_FLAGS` in
`packages/feature-flags/src/catalog.ts`; registry entry in `packages/feature-flags/flag-registry.yaml`),
gates all shared/common-list behaviour of 4.1.0 (see
[Shared lists, common lists and forks](#shared-lists-common-lists-and-forks-410)). It additionally
requires the master flag (the service evaluates it only after the master gate passed), and it is
never an authorization boundary — Permit decides who may do what. No `prod-unleash-ops` set
**enables** it (the `selection-lists-create` set creates it OFF; the `selection-lists` ramp set and
the `all-flags` set do not list it), so turning it on is a deliberate owner step; because the
browser (`GET /api/flags`, no `orgId`) and the service (canonical `org_`/`usr_` ids) cannot yet
agree on a per-org or per-user constraint, the runbook says to enable it **globally** or not at all
([`selection-lists-flag-rollout.md`](../runbooks/selection-lists-flag-rollout.md), "Third flag").

The platform organization that owns the common lists is configured by Helm
`selectionListService.platformOrgId` (env `SELECTION_LIST_PLATFORM_ORG_ID`; empty by default, and
**empty means every platform feature fails closed**). Production may only carry the root platform
org id derived from `ROOT_ORG_ID` (`org_0000000000000000000000000g`), enforced by the
`gate-platform-org-pin` CI job; `values-prod.yaml` pins exactly that value. See
`docs/runbooks/selection-lists-rollout.md` section 2.4.

Rollout/rollback procedure: `docs/runbooks/selection-lists-flag-rollout.md` (master flag) and
`docs/runbooks/selection-lists-seeding-operations.md` (seeding).

---

## Managing lists and items

### Create a list

```ts
const list = await client.createList({
  key: 'countries',          // unique within the org; immutable after create
  name: 'Countries',         // source-locale label (English by default)
  source_locale: 'en',
  description: 'ISO 3166-1 alpha-2 country codes',  // optional
})
// list.id  — the service-minted TypeID, e.g. 'front_sl_01h455vb4pex5vsknk084sn02q'
```

### Add items

```ts
const item = await client.createItem(list.id, {
  code: 'US',               // immutable interop key — omit if you don't need one
  label: 'United States',   // source-locale label
  description: 'USA',       // optional
  sort_order: 1,            // omit to append; pass to insert at position
})
// Persist item.id in your own rows, not item.code.
```

### Read and update

```ts
// All active items, first page
const page = await client.getItems(list.id, { status: 'active', locale: 'fr' })

// Partial update — only supplied fields change
await client.updateList(list.id, { description: 'Updated description' })
await client.updateItem(list.id, item.id, { label: 'United States of America' })
// Note: `code` is immutable — the type omits it and the service rejects it.
```

### Archive and purge

```ts
// Archive (default): item still resolves; existing consumer rows keep a label
await client.archiveItem(list.id, item.id)

// Equivalent — DELETE without purge archives
await client.deleteItem(list.id, item.id)

// Purge: permanent, requires list-owner; purged IDs become 'missing' on resolve
await client.deleteItem(list.id, item.id, { purge: true })
```

### Reorder items

```ts
// itemIds must be a complete permutation of all non-archived items in the list.
// Sparse patches are intentionally unsupported — two concurrent reorders with
// the whole collection have an unambiguous merge; two sparse patches do not.
await client.reorderItems(list.id, [item3.id, item1.id, item2.id])
```

---

## Resolving IDs to labels — the hot path

Consumers persist `id` values in their own tables.  When rendering, convert
them back to labels in **one round trip** using `resolveIds`:

```ts
// Collect IDs from your rows (e.g. from a DB query result)
const storedIds = rows.map((r) => r.country_id)

const { results, missing } = await client.resolveIds(storedIds, { locale: 'fr' })

for (const row of rows) {
  const resolved = results[row.country_id]
  if (resolved) {
    console.log(resolved.label)           // 'France'
    console.log(resolved.status)          // 'active' | 'archived'
    console.log(resolved.resolved_locale) // 'fr'
    console.log(resolved.is_machine)      // true if machine-translated
  }
}

// IDs that don't resolve (purged or never existed)
if (missing.length > 0) {
  console.warn('Unresolvable IDs:', missing)
}
```

### Archived IDs still resolve

An archived item resolves with `status: 'archived'` — your rows keep rendering
a real label.  Only purged or never-existent IDs appear in `missing`.

### Common lists and forks (4.1.0, shared-lists flag ON)

Item ids of a common (`platform`) list resolve in every org. Where your org holds an active,
`org`-visible fork of that list, the entry is answered from the fork item and carries
`effective_item_id` (absent otherwise); both ids keep resolving. Details:
[Stored values and `POST /v1/resolve`](#stored-values-and-post-v1resolve).

### Batch cap: 500 IDs per call

`resolveIds` is bounded at 500 IDs per call.  Chunk larger batches at the call
site — this keeps the constraint visible to the caller rather than hidden in
the client:

```ts
const CHUNK = 500

async function resolveAll(ids: string[], locale?: string) {
  const out: Record<string, ResolvedItem> = {}
  const allMissing: string[] = []

  for (let i = 0; i < ids.length; i += CHUNK) {
    const { results, missing } = await client.resolveIds(
      ids.slice(i, i + CHUNK),
      { locale }
    )
    Object.assign(out, results)
    allMissing.push(...missing)
  }
  return { results: out, missing: allMissing }
}
```

### Caching

`resolveIds` is a POST for URL-length reasons, but it is read-only and
side-effect-free.  Responses carry `Cache-Control` and `ETag` headers; cache
keying must include `locale`/`Accept-Language`.

---

## Pagination

Use `paginate` to walk a cursor without hand-rolling the loop.  The cursor
guarantees no gaps and no duplicates under concurrent writes — both of which
are easy to get subtly wrong with a manual implementation.

```ts
// Walk all active items in a list
for await (const item of client.paginate((p) => client.getItems(list.id, p))) {
  process(item)
}

// Walk all lists in the org, with a locale
for await (const list of client.paginate(
  (p) => client.getLists({ ...p, locale: 'de', status: 'active' })
)) {
  process(list)
}

// Limit page size
for await (const item of client.paginate(
  (p) => client.getItems(list.id, p),
  { limit: 50 }
)) {
  process(item)
}
```

Direct page access (when you own the cursor):

```ts
const page = await client.getItems(list.id, { limit: 20, cursor: savedCursor })
// page.page.nextCursor  — pass on the next call
// page.page.hasMore     — false when done
```

### A page can be shorter than `limit` — even empty — and still not be the last

`GET /v1/selection-lists` applies the readability filter **after** it has paginated
(`services/selection-list-service/src/routes/lists.ts`: the page of `limit` rows is cut from the
database order first, then each row is dropped unless the caller may read it — by an instance role,
and with `include_shared` also by the shared read — and, with the shared-lists flag ON, unless it is the
effective row for its key). A list the caller may not read is absent, never a `403`, so:

- a page can hold **fewer than `limit` items, or none at all, while `page.hasMore` is `true`** and
  `page.nextCursor` is set (the cursor follows the database order, so the walk stays gap- and
  duplicate-free);
- the only end-of-data signal is `page.hasMore === false` (equivalently `nextCursor === null`).
  **Never stop on an empty or short page**, and never treat "fewer than `limit` rows" as "last page";
- `client.paginate(...)` / `paginate(...)` already behave correctly (they stop only when `hasMore` is
  false or `nextCursor` is null). A hand-rolled loop must do the same;
- a one-row probe such as `getLists({ key, limit: 1 })` can therefore return an **empty** page while the
  list you want is on the next one; follow the cursor (`getEffectiveList` does since clients 2.2.0 —
  see the note on it below);
- `page.total` is omitted whenever authorization is enforced (it would count lists the caller cannot
  read), which is always the case in production.

Item pages (`getItems`) are not filtered after pagination: the list-level guard decides access before
the page is cut.

---

## Translations

### Add or update a translation

```ts
// List-level translation (name / description)
await client.upsertListTranslation(list.id, 'fr', {
  name: 'Pays',
  description: 'Pays selon ISO 3166-1',
})

// Item-level translation (label / description)
await client.upsertItemTranslation(list.id, item.id, 'fr', {
  label: 'États-Unis',
})
// Stored as is_machine: false — protected from autofill overwrite.
```

### Machine autofill

Fill in every locale entry that is missing or stale (source text changed since
the translation was produced) in one call:

```ts
const result = await client.autofillTranslations(list.id, 'fr')
// result.filled   — number of new/stale entries translated
// result.skipped  — entries with is_machine: false (human translations — never overwritten)
```

Autofill never overwrites a human translation (`is_machine: false`).
`source_hash` on a translation row records the hash of the source-locale text
at the time of translation; when the source text changes the hash diverges and
autofill knows to refresh only that entry.

---

## Access control

Authorization is decided by FuzeFront's Security API (Permit-backed), never by this service's
database and never by a feature flag. The contract splits it across **two resource types** that
answer different questions — they must not be confused (spec 3.0.0+, review H-3):

### 1. The catalog — tenant-level (`SelectionListCatalog`)

"May this caller work with selection lists in this org at all?" Keyless (the tenant is the
caller's organization), granted through **tenant roles**:

| tenant role | `list` | `create` | `read_quota` | `resolve` | `read_shared` (4.1.0) | `publish_platform` (4.1.0) |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| `admin` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (effective only in the platform org) |
| `editor` | ✓ | ✓ | | ✓ | ✓ | |
| `viewer` | ✓ | | | ✓ | ✓ | |
| `developer` | | | | | | |

| Operation | Checked against | Action |
|---|---|---|
| `GET /v1/selection-lists` | `SelectionListCatalog` | `list` |
| `POST /v1/selection-lists` | `SelectionListCatalog` | `create` (+ `publish_platform` for `visibility: platform`) |
| `POST /v1/selection-lists/{listId}/fork` (4.1.0) | `SelectionListCatalog` | `create` (+ read on the source) |
| `PATCH /v1/selection-lists/{listId}` carrying `visibility` (4.1.0) | `SelectionList` (+ catalog) | `update` + `manage_access` on the list; `publish_platform` too for `platform` |
| `GET /v1/selection-lists/quota` | `SelectionListCatalog` | `read_quota` |
| `POST /v1/resolve` | `SelectionListCatalog` | `resolve` |

### 2. Per-list actions — instance roles only (`SelectionList`)

"What may this caller do to *this* list?" Keyed on the list id and conferred **only** by
resource-instance roles on that list. **Tenant roles confer zero per-list actions** — being an org
`admin` does not by itself let anyone read, edit or delete a list it holds no instance role on.

| Role | read | add item | update item | remove item | translate | update list | delete list | manage access |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| `list-owner` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `list-editor` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | |
| `list-contributor` | ✓ | ✓ | ✓ | | ✓ | | | |
| `list-translator` | ✓ | | | | ✓ | | | |
| `list-viewer` | ✓ | | | | | | | |

(Spec action names: `read`, `add_value`, `update_value`, `remove_value`, `translate`, `update`,
`delete`, `manage_access`. Roles do not stack.)

How the two meet:

- **Listing** needs `SelectionListCatalog:list`, and the returned rows are **still filtered per
  list** by `SelectionList:read`: a caller sees only lists it holds an instance role on (plus, with the
  shared-lists flag ON and `include_shared=true`, lists readable through `visibility` — see below). A
  caller with none gets an empty page, not a `403`.
- **Creating** needs `SelectionListCatalog:create`. The service then grants the creator
  `list-owner` on the new list **with its own workload identity** (a projected Kubernetes
  ServiceAccount token exchanged for scope `selection-list:owner-grant`, which the Security API
  accepts only to bootstrap the verified creator as owner).
- Two actions are stricter than the table suggests: **purging an item**
  (`DELETE .../items/{itemId}?purge=true`) additionally needs `delete` on the list, so only a
  `list-owner` can purge (a `list-editor` can archive an item but gets `403` on purge); and
  **archiving a list via `PATCH` `status: "archived"`** needs `update` **and** the same `delete` as
  `POST .../archive` — a `list-editor` can no longer archive through PATCH (4.0.0).
- **`POST /v1/resolve`** needs only the catalog `resolve` action; it does **not** check
  `SelectionList:read` on each id's list (accepted trade-off, review L-4: it is org-scoped, it
  returns a label, a locale and a status only, and a per-list check would turn one round trip
  into N decisions on the hot path). Decided and recorded: this is not a gap to fix.
- **The last-owner guard asks the Security API, not the mirror.** Demoting or removing a
  `list-owner` is refused `409 CONFLICT` unless **another** owner is *confirmed by the authority*
  (`manage_access` on that list, asked for each other mirror owner). A mirror row the authority does
  not confirm (a failed role change, a deleted user, an operator's direct revoke) is not an owner.
  If the Security API cannot answer, the change is refused (`500`/`409`), never allowed.
- **A failed role change is compensated.** The Security API write is not part of the database
  transaction, so when `PUT`/`DELETE .../access/{userId}` fails after it revoked/granted something,
  the service puts the authority back to the user's prior role before answering `500`
  (`selection_list_authz_compensation_total{outcome="failed"}` means that compensation itself failed).
  Compensation runs **with the acting human's own token**: the Security API re-checks their
  `manage_access` on the instance exactly as for the original write; the workload identity never
  repairs a role.
- **Which credential does what.** Human access changes (role change, revoke, compensation, purge
  cleanup) always carry the caller's token and are authorized per list instance. The service's own
  workload token holds exactly two scopes, both enforced by the Security API
  (`backend/security/src/routes/authz.ts`), neither of which is `authz:admin`:
  `selection-list:owner-grant` (grant `list-owner` to an active member, nothing else) and
  `selection-list:grant-cleanup` (**revoke only**, only `SelectionList` instance roles, and only for
  a principal SQL proves is gone: the user row is missing or deactivated, or the user has no active
  membership of that tenant; a live member's grant is refused `403`).
- **Cascades keep the authority clean.** Purging a list revokes its instance's Security API grants
  after the purge commits, with the purging owner's token, their own grant last (best-effort,
  idempotent, never fails the purge; `selection_list_grant_cleanup_failed_total{cause="purge"}`).
  A grant that token is refused (typically a grantee who has since left the tenant) is retried once
  through the cleanup scope, which accepts exactly that case. `identity.user.deleted` has no human,
  so it uses the cleanup scope: it revokes every
  grant the deleted user holds on any list and removes their mirror rows (retried; dead-lettered
  after 5 attempts). If the deleted user was a list's **last** owner the grant is still revoked, the
  list is flagged (`selection_list_ownerless_lists_total{cause="user_deleted"}` and an ERROR log with
  `ownerless: true`), and a tenant admin recovers it by granting `list-owner` through the Security API
  (below).

### No implicit admin ownership — and the support path

There is **no** automatic tenant-`admin` (or `org-admin`) → `list-owner` derivation. A tenant
admin can `list`/`create`/`resolve` but holds no role on lists it did not create. Whether there
*should* be implicit ownership is an **open design question**
(`docs/planning/selection-lists-permit-actions.md`, Q1) — do not build UI or integrations that
assume it.

What works today is an explicit, audited self-grant. A tenant `admin` holds
`Organization:manage`, which the Security API's grant gate treats as authority to grant any role
in that tenant, so an admin who must administer a list it holds no role on grants itself
`list-owner` on that instance:

```http
POST /api/v1/security/authz/grants
Authorization: Bearer <tenant admin token>
Content-Type: application/json

{ "subject": "<admin user>", "tenant": "<org>", "role": "list-owner",
  "resource": { "type": "SelectionList", "key": "front_sl_..." } }
```

The grant lands in the Security API's grant log. Note it writes only to the authorization
backend: the service's `selection_list_access` read-model mirror (the roster behind
`GET .../access`) will not show it until the service reconciles it. This is also the way to make
**seeded lists** visible — see below.

### Managing grants

```ts
// Grant a role (or change an existing grant — idempotent)
await client.setAccess(list.id, userId, 'list-editor')

// Read current grants
for await (const grant of client.paginate((p) => client.getAccess(list.id, p))) {
  console.log(grant.user_id, grant.role)
}

// Revoke — idempotent; revoking the last list-owner returns 409 CONFLICT
await client.revokeAccess(list.id, userId)
```

> **Important:** an `id` is never a capability. Knowing a list's `id` grants nothing — every
> route re-checks the caller against the Security API. A resource the caller cannot read returns
> `404`, not `403`, so the API is not a cross-org existence oracle.

### Seeded lists and who can see them

Lists created by **seeding** (platform defaults such as `yes-no`, or an app's
`seed.requested` pack) are written by the system principal. Since SL8 the org's **owner** is
granted `list-owner` on the **platform**-seeded lists (`src/seed/ownerGrants.ts`); app-seeded lists
get no grant at all, and **no other member gets one either**. Because every per-list action is
instance-only, the consequence on today's code for everyone but that owner is:

- members — including tenant admins — **do not see seeded lists** in `GET /v1/selection-lists`
  and get `404` on `GET /v1/selection-lists/{listId}` until a role is granted on that list;
- the list id is not discoverable through the list endpoint either, so an admin takes it from the
  `selection-lists.seed.completed` event (`lists[].listId`) or from an operator;
- once an admin has self-granted `list-owner` (above) the list behaves like any other, and its
  items and translations can be edited — which marks it `seed.user_modified: true` and stops
  further seeding upgrades from touching it;
- `POST /v1/resolve` still resolves seeded item ids for any caller holding the catalog `resolve`
  action, because it does not check per-list read.

This is a **known gap** for seeded content as it ships today, recorded in the seeding runbook. It is
why seeding should not be switched on for an org that expects its members to use the seeded lists
immediately. The mechanism that fixes it is implemented — seed-list `visibility` (`org` makes a
seeded list readable by every member of the org without any grant; see the next section) — but it
only takes effect **while `fuzefront.selection-lists.shared-lists` is ON for the org**, and nothing
that ships declares it yet: `seed-packs/platform/platform-defaults.v1.json` carries no `visibility`
(so `yes-no`, `priority` and `work-status` are still seeded `private`), no app is on the
allowlist, and neither the one-off data migration that would set `org` on already-seeded lists nor a
platform pack v2 exists (design record section 9, steps 4-6, are **not built**).

### Shared lists, common lists and forks (4.1.0)

The requirement: a member who signs up must be able to **pick** from the app's common lists in
every dropdown without owning them and without being able to change them; an organization that
wants different values **forks** (copy-on-write). Design record, with the decisions behind every
rule below: [`selection-lists-shared-and-fork.md`](../planning/selection-lists-shared-and-fork.md).

#### What is live, what is dark, what is not built

| Area | State | Evidence |
|---|---|---|
| Service: visibility, shared read, `include_shared`, key shadowing, `editable`, fork, `fork_required`, resolve of common lists and the fork redirect, `list.forked` / `visibility.changed`, seed-list `visibility`, platform-org guard | **Implemented and merged, dark.** Everything user-visible is behind `fuzefront.selection-lists.shared-lists` (default OFF, fails closed) *and* the master flag. | `src/routes/{lists,fork,resolve,items}.ts`, `src/middleware/listAccess.ts`, `src/lib/sharedLists.ts`, `src/services/{sharedReads,fork.service}.ts`, `src/seed/apply.ts`, `src/events/{emitters,platformGuard}.ts` (all under `services/selection-list-service/`) |
| Production chart | The workload is **enabled** (`selectionListService.enabled: true`) with `platformOrgId` pinned to the root platform org; the flags decide visibility. The live Unleash state of the three flags cannot be read from the repo (the owner-directed `all-flags` set of `prod-unleash-ops` lists the master and seed flags, not `shared-lists`, so the master flag may already be ON while shared lists are not). | `deploy/helm/fuzefront/values-prod.yaml`, CI job `gate-platform-org-pin` |
| What a deployment needs before common lists work | Master flag ON **and** shared-lists flag ON for the caller; `SELECTION_LIST_PLATFORM_ORG_ID` set to a valid `org_…` TypeID **and** confirmed by the org projection (an active, `is_active`, `platform`-typed row — otherwise every platform feature is disabled); the Permit schema with `SelectionListCatalog:read_shared` / `publish_platform` synced; broker ACLs on the `identity.*` topics (FuzeInfra#1394, a hard prerequisite of enabling the service in production — its state is not verifiable from this repo). The service does not authenticate event producers in-process; that is an **accepted residual risk** while the ACLs are unverified. | `src/lib/sharedLists.ts` (`resolvePlatformOrgId`), `backend/src/permit/schema.ts`, `docs/runbooks/selection-lists-rollout.md` P6 / section 10 |
| Clients | `getEffectiveList`, `forkList`, `include_shared` / `visibility` params, `isForkRequired`, `effective_item_id` — complete since `@fuzeone/selection-list-client` 2.1.1 and Python 2.1.0; 2.2.0 (both) adds `revision` / `compareForkToSource` and makes `getEffectiveList` follow the cursor. | `selection-list-client/src/client.ts`, `packages/selection-list-client-py/src/fuzefront_selection_list_client/client.py` |
| UI | **Not built.** The five shared-lists flows are design-approved (`design/frames/selection-lists-shared/`), but `packages/selection-lists-ui/src/shared-lists/` does not exist on master; the picker still looks lists up with the exact-match `?key=` filter and has no fork flow. The implementation and RED-spec PRs were open when this was written — check their merge state. | `design/frames/selection-lists-shared/manifest.json`, `packages/selection-lists-ui/src` |
| Fork provenance "behind source" comparison | **Contract only (4.2.0).** `forked_from.revision` records the source revision at copy time; contract 4.2.0 adds `SelectionList.revision` to compare it with (clients 2.2.0, `compareForkToSource`), but the service does not emit it yet, so a client reads *unknown* and a UI can only show "comparison unavailable" — see [Is a fork behind its source?](#is-a-fork-behind-its-source-420). Service work list: design record §13.4. | `services/selection-list-service/openapi.yaml` (`SelectionList`, `SelectionListForkProvenance`) |
| Rollout data jobs (set `org` on already-seeded lists; retro-fork per-org copies of the platform pack; platform pack v2) | **Not built.** The shipped platform pack declares no `visibility`. | `services/selection-list-service/seed-packs/platform/platform-defaults.v1.json` |

With the shared-lists flag OFF the service answers as 4.0.0 in behaviour, and still emits the 4.1.0
shapes with their defaults: `visibility: "private"`, `forked_from: null`, items
`origin_item_id: null`, and **no** `editable` (`src/routes/listShape.ts`). `include_shared` and
`visibility` query parameters are accepted and ignored; `POST …/fork` is a `404`; a create or PATCH
with a non-`private` `visibility` is a `400 VALIDATION_ERROR`; seed-list `visibility` is ignored.
Two rules are deliberately **flag-independent**: a list key is unique per organization across every
rendering of its id (a second create or rename under the bare-UUID/`org_` form of the same org is a
`409`), and the platform-org suspension and common-list purge guards (below) protect a `platform`
row whenever one exists.

#### `visibility`

`SelectionList.visibility` decides who may *read* a list without an instance grant. It never confers
a change.

| `visibility` | Readable without a grant by | Who sets it |
|---|---|---|
| `private` (default; every list that existed before 4.1.0) | nobody — instance roles only | default |
| `org` | every member of the owning org (`SelectionListCatalog:read_shared`) | the list owner (`manage_access`) |
| `platform` | every member of **every** org (`read_shared`) — a **common list**, owned by the platform organization | a platform operator (`publish_platform`, acting in the platform org); **one-way** |

The service owns the column; Permit decides membership. A non-private read needs **both** the data
predicate (`org`: the list belongs to the caller's org; `platform`: the row is owned by the platform org —
a `platform` row anywhere else is untrusted data and is not served) **and** `read_shared` in the
caller's tenant (`src/lib/sharedLists.ts` `sharedPredicate`, `src/middleware/listAccess.ts` `canRead`).
A list the caller cannot read — including another org's private or `org` list — is a `404`, never a
`403`. A list owned by another org (a common list) renders `created_by` as `system:platform`.

**Changing visibility** (create body, or `PATCH` with `visibility`):

| Request | Outcome |
|---|---|
| create with `visibility` omitted | `private` |
| create or PATCH with a non-`private` value while the flag is OFF | `400 VALIDATION_ERROR` (`visibility 'x' is not available.`) |
| unknown `visibility` value | `400 VALIDATION_ERROR` |
| PATCH carrying `visibility` without `manage_access` on the list | `403 FORBIDDEN` (a `list-editor` can edit, but who may read is an access decision) |
| create or PATCH to `platform` by a caller who is not acting in the platform org, or lacks `publish_platform` there | `403 FORBIDDEN` (`Only a platform operator may publish a common list.`) |
| PATCH to `platform` on a list the platform org does not own | `403 FORBIDDEN` (`Only a list owned by the platform organization can be made a common list.`) |
| PATCH of a `platform` list to any other value | `409 CONFLICT`, `reason: "visibility_locked"` — **platform is one-way**: demotion would turn every tenant's stored ids into `missing`, so retire a common list by archiving it (archived items keep resolving) |
| PATCH to the value the list already has | no visibility change (no event) |
| promotion to `platform`, or rename of a common list, onto a key the platform org already holds | `409 CONFLICT` (`A common list with that key already exists.`) |

A change of visibility emits `selection-lists.visibility.changed`.

#### Reading shared lists

- **Default listing** (`GET /v1/selection-lists`, no `include_shared`) is the caller's own organization
  only, exactly the 4.0.0 set — still across every rendering of the org id, and still filtered per list.
- **`include_shared=true`** adds the lists readable through visibility: `org` lists of the caller's org
  (given `read_shared`) and the common lists. `include_shared` must be `true` or `false`, else
  `400` (only while the flag is ON; OFF ignores it).
- **Key shadowing.** A common list whose `key` the caller's organization already holds as an
  *active* list the caller can read (normally its fork) is omitted, so a picker sees each key once. A
  `private` fork shadows only for those who can read it. The `visibility` filter (`?visibility=`)
  turns shadowing off — an administrator's view of the list behind the fork.
- **The effective list for a key** is therefore: the caller org's own readable active list with that
  key, else the active `platform` list with that key, else nothing
  (`GET ?key=K&include_shared=true`; client helper `getEffectiveList(K)` / `get_effective_list(K)`).
- **`editable`** (present only while the flag is ON) is a caller-relative hint — one bulk
  `SelectionList:translate` check over the page — not an authorization. A list of another org is
  never `editable`. If the Security API cannot answer, the hint degrades to `false` rather than
  failing an authorized read; every mutation is still authorized on its own.

```ts
// The picker's key lookup: own org's readable list (e.g. its fork) first, else the common list.
const list = await client.getEffectiveList('priority')   // GET ?key=priority&include_shared=true&limit=1 (+ cursor, see below)
if (list && list.editable === false) {
  // read-only for this caller; for list.visibility === 'platform' offer "fork to edit"
}
// `editable === undefined` means "no hint" (see the note below) — not read-only.

// Everything readable — granted lists plus org/common lists (default is the 4.0.0 set).
for await (const l of client.paginate((p) => client.getLists({ ...p, include_shared: true }))) { /* … */ }
```

> **`getEffectiveList` may take more than one call (clients 2.2.0).** It requests `limit: 1`, and
> because the readability filter runs after pagination (see
> [Pagination](#a-page-can-be-shorter-than-limit--even-empty--and-still-not-be-the-last)) that
> single-row page can come back **empty with `hasMore: true`** when the first row in database order is
> one the caller cannot read — for example a newer `private` fork made by a colleague — while the
> effective list is on a later page of the same query. The client follows that cursor until it finds
> a row for the key or reaches the last page (then `null`), at most `MAX_EFFECTIVE_LOOKUP_PAGES` (10)
> pages. Exhausting the bound throws `EffectiveLookupIncompleteError` (Python:
> `EffectiveLookupIncompleteError`) — an *unknown* answer, never "no list"; a failed page throws the
> API error with no fallback; an aborted `signal` stops the walk (`AbortError`). 2.1.x read only the
> first page and could wrongly return `null`; on 2.1.x look the key up yourself and take the first
> item over all pages:
> `for await (const l of client.paginate((p) => client.getLists({ ...p, key, include_shared: true }))) { return l }`
> (at most one row per key is ever effective).

> **The four new response fields are still typed optional at 4.1.0.** `SelectionList.visibility`,
> `forked_from`, `editable` and `SelectionListItem.origin_item_id` are not in the spec's `required`
> lists, although the service now always emits `visibility`, `forked_from` and `origin_item_id`
> (and `editable` while the flag is ON). Keep reading absence as the 4.0.0 state:
> `visibility` absent = `private`, `forked_from` / `origin_item_id` absent = `null`, `editable`
> absent = **unknown** (no hint — behave as before and let the mutation's own authorization
> answer; never treat it as `false`). The Python client maps them to `PRIVATE` / `None` / `None` /
> `None`. A later MINOR is expected to tighten them to required.

#### One effective list per key (duplicate-key winner rule)

`(organization_id, key)` is unique per *stored string*, so lists created before the rendering-aware
rules could leave one org holding the same key under both its bare-UUID and `org_…` renderings. With
the flag ON, every consumer that answers "the list for this key" — the listing and its `?key=`
lookup, shadowing, the fork lookups and the resolve redirect — picks the **same** one:

1. an **active** row over an archived one;
2. the row stored under the caller's own claim exactly;
3. the oldest (`created_at`), then the smallest `id`

— applied among the rows **the caller can read**, so an unreadable private duplicate never hides a
readable one. New duplicates cannot be created (a create or rename is a `409` whichever rendering
the token carries), and the pre-enable audit and reconciliation queries are in
[`selection-lists-rollout.md`](../runbooks/selection-lists-rollout.md) section 10.1-10.2
(`src/services/sharedReads.ts` `pickWinner`, `readableWinners`).

#### Changing a common list: `409 fork_required`

A write to a `platform` list owned by another org is never allowed through visibility. The answer
depends on what the caller may do (`src/middleware/listAccess.ts` `requireListMutation`):

| Caller | Response |
|---|---|
| cannot read the list | `404 NOT_FOUND` (unchanged) |
| can read it and holds `SelectionListCatalog:create` | `409 CONFLICT` with `reason: "fork_required"`, `source_list_id` and a same-origin-relative `fork_url` (`/v1/selection-lists/{id}/fork`) |
| can read it, no `create` | `403 FORBIDDEN` |
| access-management route (`…/access`) | always `403` — a reader of a common list never sees its roster, and access is not forkable |
| the caller acts in the platform org and that org is **suspended** (below) | `403 FORBIDDEN`, body `reason: "platform_suspended"` |

This applies to every per-list mutation (list update/delete/archive, item create/update/reorder/
delete/archive, translation upsert/delete/autofill). Purging a common list or one of its items additionally
needs `publish_platform` (`403` otherwise) — it would turn stored ids in every tenant into `missing`.

```ts
try {
  await client.updateItem(common.id, itemId, { label: 'Urgent' })
} catch (e) {
  if (isSelectionListApiError(e) && e.isForkRequired) {
    const { list: fork, created } = await client.forkList(e.sourceListId!) // 201 new / 200 existing
    // fork.key === common.key, fork.forked_from.list_id === common.id, caller is list-owner;
    // items are copies with NEW ids; item.origin_item_id names the common item each came from.
  } else throw e
}
```

#### `POST /v1/selection-lists/{listId}/fork`

Authorization: `SelectionListCatalog:create` plus read on the source (`src/routes/fork.ts`). The body is
optional: `{ "visibility": "org" | "private" }` (default `org`); it carries no `id` and no `key`, and any
unknown property is a `400`.

| Status | When |
|---|---|
| `201` | new fork; the caller becomes `list-owner` on it (granted with the service's machine identity, as on create) |
| `200` | the org already holds a fork of this source (any status, any rendering of the org id) **and the caller can read it** — returned unchanged, nothing copied. Idempotent per (org, source), also under a race |
| `409` `reason: "fork_exists"` | the org already holds a fork the caller cannot read — ask its owner for a role |
| `409` `reason: "fork_not_applicable"` | the source belongs to the caller's own org — ask its owner for a role instead |
| `409` (no `reason`) | a **different** list of the org already uses the source's key |
| `400 VALIDATION_ERROR` | unknown/invalid body, or the source has more than **5000** non-purged items |
| `403 QUOTA_EXCEEDED` | `org_lists`, `user_lists`, `list_items`, `list_locales` or the archived-rows storage ceiling, checked exactly under the advisory lock |
| `403 FORBIDDEN` | no `SelectionListCatalog:create` |
| `404` | flag OFF; the source is unreadable, vanished, or is not a common list; or the platform org does not resolve |
| `500` | the fork was committed but the response could not be built — repeat the request, it returns the fork (`200`) |

What is copied: the list's translations and every **non-purged** item, active *and* archived (so stored
ids keep a mapping), each under a **new service-minted id** with `origin_item_id` = the source item id,
and every item translation with `is_machine` / `source_hash` preserved. The fork has `seed: null`,
`created_by` = the caller, and `forked_from {list_id, organization_id, revision, forked_at}` (the source
revision at copy time; never updated). It is one transaction; if the Security API grant succeeded but
a later step failed, the grant is taken back.

- The fork keeps the **same `key`**, so it shadows the common list for the forking org
  (`getEffectiveList` returns the fork); **archiving the fork reverts** to the common list.
- `visibility` of a fork is `org` (default — the org's version for every member) or `private` (a draft
  only grant-holders see; it shadows nothing for anyone else and never redirects stored values).
- A fork is a snapshot, not a sync: later edits to the common list do not reach it, and the service
  offers no merge.

#### Stored values and `POST /v1/resolve`

- Ids of a common list resolve in **every** org (any other org's ids stay `missing`, never a 403/404).
  While the flag is OFF common-list ids are `missing`, as in 4.0.0.
- If an id belongs to a common list P, and the caller's org holds an **active, `org`-visible** fork F of
  P with an item whose `origin_item_id` is that id, the result is the **fork item's** label, locale
  and status, and carries `effective_item_id` = the fork item's id. Rewrite stored values lazily; both ids
  keep resolving.
- A `private` fork, or an archived fork, never redirects. A fork item that was purged falls back to
  the common item. `effective_item_id` is absent (never `null`) when no redirect applied. The response
  body — hence its `ETag` — differs whenever a redirect applies, so a cached answer cannot hide a fork
  appearing or disappearing.

#### The platform organization

All common lists belong to **one** organization, named only by `SELECTION_LIST_PLATFORM_ORG_ID`
(`src/lib/sharedLists.ts`). There is deliberately no fallback to the org projection's `org_type`,
which a logged-in user can choose when creating an org.

- Unset, blank, or not yet **confirmed** by the org projection (an active, `is_active`, `platform`-typed
  row) → every platform feature fails closed: no common list is served, created, promoted, forked or
  resolved, and nothing else changes. A confirmation that arrives later enables them within about 5 s.
- Set to a string that is not a codec-valid `org_…` TypeID, or contradicted by the projection (deleted,
  deactivated, another type) → the service **refuses to start**.
- **Suspension, not deletion** (`src/events/platformGuard.ts`): the platform org owns every tenant's
  stored ids, so no lifecycle event may delete, archive or retype it. A deactivation
  (`identity.org.deleted`, or `org.created`/`org.updated` with `isActive: false`) records
  `suspended_at`; **reads stay available to every tenant** (lists, items, resolve, fork) and
  **writes fail closed** with `403` `reason: "platform_suspended"` — `publish_platform`, every
  mutation of a `platform` row, purge, and platform seeding — read fresh on every request and
  independent of the flag. A re-activation (`isActive: true`, type `platform`) clears it; a retype away from
  `platform` is refused. The gate follows the **owner** of the platform rows, not the variable, so
  removing the variable does not lift it. Operator steps:
  [`selection-lists-rollout.md`](../runbooks/selection-lists-rollout.md) section 10.3.

#### Seeding and events

- Seed lists may declare `visibility`: an app may use `private` or `org` (`platform` is refused with
  `VALIDATION_ERROR`); a platform pack may also declare `platform`, which is created as a common list
  only in the platform org and skipped for every other org. The declaration is honoured only while
  the flag is ON for the org, otherwise every list is seeded `private` (`src/seed/apply.ts`). The
  shipped pack declares none.
- `selection-lists.list.forked` (with the full source → fork `itemMap`) and
  `selection-lists.visibility.changed` are emitted through the outbox; snapshots always carry
  `visibility`, `forkedFrom` and `originItemId` — see [`SELECTION_LIST_EVENTS.md`](SELECTION_LIST_EVENTS.md).

#### Contract notes for integrators

- The service answers `403` with `reason: "platform_suspended"`; the spec's `ErrorReason` enum
  (`fork_required | fork_exists | fork_not_applicable | visibility_locked`) does not list it and says
  `reason` is only present on a `CONFLICT`. Treat an unknown `reason` as a plain `FORBIDDEN`, as the spec
  advises for unknown values.

#### Is a fork behind its source? (4.2.0)

Every list carries a read-only **`revision`** — the same per-list counter the Kafka events carry
as `listRevision`: `1` when the list is created, `+1` for every change event the service commits
about the list or anything inside it (list fields, status, visibility, items, item order,
translations — whether by a caller, seeding or autofill), never decreasing. Access-grant changes
do not move it. A fork's `forked_from.revision` is the source's revision **at copy time** and is
never updated, so one read of the source answers "has the common list changed since we forked?":

```ts
import { compareForkToSource } from '@fuzeone/selection-list-client'

const source = await client.getList(fork.forked_from!.list_id) // 404 → source gone; status 'archived' → source archived
switch (compareForkToSource(fork, source)) {
  case 'behind':     /* source.revision > fork.forked_from.revision — informational, no merge/sync exists */ break
  case 'up-to-date': /* equal */ break
  case 'unknown':    /* no revision on the source response yet — show "comparison unavailable" */ break
}
```

Python: `compare_fork_to_source(fork, source)` → `ForkSourceComparison.BEHIND` / `UP_TO_DATE` /
`UNKNOWN`.

- **`revision` is optional at 4.2.0** (the contract freezes before the service emits it).
  **Absent means unknown** — never infer a revision, or "behind", from `updated_at`.
- "Behind" means *changed since*, not that any particular item differs: a translation edit or an
  item reorder on the source counts.
- It is not a concurrency token: no request accepts it.

---

## Authorship and seed provenance

Since contract **4.0.0** (a MAJOR bump) two response shapes are no longer "always a user".

**`created_by` (lists, items) and `granted_by` (access grants) are an `AuthorPrincipal`** — one of
three disjoint forms, distinguishable from the string alone:

| Form | Example | Meaning |
|---|---|---|
| user id | `usr_01h455vb4pex5vsknk084sn02q` | a person; safe to look up as a user |
| system principal | `system:selection-list-service` | written by the service itself (seeding); pattern `^system:[a-z0-9-]+$` |
| deleted-user sentinel | `[deleted-user]` | the author was deleted and anonymized — **not an id** |

Never feed `created_by` into a user lookup or profile link without classifying it first. The
clients ship helpers (2.0.0):

```ts
import { authorPrincipalKind, isUserAuthor, DELETED_USER_SENTINEL } from '@fuzeone/selection-list-client'

authorPrincipalKind('usr_01h455vb4pex5vsknk084sn02q') // 'user'
authorPrincipalKind('system:selection-list-service')   // 'system'
authorPrincipalKind(DELETED_USER_SENTINEL)             // 'deleted-user'  ('[deleted-user]')
authorPrincipalKind('something-else')                  // 'unknown'

if (isUserAuthor(list.created_by)) {
  // only now is it a usr_ id you may resolve to a person
}
```

```python
from fuzefront_selection_list_client import author_principal_kind, is_user_author, AuthorPrincipalKind

kind = author_principal_kind(lst.created_by)   # AuthorPrincipalKind.USER | SYSTEM | DELETED_USER | UNKNOWN
if is_user_author(lst.created_by):
    ...  # only now is it a usr_ id
```

**`seed`** — every list and every item now carries a required, read-only, nullable `seed`
object: `null` on a user-authored row, and on a seeded one:

```jsonc
{ "source": "platform", "pack_key": "platform-defaults", "pack_version": 1, "user_modified": false }
```

`source` is the app slug (or `platform`). `user_modified` flips to `true` — permanently — once a
human edits the seeded content; seeding upgrades then leave the row alone. It is never accepted in a
request body: seeding happens only through the Kafka contract
([`SELECTION_LIST_EVENTS.md`](SELECTION_LIST_EVENTS.md)), never over HTTP. In the TS client it is
`SelectionList.seed` / `SelectionListItem.seed` (`SeedProvenance | null`); in Python
`SelectionList.seed` / `SelectionListItem.seed` (`SeedProvenance | None`).

---

## Events and the outbox

The service now publishes a Kafka event for every state change (lists, items, reorders,
translations, access grants, and — since 4.1.0 — forks and visibility changes:
`selection-lists.list.forked`, `selection-lists.visibility.changed`) and consumes
`identity.org.created`, `identity.org.updated`, `identity.org.deleted`, `identity.user.deleted` and
`selection-lists.seed.requested`. Full contract, delivery
semantics and the app-seeding walkthrough: [`SELECTION_LIST_EVENTS.md`](SELECTION_LIST_EVENTS.md).
What an integrator needs to know here:

- **Transactional outbox.** Each mutating route writes its events into the `event_outbox` table in
  the same database transaction as the change; a background relay publishes them to Kafka, strictly
  in commit order **per organization**, at-least-once (dedupe on `eventId`). A change that rolled
  back publishes nothing; a Kafka outage delays events but does not lose them.
- **The relay only runs when the service has `KAFKA_BROKERS` set.** Events otherwise wait in the
  table.
- **Failure handling:** 10 failed publish attempts (or a schema-invalid payload) *parks* the event:
  it is copied to `<topic>.dlq` and marked `failed`; the org then continues with later events, so a
  consumer sees a `listRevision` gap and should refetch over HTTP.
- **Seeding is flag-gated; publishing is not.** Seeding needs both flags ON (see
  [Feature flag](#feature-flag)); change events are emitted regardless.
- Seeding is **not live** until both flags are ON for the org and an app's source is on the
  allowlist; the shipped allowlist contains only the internal `platform` source.

---

## Quota

The service enforces four quota scopes per organization.  Call `getQuota`
before a create to warn the user **before** they hit a `403 QUOTA_EXCEEDED`,
rather than surfacing the refusal as a surprise:

```ts
const quota = await client.getQuota()

for (const q of quota.quotas) {
  // q.scope   — 'org_lists' | 'user_lists' | 'list_items' | 'list_locales'
  // q.current — current usage
  // q.limit   — ceiling (-1 means unlimited)
  if (q.limit !== -1 && q.current >= q.limit) {
    showWarning(`${q.scope} quota full: ${q.current}/${q.limit}`)
  }
}
```

What each scope is, and where it is enforced (all four are **enforced**, not just reported):

| Scope | Default | Counts | Refused on |
|---|---|---|---|
| `org_lists` | 100 | active lists in the org | create a list; **un-archive** a list (`PATCH {status:"active"}`) |
| `user_lists` | 20 | active lists the **caller** created in the org (seeded `system:*` lists and `[deleted-user]` lists are not a user's) | create a list; un-archive a list the user authored |
| `list_items` | 500 | active items in the list | create an item; un-archive an item |
| `list_locales` | 11 | distinct locales with a list-level translation, **source locale included** | `PUT .../translations/{locale}` or an autofill into a locale the list does not have yet; a `PATCH` that writes a new source-locale row. Updating a locale the list already has is never refused. |

A per-org override row in `selection_list_org_quota` wins over the default. Creates are exact:
the check runs inside the create transaction under an advisory lock, so N parallel creates at the
ceiling admit exactly `ceiling - current`.

**Archived rows count toward a hard storage ceiling.** Archiving is not deleting, so a loop of
archive + create would otherwise grow the tables without bound while the active counts never move.
Every stored row, archived or not, counts toward `active limit x SELECTION_LISTS_STORAGE_CEILING_FACTOR`
(an env var on the service; a positive integer; **default 10**, so a default org may *store* 1000
lists and a default list 5000 items; an invalid value falls back to 10 and never disables the
ceiling). A refusal has the **same wire shape** as any other (`403 QUOTA_EXCEEDED`, `scope`
`org_lists` or `list_items`, `limit` = the ceiling, `current` = rows stored) and its `message` says
archived rows count; **purging** archived lists/items frees the space.

There is also an **ingress rate limit** (per client IP) on `/api/v1/resolve` and on
`/api/v1/selection-lists` (Helm `selectionListService.ingress.rateLimit.*`; defaults 100 rps and 30
rps with a 4x burst; excess requests get `429` from the ingress, not from the service). It cannot
tell reads from writes on the CRUD path, so it is an abuse bound, not a meter.

When you do hit the ceiling:

```ts
try {
  await client.createList({ key: 'new-list', name: 'New list', source_locale: 'en' })
} catch (e) {
  if (isSelectionListApiError(e) && e.isQuotaExceeded) {
    // e.scope   — which ceiling was hit
    // e.limit   — the ceiling value
    // e.current — usage at the time of refusal
    showError(`Cannot create: ${e.scope} quota exhausted (${e.current}/${e.limit})`)
  }
}
```

---

## Error handling

Every non-2xx response throws a `SelectionListApiError`.  Branch on `code`,
not on `status` — the code is the machine-readable contract; the status tells
caches and proxies how to behave.  `message` is human-facing and may change
without a version bump.

```ts
import { isSelectionListApiError } from '@fuzeone/selection-list-client'

try {
  await client.createItem(list.id, { label: 'New item', code: 'NI' })
} catch (e) {
  if (!isSelectionListApiError(e)) throw e  // re-throw non-API errors

  switch (e.code) {
    case 'QUOTA_EXCEEDED':
      // e.scope / e.limit / e.current
      showQuotaError(e)
      break

    case 'CONFLICT':
      // Duplicate key/code, or demoting the last list-owner
      showError('An item with that code already exists in this list.')
      break

    case 'VALIDATION_ERROR':
      // e.details: Array<{ field, message }> for field-level problems
      for (const detail of e.details ?? []) {
        markFieldInvalid(detail.field, detail.message)
      }
      break

    case 'NOT_FOUND':
      // Resource absent *or* not visible to this caller — the service conflates
      // the two intentionally.  Do not report "deleted" on the strength of this.
      showError('List not found.')
      break

    case 'UNAUTHENTICATED':
      redirectToLogin()
      break

    case 'FORBIDDEN':
      showError('You do not have permission for this action.')
      break

    case 'UNKNOWN':
      // Non-contract response: 502, proxy timeout, HTML error page.
      // Do not map onto a contract code — it would send recovery down the wrong path.
      logAndAlert(e)
      break

    default:
      logAndAlert(e)
  }
}
```

### Convenience getters

```ts
e.isQuotaExceeded  // code === 'QUOTA_EXCEEDED'
e.isNotFound       // code === 'NOT_FOUND'
e.isConflict       // code === 'CONFLICT'
e.isForkRequired   // code === 'CONFLICT' && reason === 'fork_required' (4.1.0)
e.reason           // CONFLICT refinement: fork_required | fork_exists | fork_not_applicable | visibility_locked
e.sourceListId     // with fork_required: the common list to fork
e.forkUrl          // with fork_required: same-origin-relative path of the fork operation
```

`CONFLICT` has several meanings; branch on `reason` before assuming "duplicate key":

| `reason` | Meaning | What to do |
|---|---|---|
| `fork_required` | you tried to change a common list you hold no role on | `forkList(e.sourceListId)`, then edit the fork |
| `fork_exists` | your org already forked this list and you cannot read the fork | ask its owner for a role |
| `fork_not_applicable` | you tried to fork a list of your own org | ask its owner for a role |
| `visibility_locked` | a `platform` list cannot be given another visibility | archive it instead |
| *(absent)* | duplicate list `key` / item `code`, last-`list-owner` guard, fork key already used by a different list | as in 4.0.0 |

An unknown `reason` is a plain `CONFLICT`. A suspended platform org answers `403 FORBIDDEN` with
`reason: "platform_suspended"` — outside the spec's enum, see
[Contract notes for integrators](#contract-notes-for-integrators).

### Narrowing in `catch`

```ts
catch (e) {
  if (isSelectionListApiError(e)) {
    // TypeScript knows e is SelectionListApiError here
  }
}
```

---

## Key invariants

| Invariant | Why |
|---|---|
| Persist `item.id`, never `item.code` | `code` is an interop key; `id` is the stable FK |
| `code` is immutable after create | Changing it would break external integrations keyed on it |
| Archive before purge | Archived IDs still resolve; purged IDs break every consumer row |
| Chunk `resolveIds` at ≤ 500 IDs | The cap is enforced server-side; chunk at the call site so it stays visible |
| `baseUrl` is always same-origin in the browser | Hard-coded absolute hosts break under TLS ingress (mixed-content) |
| Check `getQuota` before creates | Surfaces the ceiling before the 403, not as a surprise |
| Gate on `fuzefront.selection-lists.service` flag | Service availability is flag-controlled |
| Classify `created_by` / `granted_by` before treating it as a user | It may be `system:*` or `[deleted-user]` (4.0.0) |
| Tenant roles never confer per-list actions; no implicit admin ownership | An admin must self-grant `list-owner` (audited) to administer a list it does not own |
| Seeding needs BOTH flags and an allowlisted source | Otherwise `SEEDING_DISABLED` / `SOURCE_NOT_ALLOWED`; nothing is written |
| Follow `page.nextCursor` until `hasMore` is false; never stop on a short or empty page | The readability filter runs after pagination, so a page can hold fewer than `limit` rows (or none) and still not be the last |
| Absent `visibility` / `forked_from` / `origin_item_id` mean `private` / `null` / `null`; absent `editable` means unknown, never `false` | The 4.1.0 fields are typed optional; `editable` is only emitted while the shared-lists flag is ON |
| A `platform` list is one-way and read-only for tenants: fork it, or archive it (operators) | Demotion would break every tenant's stored ids; writes answer `409 fork_required` / `403` |
| Gate shared-list UI on `fuzefront.selection-lists.shared-lists` as well as the master flag | Both must be ON; the flag is rollout only, real authorization stays in Permit |

---

## Interactive API docs

The selection-list-service serves Swagger UI at `/docs` when running locally.
All endpoints are exercisable from the browser with a Bearer token:

```
http://localhost:3008/docs
```

In the cluster (via port-forward):

```bash
kubectl port-forward svc/fuzefront-selection-list-service 3008:3008 -n fuzefront
# Then open http://localhost:3008/docs
```
