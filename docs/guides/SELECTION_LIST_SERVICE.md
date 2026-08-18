# Selection List Service — Consumer Integration Guide

How a consuming application stores, renders, and manages reference data
(`countries`, `industries`, `ticket-priorities`, …) using the FuzeFront
**selection-list-service** and its TypeScript client
`@fuzeone/selection-list-client`.

The service contract lives at
`services/selection-list-service/openapi.yaml` (v1.0.0). This guide is a
companion, not a replacement — the spec is the source of truth for any
discrepancy.

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
10. [Quota](#quota)
11. [Error handling](#error-handling)
12. [Key invariants](#key-invariants)
13. [Interactive API docs](#interactive-api-docs)

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

The `@fuzeone` scope is not yet published to npm (tracked on FFRNT-266).
Until the registry publish lands, install from a local build:

```bash
# In the selection-list-client workspace
cd selection-list-client
npm install
npm run build
npm pack
# → fuzeone-selection-list-client-1.0.0.tgz

# In your consuming package
npm install /path/to/fuzefront/selection-list-client/fuzeone-selection-list-client-1.0.0.tgz
```

**Python client** (tracked on the same FFRNT-266 milestone) is in
`packages/selection-list-client-py/` and follows the same pack-and-install
pattern until PyPI publication.

---

## Create the client

```ts
import { SelectionListClient } from '@fuzeone/selection-list-client'

// Browser: baseUrl MUST be a same-origin path — never an absolute host.
// Absolute hosts break under TLS ingress and trigger mixed-content blocks.
const client = new SelectionListClient({
  baseUrl: '/api/selection-lists',
  token: () => getJwt(),          // function so short-lived tokens refresh
  defaultLocale: 'en',            // optional; per-call locale always wins
})
```

### Options

| Option | Type | Required | Notes |
|---|---|---|---|
| `baseUrl` | `string` | Yes | Same-origin path in the browser; absolute URL in server-side callers |
| `token` | `string \| () => string \| Promise<string>` | No | `resolveIds` may be called unauthenticated by trusted in-cluster callers |
| `fetch` | `typeof fetch` | No | Inject for tests or non-global runtimes; defaults to `globalThis.fetch` |
| `defaultLocale` | `Locale` | No | Applied to every request that doesn't supply its own |
| `headers` | `Record<string, string>` | No | Merged into every request (tracing IDs, tenant hints) |

### Server-side (Node / service-to-service)

```ts
const client = new SelectionListClient({
  baseUrl: 'http://fuzefront-selection-list-service:3011',
  token: process.env.SELECTION_LIST_SERVICE_TOKEN,
  fetch,   // node-fetch or native fetch (Node 24+)
})
```

---

## Feature flag

The service is gated behind `fuzefront.selection-lists.service`.  Check it
before initializing the client or rendering any selection-list UI:

```ts
import { featureFlags, FLAGS } from '@fuzefront/feature-flags'

if (await featureFlags.isEnabled(FLAGS.SELECTION_LISTS_SERVICE)) {
  // show UI, initialize client
}
```

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
// list.id  — the service-minted TypeID, e.g. 'sl_01h455vb4pex5vsknk084sn02q'
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

Grants are ReBAC resource-instance roles — the creator is automatically
assigned `list-owner`.

### Roles and permissions

| Role | read | add item | update item | remove item | translate | update list | delete list | manage access |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| `list-owner` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `list-editor` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | |
| `list-contributor` | ✓ | ✓ | ✓ | | ✓ | | | |
| `list-translator` | ✓ | | | | ✓ | | | |
| `list-viewer` | ✓ | | | | | | | |

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

> **Important:** an `id` is never a capability.  Knowing a list's `id` grants
> nothing — every route re-checks the caller against Permit.  A resource the
> caller cannot read returns `404`, not `403`, so the API is not a cross-org
> existence oracle.

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
```

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

---

## Interactive API docs

The selection-list-service serves Swagger UI at `/docs` when running locally.
All endpoints are exercisable from the browser with a Bearer token:

```
http://localhost:3011/docs
```

In the cluster (via port-forward):

```bash
kubectl port-forward svc/fuzefront-selection-list-service 3011:3011 -n fuzefront
# Then open http://localhost:3011/docs
```
