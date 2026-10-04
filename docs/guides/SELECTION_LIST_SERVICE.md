# Selection List Service — Consumer Integration Guide

How a consuming application stores, renders, and manages reference data
(`countries`, `industries`, `ticket-priorities`, …) using the FuzeFront
**selection-list-service** and its TypeScript client
`@fuzeone/selection-list-client`.

The service contract lives at
`services/selection-list-service/openapi.yaml` (**v4.0.0**). This guide is a
companion, not a replacement — the spec is the source of truth for any
discrepancy. Matching clients: `@fuzeone/selection-list-client` **2.0.0** and
`fuzefront-selection-list-client` (Python) **2.0.0**. Kafka events and app
seeding are covered in [`SELECTION_LIST_EVENTS.md`](SELECTION_LIST_EVENTS.md);
how seeding is enabled safely is in
[`docs/runbooks/selection-lists-seeding-operations.md`](../runbooks/selection-lists-seeding-operations.md).

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

### TypeScript client — genuinely not published yet, and here is why

`@fuzeone/selection-list-client` is **not** in the registry
(`users/izzywdev/packages/npm/fuzeone-selection-list-client` → 404). The cause
is not `publishConfig` — that is already correct in
`selection-list-client/package.json`. It is that `selection-list-client` is
**absent from the root `package.json` `workspaces` array**, and `workspaces` is
the single source of truth `publish-packages.mjs` reads: a directory that is
not a workspace produces no matrix leg, so `packages-publish` never tries to
publish it and goes green anyway. `api-client/` and `sdk/` had exactly this
defect until they were added as workspaces. Adding `selection-list-client` (and
`packages/selection-list-client-py` for the Python side) to `workspaces` is the
whole fix.

Until then, install from a local build:

```bash
# In the selection-list-client directory
cd selection-list-client
npm install
npm run build
npm pack
# → fuzeone-selection-list-client-2.0.0.tgz

# In your consuming package
npm install /path/to/fuzefront/selection-list-client/fuzeone-selection-list-client-2.0.0.tgz
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
| `token` | `string \| () => string \| Promise<string>` | Yes (all calls) | Bearer token with an `orgId` claim. `resolveIds` also requires it |
| `fetch` | `typeof fetch` | No | Inject for tests or non-global runtimes; defaults to `globalThis.fetch` |
| `defaultLocale` | `Locale` | No | Applied to every request that doesn't supply its own |
| `headers` | `Record<string, string>` | No | Merged into every request (tracing IDs, tenant hints) |

### Server-side (Node / service-to-service)

```ts
const client = new SelectionListClient({
  baseUrl: 'http://fuzefront-selection-list-service:3008',
  token: process.env.SELECTION_LIST_SERVICE_TOKEN,
  fetch,   // node-fetch or native fetch (Node 24+)
})
```

The in-cluster Service port is `selectionListService.port` in the Helm values (**3008**);
`3011` is only the process default for local runs (`PORT` unset).

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
consumers (platform defaults on `identity.org.created`, and app `selection-lists.seed.requested`).
Seeding needs **both** flags ON for the organization; either OFF means nothing is seeded
(app requests are answered `seed.failed` / `SEEDING_DISABLED`). Publishing of change events is
**not** behind either seeding flag. Both flags are OFF everywhere today and fail closed (no flag
client or an evaluation error reads as OFF).

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

Authorization is decided by FuzeFront's Security API (Permit-backed), never by this service's
database and never by a feature flag. The contract splits it across **two resource types** that
answer different questions — they must not be confused (spec 3.0.0+, review H-3):

### 1. The catalog — tenant-level (`SelectionListCatalog`)

"May this caller work with selection lists in this org at all?" Keyless (the tenant is the
caller's organization), granted through **tenant roles**:

| tenant role | `list` | `create` | `read_quota` | `resolve` |
|---|:---:|:---:|:---:|:---:|
| `admin` | ✓ | ✓ | ✓ | ✓ |
| `editor` | ✓ | ✓ | | ✓ |
| `viewer` | ✓ | | | ✓ |
| `developer` | | | | |

| Operation | Checked against | Action |
|---|---|---|
| `GET /v1/selection-lists` | `SelectionListCatalog` | `list` |
| `POST /v1/selection-lists` | `SelectionListCatalog` | `create` |
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
  list** by `SelectionList:read`: a caller sees only lists it holds an instance role on. A caller
  with none gets an empty page, not a `403`.
- **Creating** needs `SelectionListCatalog:create`. The service then grants the creator
  `list-owner` on the new list **with its own machine identity**.
- Two actions are stricter than the table suggests: **purging an item**
  (`DELETE .../items/{itemId}?purge=true`) additionally needs `delete` on the list, so only a
  `list-owner` can purge (a `list-editor` can archive an item but gets `403` on purge); and
  **archiving a list via `PATCH` `status: "archived"`** needs `update` **and** the same `delete` as
  `POST .../archive` — a `list-editor` can no longer archive through PATCH (4.0.0).
- **`POST /v1/resolve`** needs only the catalog `resolve` action; it does **not** check
  `SelectionList:read` on each id's list (accepted trade-off: it returns a label, a locale and a
  status only).

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
`seed.requested` pack) are written by the system principal and **no `list-owner` (or any other)
grant is created for them**. Because every per-list action is instance-only, the consequence on
today's code is:

- members — including tenant admins — **do not see seeded lists** in `GET /v1/selection-lists`
  and get `404` on `GET /v1/selection-lists/{listId}` until a role is granted on that list;
- the list id is not discoverable through the list endpoint either, so an admin takes it from the
  `selection-lists.seed.completed` event (`lists[].listId`) or from an operator;
- once an admin has self-granted `list-owner` (above) the list behaves like any other, and its
  items and translations can be edited — which marks it `seed.user_modified: true` and stops
  further seeding upgrades from touching it;
- `POST /v1/resolve` still resolves seeded item ids for any caller holding the catalog `resolve`
  action, because it does not check per-list read.

This is a **known gap and an open design question** (grant an owner at seed time? derive admin
ownership? — owner decision), recorded in the seeding runbook. It is why seeding should not be
switched on for an org that expects its members to use the seeded lists immediately.

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
translations, access grants) and consumes `identity.org.created`, `identity.org.deleted`,
`identity.user.deleted` and `selection-lists.seed.requested`. Full contract, delivery
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
| Classify `created_by` / `granted_by` before treating it as a user | It may be `system:*` or `[deleted-user]` (4.0.0) |
| Tenant roles never confer per-list actions; no implicit admin ownership | An admin must self-grant `list-owner` (audited) to administer a list it does not own |
| Seeding needs BOTH flags and an allowlisted source | Otherwise `SEEDING_DISABLED` / `SOURCE_NOT_ALLOWED`; nothing is written |

---

## Interactive API docs

The selection-list-service serves Swagger UI at `/docs` when running locally.
All endpoints are exercisable from the browser with a Bearer token:

```
http://localhost:3011/docs
```

In the cluster (via port-forward):

```bash
kubectl port-forward svc/fuzefront-selection-list-service 3011:3008 -n fuzefront
# Then open http://localhost:3011/docs
```
