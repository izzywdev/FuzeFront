---
name: selection-lists
description: Use when building on, calling, extending, testing, or documenting the FuzeFront selection-lists feature (FF-EPIC-17) — org-scoped, translatable reference-data lists (countries, industries, ticket priorities) served by `selection-list-service`. Covers the domain model (list / item / translation / access grant / quota), the 24-operation contract and its frozen-spec rule, calling it from `@fuzeone/selection-list-client` (TS) and `fuzefront-selection-list-client` (Python), embedding the picker from `@fuzeone/selection-lists-ui`, the id/authz rules (service mints ids; an id is never a capability), the `fuzefront.selection-lists.service` flag, where each test layer lives, and the known code-vs-contract gaps. Owned by docs-maintainer; claims verified against source at the commit noted below.
---

# selection-lists

A **selection list** is a named, **org-scoped**, ordered set of **translatable** choices (`countries`, `ticket-priorities`) that consuming apps render in dropdowns and persist **by item id**. `selection-list-service` owns exactly three things: list/item structure, per-locale translations of both, and per-list access grants.

**Verified against** `origin/master` @ `a0de54f2` (2026-10-04). Everything below is read from code unless marked **(inferred)** or **(gap)**. If the spec and any other file disagree, **the spec wins** (`services/selection-list-service/openapi.yaml`, v2.0.0, FROZEN — FFRNT-187).

## Where things live

| Thing | Path | Package / name |
|---|---|---|
| Frozen contract (24 operations) | `services/selection-list-service/openapi.yaml` | — |
| Service (Express + Knex/Postgres, port `PORT` default **3011**) | `services/selection-list-service/` | `selection-list-service` (root workspace) |
| TS client (hand-authored, zero deps) | `selection-list-client/` (**repo root, not `packages/`**) | `@fuzeone/selection-list-client` 1.0.0 |
| Python client (stdlib `urllib`, zero deps) | `packages/selection-list-client-py/` | `fuzefront-selection-list-client` 1.0.0 |
| UI (4 flows + picker) | `packages/selection-lists-ui/` | `@fuzeone/selection-lists-ui` 0.2.0 |
| Approved design frames (14 screens) | `design/frames/selection-lists/` (`manifest.json`, `index.html`) | — |
| Helm | `deploy/helm/fuzefront/templates/selection-list-service-*.yaml`, `values*.yaml` → `selectionListService`, `selectionListsMcp` | — |
| Epic / plan | `docs/planning/epics/EPIC-17-selection-lists.md` | — |

The `@fuzeone` scope (not `@fuzefront`) is deliberate for this feature — see `design/frames/selection-lists/manifest.json` `packagesNote`.

## Domain model

All resource fields are `snake_case`; only the pagination envelope (`page.nextCursor`, `page.hasMore`, `page.total`) is camelCase (family standard, `governance/pagination-standard.md`).

- **SelectionList** — `id` (`front_sl_…`), `organization_id`, `key` (org-unique slug `^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$`), `source_locale`, `status` (`active|archived`), resolved `name`/`description`, `resolved_locale`, `is_machine`, `item_count?`.
- **SelectionListItem** — `id` (`front_sli_…`), `list_id`, `code` (list-unique interop key `US`/`HIGH`; **immutable after create**, never translated, never shown to end users), `sort_order` (gapped by 100), `status`, resolved `label`/`description`, `resolved_locale`, `is_machine`.
- **Translations** live in `*_translations` rows keyed by locale — never on the entity. Every list/item representation returns resolved text. **Locale fallback (fixed):** `locale` query param → first supported `Accept-Language` → list `source_locale` → `en`. A label is **never `null`**. `source_hash` = hash of the source text a translation was made from (staleness detection for autofill). Supported locales (11): `en es fr de pt ru zh ja hi ar he`.
- **Access grant** — per-list ReBAC role: `list-owner`, `list-editor`, `list-contributor`, `list-translator`, `list-viewer` (roles do not stack). Matrix of actions per role is in the spec's `info.description` § Authorization.
- **Quota** — four scopes `org_lists`, `user_lists`, `list_items`, `list_locales`. Platform defaults (`src/services/quota.service.ts`): 100 lists/org, 20 lists/user, 500 items/list, 11 locales/list; per-org override row wins. Counts **active rows only** (archived don't consume quota); the check is a soft limit (no transaction around check+insert). Exceeding returns **`403` with `code: QUOTA_EXCEEDED`** plus `scope`, `limit`, `current` — not a distinct status.
- **Archive is the default; purge is explicit.** `DELETE …?purge=false|absent` archives (reversible via `PATCH {status:"active"}`); `?purge=true` is irreversible and cascades. Archived items still **resolve** (with `status:"archived"`) so consumer rows keep rendering a label. Only purged/never-existed ids come back in `missing`.
- **Errors** — body `{code, message, scope?, limit?, current?, details?[{field,message}]}`; codes `VALIDATION_ERROR UNAUTHENTICATED FORBIDDEN NOT_FOUND CONFLICT QUOTA_EXCEEDED`. Conflicts: duplicate list `key`/item `code`; demoting or revoking the **last `list-owner`** → `409`.
- **Events** — the service consumes `identity.org.deleted` and user-deletion events (`src/events/`) to cascade-clean per-org data; the HTTP contract itself defines no events.

### The 24 operations (spec `operationId` → TS method → Python method)

| operationId | HTTP | TS (`SelectionListClient`) | Python |
|---|---|---|---|
| listSelectionLists | GET `/v1/selection-lists` | `getLists` | `get_lists` |
| createSelectionList | POST `/v1/selection-lists` | `createList` | `create_list` |
| getSelectionList | GET `/v1/selection-lists/{listId}` | `getList` | `get_list` |
| updateSelectionList | PATCH `…/{listId}` | `updateList` | `update_list` |
| deleteSelectionList | DELETE `…/{listId}[?purge=true]` | `deleteList` | `delete_list` |
| archiveSelectionList | POST `…/{listId}/archive` | `archiveList` | `archive_list` |
| listSelectionListItems | GET `…/{listId}/items` | `getItems` | `get_items` |
| createSelectionListItem | POST `…/{listId}/items` | `createItem` | `create_item` |
| reorderSelectionListItems | PUT `…/{listId}/items/reorder` | `reorderItems` | `reorder_items` |
| updateSelectionListItem | PATCH `…/items/{itemId}` | `updateItem` | `update_item` |
| deleteSelectionListItem | DELETE `…/items/{itemId}[?purge=true]` | `deleteItem` | `delete_item` |
| archiveSelectionListItem | POST `…/items/{itemId}/archive` | `archiveItem` | `archive_item` |
| listSelectionListTranslations | GET `…/{listId}/translations` | `listTranslations` | `list_translations` ¹ |
| upsertSelectionListTranslation | PUT `…/translations/{locale}` | `upsertListTranslation` | `upsert_list_translation` |
| deleteSelectionListTranslation | DELETE `…/translations/{locale}` | `deleteListTranslation` | `delete_list_translation` ¹ |
| listSelectionListItemTranslations | GET `…/items/{itemId}/translations` | `listItemTranslations` | `list_item_translations` ¹ |
| upsertSelectionListItemTranslation | PUT `…/items/{itemId}/translations/{locale}` | `upsertItemTranslation` | `upsert_item_translation` |
| deleteSelectionListItemTranslation | DELETE `…/items/{itemId}/translations/{locale}` | `deleteItemTranslation` | `delete_item_translation` ¹ |
| autofillSelectionListTranslations | POST `…/translations/{locale}/autofill` | `autofillTranslations` | `autofill_translations` |
| listSelectionListAccess | GET `…/{listId}/access` | `getAccess` | `get_access` |
| setSelectionListAccess | PUT `…/access/{userId}` | `setAccess` | `set_access` |
| revokeSelectionListAccess | DELETE `…/access/{userId}` | `revokeAccess` | `revoke_access` |
| getSelectionListQuota | GET `/v1/selection-lists/quota` | `getQuota` | `get_quota` |
| resolveSelectionListItems | POST `/v1/resolve` | `resolveIds` | `resolve_ids` |

¹ The Python client on `master` @ `a0de54f2` has 20 methods; these four translation read/delete methods are being added by a sibling PR. The names follow the mechanical TS→snake_case mapping **(inferred)** — confirm against `client.py` once that PR merges. The TS client has all 24 (`scripts/check-selection-lists-client-drift.sh` holds the canonical operationId→TS-method table).

## Calling it from TypeScript

Paths include `/v1/…`, so `baseUrl` is the **prefix before `/v1`**. In the browser it must be same-origin (`'/api'` yields `/api/v1/selection-lists`, which is what `@fuzeone/selection-lists-ui` calls) — never an absolute host. Cluster-internal callers use `http://fuzefront-selection-list-service:3011` (the spec's default server).

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
    base_url="http://fuzefront-selection-list-service:3011",  # http/https only
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

Build/consume rules: use design-system tokens only (no raw hex/spacing); the UI's own `src/api.ts` calls the **same-origin** base `/api/v1/selection-lists` and `/api/v1/resolve`; changing UI behaviour needs an approved frame first (`gate-frames-first`; frames are authored only by `product-designer`, in `design/frames/selection-lists/` in this repo).

**Picker** — props are a discriminated union on `mode`: single takes `initialValue?: string` and `onChange(value: string)`; multi takes `initialValue?: string[]`, `max?`, and `onChange(value: string[])` (ids in the list's `sort_order`, same as the hidden `[data-persisted]` slot). It accepts the list **key** and looks the list up with the contract's exact-match `GET /v1/selection-lists?key=` filter (one call, no page walking; a `front_sl_…` id is used as-is), then reads the items by id. Seeding from `initialValue` never fires `onChange`, and all seeded ids are resolved in **one** `POST /v1/resolve` (`api.resolveItems` de-duplicates and only splits above the contract's 500-id cap). Stored values that are no longer offerable follow frame 14: an **archived** id renders its real label badged and is kept until the user removes it (multi chip ×) or replaces it (single); a **purged/unknown** id renders "Unknown value" (`[data-state="missing"]`, `[data-missing="true"]`, `[data-error="missing"]`) and is kept in the form until the user picks a replacement — single: the pick replaces it; multi: the next pick swaps one purged id out (or the chip × removes it) — after which the notice clears and the picker returns to frame 12/13. The harness route takes `?value=` as one id (single) or several (multi; repeated or comma-separated). `api.resolveItems` maps the contract's `{ results: { [id]: … }, missing }` body to the UI's `resolved[]` shape.

## Authorization and ownership rules

1. **Org scope comes from the token, never the body.** `organization_id` and the acting user derive from the Bearer JWT (`src/middleware/auth.ts` accepts `userId`/`sub` and `orgId`/`organization_id`/`organizationId`). Every list/item query in the routes filters by `req.orgId`. A cross-org or unentitled read returns **`404`, not `403`** (no existence oracle).
2. **The service mints ids** (`mintId('selectionList'|'selectionListItem')` from `@izzywdev/fuzefront-identity` → `front_sl_…` / `front_sli_…`, TypeID). Create bodies carry no `id` and set `additionalProperties: false`. Ids are opaque past the prefix — validate the prefix, never parse further. Referenced spine ids keep their own prefixes (`org_`, `usr_`). Standard: `governance/identifier-standard.md`.
3. **An id is never a capability.** Knowing a list or item id grants nothing; routes re-check org scope (and, for access routes, the Security API). `POST /v1/resolve` returns only `{label, locale, is_machine, status}` — never list key, org, or anything else an id alone shouldn't unlock; max **500 ids** per call.
4. **Authorization backend:** FuzeFront's Security API (`backend/security` `/api/v1/security/authz/*`) via `@fuzefront/auth`'s `AuthzClient` — no vendor SDK in the service. Resource `SelectionList`, instance-scoped by `{type:'SelectionList', key: listId}`. **Fails closed** (Security API error → `403`). `selection_list_access` is a **read-model mirror only** — never consulted for authz decisions, only for the roster and the last-owner guard.
5. **Never route authz through the feature flag.** `fuzefront.selection-lists.service` is rollout, not entitlement (see below).

**(gap) Code vs. contract, as shipped @ `a0de54f2`** — do not describe the matrix in the spec as fully enforced:
- Per-role Security-API checks (`requireAuthzCheck`) are wired **only on the three `/access` routes**; list/item/translation routes enforce **org scope** but not the per-role matrix.
- Those access routes check action `manage_access`. Authorization is **always enforced when `NODE_ENV=production`** (`isAuthzEnforced()` in `src/middleware/authz.flags.ts` never reads the env var there); `FUZEFRONT_SELECTION_LIST_AUTHZ_ENABLED=true` is only a dev/test switch outside production (default OFF = pass-through + warning). Grant/revoke WRITES are authenticated with the service's own machine identity (`src/lib/machineIdentity.ts`, client_credentials, scope `authz:admin`), never the end user's token.
- `grantListOwner()` (writes the creator's `list-owner` grant) is defined in `src/middleware/authz.ts` but **no route calls it** (grep), so creating a list does not currently seed an owner grant.
- `/v1/resolve` **requires a Bearer token** with an `orgId` claim (spec v2.0.0 closed the earlier anonymous-resolve gap; clients send the token on `resolveIds`).
- Spec says purge needs `delete` (list-owner only); no per-role check exists on the purge path in the route handlers.
These belong to `backend-engineer` (and `contract-designer` if the *spec* should change instead). Do not paper over them in docs.

## Feature flag

`fuzefront.selection-lists.service` — **release**, **default OFF**, owner platform team, Jira FFRNT-201, `web_exposed: true` (`packages/feature-flags/flag-registry.yaml`; key constant `FLAG_KEYS.SELECTION_LISTS_SERVICE`).

- **Server:** `isSelectionListsEnabled()` in `services/selection-list-service/src/flags.ts`, called at the top of every list/item/translation/quota/resolve handler. OFF → `404 NOT_FOUND` (body message "Not found." or "Service not enabled."). Fails closed: no flag client or any client error → OFF. Org-targeted: context carries `orgId`.
- **Local/CI only:** `FLAGS_FORCE_ON=fuzefront.selection-lists.service` forces ON, hard-disabled when `NODE_ENV=production`. Prod targeting is Unleash only (`unleash-flag-enable` skill; flag administration is `feature-flags-engineer`).
- **UI:** sidebar entry + each `/settings/selection-lists/*` route gated by `useFlag(...)`.
- **Deploy gate (separate from the flag):** Helm `selectionListService.enabled` and `selectionListsMcp.enabled` are `false` in `values.yaml`; `values-prod.yaml` sets `selectionListService.enabled: false` (image tag pinned). The chart routes `/api/v1/selection-lists` and `/api/v1/resolve` to the service via `templates/ingress.yaml` (nginx rewrite annotation; a `selection-list-service-stripprefix` Middleware under Traefik), gated on `selectionListService.enabled`.
- Plan any new work on this feature behind this flag (default OFF), test **both** states (`services/selection-list-service/tests/flags.force-on.test.ts` shows the pattern), and see the `feature-flags` skill for the family rules.

## MCP surface

There is **no per-repo MCP server** for this feature: no `mcp/` directory exists, and the `mcp.servers[]` block in `.fuze/manifest.json` declares only `fuzefront-mcp` (the app-registry gateway). What does exist is a **dark, chart-only OpenAPI gateway**: `deploy/helm/fuzefront/templates/selection-list-service-mcp-gateway.yaml` runs the shared `ghcr.io/izzywdev/fuze-mcp-gateway` image over a Helm copy of the spec (`files/selection-list-service-openapi.yaml`, byte-identical to the service spec at verification time; `scripts/check-mcp-spec-drift.sh` guards drift) with `files/mcp-tools-selection-lists.overrides.yaml`. It deploys only when both `selectionListService.enabled` and `selectionListsMcp.enabled` are true (both `false` today) and forwards the caller's bearer token (no service credential).

**(gap, unverified)** the overrides file keys (`archiveList`, `archiveItem`, `revokeAccess`) and its path comments (`{itemCode}`, `{grantId}`, `is_active`) do not match the frozen spec's operationIds (`archiveSelectionList`, `revokeSelectionListAccess`, …) or paths (`{itemId}`, `{userId}`); whether the gateway silently ignores unknown override keys was not verified. Route to `mcp-maintainer`. Do **not** invent an MCP server or tool list for selection lists.

## Tests — where each layer lives

| Layer | Path | Run |
|---|---|---|
| Service unit/route tests (jest, DB mocked; authz no-op under `NODE_ENV=test`) | `services/selection-list-service/tests/*.test.ts` | `npm run -w selection-list-service test` (CI job `selection-list-service-tests`) |
| Independent acceptance + contract + security suite against a **running** service (`SERVICE_BASE_URL`, default `http://localhost:3011`) | `tests/selection-list-service/{contract,security}/` | `npm test` / `test:contract` / `test:security` in that dir; its helper builds an `@fuzeone/selection-list-client` |
| Python client tests | `packages/selection-list-client-py/tests/test_client.py` | `pip install -e '.[dev]' && pytest` in that dir |
| UI e2e (Playwright, derived from the approved frames; `data-*` hooks from the manifest) | `frontend/tests/selection-lists-{list-management,translation-workbench,access-control,picker}.spec.ts` | CI job `selection-list-service-e2e` ("Selection list E2E") — a **blocking gate**: no `continue-on-error`, required by `Notify Team` |
| UI unit tests (vitest + RTL; `../api` mocked at the module boundary) | `packages/selection-lists-ui/src/test/*.test.ts(x)` — the four flows, the picker (frames 12-14), and `api.test.ts` | `npm test` (= `vitest run`) in the package |
| TS-client ↔ spec coverage | `scripts/check-selection-lists-client-drift.sh` (**not** wired into `ci.yml`) | run by hand |
| Contract lint | `selection-list-client`: `npm run lint:contract` (Spectral, `services/selection-list-service/.spectral.yaml`) | by hand |

API tests are `test-engineer`'s; UI e2e is `frontend-test-engineer`'s. Documentation work never edits them.

## Contract-first rule (non-negotiable)

`openapi.yaml` is the single source of truth. **Never edit it, and never add/rename/remove a route, field, status code, or error shape, without going through `contract-designer`** (amend the spec first, bump `info.version`, re-lint with Spectral, re-issue/re-sync the clients, update the Helm copy with `scripts/check-mcp-spec-drift.sh --fix`, then fan out implementation per the `api-contract-first` skill). Both clients are *hand-written projections* of the spec — a spec change is not done until the TS client, the Python client, `scripts/check-selection-lists-client-drift.sh`'s mapping table, and this skill's operation table are updated in the same pass. Ownership: `contract-designer` spec · `backend-engineer` service/client build · `frontend-engineer` UI (after `product-designer` frames) · `database-engineer` migrations (`src/db/migrations/`) · `devops-engineer` Helm/CI · `feature-flags-engineer` flag admin · `mcp-maintainer` the gateway wiring.

## Known doc/code discrepancies to fix at the source (not here)

- `SELECTION_LIST_ID_PREFIX = 'sl_'` / `SELECTION_LIST_ITEM_ID_PREFIX = 'sli_'` in both clients' `types.ts` contradict the spec/service (`front_sl_` / `front_sli_`). Do not use those constants for prefix validation. → `backend-engineer`.
- `selection-list-client/README.md` shows `baseUrl: '/api/selection-lists'` (which would request `/api/selection-lists/v1/selection-lists`) and ids like `sli_01h4…`; correct usage is `baseUrl: '/api'` and `front_sli_…`. The Python README names its peer as `@fuzefront/selection-list-client` (it is `@fuzeone/…`).
- `@fuzeone/selection-list-client` is **not published**: `selection-list-client` is absent from root `package.json` `workspaces`, the one list `scripts/publish-packages.mjs` reads (per that README). Install it from a local `npm pack` until fixed. (`@fuzeone/selection-lists-ui` is a workspace.)
- Port references disagree: service default `3011` (spec, Dockerfile, `index.ts`) vs Helm `selectionListService.port: 3008` (the deployment sets `PORT` from it). In-cluster callers should use the Helm Service + port, not `3011`.

## Doc-validity checklist for edits to this skill

Re-run before claiming it current: (1) operation count `grep -c 'operationId:' services/selection-list-service/openapi.yaml` == 24 and equals the table rows; (2) every path above exists (`git ls-files`); (3) the TS block type-checks against `selection-list-client/src` with `tsc --noEmit --strict`; (4) Python block imports and runs against a stub server; (5) re-check each **(gap)** — delete it the moment the code is fixed.
