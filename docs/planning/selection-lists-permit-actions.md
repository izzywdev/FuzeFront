# Selection lists — authorization resources, actions and roles (contract 3.0.0, amended 4.0.0 and 4.1.0)

**Status:** contract change (H-3). Frozen in
`services/selection-list-service/openapi.yaml` `info.version: 3.0.0`; the vendored
Helm copy `deploy/helm/fuzefront/files/selection-list-service-openapi.yaml` is
byte-identical. This document is the design record behind that change. **The spec
is normative; if this document and the spec disagree, the spec wins** and this
document is stale.

**4.0.0 amendment (L-1):** `updateSelectionList` with body `status: archived`
additionally requires `SelectionList:delete` (`x-permit-additional-actions`), so
PATCH is no longer a way for a `list-editor` to reach the archive outcome that
`DELETE`/`POST .../archive` reserve for `delete`. The service already
enforces it (#1253: `requireArchiveAuthzOnStatusChange` in `routes/lists.ts`; the
item-purge `delete` check in `routes/items.ts`; pinned by
`tests/authz.route-matrix.test.ts`) — 4.0.0 brings the contract up to the code. 4.0.0 also widens `created_by`/`granted_by` and adds `seed`; see the spec
changelog and `selection-lists-events.md` §13.1.

**4.1.0 amendment (shared lists, common lists, forks):** design record
[`selection-lists-shared-and-fork.md`](selection-lists-shared-and-fork.md).
`SelectionListCatalog` gains `read_shared` (every customer tenant role — the
membership proof behind list `visibility`) and `publish_platform` (`admin`,
effective only in the platform organization's tenant). New operation
`forkSelectionList` (catalog `create` + source `read`). Read operations declare
`x-permit-shared-read`: their `SelectionList:read` may instead be satisfied by
`read_shared` plus the service-owned visibility predicate. New
`x-permit-additional-actions` on create/update/delete/item-delete (rows below).
Tenant roles still confer **zero** `SelectionList:*` actions; there is still no
admin → owner derivation.

**Who builds what (not this PR):**

| Stream | Branch / owner | Work |
|---|---|---|
| Route enforcement | `claude/sl5-h3-service` (backend) | `requireAuthzCheck(<x-permit-resource>, <x-permit-action>)` per operation; the extra `delete` check on item purge; creator `list-owner` grant via machine identity |
| Permit schema | separate agent | `SelectionListCatalog` resource + tenant-role grants exactly as tabled below |
| Acceptance tests | test-engineer | deny paths for every row of the tables below |

---

## 1. Why the model changed

Through 2.0.0 every operation was checked against one resource type,
`SelectionList`, with one action vocabulary. That vocabulary had to serve two
different questions, and it served neither well:

1. **"May this caller work with selection lists in this org at all?"** —
   listing, creating, reading the quota, resolving ids. There is no list
   instance to check against for any of these (the list does not exist yet, or
   the request spans many lists), so the check ran against the bare
   `SelectionList` type at tenant scope. Satisfying it therefore required a
   **tenant-wide** grant of `SelectionList:read` / `SelectionList:add_value` —
   and a tenant-wide grant of `read` is also a grant of `read` on **every list
   instance** in the org. The per-list ReBAC roles were decorative for anyone
   who could list at all.
2. **"What may this caller do to this list?"** — the eight per-list actions,
   which the five instance roles were designed to answer.

3.0.0 gives each question its own resource type, so a tenant role can answer
the first without silently answering the second.

## 2. Resources

| Resource | Scope | Instance key | Answers |
|---|---|---|---|
| `SelectionListCatalog` | tenant-level (the caller's organization) | none | "may this caller work with selection lists in this org?" |
| `SelectionList` | resource instance | the `front_sl_` list id | "what may this caller do to *this* list?" |

## 3. Operation → resource → action (the full matrix)

| operationId | Method + path | `x-permit-resource` | `x-permit-action` | Notes |
|---|---|---|---|---|
| `listSelectionLists` | `GET /v1/selection-lists` | `SelectionListCatalog` | `list` | rows still filtered per list by `SelectionList:read`; `403` declared; with `include_shared=true` the filter also admits shared reads (4.1.0) |
| `createSelectionList` | `POST /v1/selection-lists` | `SelectionListCatalog` | `create` | service then grants the creator `list-owner` with **its machine identity**; with body `visibility: platform` ALSO `SelectionListCatalog:publish_platform` (platform org only) — 4.1.0 |
| `forkSelectionList` | `POST /v1/selection-lists/{listId}/fork` | `SelectionListCatalog` | `create` | ALSO `SelectionList:read` on the source (grant, or shared read via `read_shared`); service grants the forker `list-owner` — 4.1.0 |
| `getSelectionList` | `GET /v1/selection-lists/{listId}` | `SelectionList` | `read` | `404`, never `403`, when denied; shared read (4.1.0) |
| `updateSelectionList` | `PATCH /v1/selection-lists/{listId}` | `SelectionList` | `update` | **with body `status: archived` ALSO `SelectionList:delete`** (`x-permit-additional-actions`) — L-1, 4.0.0; with body `visibility` ALSO `SelectionList:manage_access`, and with `visibility: platform` ALSO `SelectionListCatalog:publish_platform` — 4.1.0 |
| `deleteSelectionList` | `DELETE /v1/selection-lists/{listId}` | `SelectionList` | `delete` | archive and purge alike; purge of a `platform` list ALSO `SelectionListCatalog:publish_platform` — 4.1.0 |
| `archiveSelectionList` | `POST /v1/selection-lists/{listId}/archive` | `SelectionList` | `delete` | |
| `listSelectionListItems` | `GET .../{listId}/items` | `SelectionList` | `read` | shared read (4.1.0) |
| `createSelectionListItem` | `POST .../{listId}/items` | `SelectionList` | `add_value` | |
| `reorderSelectionListItems` | `PUT .../{listId}/items/reorder` | `SelectionList` | `update_value` | |
| `updateSelectionListItem` | `PATCH .../{listId}/items/{itemId}` | `SelectionList` | `update_value` | |
| `deleteSelectionListItem` | `DELETE .../{listId}/items/{itemId}` | `SelectionList` | `remove_value` | **with `purge=true` ALSO `SelectionList:delete`** (`x-permit-additional-actions`) — M-1; purge on a `platform` list ALSO `SelectionListCatalog:publish_platform` — 4.1.0 |
| `archiveSelectionListItem` | `POST .../{listId}/items/{itemId}/archive` | `SelectionList` | `remove_value` | |
| `listSelectionListTranslations` | `GET .../{listId}/translations` | `SelectionList` | `read` | shared read (4.1.0) |
| `listSelectionListItemTranslations` | `GET .../items/{itemId}/translations` | `SelectionList` | `read` | shared read (4.1.0) |
| `upsertSelectionListTranslation` | `PUT .../{listId}/translations/{locale}` | `SelectionList` | `translate` | |
| `deleteSelectionListTranslation` | `DELETE .../{listId}/translations/{locale}` | `SelectionList` | `translate` | |
| `upsertSelectionListItemTranslation` | `PUT .../items/{itemId}/translations/{locale}` | `SelectionList` | `translate` | |
| `deleteSelectionListItemTranslation` | `DELETE .../items/{itemId}/translations/{locale}` | `SelectionList` | `translate` | |
| `autofillSelectionListTranslations` | `POST .../{listId}/translations/{locale}/autofill` | `SelectionList` | `translate` | |
| `listSelectionListAccess` | `GET .../{listId}/access` | `SelectionList` | `manage_access` | |
| `setSelectionListAccess` | `PUT .../{listId}/access/{userId}` | `SelectionList` | `manage_access` | last-owner guard → `409` |
| `revokeSelectionListAccess` | `DELETE .../{listId}/access/{userId}` | `SelectionList` | `manage_access` | last-owner guard → `409` |
| `getSelectionListQuota` | `GET /v1/selection-lists/quota` | `SelectionListCatalog` | `read_quota` | `403` declared |
| `resolveSelectionListItems` | `POST /v1/resolve` | `SelectionListCatalog` | `resolve` | no per-list `read` check — L-4 |

All 25 operations carry both extensions; there is no operation without an
`x-permit-resource`. "Shared read" in the notes means the operation also
declares `x-permit-shared-read` (4.1.0): for a list whose `visibility` is not
`private`, its `SelectionList:read` is equally satisfied by
`SelectionListCatalog:read_shared` in the caller's tenant **plus** the
service-owned predicate (`org` → same organization, `platform` → always).
Per-list **mutations** never accept the shared read; on a `platform` list the
caller holds no role on they answer `409 CONFLICT` / `reason: fork_required`
(if the caller holds `SelectionListCatalog:create`) or `403`.

## 4. Who holds which action

### 4.1 Tenant roles → `SelectionListCatalog` (the only thing tenant roles grant here)

| tenant role | `list` | `create` | `read_quota` | `resolve` | `read_shared` | `publish_platform` |
|---|---|---|---|---|---|---|
| `admin` | x | x | x | x | x | x |
| `editor` | x | x | | x | x | |
| `viewer` | x | | | x | x | |
| `developer` | | | | | | |

These names are exact; the Permit-schema stream implements them verbatim
(`backend/src/permit/schema.ts`, `backend/security/src/permit/schema.ts`).

* `read_shared` (4.1.0) is held by **every customer tenant role** — a plain
  member is `editor` (`role-assignment.ts`: member → editor). It is the
  membership proof behind `visibility`: Permit decides *who is a member*, the
  service decides *what the list's visibility is*. `developer` is excluded
  deliberately: it is the root-org developer-portal role, which must not read
  tenant data (`docs/planning/developers-portal.md` §5.3) and holds no catalog
  action at all, so `read_shared` would be inert for it anyway.
* `publish_platform` (4.1.0) is in `admin` but is only **effective in the
  platform organization's tenant**: the service evaluates it with the platform
  organization as the tenant and also requires the caller to be acting in that
  organization. A customer-org `admin` therefore holds the action in its own
  tenant and still cannot publish a common list.

### 4.2 Instance roles → `SelectionList` (per list)

| role | read | add_value | update_value | remove_value | translate | update | delete | manage_access |
|---|---|---|---|---|---|---|---|---|
| `list-owner` | x | x | x | x | x | x | x | x |
| `list-editor` | x | x | x | x | x | x | | |
| `list-contributor` | x | x | x | | x | | | |
| `list-translator` | x | | | | x | | | |
| `list-viewer` | x | | | | | | | |

**Per-list actions are instance-only.** No tenant role confers any
`SelectionList:*` action. An org `admin` who holds no instance role on a list
cannot read, edit, translate, archive or purge it — see §5 for how an admin
gets in when it must.

Derived consequences worth stating, because each is a test case:

* Item **purge** = `remove_value` + `delete` → `list-owner` only. A
  `list-editor` can archive an item but gets `403` on `?purge=true`.
* List **archive via PATCH** (`{"status": "archived"}`) = `update` + `delete`
  → `list-owner` only (4.0.0, review L-1), matching `DELETE` and
  `POST .../archive`. A `list-editor` gets `403` for that body and can still
  PATCH every other field.
* A tenant `viewer` can list (and sees only lists it holds an instance role
  on), and can resolve ids, but cannot create.
* A tenant `editor` can create; the new list is its own (`list-owner`) because
  the service grants it, not because `editor` implies anything per list.
* A tenant `developer` gets `403` on list/create/quota/resolve, and `404` on
  every per-list route unless it holds an instance role.

## 5. Tenant administrators and the support path

There is **no** automatic `admin` (or `org-admin`) → `list-owner` derivation in
3.0.0. This was considered and rejected **as specified**, because it would be
inert:

* A ReBAC derivation needs a relation tuple `SelectionList:<id> --organization-->
  Organization:<org>`, and nothing in the service or the Security API creates
  that tuple today.
* Only FuzeOne staff hold the ReBAC `org-admin` instance role on
  `Organization`; customer organization administrators hold the **tenant**
  role `admin`. A derivation keyed on `org-admin` would therefore never fire
  for the people it was meant for.

What *does* work, verified in code: a tenant `admin` holds
`Organization:manage`, and the Security API's grant gate
(`backend/security/src/services/authz-gate.ts`, `authorizeGrantMutation`,
`TENANT_ADMIN_RESOURCE = 'Organization'`, `TENANT_ADMIN_ACTION = 'manage'`)
treats that as authority to grant any role in the tenant. So the support path
is:

```
POST /api/v1/security/authz/grants
{ "subject": "<admin user>", "tenant": "<org>", "role": "list-owner",
  "resource": { "type": "SelectionList", "key": "front_sl_..." } }
```

That is explicit and audited (it lands in the grant log), which is arguably the
right property for "an admin reached into a list they don't own". Note it
writes only to the authorization backend; the service's
`selection_list_access` read-model mirror will not show the grant until the
service reconciles it (see open question Q4).

## 6. Migration notes for existing grants

The wire surface is unchanged, so **no client changes and no client version
bumps**. What changes is which grants satisfy which operations. On rollout:

1. **Tenant-wide `SelectionList:read` / `SelectionList:add_value` grants stop
   authorizing** list, create, quota and resolve. Before the service flips to
   the new checks, the Permit schema must define `SelectionListCatalog` with
   the tenant-role grants in §4.1, or every caller loses list/create/resolve at
   once. Order: **Permit schema → service enforcement**, never the reverse.
2. **Remove tenant-role grants of `SelectionList:*` actions** from the Permit
   schema. Left in place they keep the 2.0.0 hole open (a tenant grant of
   `read` = read on every list instance), which is the point of this change.
3. **Instance-role assignments are untouched.** Every existing
   `list-owner`/`list-editor`/… assignment keeps its meaning, with one
   reduction: `list-editor` can no longer purge items (M-1).
4. **Lists whose only effective access came through a tenant grant become
   invisible** to the users relying on it. Before removing the tenant
   `SelectionList:*` grants, enumerate lists with zero instance roles (the
   `selection_list_access` mirror is the cheap first pass; confirm against the
   Security API) and grant an owner via the §5 support path. A list with no
   instance owner after migration is administrable only via that path.
5. **Consumers calling `/v1/resolve` with a `developer`-role token** start
   getting `403`. Grant such service users `viewer` (or route them through a
   user token, as 2.0.0 already requires).
6. **UI:** the quota banner must treat `403` from `getSelectionListQuota` as
   "no banner" (non-admins), not as an error state.

## 7. Open questions

* **Q1 — automatic admin → list-owner derivation.** Should a tenant `admin`
  implicitly hold `list-owner` (or a lesser role) on every list in its org?
  Doing it properly needs (a) the service to write the
  `SelectionList --organization--> Organization` tuple on create and backfill
  it, and (b) the derivation to key on the **tenant** `admin` role, not ReBAC
  `org-admin`. Until decided, §5's explicit grant is the path. Owner decision.
* **Q2 — M-1 (item purge owner-only) and L-1 (archive via PATCH).** M-1 resolved in 3.0.0 by requiring
  `delete` on the parent list in addition to `remove_value`
  (`x-permit-additional-actions` on `deleteSelectionListItem`); L-1 in 4.0.0
  the same way on `updateSelectionList` (`when: body.status=archived`). Open only in
  that the extension is a FuzeFront convention with no gate reading it yet; the
  service stream must enforce it in code, and a future `gate-authz` could
  cross-check route checks against `x-permit-resource` / `x-permit-action` /
  `x-permit-additional-actions`.
* **Q3 — L-4 (resolve has no per-list read check).** Accepted trade-off,
  documented in the spec on `resolveSelectionListItems`: within its own org, a
  caller with `SelectionListCatalog:resolve` who holds an item id can render
  that item's label without an instance grant on the list. Bounded by the
  minimal response (label, locale, status — no list key, no org). Revisit if a
  list ever holds sensitive labels; the fix would be a bulk-check over the
  distinct parent lists of the requested ids, landing unreadable ones in
  `missing`.
* **Q4 — mirror drift on support-path grants.** A §5 grant made directly
  against the Security API bypasses `PUT .../access/{userId}`, so the
  `selection_list_access` mirror (used for display and the last-owner guard)
  does not see it. Either the service reconciles on read, or support grants go
  through the service's own access endpoint (which requires `manage_access`
  first — a bootstrap problem). Owner decision.
