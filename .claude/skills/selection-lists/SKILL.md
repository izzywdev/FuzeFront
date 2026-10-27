---
name: selection-lists
description: Use when building on, calling, extending, testing, or documenting the FuzeFront selection-lists feature (FF-EPIC-17) — org-scoped, translatable reference-data lists (countries, industries, ticket priorities) served by `selection-list-service`. Covers the domain model (list / item / translation / access grant / quota, list visibility and forks), the 25-operation contract and its frozen-spec rule, calling it from `@fuzeone/selection-list-client` (TS) and `fuzefront-selection-list-client` (Python), embedding the picker from `@fuzeone/selection-lists-ui`, the id/authz rules (service mints ids; an id is never a capability), the authz catalog-vs-per-list split (no implicit admin ownership), authorship/seed provenance (`created_by`, `seed`), the Kafka outbox/events and app/platform seeding (allowlist, attestation, flags), the three flags (`fuzefront.selection-lists.service`, `fuzefront.selection-lists.seed-defaults`, `fuzefront.selection-lists.shared-lists`; all default OFF), where each test layer lives, and the known code-vs-contract gaps. Owned by docs-maintainer; claims verified against source at the commit noted below.
---

# selection-lists

A **selection list** is a named, **org-scoped**, ordered set of **translatable** choices (`countries`, `ticket-priorities`) that consuming apps render in dropdowns and persist **by item id**. `selection-list-service` owns exactly three things: list/item structure, per-locale translations of both, and per-list access grants.

**Verified against** `origin/master` @ `0e70bcee` (2026-10-04), with the SL9 (contract 4.1.0), deployment-state, flag, client, MCP and gap-list sections re-verified against `origin/master` @ `bac173471` (2026-10-26). Everything below is read from code unless marked **(inferred)** or **(gap)**; live Unleash/Permit/Kafka/registry state is **not** readable from the repo and is never asserted. If the spec and any other file disagree, **the spec wins** (`services/selection-list-service/openapi.yaml`, **v4.2.0**, FROZEN — FFRNT-187).

**Contract 4.1.0 (2026-10-05) is implemented in the service and ships dark.** Shared lists (`visibility`), common (`platform`) lists, copy-on-write forks (`forkSelectionList`), `read_shared`/`publish_platform`, the events `selection-lists.list.forked` / `selection-lists.visibility.changed`, seed-list `visibility`, key shadowing/`include_shared`, `editable` and the resolve fork redirect are all merged in `selection-list-service`, the spec, both clients (2.1.x onward), `@fuzefront/shared` 1.3.0 and the Permit schema. **Everything user-visible is behind the release flag `fuzefront.selection-lists.shared-lists` (default OFF; requires the master flag).** What is **not** built: the shared-lists UI (frames approved, `packages/selection-lists-ui/src/shared-lists/` absent; PRs were open on 2026-10-26), the service side of `SelectionList.revision` (see 4.2.0 below), the rollout data jobs and a platform pack v2. Behaviour, status codes and the "dark / needs flags / not built" table: `docs/guides/SELECTION_LIST_SERVICE.md` § "Shared lists, common lists and forks". Design record: `docs/planning/selection-lists-shared-and-fork.md`.

**Contract 4.2.0** (`SelectionList.revision`, the fork "behind source" comparison) is **ahead of the service**: frozen in the spec and both clients (2.2.0), not yet emitted — see the gap below. Design record §13.

## Where things live

| Thing | Path | Package / name |
|---|---|---|
| Frozen contract (25 operations) | `services/selection-list-service/openapi.yaml` | — |
| Service (Express + Knex/Postgres, port `PORT` default **3008**, matching the chart) | `services/selection-list-service/` | `selection-list-service` (root workspace) |
| TS client (hand-authored, zero deps) | `selection-list-client/` (**repo root, not `packages/`**; a root `package.json` `workspaces` entry) | `@fuzeone/selection-list-client` **2.2.0** (published as `@izzywdev/fuzeone-selection-list-client`) |
| Python client (stdlib `urllib`, zero deps) | `packages/selection-list-client-py/` | `fuzefront-selection-list-client` **2.2.0** |
| Event schemas (source of truth for Kafka) | `shared/src/kafka/schemas/selection-lists.*.ts` | `@fuzefront/shared` ≥ 1.1.0 (`/kafka`); 1.3.0 for the 4.1.0 topics |
| Event emitters / outbox / consumers | `services/selection-list-service/src/events/` | — |
| Seeding (algorithm, packs, allowlist, flag gate) | `services/selection-list-service/src/seed/`, `seed-packs/platform/*.json`, `seed-sources.json` | — |
| UI (4 flows + picker; no shared-lists UI yet) | `packages/selection-lists-ui/` | `@fuzeone/selection-lists-ui` 0.3.0 |
| Approved design frames (18 screens incl. mobile) | `design/frames/selection-lists/` (`manifest.json`, `index.html`) | — |
| Approved design frames, shared/common lists + fork (15 screens, 5 flows, all approved 2026-10-20; **not built**) | `design/frames/selection-lists-shared/` | — |
| Helm | `deploy/helm/fuzefront/templates/selection-list-service-*.yaml`, `values*.yaml` → `selectionListService`, `selectionListsMcp` | — |
| Epic / plan | `docs/planning/epics/EPIC-17-selection-lists.md` | — |

The `@fuzeone` scope (not `@fuzefront`) is deliberate for this feature — see `design/frames/selection-lists/manifest.json` `packagesNote`.

## Domain model

All resource fields are `snake_case`; only the pagination envelope (`page.nextCursor`, `page.hasMore`, `page.total`) is camelCase (family standard, `governance/pagination-standard.md`).

- **SelectionList** — `id` (`front_sl_…`), `organization_id`, `key` (org-unique slug `^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$`), `source_locale`, `status` (`active|archived`), resolved `name`/`description`, `resolved_locale`, `is_machine`, `item_count?`, **`created_by`** (an `AuthorPrincipal`, below), **`seed`** (required, nullable provenance).
- **SelectionListItem** — `id` (`front_sli_…`), `list_id`, `code` (list-unique interop key `US`/`HIGH`; **immutable after create**, never translated, never shown to end users), `sort_order` (gapped by 100), `status`, resolved `label`/`description`, `resolved_locale`, `is_machine`, **`created_by`**, **`seed`**.
- **`AuthorPrincipal` (4.0.0, MAJOR)** — `created_by` (lists, items) and `granted_by` (grants) are one of three disjoint forms: a `usr_` user id, a `system:<service>` principal (seeded rows carry `system:selection-list-service`), or the literal `[deleted-user]` sentinel. Classify from the string alone before treating it as a user: TS `authorPrincipalKind` / `isUserAuthor` / `DELETED_USER_SENTINEL` / `SYSTEM_PRINCIPAL_PREFIX`; Python `author_principal_kind` / `is_user_author` (+ the same constants).
- **`seed` (4.0.0)** — read-only, always present: `null` for user-authored rows, else `{source, pack_key, pack_version, user_modified}`. `user_modified` is sticky (set once a human edits seeded content; detected by content hash). Never accepted in a request body — seeding is Kafka-only.
- **Translations** live in `*_translations` rows keyed by locale — never on the entity. Every list/item representation returns resolved text. **Locale fallback (fixed):** `locale` query param → first supported `Accept-Language` → list `source_locale` → `en`. A label is **never `null`**. `source_hash` = hash of the source text a translation was made from (staleness detection for autofill). Supported locales (11): `en es fr de pt ru zh ja hi ar he`.
- **Access grant** — per-list ReBAC role: `list-owner`, `list-editor`, `list-contributor`, `list-translator`, `list-viewer` (roles do not stack). Matrix of actions per role is in the spec's `info.description` § Authorization.
- **Visibility (4.1.0, implemented; real only while the shared-lists flag is ON — OFF reports `private` for every list)** — `SelectionList.visibility`: `private` (default; every list that exists today; instance roles only), `org` (readable by every member of the owning org), `platform` (a **common list** owned by the platform organization — FuzeFront's root org — readable by every org; operator-only, **one-way**). Visibility widens **reading only** (get, items, translations, listing with `include_shared=true`, resolve); it never confers a mutation. `editable` (bool) is a caller-relative hint: the caller holds a write role on the list (one bulk `translate` check; emitted only while the flag is ON; a list of another org is never editable). `platform` is one-way (`PATCH` to anything else → `409 visibility_locked`); only a list owned by the platform org can be promoted; a flag-OFF create/PATCH with non-`private` is `400`.
- **Fork (4.1.0, implemented, dark)** — `POST /v1/selection-lists/{listId}/fork` copies a `platform` list (items incl. archived, translations) into the caller's org with the **same `key`** (so it shadows the common list for that org), new item ids, `origin_item_id` on each item, `forked_from {list_id, organization_id, revision, forked_at}` (`revision` = the source's revision at copy time, never updated), `seed: null`, visibility `org` (default) or `private`, caller = `list-owner`. One fork per (org, source): `201` new / `200` existing (`409 fork_exists` if the existing fork is unreadable; `409 fork_not_applicable` for the caller's own org's list; plain `409` when another list holds the key; `400` over 5000 non-purged items or an unknown body property; `403 QUOTA_EXCEEDED`; `404` flag OFF/unreadable source). Mutating a common list you hold no role on ⇒ `409 CONFLICT` with `reason: fork_required`, `fork_url`, `source_list_id` (or `403` without `SelectionListCatalog:create`). Key precedence for a caller in org X: X's own readable active list with key K > the active `platform` list K (`getEffectiveList`; one row per key is effective — duplicates under two renderings of an org id resolve active > caller's exact claim > oldest > smallest id, among the rows the caller can read). **Pages of `GET /v1/selection-lists` are filtered after pagination, so a page can be shorter than `limit` or empty while `hasMore` is true: follow `nextCursor` until `hasMore` is false.** `getEffectiveList` / `get_effective_list` request `limit: 1` and therefore follow that cursor (clients 2.2.0; 2.1.x stopped after page 1 and could return `null`). `POST /v1/resolve` resolves common-list ids in every org and redirects to an `org`-visible fork's item (`effective_item_id`).
- **Revision (4.2.0, contract only)** — `SelectionList.revision` (read-only, integer ≥ 1) = the event contract's `listRevision`: the `selection_lists.revision` column (migration 6: `NOT NULL DEFAULT 1`, `CHECK >= 1`, monotonic trigger), bumped once per revisioned event by `bumpListRevision` (`src/events/outbox.ts`); access events do not bump it. Fork is behind its source ⇔ source `revision` > fork `forked_from.revision`. **Optional at 4.2.0: absent = unknown** ("comparison unavailable"; never infer from `updated_at`). Helpers `compareForkToSource` / `compare_fork_to_source` → `behind | up-to-date | unknown`.
- **Quota** — four scopes `org_lists`, `user_lists`, `list_items`, `list_locales`. Platform defaults (`src/services/quota.service.ts`): 100 lists/org, 20 lists/user, 500 items/list, 11 locales/list; per-org override row wins. **All four are enforced** (review M-4): `org_lists` and `user_lists` on create and on un-archive (`PATCH {status:"active"}`), `list_items` on item create/un-archive, `list_locales` when a locale is *added* (translation PUT, autofill, a PATCH writing a new source-locale row; the source locale counts). The per-scope ceilings count **active rows only**; creates are exact (advisory lock + re-check inside the create transaction). **Archived rows count toward a hard storage ceiling** = active limit × `SELECTION_LISTS_STORAGE_CEILING_FACTOR` (env, positive integer, default 10; invalid → default), reported as the same `org_lists`/`list_items` `QUOTA_EXCEEDED` with `limit` = the ceiling; purging frees it. Exceeding returns **`403` with `code: QUOTA_EXCEEDED`** plus `scope`, `limit`, `current` — not a distinct status. Ingress also rate-limits `/api/v1/resolve` and `/api/v1/selection-lists` per client IP (`selectionListService.ingress.rateLimit.*`, `429` from the edge).
- **Archive is the default; purge is explicit.** `DELETE …?purge=false|absent` archives (reversible via `PATCH {status:"active"}`); `?purge=true` is irreversible and cascades. Archived items still **resolve** (with `status:"archived"`) so consumer rows keep rendering a label. Only purged/never-existed ids come back in `missing`.
- **Errors** — body `{code, message, scope?, limit?, current?, details?[{field,message}], reason?, fork_url?, source_list_id?}` (`reason` 4.1.0: `fork_required|fork_exists|fork_not_applicable|visibility_locked`, only on `CONFLICT` — **but** the service also answers `403 FORBIDDEN` with `reason: platform_suspended` while the platform org is suspended, which the spec's `ErrorReason` does not list (**gap**, contract)); codes `VALIDATION_ERROR UNAUTHENTICATED FORBIDDEN NOT_FOUND CONFLICT QUOTA_EXCEEDED`. Conflicts: duplicate list `key`/item `code`; demoting or revoking the **last `list-owner`** → `409` (decided by the Security API: another mirror owner must be *confirmed* by `manage_access` on the list; see Authorization).
- **Events** — see "Events, outbox and seeding" below. The HTTP contract itself defines no events; the Kafka contract lives in `shared/src/kafka/schemas/`.

### The 25 operations (spec `operationId` → TS method → Python method)

| operationId | HTTP | TS (`SelectionListClient`) | Python |
|---|---|---|---|
| listSelectionLists | GET `/v1/selection-lists` | `getLists` | `get_lists` |
| createSelectionList | POST `/v1/selection-lists` | `createList` | `create_list` |
| getSelectionList | GET `/v1/selection-lists/{listId}` | `getList` | `get_list` |
| updateSelectionList | PATCH `…/{listId}` | `updateList` | `update_list` |
| deleteSelectionList | DELETE `…/{listId}[?purge=true]` | `deleteList` | `delete_list` |
| archiveSelectionList | POST `…/{listId}/archive` | `archiveList` | `archive_list` |
| forkSelectionList **(4.1.0)** | POST `…/{listId}/fork` | `forkList` → `{list, created}` | `fork_list` → `(list, created)` |
| listSelectionListItems | GET `…/{listId}/items` | `getItems` | `get_items` |
| createSelectionListItem | POST `…/{listId}/items` | `createItem` | `create_item` |
| reorderSelectionListItems | PUT `…/{listId}/items/reorder` | `reorderItems` | `reorder_items` |
| updateSelectionListItem | PATCH `…/items/{itemId}` | `updateItem` | `update_item` |
| deleteSelectionListItem | DELETE `…/items/{itemId}[?purge=true]` | `deleteItem` | `delete_item` |
| archiveSelectionListItem | POST `…/items/{itemId}/archive` | `archiveItem` | `archive_item` |
| listSelectionListTranslations | GET `…/{listId}/translations` | `listTranslations` | `list_translations` |
| upsertSelectionListTranslation | PUT `…/translations/{locale}` | `upsertListTranslation` | `upsert_list_translation` |
| deleteSelectionListTranslation | DELETE `…/translations/{locale}` | `deleteListTranslation` | `delete_list_translation` |
| listSelectionListItemTranslations | GET `…/items/{itemId}/translations` | `listItemTranslations` | `list_item_translations` |
| upsertSelectionListItemTranslation | PUT `…/items/{itemId}/translations/{locale}` | `upsertItemTranslation` | `upsert_item_translation` |
| deleteSelectionListItemTranslation | DELETE `…/items/{itemId}/translations/{locale}` | `deleteItemTranslation` | `delete_item_translation` |
| autofillSelectionListTranslations | POST `…/translations/{locale}/autofill` | `autofillTranslations` | `autofill_translations` |
| listSelectionListAccess | GET `…/{listId}/access` | `getAccess` | `get_access` |
| setSelectionListAccess | PUT `…/access/{userId}` | `setAccess` | `set_access` |
| revokeSelectionListAccess | DELETE `…/access/{userId}` | `revokeAccess` | `revoke_access` |
| getSelectionListQuota | GET `/v1/selection-lists/quota` | `getQuota` | `get_quota` |
| resolveSelectionListItems | POST `/v1/resolve` | `resolveIds` | `resolve_ids` |

Both clients cover all 25 operations (`scripts/check-selection-lists-client-drift.sh` holds the canonical operationId→TS-method table). 2.1.0 added the helper `getEffectiveList(key)` / `get_effective_list(key)` (one `GET ?key=&include_shared=true&limit=1` call) and `SelectionListApiError.isForkRequired` / `is_fork_required` with `sourceListId`/`forkUrl` (`source_list_id`/`fork_url`). 2.2.0 adds `SelectionList.revision` and `compareForkToSource(fork, source)` / `compare_fork_to_source(fork, source)` (`ForkSourceComparison`), and makes `getEffectiveList` / `get_effective_list` **follow the same query's cursor** through empty non-terminal pages (max `MAX_EFFECTIVE_LOOKUP_PAGES` = 10; exhaustion throws `EffectiveLookupIncompleteError`, never `null`; a failed page throws; TS abort stops the walk). **Pages can be short or empty while `hasMore` is true**: `GET /v1/selection-lists` cuts the page in SQL (`ORDER BY created_at DESC, id DESC LIMIT n+1`) and only then drops unreadable rows (`filterReadable` / `readableWinners`, `src/routes/lists.ts`) — so never treat an empty page as the end. 2.1.x read only page 1 of the key lookup and could report "no list" for a key whose newest row the caller cannot read.

## Calling it from TypeScript

Paths include `/v1/…`, so `baseUrl` is the **prefix before `/v1`**. In the browser it must be same-origin (`'/api'` yields `/api/v1/selection-lists`, which is what `@fuzeone/selection-lists-ui` calls) — never an absolute host. Cluster-internal callers use `http://fuzefront-selection-list-service:<selectionListService.port>` — **3008** in the chart, the service's own `PORT` default, the Dockerfile `EXPOSE` and the OpenAPI `servers` example (the spec's only remaining `3011` is its changelog note about the correction).

```ts
import {
  SelectionListClient,
  isSelectionListApiError,
  type SelectionListItem,
} from '@fuzeone/selection-list-client'

declare function getJwt(): string

const client = new SelectionListClient({
  baseUrl: '/api', // same-origin in the browser; client appends /v1/...
  token: () => getJwt(), // string | () => string | undefined | Promise<...>
  defaultLocale: 'en', // applied when a call passes no locale
})

export async function seedCountries(): Promise<SelectionListItem> {
  try {
    // The service mints the id; the create body has no `id` field.
    const list = await client.createList({ key: 'countries', name: 'Countries', source_locale: 'en' })
    const item = await client.createItem(list.id, { code: 'US', label: 'United States' })
    await client.upsertItemTranslation(list.id, item.id, 'fr', { label: 'États-Unis' })
    return item
  } catch (e) {
    if (isSelectionListApiError(e) && e.isQuotaExceeded) {
      // e.scope / e.limit / e.current identify the ceiling that was hit
      throw new Error(`quota ${e.scope}: ${e.current}/${e.limit}`)
    }
    if (isSelectionListApiError(e) && e.isConflict) {
      // duplicate list key or item code in this org/list
    }
    throw e
  }
}

export async function labelsFor(storedItemIds: string[]) {
  // PERSIST item.id (front_sli_…), never item.code. Archived ids still resolve.
  const { results, missing } = await client.resolveIds(storedItemIds, { locale: 'fr' })
  return { results, missing } // missing = purged / never existed
}

export async function allActiveItems(listId: string): Promise<SelectionListItem[]> {
  const out: SelectionListItem[] = []
  for await (const item of client.paginate((p) => client.getItems(listId, { ...p, status: 'active' }))) {
    out.push(item)
  }
  return out
}
```

Notes verified in `selection-list-client/src/client.ts`: `deleteList`/`deleteItem` take `{ purge?: boolean }` and return `T | null` (null on `204` purge); the three `delete*Translation`/`revokeAccess` methods return `void`; `paginate(fetchPage, params?)` is an async generator over `{items, page}`; every method accepts a trailing `AbortSignal`; `SelectionListApiError` exposes `status`, `code`, `scope`, `limit`, `current`, `details`, `isQuotaExceeded|isNotFound|isConflict`.

## Calling it from Python

```python
from fuzefront_selection_list_client import SelectionListApiError, SelectionListClient

client = SelectionListClient(
    base_url="http://fuzefront-selection-list-service:3008",  # http/https only; chart Service port
    token=lambda: get_token(),  # str or zero-arg callable, resolved per request
    default_locale="en",
)

try:
    sl = client.create_list(key="countries", name="Countries", source_locale="en")
    item = client.create_item(sl.id, "US", "United States")  # code, label positional
    client.upsert_item_translation(sl.id, item.id, "fr", "États-Unis")
    client.reorder_items(sl.id, [item.id])  # returns list[SelectionListItem]
except SelectionListApiError as exc:
    if exc.is_quota_exceeded:
        print(f"quota {exc.scope}: {exc.current}/{exc.limit}")
    elif exc.is_conflict:
        print("duplicate key/code, or last list-owner")
    else:
        raise

# Persist item.id, resolve at render time (archived ids still resolve).
resolved = client.resolve_ids([item.id], locale="fr")
for item_id, r in resolved.results.items():
    print(item_id, r.label, r.status.value)
print(resolved.missing)

# Walk every page: pass the bound method; extra kwargs are forwarded to it.
for it in client.paginate(client.get_items, list_id=sl.id, status="active"):
    print(it.code, it.label)
```

Caveats verified in `client.py`: `delete_list`/`delete_item` take keyword-only `purge: bool = False`; `paginate` is a *method* taking `(method, *, limit, cursor, **kwargs)` and forwards `**kwargs` — `list_id` must therefore be a **keyword** (`client.paginate(client.get_items, list_id=sl.id, status="active")`); the module-level `paginate(fetch_page, ...)` is also exported. Python errors expose `.code` (str), `.status`, `.scope`, `.limit`, `.current`, `.details`.

## Consuming the UI (`@fuzeone/selection-lists-ui`)

Four approved flows (`design/frames/selection-lists/manifest.json` → `build.flows`, all `approved: true`, stamped):

| Flow id | Orchestrator | Route | Frames |
|---|---|---|---|
| list-management | `SelectionListManagementFlow` | `/settings/selection-lists[/:listId]` | 01–06 (index, new list, detail, value modal, reorder, quota) |
| translation-workbench | `TranslationWorkbenchFlow` | `/settings/selection-lists/:listId/translations[/:locale]` | 07–09 |
| access-control | `SelectionListAccessFlow` | `/settings/selection-lists/:listId/access` | 10–11 |
| picker | `SelectionListPicker` (**embeddable component**, not a routed page) | harness only: `/embed/selection-list-picker` | 12–14 (single, multi, archived value) |

The shell mounts the three admin flows in `frontend/src/App.tsx` (each route re-checks the flag) and the sidebar entry in `frontend/src/components/SidePanel.tsx` — both gated by `useFlag('fuzefront.selection-lists.service', false)`. The package is peer-dependent on `react ^19`, `react-dom ^19`, `react-router-dom ^7`, `@fuzefront/design-system ^1`; the shell resolves it **from source** via a Vite alias (`frontend/vite.config.ts`), and CI builds it before type-check/bundle.

```tsx
import { SelectionListPicker } from '@fuzeone/selection-lists-ui'

// Props (src/SelectionListPickerHarness.tsx): listKey, mode, initialValue?, max? (multi), onChange?
// single: initialValue?: string  -> onChange(id: string)
// multi:  initialValue?: string[] -> onChange(ids: string[])
export function RegionField() {
  return <SelectionListPicker listKey="sales-regions" mode="single" />
}
```

Build/consume rules: use design-system tokens only (no raw hex/spacing); the UI's own `src/api.ts` calls the **same-origin** base `/api/v1/selection-lists` and `/api/v1/resolve`, and sends the org-scoped bearer the host installs with `configureSelectionListsAuth({ getOrgToken, getSessionToken })` (no host configured → no `Authorization` header; the user search goes to the host backend with the plain session token); changing UI behaviour needs an approved frame first (`gate-frames-first`; frames are authored only by `product-designer`, in `design/frames/selection-lists/` in this repo).

**Picker** — props are a discriminated union on `mode`: single takes `initialValue?: string` and `onChange(value: string)`; multi takes `initialValue?: string[]`, `max?`, and `onChange(value: string[])` (ids in the list's `sort_order`, same as the hidden `[data-persisted]` slot). It accepts the list **key** and looks the list up with the contract's exact-match `GET /v1/selection-lists?key=` filter (one call, no page walking; a `front_sl_…` id is used as-is), then reads the items by id. Seeding from `initialValue` never fires `onChange`, and all seeded ids are resolved in **one** `POST /v1/resolve` (`api.resolveItems` de-duplicates and only splits above the contract's 500-id cap). Stored values that are no longer offerable follow frame 14: an **archived** id renders its real label badged and is kept until the user removes it (multi chip ×) or replaces it (single); a **purged/unknown** id renders "Unknown value" (`[data-state="missing"]`, `[data-missing="true"]`, `[data-error="missing"]`) and is kept in the form until the user picks a replacement — single: the pick replaces it; multi: the next pick swaps one purged id out (or the chip × removes it) — after which the notice clears and the picker returns to frame 12/13. The harness route takes `?value=` as one id (single) or several (multi; repeated or comma-separated). `api.resolveItems` maps the contract's `{ results: { [id]: … }, missing }` body to the UI's `resolved[]` shape.

## Authorization and ownership rules

1. **Org scope comes from the token, never the body or a header.** `organization_id` and the acting user derive from the verified Bearer JWT (`src/middleware/auth.ts`): subject `userId` else `sub`; org claim precedence `orgId` → `organization_id` → `organizationId` (disagreeing or malformed values → `401`, none → authenticated but org routes `401`); **HS256 pinned**; only `kind` absent or `fuze-org-session` accepted (`fuze-workload` / `fuze-delegation` → `401`, review L-2). **The FuzeFront session token `{userId, sessionId, tid}` carries NO org and `tid` is the identity-directory tenant, never an org** (review I-1): a caller obtains an org-scoped token from `POST /api/organizations/{orgId}/session-token` (backend/security `services/orgSessionToken.ts`; mints `{userId, sessionId, tid, orgId, kind:'fuze-org-session'}`, ≤15 min, only after the canonical `proveSessionTenant` active-membership proof, 403 for non-member/nonexistent; this is the END-USER path, distinct from the service-to-service `POST /api/v1/security/tokens/exchange` delegation, see the guide's "Authentication and the org claim"). The shell does it in `frontend/src/lib/selectionListsAuth.ts` and injects it via the package's `configureSelectionListsAuth`. Every list/item query in the routes filters by `req.orgId`. A cross-org or unentitled read returns **`404`, not `403`** (no existence oracle).
2. **The service mints ids** (`mintId('selectionList'|'selectionListItem')` from `@izzywdev/fuzefront-identity` → `front_sl_…` / `front_sli_…`, TypeID). Create bodies carry no `id` and set `additionalProperties: false`. Ids are opaque past the prefix — validate the prefix, never parse further. Referenced spine ids keep their own prefixes (`org_`, `usr_`). Standard: `governance/identifier-standard.md`.
3. **An id is never a capability.** Knowing a list or item id grants nothing; routes re-check org scope (and, for access routes, the Security API). `POST /v1/resolve` returns only `{label, locale, is_machine, status}` — never list key, org, or anything else an id alone shouldn't unlock; max **500 ids** per call.
4. **Authorization backend:** FuzeFront's Security API (`backend/security` `/api/v1/security/authz/*`) via `@fuzefront/auth`'s `AuthzClient` — no vendor SDK in the service. **Two resource types, never mixed (review H-3; matrix in `docs/planning/selection-lists-permit-actions.md`):**
   - **`SelectionListCatalog`** — tenant-level, **keyless**, for the four operations that are not about one list: `GET /v1/selection-lists` → `list`, `POST /v1/selection-lists` → `create`, `GET /v1/selection-lists/quota` → `read_quota`, `POST /v1/resolve` → `resolve` (`requireCatalogCheck(action)` in `src/middleware/authz.ts`, which never sends a key even if a route carried a `:listId`). **Tenant roles carry only these actions.**
   - **`SelectionList`** — instance-scoped by `{type:'SelectionList', key: listId}`; every `:listId` route checks its per-list action (`read`, `update`, `delete`, `add_value`, `update_value`, `remove_value`, `translate`, `manage_access`) on that instance. **Per-list actions are instance-only: no tenant role confers any of them**, and there is no automatic org-admin → `list-owner` derivation.
   - `GET /v1/selection-lists` additionally filters each returned row through a per-list `SelectionList:read` bulk check (`filterReadable`) — the catalog `list` action only authorizes *asking* for the catalog, so a caller sees only lists it holds an instance role on.
   - **(4.1.0)** `SelectionListCatalog` gains `read_shared` (admin, editor, viewer — every customer tenant role; not `developer`) and `publish_platform` (admin; the service evaluates it in the **platform org's** tenant and requires the caller to act there). Read operations declare `x-permit-shared-read`: for a non-`private` list, `SelectionList:read` may instead be satisfied by `read_shared` in the caller's tenant **plus** the service-owned predicate (`org` → same org; `platform` → always). Permit decides membership; the service owns `visibility`. Still zero tenant-role `SelectionList:*` actions and no admin → owner derivation. New `x-permit-additional-actions`: create with `visibility: platform` → `publish_platform`; PATCH with `visibility` → `manage_access` (+ `publish_platform` for `platform`); purge of a `platform` list or its item → `publish_platform`; fork → `create` + source `read`.
   - Extra checks stacked after a route's base check (`requireAuthzCheckWhen`): item purge (`DELETE …/items/:itemId?purge=true`) also needs `delete` on the list (owner-only, review M-1); `PATCH …/:listId` with `status:"archived"` also needs `delete` like `POST …/:listId/archive` (review L-1; un-archive stays on `update`). Both are declared in the spec as `x-permit-additional-actions` (4.0.0).
   - **No implicit admin ownership.** Tenant `admin` holds the four catalog actions and **no** per-list action; there is no admin/`org-admin` → `list-owner` derivation (open design question Q1, `docs/planning/selection-lists-permit-actions.md`). **Support path:** a tenant admin (who holds `Organization:manage`) self-grants `list-owner` on the instance via `POST /api/v1/security/authz/grants` `{subject, tenant, role:"list-owner", resource:{type:"SelectionList", key:"front_sl_…"}}` — explicit and audited; it updates the authz backend only, so the `selection_list_access` mirror lags until reconciled.
   - **Seeded lists are invisible to members.** Seeding writes rows as `system:selection-list-service`; since SL8 the org's **owner** is granted `list-owner` on platform-seeded lists (`src/seed/ownerGrants.ts`), and app-seeded lists get no grant at all, so every other member — admins included — sees no seeded list in `GET /v1/selection-lists` (filtered by `SelectionList:read`) or can `GET` it (404) until a role is granted. `POST /v1/resolve` still resolves seeded item ids (catalog `resolve` only). Known gap for content as it ships: the **owner decision** is made and **implemented** in 4.1.0 (seed-list `visibility: org` makes a seeded list pickable by every member, still ownerless/immutable for them; a platform pack may declare `platform`), but it is honoured only while `shared-lists` is ON for the org and the shipped `platform-defaults.v1.json` declares no `visibility`, so seeded lists stay `private`; the data migration / pack v2 / retro-fork jobs of the design record's §9 are **not built**.
   **Fails closed** (Security API error → `403`). `selection_list_access` is a **read-model mirror only** — never consulted for authz decisions, only for the roster and as the *candidate set* of the last-owner guard (the guard itself asks the authority: `services/authority.ts` `hasConfirmedOtherOwner`, `manage_access` on the instance, which only `list-owner` holds; an unconfirmed mirror owner is not counted — review M-2).
   **Authority and mirror are kept in step:** a failed `PUT`/`DELETE …/access/{userId}` re-grants/re-revokes in the Security API to restore the user's prior role (`restoreAuthority`, **with the acting human's token**; `selection_list_authz_compensation_total{outcome="failed"}` = it could not, alert); list **purge** revokes the instance's grants after commit with the purging owner's token, their own grant last (best-effort, never fails the purge; `selection_list_grant_cleanup_failed_total{cause="purge"}`; a grant that token is refused, e.g. a grantee who left the tenant, is retried once via the cleanup scope); `identity.user.deleted` has no human, so it revokes the deleted user's grants with the workload token's **`selection-list:grant-cleanup`** scope and deletes their mirror rows (retried, DLQ after 5 attempts). That scope is revoke-only, `SelectionList` instance roles only, and the Security API honours it only for a principal SQL proves gone (user row missing/deactivated, or no active membership of the tenant) — never a live member, never `authz:admin`; do not widen it or the owner-grant scope (`backend/security/src/routes/authz.ts`). A deleted user who was a list's **last** owner is still revoked, and the list is flagged (`selection_list_ownerless_lists_total{cause="user_deleted"}`, ERROR log `ownerless: true`) — recovery is the tenant-admin self-grant above.
5. **Never route authz through the feature flag.** `fuzefront.selection-lists.service` is rollout, not entitlement (see below).

**Authz enforcement as implemented** (`services/selection-list-service/src`, verified by `tests/authz.route-matrix.test.ts`, which discovers every mounted `/v1` route and asserts its `(resource, key, action)`):
- Every `/v1` route carries a Security-API check — the four collection-level ones on `SelectionListCatalog`, all others on `SelectionList` keyed by the list id. Authorization is **always enforced when `NODE_ENV=production`** (`isAuthzEnforced()` in `src/middleware/authz.flags.ts` never reads the env var there); `FUZEFRONT_SELECTION_LIST_AUTHZ_ENABLED=true` is only a dev/test switch outside production (default OFF = pass-through + warning). Grant/revoke WRITES are authenticated with the service's own machine identity (`src/lib/machineIdentity.ts`, client_credentials, scope `authz:admin`), never the end user's token.
- Create (`POST /v1/selection-lists`) checks `SelectionListCatalog:create`, then `grantListOwner()` writes the creator's instance-scoped `list-owner` grant with the service's workload token (scope `selection-list:owner-grant`: the Security API lets it bootstrap an owner and nothing else) inside the create transaction — that grant, not the tenant role, is what lets the creator then read/edit its own list.
- `/v1/resolve` **requires a Bearer token** with an `orgId` claim and `SelectionListCatalog:resolve`; it does not run a per-list `read` check (accepted trade-off, review L-4 — the org predicate is the isolation boundary).
- The Permit schema (`SelectionListCatalog` + the tenant-role grants above, no tenant `SelectionList:*` grants) is declared in `backend/src/permit/schema.ts` and pushed by the backend at boot (`syncPermitSchemaFromRegistry`, `backend/src/index.ts`; outcome on the backend's `GET /health` → `permit`). Order matters on rollout: **Permit schema synced → service enforcement**, never the reverse, or every caller loses list/create/resolve (fail closed). Whether a given environment's Permit has actually received it is **(unverified)** from this repo — confirm in that environment before enabling anything.

## Feature flags (three; all default OFF; live Unleash state is not readable from the repo)

| Flag | Gates | Web-exposed |
|---|---|---|
| `fuzefront.selection-lists.service` (master) | every `/v1` route (404 when OFF), the shell nav/routes, **and** is a prerequisite of seeding | yes |
| `fuzefront.selection-lists.seed-defaults` | both seeding consumers (platform defaults on `identity.org.created`; app `selection-lists.seed.requested`) and the reconciler (`src/seed/reconciler.ts`, off unless `SEED_RECONCILER_ENABLED=true`, which the chart does not set) | **no** (server-only) |
| `fuzefront.selection-lists.shared-lists` (SL9) | all 4.1.0 behaviour: non-private `visibility`, shared read, `include_shared`, fork, `fork_required`, common-list resolve + redirect, `list.forked`/`visibility.changed`, seed-list `visibility`. Requires the master flag; real authorization stays in Permit | **yes** (`WEB_EXPOSED_FLAGS`) |

Seeding requires **master AND seed-defaults ON for the org** (`isSeedingEnabled` in `src/seed/flagGate.ts`; both read per message, fail closed). Publishing change events is **not** flagged. Targeting note: the seeding path evaluates both flags with **only `orgId`** (the `org_…` TypeID, no `userId`), so a percentage `flexibleRollout` with `stickiness: default` has no stable key there — use an `orgId` constraint (**inferred** from Unleash semantics; verify before the first ramp). The HTTP path evaluates the master flag with the JWT's org claim, whose format may differ from the TypeID (**gap**, see below).

### `fuzefront.selection-lists.service`

**release**, **default OFF**, owner platform team, Jira FFRNT-201, `web_exposed: true` (`packages/feature-flags/flag-registry.yaml`; key constant `FLAG_KEYS.SELECTION_LISTS_SERVICE`).

- **Server:** `isSelectionListsEnabled()` in `services/selection-list-service/src/flags.ts`, called at the top of every list/item/translation/quota/resolve handler. OFF → `404 NOT_FOUND` (body message "Not found." or "Service not enabled."). Fails closed: no flag client or any client error → OFF. Org-targeted: context carries `orgId`.
- **Local/CI only:** `FUZE_FLAGS_PROVIDER=offline` with `FUZE_FLAGS_OFFLINE_ON=fuzefront.selection-lists.service` installs the offline OpenFeature provider in `@fuzefront/feature-flags` that forces the flag ON, refused when `NODE_ENV=production` and ignored whenever Unleash is configured. Prod targeting is Unleash only (`unleash-flag-enable` skill; flag administration is `feature-flags-engineer`).
- **UI:** sidebar entry + each `/settings/selection-lists/*` route gated by `useFlag(...)`.
- **Deploy gate (separate from the flag):** Helm `selectionListService.enabled` and `selectionListsMcp.enabled` are `false` in `values.yaml`; `values-prod.yaml` sets `selectionListService.enabled: true` (since #1592, image tag pinned, `platformOrgId` pinned to the root platform org and enforced by `gate-platform-org-pin`) — **the workload is deployed in prod and the flags gate visibility**; whether the pod is healthy or any flag has been ramped is live state this repo cannot show. `selectionListsMcp.enabled` is still `false`. The chart routes `/api/v1/selection-lists` and `/api/v1/resolve` to the service via `templates/ingress.yaml` (nginx rewrite annotation; a `selection-list-service-stripprefix` Middleware under Traefik), gated on `selectionListService.enabled`.
- Plan any new work on this feature behind this flag (default OFF), test **both** states (`services/selection-list-service/tests/feature-flags.init.test.ts` and the `on`/`off` CI matrix with `tests/selection-list-service/dark.spec.ts` show the pattern), and see the `feature-flags` skill for the family rules.

### `fuzefront.selection-lists.seed-defaults`

**release**, **default OFF**, owner `izzywdev`, server-only (`web_exposed: false`); registry entry in `packages/feature-flags/flag-registry.yaml`, key `FLAG_KEYS.SELECTION_LISTS_SEED_DEFAULTS`, read by `isSeedDefaultsEnabled()` (`src/flags.ts`, mirrored in the service-root `flags.ts`). Local/CI force-on works the same way (`FUZE_FLAGS_PROVIDER=offline` with `FUZE_FLAGS_OFFLINE_ON=fuzefront.selection-lists.seed-defaults`; refused in production). Removal criterion: seeding ON for all orgs for 30 days with zero `seed.failed`, **and** the reconciler has backfilled every org (the reconciler is built — `src/seed/reconciler.ts` — but the chart does not set `SEED_RECONCILER_ENABLED`, so it does not run in a deployment as configured). **The `prod-unleash-ops` `selection-lists` ramp set covers only the master flag and is percentage-only**; `selection-lists-create` creates all three flags OFF (never enables); the owner-directed `all-flags` set lists `service` and `seed-defaults` (not `shared-lists`). Per-org targeting of `seed-defaults` needs the `unleash-flag-enable` raw procedure (`feature-flags-engineer`).

### `fuzefront.selection-lists.shared-lists` (SL9)

**release**, **default OFF**, owner `izzywdev`, **server and web** (`WEB_EXPOSED_FLAGS`), key `FLAG_KEYS.SELECTION_LISTS_SHARED_LISTS` (`packages/feature-flags/src/catalog.ts`), registry entry in `packages/feature-flags/flag-registry.yaml`; read by `isSharedListsEnabled()` in `src/flags.ts` (memoised per request via `sharedListsOn`, `src/lib/sharedLists.ts`), only after the master gate has passed; fails closed. Created OFF by `prod-unleash-ops` `flags=selection-lists-create`; **no workflow enables it**. Gating, flag-OFF behaviour (4.1.0 shapes with `private`/`null` defaults, `404` fork, `400` non-private visibility) and the two flag-independent rules (cross-rendering key uniqueness; platform-org suspension/purge guards) are in the guide's shared-lists section. **Per-org targeting is wrong for the browser** (`GET /api/flags` carries no `orgId`; the `userId` forms differ) — the runbook says enable globally. Platform org: Helm `selectionListService.platformOrgId` → `SELECTION_LIST_PLATFORM_ORG_ID`; unset/unconfirmed → every platform feature fails closed; invalid → the service refuses to start. CI covers both states: the `on` leg runs the main instance with the offline provider forcing `service` + `shared-lists` ON and extra instances on ports 3012-3015 (shared-lists OFF; platform org unset / unconfirmed / deactivated) — `.github/workflows/ci.yml`, `tests/selection-list-service/contract/shared-lists-*.test.ts`. Runbook: `docs/runbooks/selection-lists-flag-rollout.md` § Third flag. `src/flags.ts` still carries a `TODO(#1461)` saying the key is not in `@fuzefront/feature-flags` yet — **stale** (the constant exists; **gap**, code comment).

## Events, outbox and seeding

Full consumer guide: `docs/guides/SELECTION_LIST_EVENTS.md`; operations: `docs/runbooks/selection-lists-seeding-operations.md`; design: `docs/planning/selection-lists-events.md`. Contract: `shared/src/kafka/schemas/selection-lists.*.ts` (18 topics: list/item/translation/access change events produced by the service; `seed.requested` inbound; `seed.completed`/`seed.failed` outcomes; **(4.1.0, shared 1.3.0, emitted by the service — `emitForkEvents` / `emitVisibilityChanged` in `src/events/emitters.ts`, declared in the chart's `kafkaTopics`)** `selection-lists.list.forked` (provenance + `itemMap[{originItemId,itemId}]`, a fork also emits the ordinary created/translation/access events) and `selection-lists.visibility.changed`; snapshots always carry `visibility`/`forkedFrom`/`originItemId`; seed lists may declare `visibility` (`platform` refused in `seed.requested`, allowed in platform packs; honoured only while `shared-lists` is ON for the org, otherwise seeded `private`)). Common-list events are keyed by the platform org.

- **Outbox.** Every mutating route enqueues its events into `event_outbox` in the **same transaction** as the change (`src/events/emitters.ts`, `outbox.ts`); `src/events/outboxRelay.ts` publishes them. Per-organization strict `seq` order (the claim is per org: a pending head blocks that org's later rows), at-least-once, key = `organizationId`, 10 attempts then **park** (copy to `<topic>.dlq`, row `failed`; later rows of the org continue), schema-invalid payload parks immediately. Relay starts only if `KAFKA_BROKERS` is set (`startOutboxRelayFromEnv`); `sent` rows are pruned after 168 h (`OUTBOX_SENT_RETENTION_HOURS`). Metrics (`/metrics`): `selection_list_outbox_pending`, `_oldest_pending_age_seconds`, `_failed` (alert > 0), `_published_total`, `_publish_failures_total`, `_parked_total` (alert on any increase) — there are **no seed-specific metrics**; the signal for seeding is `seed.failed` events and logs.
- **Consumers** (`src/events/consumer.ts`, groups `${KAFKA_GROUP_ID}-{org-created,org-updated,seed-requested,org-deleted,user-deleted}`) always start when Kafka is configured; the seeding flags are evaluated **per message**. `identity.org.created` → org projection (`selection_list_ref_index`, **always**, regardless of flags) then platform defaults if both flags ON. `identity.org.updated` refreshes the projection (type / `is_active` / name; flag-independent). `identity.org.deleted` tombstones the projection then cascades — except for the platform org, which is **suspended (writes fail closed), never deleted, archived or retyped** (`src/events/platformGuard.ts`); no event producer is authenticated in-process (accepted residual risk; broker ACLs FuzeInfra#1394 are the control and a prerequisite for enabling the service in production — state unverifiable from the repo).
- **Platform source.** `seed-packs/platform/platform-defaults.v1.json`: `yes-no` (2 items), `priority` (4), `work-status` (4), each with 10 translations (11 locales), `appliesTo: [organization, personal]`, `"translationProvenance": "machine"` — the translations are machine-written and stored `is_machine: true` (English source rows `false`); they were **LLM-reviewed on 2026-10-05 (two-pass, back-translation; owner-approved in place of native review) and are not human-reviewed**, so provenance stays `machine`; a human review, if ever done, ships as `platform-defaults.v2.json` (runbook §2.5, which holds the per-language decisions). No attestation, no allowlist row (`platform` is reserved).
- **App source.** `seed.requested` → schema parse (failure ⇒ best-effort `seed.failed`/`VALIDATION_ERROR` + redacted DLQ copy) → scope `user` ⇒ `SCOPE_UNSUPPORTED` → flags (`SEEDING_DISABLED`) → **attestation** (introspect via the Security API; needs active, unexpired, a subject, scope `selection-lists:seed`; token not acceptable ⇒ `ATTESTATION_INVALID`, introspection unreachable ⇒ the message is **retried**, up to 5 attempts, then `INTERNAL_ERROR`) → allowlist row + `allowedSubjects` binding (`SOURCE_NOT_ALLOWED`), `keyPrefixes` (`NAMESPACE_VIOLATION`), caps (`LIMIT_EXCEEDED`) → org projection (`ORG_UNKNOWN`/`ORG_INACTIVE`) → ledger → quota (`QUOTA_EXCEEDED`, `KEY_CONFLICT`). All in one transaction; refusal ⇒ nothing written + `seed.failed` in its own transaction. Failure reasons and default `retryable` are in `src/seed/types.ts` (`SEED_FAILURE_RETRYABLE`).
- **Allowlist** = reviewed file `services/selection-list-service/seed-sources.json` (camelCase keys `app`, `allowedSubjects`, `keyPrefixes` (default `["<app>-"]`), `maxListsPerRequest` ≤ 20, `maxItemsPerRequest` ≤ 2000, `enabled`), validated at boot (invalid ⇒ service **refuses to start**) and synced to `selection_list_seed_sources`; removed sources are disabled, not deleted. **Shipped file lists only `platform`**, so every app request is `SOURCE_NOT_ALLOWED` today.
- **Idempotency / versions.** Ledger key `(org, source, pack key, version)` + SHA-256 of the canonical `lists`; `requestId` is only echoed/audited. Same version same content ⇒ `already-applied`; same version different content ⇒ `PACK_CONTENT_MISMATCH`; lower than applied ⇒ `superseded`; higher ⇒ `upgraded`.
- **Seeded-then-edited.** `seed_hash` is recomputed on each upgrade; any human edit to a row's content (list: name/description/status/human translations; item: label/description/status/human translations) means that row is skipped forever (`seed.user_modified: true`). An edited **list** is skipped whole (new items included); an edited **item** is skipped alone. Purged rows are never recreated; dropped lists/items are archived, not deleted; order is never changed, new items append.
- **Limits.** 20 lists / 2000 items / 500 items per list per request; 900 000-byte request ceiling (enforced by the client builders only); org quota applies (default 100 active lists, 500 items/list); the per-user list cap does not.
- **Client helpers (2.0.0).** `buildSeedRequest`, `buildSeedRequestEnvelope`, `seedRequestKafkaKey`, `SEED_REQUESTED_TOPIC` / `SEED_COMPLETED_TOPIC` / `SEED_FAILED_TOPIC`, `SEED_LIMITS`, `SeedRequestValidationError` (TS); `build_seed_request`, `build_seed_request_envelope`, `seed_request_kafka_key`, `SEED_*` constants (Python). Builders default `sourceLocale` to `en` and `trigger` to `app-installed`, enforce the `<app>-` key prefix, and list **every** problem at once; the wire schema itself requires `sourceLocale`.
- **Token acquisition.** A dedicated Authentik `client_credentials` client per requesting service with scope `selection-lists:seed` only (`docs/runbooks/selection-lists-seed-clients.md`); mint with `createServiceAuthClient({ baseUrl: <origin only>, clientId, clientSecret, scope: 'selection-lists:seed' })` from `@fuzefront/service-auth`.
- **Not built / not live (gaps — do not document as working):** user-scoped seeding (`SCOPE_UNSUPPORTED`); the reconciler is **built** (`src/seed/reconciler.ts`) but off unless `SEED_RECONCILER_ENABLED=true`, which the chart does not set; seeded-list owner grants exist for the org owner on platform-seeded lists only (`src/seed/ownerGrants.ts`); the `identity.org.updated` consumer exists; `kafkaTopics.enabled` is `true` in `values-prod.yaml` (verify the Job completed on the cluster; change-event DLQs remain undeclared); the SL9 rollout data jobs and a platform pack v2 (design record §9.4-9.6, §10 task 10) are **not built**.

## MCP surface

There is **no hand-written MCP server** for this feature; it is a **dark OpenAPI gateway**, declared as `selection-list-mcp` in the `mcp.servers[]` block of `.fuze/manifest.json` (alongside `fuzefront-mcp`, the app-registry gateway). `deploy/helm/fuzefront/templates/selection-list-service-mcp-gateway.yaml` runs the shared `ghcr.io/izzywdev/fuze-mcp-gateway` image (`packages/mcp-gateway`) over a Helm copy of the spec (`files/selection-list-service-openapi.yaml`, byte-identical to the service spec; `scripts/check-mcp-spec-drift.sh` guards drift) with `files/mcp-tools-selection-lists.overrides.yaml`. One tool per operation (25 at 4.2.0, including `forkSelectionList`), named by `operationId`; `mcp/tools-selection-lists.json` is the checked-in tool record (`mutates` on every tool). It deploys only when both `selectionListService.enabled` and `selectionListsMcp.enabled` are true (both `false` today) and forwards the caller's bearer token (no service credential), so an agent must present an **org-scoped** token (see Authorization rule 1). Its upstream is `http://fuzefront-selection-list-service:<port>/v1` (the Service's real name; it previously said `selection-list-service`, which matched no Service, review I-1c).

- **`forkSelectionList` (4.1.0)** — `POST /v1/selection-lists/{listId}/fork`, input `{listId, body?: {visibility?: private|org}}` (the body is optional and carries no id). A **WRITE**, `reversibility: reversible` (archive the fork to revert to the common list; purging it is the separate irreversible `deleteSelectionList`), idempotent per (org, source). The override entry only pins that classification; **it adds no authorization** — the service enforces Permit (`SelectionListCatalog:create` + source `read`/`read_shared`) on the forwarded token. It returns `404` until the implementation wave ships the route (the gateway is derived from the frozen contract, not from running code).
- **Override keys are exact `operationId`s and are now enforced.** The overrides file used to be documented as keyed `archiveList` / `archiveItem` / `revokeAccess` with `{itemCode}` / `{grantId}` / `is_active` path comments; they described an older DELETE-as-archive / `is_active` shape and matched no operation, and the gateway silently ignored any key that matched nothing (#1272 shipped them; #1303 rewrote the keys, SL9 task 16 removed the last stale `{grantId}` comment and added the enforcement below). Keys now are `archiveSelectionList`, `archiveSelectionListItem`, `resolveSelectionListItems`, `revokeSelectionListAccess`, `forkSelectionList`; `buildTools` (`packages/mcp-gateway/src/spec.ts`) now **refuses to boot** on an override key that matches no operation, and `packages/mcp-gateway/test/overrides-conformance.test.ts` (run by `gate-mcp-contract.yml` and `mcp-gateway-image.yml`) fails CI on an unknown key and on any `mcp/*.json` tool-name or `mutates` drift. When a spec change renames an operationId, the overrides file and `mcp/tools-selection-lists.json` move in the same PR or CI is red. Do **not** invent tools beyond the spec's operations.

## Tests — where each layer lives

| Layer | Path | Run |
|---|---|---|
| Service unit/route tests (jest, DB mocked; authz no-op under `NODE_ENV=test`) | `services/selection-list-service/tests/*.test.ts` | `npm run -w selection-list-service test` (CI job `selection-list-service-tests`) |
| Independent acceptance + contract + security suite against a **running** service (`SERVICE_BASE_URL`, default `http://localhost:3008`) | `tests/selection-list-service/{contract,security}/` | `npm test` / `test:contract` / `test:security` in that dir; its helper builds an `@fuzeone/selection-list-client` |
| Seeding / outbox / consumers (service; `*.db.test.ts` need a real Postgres, the rest mock it) | `services/selection-list-service/tests/{seed.*,outbox.*,events.*,migrations.seed-events.db.test.ts,flags.seed-defaults.test.ts,failure-containment.test.ts}` | same job |
| Seed-request builders (TS + Python, pinned to the shared golden fixtures `shared/tests/fixtures/selection-lists/`) | `selection-list-client/tests/seed.test.ts`, `packages/selection-list-client-py/tests/test_seed.py` | `vitest` / `pytest` in each dir |
| SL9 shared lists / fork / platform org (service; `*.db.test.ts` need Postgres) | `services/selection-list-service/tests/{shared-lists.*,flags.shared-lists,authz.shared-lists.matrix,seed.visibility.db,migrations.shared-lists.db,boot.platform-org-config}.test.ts`; running-service suites `tests/selection-list-service/contract/shared-lists-*.test.ts` (both flag states + three platform-org-disabled instances on ports 3012-3015, see `ci.yml`) | same jobs |
| SL9 client tests | `selection-list-client/tests/shared-and-fork.test.ts`, `packages/selection-list-client-py/tests/test_shared_and_fork.py` | `vitest` / `pytest` in each dir |
| Python client tests | `packages/selection-list-client-py/tests/test_client.py` | `pip install -e '.[dev]' && pytest` in that dir |
| UI e2e (Playwright, derived from the approved frames; `data-*` hooks from the manifest) | `frontend/tests/selection-lists-{list-management,translation-workbench,access-control,picker}.spec.ts` | CI job `selection-list-service-e2e` ("Selection list E2E") — a **blocking gate**: no `continue-on-error`, required by `Notify Team` |
| UI unit tests (vitest + RTL; `../api` mocked at the module boundary) | `packages/selection-lists-ui/src/test/*.test.ts(x)` — the four flows, the picker (frames 12-14), and `api.test.ts` | `npm test` (= `vitest run`) in the package |
| TS-client ↔ spec coverage | `scripts/check-selection-lists-client-drift.sh` (wired into `ci.yml`, the job that runs `bash scripts/check-selection-lists-client-drift.sh`) | CI, or by hand |
| Contract lint | `selection-list-client`: `npm run lint:contract` (Spectral, `services/selection-list-service/.spectral.yaml`) | by hand |

There are **no Playwright specs for the shared-lists UI on master** (RED specs were an open PR when this was written). API tests are `test-engineer`'s; UI e2e is `frontend-test-engineer`'s. Documentation work never edits them.

## Contract-first rule (non-negotiable)

`openapi.yaml` is the single source of truth. **Never edit it, and never add/rename/remove a route, field, status code, or error shape, without going through `contract-designer`** (amend the spec first, bump `info.version`, re-lint with Spectral, re-issue/re-sync the clients, update the Helm copy with `scripts/check-mcp-spec-drift.sh --fix`, then fan out implementation per the `api-contract-first` skill). Both clients are *hand-written projections* of the spec — a spec change is not done until the TS client, the Python client, `scripts/check-selection-lists-client-drift.sh`'s mapping table, and this skill's operation table are updated in the same pass. Ownership: `contract-designer` spec · `backend-engineer` service/client build · `frontend-engineer` UI (after `product-designer` frames) · `database-engineer` migrations (`src/db/migrations/`) · `devops-engineer` Helm/CI · `feature-flags-engineer` flag admin · `mcp-maintainer` the gateway wiring.

## Known doc/code discrepancies to fix at the source (not here)

- **Fixed since the last pass (do not re-report):** `selection-list-client` is a root `package.json` `workspaces` entry, so `packages-publish.yml` publishes it (registry presence is not verifiable from this session); port references all say `3008` (service default, Dockerfile, OpenAPI `servers` example, Python README); the flag-context org-id format gap (`buildFlagContext` canonicalises to `org_…`/`usr_…`, SL8); the reconciler (SL7, `src/seed/reconciler.ts`, off unless `SEED_RECONCILER_ENABLED=true`); the `identity.org.updated` consumer (SL8); the org-owner `list-owner` grant on platform-seeded lists (SL8); the prod `kafkaTopics` Job (`enabled: true`); the MCP override keys; the Python/TS README install and port text; `scripts/check-selection-lists-client-drift.sh` is wired into `ci.yml`; `getEffectiveList` / `get_effective_list` follow the cursor through empty non-terminal pages (clients 2.2.0).
- **Contract 4.1.0 is implemented but dark, and the UI is not built.** Remaining gaps, each with an owner: (a) the shared-lists UI (frames approved; implementation + RED specs open as PRs on 2026-10-26) → `frontend-engineer` / `frontend-test-engineer`; (b) **contract 4.2.0 `SelectionList.revision` is not emitted yet (gap, by design — contract-first).** `src/routes/listShape.ts` neither selects `sl.revision` in `LIST_COLUMNS` nor writes it in `formatList`, so responses omit it and clients read *unknown*; the 4.2.0 spec therefore declares it **optional**. No migration is needed — the column exists. Work list: `docs/planning/selection-lists-shared-and-fork.md` §13 → `backend-engineer`, then `test-engineer`; (c) the spec still types `visibility`/`forked_from`/`origin_item_id` optional (and says "until the implementation ships") though the service always emits them → `contract-designer`, MINOR tightening; (d) a `403` with `reason: platform_suspended` is outside the spec's `ErrorReason` enum (`src/middleware/listAccess.ts` `PLATFORM_SUSPENDED_BODY`) → `contract-designer`; (e) the rollout data jobs and platform pack v2 → `backend-engineer` + `database-engineer`; (f) `src/flags.ts` carries a stale `TODO(#1461)` about the flag key not being in `@fuzefront/feature-flags` → `backend-engineer`.
- **Production enablement prerequisites that this repo cannot confirm:** broker ACLs on `identity.*` (FuzeInfra#1394); that the platform org (`org_0000000000000000000000000g`) actually has a confirmed row in `selection_list_ref_index` (**inferred risk**: the root org is created by `backend/security/src/migrations/014_seed_root_platform_organization.ts`, which publishes no event, and the projection is fed only by `identity.org.created`/`.updated`) — until it does, `resolvePlatformOrgId()` returns null and every platform feature stays disabled; the live Unleash state of the three flags; the live Permit schema sync.
- **App-seeded lists still get no `list-owner`** (the requesting app must grant); the org owner is granted on platform-seeded lists only. Seed-list `visibility: org` (flag ON) is the member-visibility fix, but nothing that ships declares it.
- **`prod-unleash-ops`**: the `selection-lists` ramp set is the master flag only and percentage-only; no workflow enables `shared-lists`, and there is no per-org targeting. → `feature-flags-engineer` / `devops-engineer`.
- Change-event DLQs (`<topic>.dlq`) remain undeclared in the chart (rely on broker auto-create).

## Doc-validity checklist for edits to this skill

Re-run before claiming it current: (1) operation count `grep -c 'operationId:' services/selection-list-service/openapi.yaml` == 25 and equals the table rows; (2) every path above exists (`git ls-files`); (3) the TS block type-checks against `selection-list-client/src` with `tsc --noEmit --strict`; (4) Python block imports and runs against a stub server; (5) re-check each **(gap)** — delete it the moment the code is fixed.
