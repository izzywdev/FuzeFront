# @fuzeone/selection-list-client

Typed client for the FuzeFront **selection-list-service**. Zero runtime dependencies; uses the platform `fetch`.

Derived from the frozen contract at [`services/selection-list-service/openapi.yaml`](../services/selection-list-service/openapi.yaml) **v4.1.0**. The spec wins any disagreement.

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
implements all of it (design record:
`docs/planning/selection-lists-shared-and-fork.md`), **dark behind the release
flag `fuzefront.selection-lists.shared-lists`** (default OFF; it also needs
`fuzefront.selection-lists.service`). While the flag is OFF `include_shared` /
`visibility` are ignored, `forkList` answers `404`, a non-`private` `visibility`
on create/PATCH is a `400`, and every list reads `visibility: 'private'`,
`forked_from: null`, items `origin_item_id: null`, with no `editable`. The
shared-lists UI is not built yet.

All four fields are still typed **optional** in the 4.1.0 types (`visibility?`,
`forked_from?`, `editable?`, `origin_item_id?`) because the spec types them
optional (the service always emits the first, second and fourth, and `editable`
while the flag is ON). Absent means the 4.0.0 state: `visibility` = `'private'`, `forked_from` /
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
(the default is unchanged).

**Pages can be shorter than `limit`, even empty, and still not be the last.**
The service filters unreadable lists *after* it paginates, so follow
`page.nextCursor` until `page.hasMore` is `false` (`paginate()` does) and never
stop on a short or empty page. `getEffectiveList` asks for `limit: 1` and
therefore returns `null` when the first row in database order for the key is
one the caller cannot read (for example a colleague's `private` fork) although
the common list is on the next page; until it follows the cursor, look the key
up with `paginate((p) => client.getLists({ ...p, key, include_shared: true }))`
and take the first item.

`forkList` answers `201` (`created: true`) or `200` (the org already holds a
fork you can read); a fork you cannot read is `409` `reason: 'fork_exists'`,
your own org's list is `409` `reason: 'fork_not_applicable'`, a key already used
by a different list is a plain `409`, over 5000 items is `400`, and quota is
`403` `QUOTA_EXCEEDED`. A `platform` list is never demoted: `409`
`reason: 'visibility_locked'`. `resolveIds` resolves common-list ids in every org
and, where the org holds an `org`-visible fork, answers from the fork item with
`effective_item_id` set.

## Install

`selection-list-client` is a root `package.json` `workspaces` entry, which is the
one list `scripts/publish-packages.mjs` reads, so `packages-publish.yml` builds
and publishes it to GitHub Packages as
`@izzywdev/fuzeone-selection-list-client` (the owner-scope alias of this
canonical name) on a version bump merged to `master`. Whether a given version is
in the registry is not something this repo can show; check it with
`gh api users/izzywdev/packages/npm/fuzeone-selection-list-client/versions --jq '[.[].name]'`.
Inside this repo no mapping is needed (it links from the tree). To test an
unpublished build:

```bash
cd selection-list-client && npm install && npm run build && npm pack
npm install /path/to/fuzeone-selection-list-client-2.1.1.tgz
```

See `docs/guides/SELECTION_LIST_SERVICE.md` for the registry `.npmrc` and the
alias.

## Scripts

`npm run build` (tsup, dual ESM+CJS+d.ts) · `npm run type-check` (`tsc --noEmit`, strict) · `npm run lint:contract` (Spectral against the spec).
