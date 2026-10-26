# @fuzeone/selection-list-client

Typed client for the FuzeFront **selection-list-service**. Zero runtime dependencies; uses the platform `fetch`.

Derived from the frozen contract at [`services/selection-list-service/openapi.yaml`](../services/selection-list-service/openapi.yaml) **v4.2.0**. The spec wins any disagreement.

```ts
import { SelectionListClient, isSelectionListApiError } from '@fuzeone/selection-list-client'

// In the browser, baseUrl MUST be same-origin — never an absolute host. Paths already include
// /v1/..., so baseUrl is the prefix before /v1: '/api' => /api/v1/selection-lists.
const client = new SelectionListClient({ baseUrl: '/api', token: () => getJwt() })

const { items } = await client.getItems(listId, { status: 'active', locale: 'fr' })

// Persist item.id — never item.code, which is an interop key, not a foreign key.
const { results, missing } = await client.resolveIds(['front_sli_01h4…'], { locale: 'fr' })
results['front_sli_01h4…']?.label // 'États-Unis'

// Walk a cursor without hand-rolling the loop.
for await (const item of client.paginate((p) => client.getItems(listId, p))) { /* … */ }

try {
  await client.createList({ key: 'countries', name: 'Countries' })
} catch (e) {
  if (isSelectionListApiError(e) && e.isQuotaExceeded) {
    // e.scope / e.limit / e.current name the ceiling that was hit.
  }
}
```

## Authorship fields are not always users (2.0.0)

`created_by` (lists, items) and `granted_by` (access grants) are an
`AuthorPrincipal`: a `usr_` user id, a `system:<service>` principal (rows written
by seeding carry `system:selection-list-service`), or the literal
`DELETED_USER_SENTINEL` (`'[deleted-user]'`, after the author was deleted). Branch
before treating one as a user:

```ts
import { authorPrincipalKind, isUserAuthor } from '@fuzeone/selection-list-client'

if (isUserAuthor(list.created_by)) showProfileLink(list.created_by)
else if (authorPrincipalKind(list.created_by) === 'system') render('Seeded')
else render('Deleted user')
```

Lists and items also carry a read-only `seed` (`SeedProvenance` or `null`):
`source`, `pack_key`, `pack_version`, `user_modified`. It is `null` for every
user-authored row.

## Shared and common lists, forks (2.1.0, contract 4.1.0)

Lists carry `visibility` (`private` / `org` / `platform`), `forked_from` and a
caller-relative `editable` hint; items carry `origin_item_id`. `org` lists are
pickable by every member of their org and `platform` lists are common lists
pickable by every org — read-only without an instance role. The service
implements this behind the default-OFF flag
`fuzefront.selection-lists.shared-lists` (see
`docs/planning/selection-lists-shared-and-fork.md`).

All four fields are **optional** in the 4.1.0 types (`visibility?`,
`forked_from?`, `editable?`, `origin_item_id?`) because the running service
omits `editable` while `fuzefront.selection-lists.shared-lists` is OFF (and a
pre-4.1.0 service omits all four).
Absent means the 4.0.0 state: `visibility` = `'private'`, `forked_from` /
`origin_item_id` = `null`, `editable` = unknown (test `editable === false`, never
`!editable`). A later contract MINOR tightens them to required.

```ts
const list = await client.getEffectiveList('priority') // own org's list/fork first, else the common list
try {
  await client.updateList(list!.id, { name: 'Urgency' })
} catch (e) {
  if (isSelectionListApiError(e) && e.isForkRequired) {
    const { list: fork } = await client.forkList(e.sourceListId!) // same key; items keep origin_item_id
    await client.updateList(fork.id, { name: 'Urgency' })
  } else throw e
}
```

`getLists({ include_shared: true })` adds lists readable through visibility
(the default is unchanged). `resolveIds` resolves common-list ids in every org
and, where the org holds an `org`-visible fork, answers from the fork item with
`effective_item_id` set.

## Is a fork behind its source? (2.2.0, contract 4.2.0)

Lists carry a read-only `revision` — the per-list counter the events carry as
`listRevision` (`1` at creation, `+1` per committed change event about the list
or anything inside it, never decreasing). A fork's `forked_from.revision` is the
source's revision at copy time. `compareForkToSource(fork, source)` compares
them: `'behind'` / `'up-to-date'` / `'unknown'`.

```ts
const source = await client.getList(fork.forked_from!.list_id)
const state = compareForkToSource(fork, source) // never looks at updated_at
```

`revision?` is **optional** at 4.2.0: the service does not emit it until its
implementation ships, and **absent means unknown** (`'unknown'` → show
"comparison unavailable"). Archived (`status`) and gone (`404`) sources are
yours to render; the helper answers only the revision question.

## Install

`selection-list-client` is a root `package.json` workspace, so `packages-publish`
publishes it whenever its version changes. GitHub Packages requires the owner's
scope, so it is published as **`@izzywdev/fuzeone-selection-list-client`** (the
source tree keeps the canonical `@fuzeone/selection-list-client`; the rename is
`scripts/publish-packages.mjs`'s scope alias). To try an unpublished build:

```bash
cd selection-list-client && npm install && npm run build && npm pack
npm install /path/to/fuzeone-selection-list-client-<version>.tgz
```

## Scripts

`npm run build` (tsup, dual ESM+CJS+d.ts) · `npm run type-check` (`tsc --noEmit`, strict) · `npm run lint:contract` (Spectral against the spec).
