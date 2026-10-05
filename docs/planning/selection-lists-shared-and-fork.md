# Selection lists — shared lists, common (platform) lists and copy-on-write forks

**Status:** contract FROZEN in `services/selection-list-service/openapi.yaml`
**4.1.0** (byte-identical Helm copy), `@fuzeone/selection-list-client` **2.1.0**,
`fuzefront-selection-list-client` **2.1.0**, `@fuzefront/shared` **1.3.0**
(`/kafka`), Permit schema-as-code (`backend/src/permit/schema.ts`,
`backend/security/src/permit/schema.ts`). **Nothing below is implemented in
`selection-list-service` yet** — this document is the design the
implementation wave (§10) builds against. If this document and the spec
disagree, **the spec wins** and this document is stale.

Related: `selection-lists-permit-actions.md` (authorization matrix, amended for
4.1.0), `selection-lists-events.md` (event contract), the consumer guides
`docs/guides/SELECTION_LIST_SERVICE.md` and `SELECTION_LIST_EVENTS.md`, and the
`selection-lists` skill.

---

## 1. Requirement

Owner, verbatim:

> "we surely need the mechanism to grant them read access to the common lists
> of the app(s). like when someone signs up to LinkedIn e.g. they have the enums
> shown in the various dropdowns, though they don't own the lists and can't
> modify the values. but they can pick a value for a field in a form from those
> lists that are in the seeded set of a user. whether the lists are copied per
> user or a common instance with ACL this is impl detail, which of course I
> prefer ACL with copy-on-write then the list is forked."

The gap it closes, on today's code (4.0.0): every per-list action is
instance-only. Seeding grants `list-owner` on platform-seeded lists to the
**org's owner only** (SL8, `services/selection-list-service/src/seed/ownerGrants.ts`)
and grants nothing on app-seeded lists, so **ordinary members cannot even read
the lists their org was seeded with** until someone with `manage_access` (or
`Organization:manage`, via the Security API) grants each of them a role, list
by list. They can never simply pick from them. And there is no tenant-agnostic "common list": the platform pack
is copied into every org (`yes-no`, `priority`, `work-status` × N orgs).

Hard requirements derived from it:

| # | Requirement |
|---|---|
| R1 | A plain member can **read and pick** values of the lists the app gives the org, with no per-user grant. |
| R2 | They **cannot modify** those lists (no implicit write, no implicit admin ownership). |
| R3 | There can be **one common instance** shared by every tenant ("ACL", not copies). |
| R4 | A tenant that wants different values gets a **copy-on-write fork** it owns. |
| R5 | Values already stored in consumer rows keep rendering across a fork. |
| R6 | Permit stays the authority on *who* may do what; ids are never capabilities. |
| R7 | No existing behaviour changes for existing data (lists that exist today). |

## 2. Decisions (final)

The orchestrator's recommended design is adopted; **deviations are marked ⚠ and
justified**.

### D1 — `visibility` on every list: `private | org | platform`

- `private` — today's behaviour; readable only through an instance role. The
  **default** on create, and the value of every list that exists at 4.0.0.
- `org` — every member of the **owning** organization may read it (get, items,
  translations, pick, resolve) without a grant.
- `platform` — a **common list**: one instance readable by every authenticated
  caller in **every** organization; immutable for tenants (they fork).

Visibility widens **reading only**. Every mutation stays gated by the five
instance roles exactly as in 4.0.0. Exposed as required, read-only
`SelectionList.visibility`; settable on create (`SelectionListCreate.visibility`)
and via PATCH (`SelectionListUpdate.visibility`).

### D2 ⚠ — a `platform` list is owned by the **platform organization**, not `org_id = null`

Recommended: `org_id null, owned by platform principal system:*`. **Deviation:**
a common list is an ordinary row whose `organization_id` is FuzeFront's **root
platform organization** (`backend/src/migrations/015_seed_root_platform_organization.ts`,
`ROOT_ORG_ID`; type `platform`), and its `visibility` is `platform`.

Concrete flaws of `null` that this avoids:

1. `SelectionList.organization_id` is **required, non-null** (`^org_`) in the
   HTTP contract. Making it nullable is a MAJOR change (the 4.0.0 precedent:
   widening `created_by` was MAJOR) for every consumer that keys by org.
2. **Every** `selection-lists.*` event requires a top-level `organizationId`
   (`slListEventBaseV1`) and is partitioned/ordered by it; the outbox claims
   per org (`event_outbox` strict per-org `seq`). A null owner breaks event
   validation, partitioning, ordering and per-org outbox parking.
3. `UNIQUE (organization_id, key)` would no longer guarantee unique common-list
   keys (NULLs are distinct in Postgres), quotas and the ref-index projection
   key on org, and `identity.org.deleted` cascades would have to special-case it.
4. Owning the list by a real org gives operators a normal ownership model: the
   creator is `list-owner`, grants work, the roster works, the last-owner
   guard works — all unchanged code.

`system:*` still appears where it already does: `created_by` of rows written by
seeding (`system:selection-list-service`).

The service learns the platform org's wire id from configuration
(`SELECTION_LIST_PLATFORM_ORG_ID`, the `org_…` TypeID of `ROOT_ORG_ID`), with a
fallback to the `selection_list_ref_index` row whose `org_type = 'platform'`;
if neither resolves, every platform feature **fails closed** (no `platform`
lists are served or created, nothing else changes).

### D3 ⚠ — `SelectionListCatalog:read_shared` for every **customer** tenant role (not `developer`)

Recommended: "granted to ALL tenant roles incl. plain member/viewer".
**Adopted for `admin`, `editor`, `viewer`** (a plain member is `editor` —
`role-assignment.ts`: member → editor). **Deviation:** not `developer`.
`developer` is the root-org developer-portal role that must not read tenant data
(`docs/planning/developers-portal.md` §5.3) and holds **no** catalog action — it
cannot `list` or `resolve` at all, so `read_shared` would be inert for it and
would only blur the "developer is narrower than viewer" invariant.

The invariants hold: tenant roles confer **zero** `SelectionList:*` actions; there
is **no** admin → `list-owner` derivation.

### D4 — how readability is decided (Permit stays the authority)

A read of list L by caller C (token org `X`) is allowed iff **either**

1. Permit grants `SelectionList:read` on instance `L` (an instance role — today's
   path), **or**
2. the **shared read**: L is not `private` **and** the service-owned predicate
   holds (`org` → `L.organization_id = X`; `platform` → always) **and** Permit
   grants `SelectionListCatalog:read_shared` to C **in tenant `X`**.

Why this split (and not Permit ABAC/ReBAC): Permit decides **who is a member**
(the tenant role in X); the service decides **what the list's visibility is**,
because it owns that column. The token's org claim alone is never treated as
membership — the `read_shared` check is the membership proof. Modelling
visibility inside Permit would need either resource-instance attributes synced
on every list write (ABAC resource sets) or `SelectionList → Organization`
relation tuples plus a tenant-role derivation Permit does not offer for
tenant-scoped roles (see `selection-lists-permit-actions.md` §5, Q1) — a second
source of truth for a column the service already owns, with sync lag on the
hottest path. The shared read is **one** catalog check per request regardless
of how many rows are returned (cache per request).

Declared per operation in the spec as `x-permit-shared-read` on exactly:
`getSelectionList`, `listSelectionListItems`, `listSelectionListTranslations`,
`listSelectionListItemTranslations`, `listSelectionLists` (with
`include_shared=true`) and the source read of `forkSelectionList`. Pinned by
`tests/selection-list-service/contract/spec-consistency.test.ts`.

`SelectionList:read` is unchanged for `listSelectionListAccess` (needs
`manage_access`) — a reader of a common list cannot see its roster.

### D5 — `SelectionListCatalog:publish_platform` for platform operators

Creating a `platform` list, promoting a list to `platform`, and **purging** a
`platform` list or one of its items require `publish_platform`. It is granted
via tenant `admin` but is only **effective in the platform organization's
tenant**: the service evaluates it with tenant = platform org and additionally
requires the caller to be acting in the platform org (token org = platform org).
A customer-org admin therefore holds the action in its own tenant and still
cannot publish. Platform operators are the root org's admins (the same people
`ensureRootOrgAdmin` grants ReBAC `org-admin` on the root organization).

Destructive-but-reversible operations (archive) on a common list stay with the
instance owner, as for every list; only the irreversible ones (purge) need the
operator action, because they turn stored ids in every tenant into `missing`.

### D6 — copy-on-write fork: `POST /v1/selection-lists/{listId}/fork`

- **Authorization:** `SelectionListCatalog:create` (the fork is a new list in
  the caller's org, subject to `org_lists`/`user_lists`/`list_items` quotas)
  **+** read on the source (grant or shared read). The service grants the
  caller `list-owner` on the fork with its machine identity (as on create).
- **Forkable:** a list owned by **another** organization that the caller can
  read — in practice a `platform` list. Forking a list of the caller's own org
  is `409 CONFLICT` `reason: fork_not_applicable` (the key would collide with
  itself; ask the owner for a role instead). Unreadable source → `404`.
- **Copy:** list source-locale text + every list translation; every
  **non-purged** item (active **and** archived, so stored ids keep a mapping)
  with `code`, `status`, `sort_order`, source-locale text, every item
  translation (with `is_machine` and `source_hash` preserved); `seed: null`;
  `created_by` = caller; `visibility` from the body (`org` default, or
  `private`; never `platform`).
- **Same `key`.** The fork keeps the source's key, so it shadows the common
  list for the org in key lookups (D8), and archiving the fork reverts to the
  common list. This is the whole copy-on-write experience for a picker that
  addresses lists by key.
- **Provenance:** `forked_from {list_id, organization_id, revision, forked_at}`
  (source revision at the moment of copying; never updated); every copied item
  carries `origin_item_id` = source item id.
- **Ids:** every list/item id is **minted by the service**; the request body
  (`SelectionListForkRequest`) has no `id`/`key`, `additionalProperties: false`
  (`gate-identifier` verified: injecting `id` into the body fails the gate).
- **Idempotent per (org, source):** a partial unique index on
  `(organization_id, forked_from_list_id)`. If a fork exists (any status): `200`
  with it when the caller can read it, else `409 reason: fork_exists`. New fork:
  `201`. A *different* list already holding the key in the org (e.g. a legacy
  per-org seeded copy — see §9) is a plain `409 CONFLICT`.
- **Size:** a source with more than 5000 non-purged items is refused
  (`400 VALIDATION_ERROR`); common lists are curated and this bound keeps the
  `list.forked` event under the Kafka message ceiling.

### D7 ⚠ — the "fork required" error uses the contract's existing error shape, not RFC 7807

Recommended: "a documented RFC 7807 problem (e.g. 409 `fork_required` with a
`fork_url` extension)". **Deviation in form, not in substance:** this contract
has **one** error shape for every non-2xx (`Error {code, message, …}`,
`application/json`), and both clients parse exactly that. Introducing
`application/problem+json` for one case would give clients two parsers and break
"the single error shape". So the problem is expressed in the existing shape,
additively:

```json
HTTP/1.1 409 Conflict
{ "code": "CONFLICT",
  "message": "This is a common list; fork it to change it.",
  "reason": "fork_required",
  "source_list_id": "front_sl_…",
  "fork_url": "/v1/selection-lists/front_sl_…/fork" }
```

`code` stays `CONFLICT` (no new `ErrorCode` enum value, so no response-enum
widening); the refinement is the new optional `reason`
(`fork_required | fork_exists | fork_not_applicable | visibility_locked`);
`fork_url` is **same-origin relative** (CLAUDE.md: never an absolute host).
Returned on every per-list mutation (list update/delete/archive, item
create/update/reorder/delete/archive, translation upsert/delete/autofill) when
the list is a `platform` list owned by another org, the caller holds no
instance role granting the action, and the caller holds
`SelectionListCatalog:create`; without `create` it is `403 FORBIDDEN`. Check
order: unreadable → `404` (unchanged); readable-not-writable → `409`/`403`.
Access-management operations on a common list are always `403` (not forkable).
`409` is now declared on every one of those operations (oasdiff: info-level
`response-non-success-status-added`).

### D8 — which list a key means (precedence)

For caller C in org X asking for key K (`GET /v1/selection-lists?key=K&include_shared=true`,
client helper `getEffectiveList(K)`):

1. X's own **active** list with key K **that C can read** (instance grant or
   `org` visibility) — normally X's fork;
2. else the **active** `platform` list with key K;
3. else nothing.

Keys are unique per org, and every common list lives in the platform org, so
each step has at most one candidate. A `private` fork (a draft) shadows only for
those who can read it. Without `include_shared` the 4.0.0 semantics apply
unchanged. In the general listing with `include_shared=true` (no `key`), a
common list shadowed by a readable own list of the same key is omitted so a
picker sees each key once; a `visibility` filter turns shadowing off (admin view).

### D9 — stored values across a fork (`origin_item_id`, resolve redirect)

Forked items get **new** ids (a fork is a different entity in a different org;
ids are entity identity, minted by the owner). Stored values keep working:

- `POST /v1/resolve` resolves ids of the caller's org **and of every `platform`
  list** (common ids are readable everywhere).
- If an id belongs to a `platform` list P and X holds an **active, `org`-visible
  fork** F of P with a non-purged item whose `origin_item_id` = id, the result is
  F's item (label/locale/status) and carries `effective_item_id` = that item's
  id. A consumer may rewrite its stored value lazily; both ids keep resolving.
- A `private` fork never redirects (a draft is not the org's choice). An item
  deleted (purged) from the fork falls back to the common item.

Resolve stays one round trip: the redirect is one join on
`(organization_id = X, forked_from_list_id = P.id, visibility = 'org', status = 'active')`.

### D10 — visibility changes (PATCH), `platform` is one-way

- `private ↔ org`: requires `SelectionList:manage_access` (owner) in addition to
  `update` — who may read is an access decision.
- `private|org → platform`: additionally `publish_platform`, and the list must
  be owned by the platform org (a tenant cannot donate a list to every tenant).
- `platform →` anything: `409 CONFLICT reason: visibility_locked`. Demotion
  would turn every tenant's stored ids into `missing` (resolve stops reaching
  them); to retire a common list, archive it (archived items keep resolving).
- Emits `selection-lists.visibility.changed`.

### D11 — events

| Topic | Produced when | Payload (beyond `eventId, organizationId, actor, listId, listKey, listRevision`) |
|---|---|---|
| `selection-lists.list.forked` | a fork is created | `list` (fork snapshot), `source {listId, organizationId, listKey, listRevision}`, `itemMap[{originItemId, itemId}]` (≤ 5000) |
| `selection-lists.visibility.changed` | PATCH changed visibility | `list`, `previousVisibility`, `visibility` |

⚠ Topic names follow the existing `selection-lists.<entity>.<verb>` convention
(three segments, pinned by `shared/tests/kafka/selection-lists.schemas.test.ts`),
so the recommended `selection-list.forked` became `selection-lists.list.forked`,
and visibility is its own entity/topic (`selection-lists.visibility.changed`)
rather than a new `changedFields` value on `list.updated` (adding an enum value
consumers may strictly enumerate would be breaking for them). Both are in the
Helm `kafkaTopics.topics` with 3 partitions / 7 d / `delete`, like the other
change events. Snapshots gain **optional** `visibility`, `forkedFrom`,
`originItemId` (additive under the events' versioning promise). A fork also
emits the ordinary `list.created`/`item.created`/`translation.upserted` and
`access.granted` events in the same transaction, so fork-unaware consumers stay
correct. A common list's events are keyed by the platform org.

`gate-microservice-events` needed no change: it enforces identity-lifecycle
subscriptions, which this feature does not alter (verified: the gate passes).

### D12 — seeding

- Seed list specs (`slSeedListSpecV1`, used by `seed.requested` **and** platform
  packs) gain optional `visibility`. Absent = `private` = today's behaviour.
- `seed.requested` (apps) may declare `private | org`; `platform` is refused by
  the schema (an app cannot publish to every tenant). Both client builders
  enforce the same.
- A **platform** pack list may declare `platform`: it is then seeded **once**
  into the platform org (as a common list), and **skipped** for per-org
  application. `org` in a platform pack seeds per-org copies readable by members.
- **This PR does not change seeding behaviour.** Until the service wave lands,
  the field is accepted by the schema and ignored (lists are seeded `private`).

### D13 — `GET /v1/selection-lists` gains `include_shared` (default `false`) and `visibility`

Default `false` keeps the 4.0.0 result set byte-for-byte. A picker passes
`true`. `visibility` filters to one value and disables shadowing. Pagination is
unchanged (cursor, `limit` 1–200). Rows carry `visibility`, `forked_from`,
`editable`.

`editable` is a **caller-relative hint**, not an authorization: `true` when the
caller holds a write role on the list. By the role table every write role
(owner, editor, contributor, translator) holds `translate` and `list-viewer`
holds no write action, so the service computes it with **one bulk check of
`SelectionList:translate`** over the page.

### D14 — version: **4.1.0 (MINOR)**, clients 2.1.0, shared 1.3.0

- No existing request changes its response or authorization **for existing
  data**: every list that exists at 4.0.0 is `private`, so it reads, lists,
  resolves and authorizes exactly as before; the default listing is unchanged;
  all widened behaviour needs a new opt-in parameter, the new operation, or a
  list with non-`private` visibility, which cannot exist before 4.1.0.
- Response objects gain properties (as `seed` did); `oasdiff breaking` reports
  **0 breaking, 0 warnings** (292 info: 1 endpoint added, 2 optional params,
  2 optional request properties, 11 non-success statuses added, 24 required
  response properties added, 252 optional response properties added).
- Contrast with 4.0.0 (MAJOR): there, existing responses changed meaning
  (`created_by` stopped being always a user) and an existing role lost a
  permission. Nothing comparable happens here.
- `organization_id` stays non-null (D2) and no `ErrorCode` value is added (D7) —
  the two changes that would have forced a MAJOR were designed out.
- Also in 4.1.0: the `servers` example port `3011 → 3008` (the service default
  and `selectionListService.port`), in the spec, its Helm copy, and the Python
  client README/docstrings.

## 3. Library & architecture review (build vs adopt)

| Option | Fit | Cost / risk | Verdict |
|---|---|---|---|
| **Service-owned `visibility` + Permit tenant-role `read_shared` (chosen)** | Full (R1–R7) | One column, one catalog check per request; Permit unchanged in kind (two new actions) | **Adopt** |
| Permit ABAC resource sets on a synced `visibility` attribute | Full | Every list write must sync instance attributes to Permit; read path depends on sync lag; second source of truth | Runner-up if Permit becomes the system of record for list metadata |
| Permit ReBAC `SelectionList → Organization` tuple + derived `list-viewer` | Partial (no tenant-role derivation for customer tenants; `platform` needs a tuple per org) | Tuple per list per org; backfill; inert today (`permit-actions.md` §5) | Reject |
| Per-org (or per-user) copies only, no common instance | R1/R2 only | N × lists, N × translations upkeep, no single place to fix a label; the owner prefers ACL + COW | Reject (kept only as the transitional per-org `org` seeding, §9) |
| Third-party reference-data service | Overkill | New dependency for a non-differentiating, already-built capability | Reject |

**Boundaries.** No new service or package: the capability lives inside
`selection-list-service` (it owns the rows, so it owns visibility), its public
interface is the 4.1.0 HTTP contract + the two event topics, consumed through
`@fuzeone/selection-list-client` / `fuzefront-selection-list-client` and
`@fuzefront/shared/kafka`. The picker (`@fuzeone/selection-lists-ui`) moves to
`getEffectiveList` in the UI wave.

## 4. Authorization matrix (who may do what, by visibility)

Caller in org X; "member" = holds a customer tenant role in X (admin/editor/viewer).

| Operation | `private` list of X | `org` list of X | `platform` list (platform org) | list of another customer org |
|---|---|---|---|---|
| get / items / translations | instance `read` | instance `read` **or** member (`read_shared`) | instance `read` **or** member of any org (`read_shared`) | `404` |
| appear in `GET` list | instance `read` | `include_shared=true` + member | `include_shared=true` + member (unless shadowed) | never |
| resolve item ids | `resolve` (L-4, unchanged) | `resolve` | `resolve` (+ fork redirect) | `missing` |
| any mutation | instance role per §4.2 | instance role per §4.2 (else `403`) | instance role per §4.2; else `409 fork_required` with `create`, `403` without | `404` |
| change visibility | owner (`manage_access`) | owner | `409 visibility_locked` | `404` |
| → `platform` | owner + `publish_platform`, X = platform org | same | n/a | `404` |
| purge (list or item) | owner (`delete`) | owner | owner + `publish_platform` | `404` |
| fork | `409 fork_not_applicable` | `409 fork_not_applicable` | `create` + readable | `404` |
| access roster/grants | `manage_access` | `manage_access` | `manage_access` (operators) | `404` |

## 5. Data model (service wave) — migration outline

Migration `20261005_000011_shared_lists_and_forks.ts` (`database-engineer`),
additive and backward compatible (no default-behaviour change):

```sql
ALTER TABLE selection_lists
  ADD COLUMN visibility               TEXT        NOT NULL DEFAULT 'private',
  ADD COLUMN forked_from_list_id      TEXT        NULL,   -- front_sl_… of the source; NOT a FK (source may be purged / another tenant)
  ADD COLUMN forked_from_org_id       TEXT        NULL,   -- org_… of the source
  ADD COLUMN forked_from_revision     BIGINT      NULL,
  ADD COLUMN forked_at                TIMESTAMPTZ NULL,
  ADD CONSTRAINT ck_sl_visibility CHECK (visibility IN ('private','org','platform')),
  ADD CONSTRAINT ck_sl_fork_complete CHECK (
    (forked_from_list_id IS NULL) = (forked_from_org_id IS NULL)
    AND (forked_from_list_id IS NULL) = (forked_from_revision IS NULL)
    AND (forked_from_list_id IS NULL) = (forked_at IS NULL)),
  ADD CONSTRAINT ck_sl_fork_not_platform CHECK (forked_from_list_id IS NULL OR visibility <> 'platform');

-- one fork per (org, source) — the idempotency key of POST …/fork
CREATE UNIQUE INDEX ux_sl_fork_per_org ON selection_lists (organization_id, forked_from_list_id)
  WHERE forked_from_list_id IS NOT NULL;
-- shared-read and key-precedence lookups
CREATE INDEX ix_sl_platform_key ON selection_lists (key) WHERE visibility = 'platform';
CREATE INDEX ix_sl_org_visible ON selection_lists (organization_id, status) WHERE visibility = 'org';

ALTER TABLE selection_list_items
  ADD COLUMN origin_item_id TEXT NULL;                     -- front_sli_… of the source item
CREATE UNIQUE INDEX ux_sli_origin ON selection_list_items (list_id, origin_item_id)
  WHERE origin_item_id IS NOT NULL;
```

- "platform list ⇒ owned by the platform org" is enforced in the service (the
  platform org id is configuration, not schema).
- `selection_list_seed_ledger` needs no change; a platform-common seed records
  the platform org as its org.
- `data-contract.json` (data-consistency standard): declare
  `forked_from_list_id` / `origin_item_id` (same-service, cross-tenant
  provenance references; validation level: prefix only; on-delete of the
  source: **keep** — dangling provenance is legal) and `forked_from_org_id`
  (spine `organization` reference, on-delete: keep).
- `identity.org.deleted` cascade: deleting a customer org deletes its forks as
  today; deleting the platform org is not a supported operation.

## 6. Read/write algorithms (service wave)

- **`readable(L, C)`** = `Permit.check(C, read, SelectionList:L)` **or**
  (`L.visibility='org' ∧ L.org=X ∨ L.visibility='platform'`) ∧
  `Permit.check(C, read_shared, SelectionListCatalog, tenant X)` — evaluate the
  data predicate first, memoise the catalog check per request.
- **Org scoping:** every `:listId` route currently filters by `req.orgId`; it
  becomes `organization_id = X OR (visibility = 'platform')` for **reads**, and
  stays `organization_id = X` for writes — except that a write on a readable
  common list returns `409 fork_required`/`403` instead of `404`.
- **List (`include_shared=true`):** `WHERE (org = X) OR (visibility='platform')`,
  then admit rows by instance `read` (bulk) or the shared predicate; drop a
  `platform` row whose key is matched by an admitted own active row (unless a
  `visibility` filter is set); paginate on the existing cursor.
- **Effective key:** at most two indexed lookups (own `(org, key)`, then
  `ix_sl_platform_key`).
- **Fork:** one transaction: check source readable + other org + `< 5000`
  items; quota checks; insert list (minted id) + translations; insert items
  (minted ids, `origin_item_id`) + item translations; grant `list-owner`
  (machine identity, as on create; compensate on rollback as create does);
  enqueue `list.created`, `item.created`×n, `translation.upserted`×m,
  `access.granted`, `list.forked` into the outbox. Unique-violation on
  `ux_sl_fork_per_org` ⇒ re-read and answer `200`/`409 fork_exists`.
- **Resolve:** add `OR l.visibility = 'platform'` to the org predicate; left join
  the caller org's active `org`-visible fork items on `origin_item_id`; prefer
  the fork item when present.

## 7. Feature flag

New release flag **`fuzefront.selection-lists.shared-lists`**, default **OFF**,
server + web (`feature-flags-engineer` registers it; owner `izzywdev`; removal
criterion: ON for all orgs 30 days with no fork/shared-read incidents). While
OFF the service answers exactly as 4.0.0 *in behaviour* while still emitting
4.1.0 shapes: every list reports `visibility: "private"`, `forked_from: null`,
`origin_item_id: null`; `include_shared`/`visibility` params are accepted and
ignored; `POST …/fork` → `404`; PATCH/create with non-`private` visibility →
`400 VALIDATION_ERROR`; seed-list `visibility` is ignored. Test **both** states.
Authorization never routes through the flag (Permit stays the authority).

## 8. What does *not* change

- The five instance roles and their actions; the last-owner guard; archive vs
  purge; L-4 (resolve has no per-list read check); the error envelope; ids
  minted only by the service; `404` (never `403`) for unreadable lists.
- Tenant roles confer no `SelectionList:*` action; no admin → owner derivation.

## 9. Rollout and migration of existing data

Order matters (fail-closed authz): **Permit schema → service → flag → data**.

1. **Contract** (this PR) merges; the backend's boot-time Permit sync
   (`syncPermitSchemaFromRegistry`) pushes `read_shared` / `publish_platform`
   to Permit. Verify the backend `GET /health` → `permit` outcome in each
   environment **before** step 3.
2. **Service wave** ships migrations + logic behind the flag (OFF). Responses
   switch to 4.1.0 shapes with `private` defaults — wire-additive.
3. **Flag ON for an internal org**; create an `org` list and a `platform` list
   from the platform org; exercise fork, precedence, resolve redirect.
4. **Fix the "seeded lists are invisible" gap without common lists yet:** a
   one-off, idempotent data migration sets `visibility = 'org'` on every
   **seeded** list (`seed_source IS NOT NULL`) — members can now pick from them;
   nobody gains a write. Platform pack bumped to declare `visibility: org` for
   new orgs (pack version 2 with identical content + visibility; the ledger
   treats a visibility-only change as content — bump the version).
5. **Common platform lists:** publish the platform pack lists once into the
   platform org as `platform` lists (pack declares `visibility: platform`; the
   per-org application then skips them for new orgs).
6. **Existing per-org copies** of the platform pack lists (same keys) are
   retroactively made **forks** of the new common lists: set
   `forked_from_*` to the common list and `origin_item_id` by matching `code`
   (codes are immutable and list-unique, so the mapping is exact). They keep
   their ids, their `org` visibility and any user edits; they keep shadowing the
   common list for their org (precedence is unchanged for their users). An
   optional later job may **collapse** untouched forks (`user_modified = false`
   everywhere): archive the fork so the org falls through to the common list,
   *only* after consumer stored values are migrated using the `itemMap`
   (published as a synthetic `list.forked`) — owner decision, not scheduled.
7. Flag ON broadly; remove the flag per its criterion.

Existing app packs (`seed.requested`) keep seeding `private` until each app opts
into `visibility: org` in a new pack version.

## 10. Implementation wave — ordered task list

Every stream gates on this contract PR being **merged**.

| # | Stream (owner) | Task | Done when |
|---|---|---|---|
| 1 | `devops-engineer` | `SELECTION_LIST_PLATFORM_ORG_ID` in the chart (values/overlays → Deployment env); Kafka topics already declared here — verify they render. | `helm template` shows the env + both topics; `gate-helm` green |
| 2 | `feature-flags-engineer` | Register `fuzefront.selection-lists.shared-lists` (release, default OFF) in `packages/feature-flags/flag-registry.yaml` + `FLAG_KEYS`; extend `prod-unleash-ops` | flag readable server-side and in the shell |
| 3 | `database-engineer` | Migration §5 + down-migration; `*.db.test.ts` for constraints/indexes | migrations up/down clean on CI Postgres |
| 4 | `backend-engineer` | Read path: `readable()`; org scoping for reads; `include_shared`/`visibility`/shadowing on `listSelectionLists`; effective-key lookup; `editable` bulk check; response fields (`visibility`, `forked_from`, `editable`, `origin_item_id`) — all behind the flag | `tests/authz.route-matrix.test.ts` extended with `x-permit-shared-read`; route tests both flag states |
| 5 | `backend-engineer` | Write path: create/PATCH `visibility` with the extra checks (`manage_access`, `publish_platform` evaluated in the platform tenant, platform-org ownership, one-way lock); `409 fork_required`/`403` on mutations of common lists; purge of platform lists needs `publish_platform` | every `x-permit-additional-actions` row enforced and route-matrix-pinned |
| 6 | `backend-engineer` | `POST …/fork` (D6, §6) incl. quotas, machine-identity owner grant, idempotency, 5000 cap | contract + unit tests green |
| 7 | `backend-engineer` | Resolve: platform ids + fork redirect + `effective_item_id`; keep one round trip; cache key unchanged except fork presence (ETag must vary) | resolve tests incl. private-fork no-redirect |
| 8 | `backend-engineer` | Events: add both topics to `PRODUCED_TOPICS`; emitters for `list.forked` / `visibility.changed`; snapshots carry `visibility`/`forkedFrom`/`originItemId` | `outbox.*` tests; payloads validate via `SCHEMA_BY_TOPIC` |
| 9 | `backend-engineer` | Seeding: honour seed-list `visibility` (`org` per org; `platform` once into the platform org, skipped per org); refuse `platform` from apps (schema already does) | seed tests; ledger semantics unchanged |
| 10 | `backend-engineer` + `database-engineer` | Rollout data migrations §9.4 and §9.6 as idempotent, flag-independent jobs with dry-run | dry-run report on staging; re-run is a no-op |
| 11 | `test-engineer` | `tests/selection-list-service/contract` + `security`: shared-read allow/deny per tenant role (incl. `developer` 403/404), cross-org `404`, fork 201/200/409×3, precedence, resolve redirect, `fork_required` body, visibility lock, purge needs operator; `helpers/fake-security-api.mjs` evaluates `publish_platform` with tenant = platform org | suites green against the running service, both flag states |
| 12 | `docs-maintainer` | Drop the "contract only" banners from the guides/skill once the service ships; runbook entries for §9 jobs | docs match code |
| 13 | `product-designer` | Frames for: shared/common badge + read-only list detail, "fork to edit" CTA on `fork_required`, fork confirmation (visibility choice), fork provenance + "behind source" indicator, picker unchanged except effective-list lookup; loading/empty/error/`fork_exists`/quota states | frames PR approved per flow (`gate-frames-first`) |
| 14 | `frontend-engineer` (after 13) | `@fuzeone/selection-lists-ui`: picker uses `getEffectiveList`; list management shows `visibility`/`editable`, fork flow; visibility control for owners | e2e per approved frames; console-clean |
| 15 | `frontend-test-engineer` | Playwright specs RED-first from the approved frames, then verify | e2e green |
| 16 | `mcp-maintainer` | Gateway overrides for `forkSelectionList` (and the pre-existing override-key drift noted in the skill) | gateway exposes the op correctly |

## 11. Test plan (acceptance, summarised)

1. **R7 regression:** with no non-`private` lists, every 4.0.0 contract/security
   test passes unchanged; default listing returns exactly the granted set.
2. **Shared read:** member (admin/editor/viewer) of X reads an `org` list of X
   without a grant; `developer` gets `404`; member of Y gets `404` on X's `org`
   list; any member reads a `platform` list; nobody can mutate via shared read.
3. **Listing:** `include_shared=true` adds the right rows; shadowing; `visibility`
   filter disables shadowing; pagination stable across pages.
4. **Precedence:** key → own readable active list > platform list; archived fork
   falls through; private fork shadows only for grant-holders.
5. **Fork:** `201` + `list-owner` + copied items/translations/archived items +
   `origin_item_id` + `forked_from`; repeat `200`; unreadable existing fork
   `409 fork_exists`; own-org source `409 fork_not_applicable`; key taken by a
   non-fork `409`; quota `403 QUOTA_EXCEEDED`; body with `id` → `400`.
6. **Mutations on common lists:** each per-list mutation → `409 fork_required`
   with `fork_url`/`source_list_id` (with `create`), `403` (without).
7. **Visibility:** owner `private↔org`; editor `403`; promotion needs
   `publish_platform` + platform org; demotion `409 visibility_locked`.
8. **Purge on common lists:** owner without `publish_platform` → `403`.
9. **Resolve:** platform ids resolve from every org; `org`-fork redirect sets
   `effective_item_id`; private fork no redirect; other customer org ids `missing`.
10. **Events:** each case emits the documented topics in one transaction; payloads
    validate against `@fuzefront/shared` 1.3.0.
11. **Flag OFF:** 4.0.0 behaviour with 4.1.0 shapes (§7).

## 12. Risks

- **Resolve cost:** the fork redirect adds a join on the hot path — index
  `ux_sli_origin` and the partial fork index keep it O(ids); benchmark in task 7.
- **Common-list edits ripple to every tenant** that has not forked — operators
  should treat a common list like a public API (translations reviewed,
  archive rather than relabel semantics). `forked_from.revision` lets a UI show
  "your fork is behind the common list"; no automatic merge is offered (by
  design: copy-on-write, not sync).
- **Platform org identification** is configuration; a wrong
  `SELECTION_LIST_PLATFORM_ORG_ID` would let that org publish — the boot check
  must confirm the configured org's projection type is `platform`.
