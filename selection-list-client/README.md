# @fuzeone/selection-list-client

Typed client for the FuzeFront **selection-list-service**. Zero runtime dependencies; uses the platform `fetch`.

Derived from the frozen contract at [`services/selection-list-service/openapi.yaml`](../services/selection-list-service/openapi.yaml) **v4.0.0**. The spec wins any disagreement.

```ts
import { SelectionListClient, isSelectionListApiError } from '@fuzeone/selection-list-client'

// In the browser, baseUrl MUST be same-origin — never an absolute host.
const client = new SelectionListClient({ baseUrl: '/api/selection-lists', token: () => getJwt() })

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

## Install locally (pre-publish)

The `@fuzeone` scope IS published now — but only for packages that are root
workspaces. `@fuzeone/selection-lists-ui` is live as
`@izzywdev/fuzeone-selection-lists-ui@0.1.0`; **this** package is not, because
`selection-list-client` is missing from the root `package.json` `workspaces`
array, which is the one list `scripts/publish-packages.mjs` reads. No workspace
entry means no matrix leg, so `packages-publish` never attempts it and stays
green regardless. Until it is added:

```bash
cd selection-list-client && npm install && npm run build && npm pack
npm install /path/to/fuzeone-selection-list-client-1.0.0.tgz
```

## Scripts

`npm run build` (tsup, dual ESM+CJS+d.ts) · `npm run type-check` (`tsc --noEmit`, strict) · `npm run lint:contract` (Spectral against the spec).
