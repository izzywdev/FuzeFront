# Selection lists — Kafka event contract (SL5)

**Status:** contract FROZEN on merge of this PR. **No implementation exists yet** — the
selection-list-service does not publish any of these events, does not consume
`identity.org.created` or `selection-lists.seed.requested`. (The `fuzefront.selection-lists.seed-defaults` flag IS now registered —
`packages/feature-flags/flag-registry.yaml`, `FLAG_KEYS.SELECTION_LISTS_SEED_DEFAULTS`,
`isSeedDefaultsEnabled()` in the service — default OFF, never enabled by registration.)
A later wave builds all of that against this contract (see [§14](#14-implementation-wave-for-the-orchestrator)).

| Artifact | Path |
|---|---|
| Zod schemas (source of truth) | `shared/src/kafka/schemas/selection-lists.*.ts` |
| Topic names | `shared/src/kafka/types.ts` → `TOPICS.SELECTION_LISTS_*` |
| Validation registry | `shared/src/kafka/registry.ts` → `SCHEMA_BY_TOPIC` |
| Golden fixtures | `shared/tests/fixtures/selection-lists/*.json` |
| Seed-request builders | `selection-list-client/src/seed.ts` (TS), `packages/selection-list-client-py/src/fuzefront_selection_list_client/seed.py` (Py) |
| Consumer guide | `docs/guides/SELECTION_LIST_EVENTS.md` |
| HTTP contract (unchanged here) | `services/selection-list-service/openapi.yaml` |

Versions: `@fuzefront/shared` 1.0.0 → **1.1.0**, `@fuzeone/selection-list-client`
1.0.1 → **1.1.0**, `fuzefront-selection-list-client` (Py) 1.1.1 → **1.2.0**. All additive.

## 1. The request

> "plan and implement which events the services will publish in kafka for consuming
> services and which events the service will respond to, like seeding default lists for
> a new org or user, and giving other services the opportunity to seed org/user lists
> for a specific app."

Three surfaces:

1. **Published** — change events for lists, items, translations and access, so other
   services can keep read models, search indexes or denormalised labels in sync.
2. **Platform seeding** — when an org is created, seed the platform's default lists.
3. **App seeding** — another service asks to seed a versioned pack of lists for *its app*
   into an org (or, later, a user).

## 2. Inputs and locked decisions

Verified on `origin/master` at `0e300a6d`:

- Event plumbing is the root `shared/` package (`@fuzefront/shared`, export `./kafka`,
  zod 3.22.4). The envelope `FuzeEvent { version, topic, correlationId, occurredAt, payload }`
  has no event id and no actor. **Decision: do not amend the envelope** (every existing
  producer and consumer would ripple); `eventId` and `actor` go in the payload.
- `partitionKeyForPayload()` keys by `organizationId`, then `userId`, … **Every**
  selection-lists payload has a top-level `organizationId`, so every event is keyed by org.
- The registry comment mentions a Python `fuzefront-events` mirror. **It does not exist**
  (`git ls-files | grep -i events-py|fuzefront_events` is empty), so nothing to update.
  The Python seed helper is pinned to the Zod schema through shared golden fixtures instead.
- **No user-scoped lists exist.** `selection_lists` is keyed `(organization_id, key)`;
  `user_lists` quota is a per-*creator* cap. **Decision (architect):** `seed.requested`
  accepts `scope: 'org' | 'user'`, but `scope: 'user'` is answered with
  `seed.failed` / `SCOPE_UNSUPPORTED` until a user-scoped model exists. Consequently
  `identity.user.created` triggers **no** seeding and is declared `notApplicable` for
  gate-microservice-events ([§12](#12-gate-microservice-events-policy-change)).
  Open question Q1.
- Inbound identity events carry **bare UUIDs**; the service stores and serves **TypeIDs**
  (`org_…`, `usr_…`). Handlers convert with `fromUuid` from `@izzywdev/fuzefront-identity`
  (as `org-deleted.handler.ts` already does). Published selection-lists events carry
  **TypeIDs**, matching the HTTP contract.
- A list's `key` is **mutable** over HTTP (`PATCH /lists/{id}` accepts `key`). Seeding
  therefore tracks lists by **id + provenance**, never by key alone, and `list.updated`
  carries `previousKey`.
- `DELETE /lists/{id}` archives; `?purge=true` purges. Same for items. Hence separate
  `archived` and `deleted` topics.
- **Kafka has no authentication today.** `shared/src/kafka/client.ts` connects with no
  SASL/TLS; nothing in this repo configures broker ACLs. Any pod that can reach the broker
  can produce to any topic. This drives the trust model in [§8](#8-trust-model-for-seedrequested).

## 3. Library & architecture review

**Capability:** fan out selection-list changes to N consumers, and accept seeding
requests from N producers, without coupling them to the service's availability.

| Option | Fit | Cost / risk | Verdict |
|---|---|---|---|
| **Transactional outbox → Kafka (build on existing `backend/core/src/events`)** | Full: atomic with the state change, at-least-once, ordered per org | Small: the pattern, relay and DLQ policy already exist and are tested in core | **Chosen** |
| CDC (Debezium) on the service DB | Full for publish; nothing for inbound seeding | New infra (Kafka Connect) on FuzeInfra, leaks table shape as the contract | Rejected — the contract must be designed, not derived from columns |
| Direct `producer.send()` after commit | Partial: dual-write gap loses events on crash | None to build | Rejected — silently drops events |
| HTTP `POST /seed` for app seeding instead of Kafka | Full, and authenticates natively with the caller's token | Synchronous: the seeding service must wait on selection-list-service; no replay | **Runner-up.** Switch to it if Kafka SASL/ACLs (§8) are refused and the attestation approach proves operationally painful. The Zod `slSeedListSpecV1` would become the request body unchanged. |

**Boundaries.** The contract lives in `@fuzefront/shared/kafka` (schemas + topics + the
registry), the only package every producer/consumer already depends on. Request
*builders* live in the selection-list client packages (TS + Py) because that is what a
seeding service already installs to talk to this service, and they add zero runtime
dependencies. The service owns all `selection-lists.*` topics.

## 4. Topic catalogue

Naming follows `domain.entity.verb`. Every topic is keyed by `organizationId`
(partition key derived by `partitionKeyForPayload`). DLQ = `<topic>.dlq`.

| Topic | Producer | Emitted when (HTTP route / trigger) |
|---|---|---|
| `selection-lists.list.created` | selection-list-service | `POST /lists`; seeding creates a list |
| `selection-lists.list.updated` | selection-list-service | `PATCH /lists/{id}` (incl. key rename, restore archived→active); seeding upgrades an unedited list |
| `selection-lists.list.archived` | selection-list-service | `POST /lists/{id}/archive`, `DELETE /lists/{id}`; seeding archives a list dropped from a pack |
| `selection-lists.list.deleted` | selection-list-service | `DELETE /lists/{id}?purge=true` |
| `selection-lists.item.created` | selection-list-service | `POST /lists/{id}/items`; seeding |
| `selection-lists.item.updated` | selection-list-service | `PATCH /lists/{id}/items/{itemId}` (incl. restore); seeding upgrade |
| `selection-lists.item.archived` | selection-list-service | `POST …/items/{itemId}/archive`, `DELETE …/items/{itemId}`; seeding |
| `selection-lists.item.deleted` | selection-list-service | `DELETE …/items/{itemId}?purge=true` |
| `selection-lists.item.reordered` | selection-list-service | `PUT /lists/{id}/items/reorder` |
| `selection-lists.translation.upserted` | selection-list-service | `PUT …/translations/{locale}` (list or item, non-source locale), autofill (one event per written translation), seeding |
| `selection-lists.translation.deleted` | selection-list-service | `DELETE …/translations/{locale}` |
| `selection-lists.access.granted` | selection-list-service | `PUT /lists/{id}/access/{userId}`; owner grant on `POST /lists` |
| `selection-lists.access.revoked` | selection-list-service | `DELETE /lists/{id}/access/{userId}` |
| `selection-lists.seed.requested` | **allowlisted services** | a service wants its app's lists in an org |
| `selection-lists.seed.completed` | selection-list-service | a seed (platform or requested) was applied / was a no-op |
| `selection-lists.seed.failed` | selection-list-service | a seed was rejected; nothing written |

**Deliberately NOT emitted** (each would be a redundant or misleading signal):

- No per-list events for an **org-wide cascade** from `identity.org.deleted` (soft archive
  or hard purge). Consumers subscribe to `identity.org.deleted` themselves; re-broadcasting
  up to 100 list events per org would race with it and add nothing.
- No per-item / translation / access events when a **list is purged** — `list.deleted`
  implies them. Likewise no translation events when an **item is purged**.
- No event for the `identity.user.deleted` anonymisation (`created_by` → sentinel); it
  changes no consumer-visible field.
- **Source-locale** text never produces `translation.*`: it is part of the list/item
  snapshot and changes surface as `list.updated` / `item.updated` (`name` / `label`).

## 5. Conventions every selection-lists event follows

- **`eventId`** (UUID) — unique per emission; the same value on every redelivery. The
  consumer-side idempotency key. Minted by the outbox writer with the identity package's
  UUIDv7 bytes (`bytesToUuid(uuidv7Bytes())`) so `gate-identifier --source` stays clean.
  The envelope `correlationId` keeps its existing meaning (request trace id).
- **`actor`** — discriminated on `type` (identifier standard §2: a polymorphic reference
  carries its type):
  `{ type: 'user', userId: 'usr_…' }` or
  `{ type: 'system', principal: 'selection-list-service', seedSource: '<app>' | 'platform' | null }`.
- **Ids are wire TypeIDs**, opaque past the prefix: `org_`, `usr_`, `front_sl_`, `front_sli_`.
- **`listRevision`** — a positive integer, **monotonic per list**, bumped in the same
  transaction as *any* change to the list or anything inside it (items, translations).
  Needed because Kafka orders only *within one topic partition*: `item.created` and
  `list.updated` are on different topics and can be consumed in either order. A consumer
  that maintains a per-list read model applies an event only if its `listRevision` is
  greater than the last one it applied for that list, and refetches over HTTP on a gap
  it cares about. Access events carry no revision (they do not change list content).
- **Event-carried state transfer.** `created` / `updated` / `archived` carry a full
  snapshot (`list` or `item`) in the source locale, with `seed` provenance — a consumer
  never has to call back to apply an event.
- **Casing** is camelCase (Kafka family convention), unlike the snake_case HTTP resources.

### Versioning and compatibility

- The envelope `version` is `"1.0"` for every V1 schema.
- **Additive, optional** payload fields are a minor change: envelope `"1.1"`, same topic,
  same `…SchemaV1` export. Published schemas are non-strict `z.object`s, so an older
  consumer silently strips the new field — a test pins this.
- **Anything else is breaking** (removing/renaming a field, narrowing a type, a new
  required field, a new enum member a consumer must handle): a new `…SchemaV2` on a **new
  topic** `<topic>.v2`, dual-published for one deprecation window announced in the
  guide; V1 is retired only after every consumer group has moved.
- Enum growth on `seed.failed.reason` and `seed.completed.outcome` **is breaking** for a
  strict consumer — so consumers are told to treat an unknown reason as non-retryable
  failure and an unknown outcome as success, and new members still ship as a minor
  version only with that guidance in place.
- `selection-lists.seed.requested` is **strict** (`.strict()` everywhere — the identifier
  standard requires a create body to reject unknown fields so an `id` cannot be smuggled
  in). An additive field therefore requires the **service to deploy first**, then
  producers; the builders refuse unknown fields too, so a producer cannot get ahead.

## 6. Delivery: outbox, at-least-once, idempotency

Copy `backend/core/src/events/{outbox.ts,outboxRelay.ts,kafkaPublisher.ts}`:

1. Every route/handler that changes state calls `enqueueEvent(trx, topic, payload, correlationId)`
   **inside the same transaction** as the change (`event_outbox` row). Rollback drops the event.
2. A relay polls `pending` rows with `FOR UPDATE SKIP LOCKED`, validates each payload with
   `schemaForTopic(topic)` (a schema failure is a bug → park immediately), publishes with
   key = `partitionKeyForPayload(payload)`, marks `sent`.
3. A publish failure increments `attempts`; after **10** the row is parked as `failed` and
   copied to `<topic>.dlq`; an alert fires on any parked row.
4. Ordering: the relay publishes rows **in `created_at, id` order per organization** and
   never publishes row N+1 for an org while row N for that org is pending retry (the core
   relay does not do this today — the selection-list relay must, or per-org ordering is
   lost on a transient failure). Recorded as an implementation requirement, test T-O3.

**Guarantee:** at-least-once, ordered per (topic, organization). **Not** exactly-once.

**Consumer guidance** (in the guide): dedupe on `eventId` (keep a processed-ids table or
an idempotent upsert); for read models, also gate on `listRevision`; treat
`list.deleted` as a tombstone for the `listId` (a later lower-revision event for it is
stale).

## 7. Consumed events

| Topic | Consumer group | Behaviour | Status |
|---|---|---|---|
| `identity.org.deleted` | `${KAFKA_GROUP_ID}-org-deleted` | soft → archive org lists; hard → purge (existing `org-deleted.handler.ts`) | **exists** |
| `identity.user.deleted` | `${KAFKA_GROUP_ID}-user-deleted` | anonymise `created_by` / `granted_by` (existing) | **exists** |
| `identity.org.created` | `${KAFKA_GROUP_ID}-org-created` | seed the platform default pack(s) | **new** |
| `selection-lists.seed.requested` | `${KAFKA_GROUP_ID}-seed-requested` | validate, authorise, apply a pack | **new** |
| `identity.user.created` | — | **not applicable** — no user-scoped lists (decision §2) | declared N/A |

Both new consumers are gated by `fuzefront.selection-lists.seed-defaults` ([§11](#11-feature-flag)).

### 7.1 `identity.org.created` → platform defaults

1. Convert `organizationId` (bare UUID) → `org_…` with `fromUuid('organization', …)`.
2. Upsert the org into the service's **org projection** (the `@izzywdev/fuzefront-identity`
   `ref-index` L1 store, fed by `identity.org.created` / `.deleted`), so later
   `seed.requested` messages can check the org exists.
3. If `isActive === false` → skip (no ledger row, log). If the flag is OFF for the org →
   skip; the reconciler (step 6) seeds it later.
4. For each platform pack whose `appliesTo` includes the org's `type`: run the **seed
   algorithm** (§9) with `source = 'platform'`, `requestId = null`,
   `trigger = 'org-created'`, actor = system principal.
5. Emit `seed.completed` / `seed.failed` (so ops can observe platform seeding exactly like
   app seeding) plus the per-list/item `created` events, all through the outbox.
6. **Reconciler** (a periodic job, not an event): every org in the projection whose
   ledger lacks the current platform pack version and for which the flag is ON gets
   seeded with `trigger = 'backfill'`. This covers orgs created while the flag was OFF,
   orgs that predate this feature, and pack upgrades (v1 → v2). Without it, flipping the
   flag ON would seed only *future* orgs.

**Race with deletion.** `identity.org.created` and `identity.org.deleted` are different
topics in different consumer groups; a delete can be processed first. The seed algorithm
refuses (`ORG_INACTIVE`) when the projection marks the org deleted, and the
`org-deleted` handler marks the projection deleted **before** cascading. So a late create
never resurrects lists in a deleted org.

### 7.2 `selection-lists.seed.requested` → app seeding

1. Parse with `selectionListsSeedRequestedSchemaV1`. On failure: dead-letter (as
   `TypedConsumer` does) **and**, if `requestId`, `organizationId`, `source`, `pack` can be
   read from the raw JSON, emit `seed.failed` / `VALIDATION_ERROR` (best-effort), so the
   requester is not left waiting forever. The DLQ copy contains the attestation token —
   same exposure as the source topic (§8).
2. `scope === 'user'` → `seed.failed` / `SCOPE_UNSUPPORTED` (not retryable).
3. Flag OFF for the org → `SEEDING_DISABLED` (retryable).
4. Verify the attestation and the allowlist (§8) → `ATTESTATION_INVALID` /
   `SOURCE_NOT_ALLOWED` / `NAMESPACE_VIOLATION` / `LIMIT_EXCEEDED`.
5. Org check against the projection → `ORG_UNKNOWN` (retryable — the create may not have
   been consumed yet) / `ORG_INACTIVE`.
6. Run the seed algorithm (§9) with `trigger` from the request.

## 8. Trust model for `seed.requested`

The topic is unauthenticated today, so authentication rides **in the message**, and the
broker-level controls are requested from FuzeInfra as defence in depth ([§15](#15-drafted-unsent-fuze-delegation-to-fuzeinfra)).

**Authentication — `attestation`.** Every request carries
`{ kind: 'service-token', token }`: a short-lived OAuth `client_credentials` token minted
by the requesting service with `@fuzefront/service-auth`, scope **`selection-lists:seed`**.
The consumer introspects it with the existing fail-closed verifier
(`packages/service-auth/src/verifier.ts`, `POST /api/v1/security/tokens/introspect`):
`active` must be true and `scopes` must include `selection-lists:seed`. The
introspected **`subject`** is the authenticated caller. An expired token is
`ATTESTATION_INVALID` with `retryable: true` (re-send with a fresh token).

- Requesters MUST mint a **dedicated** token carrying only `selection-lists:seed` — never
  reuse a broader token (e.g. `authz:admin`), because the token sits in the Kafka log for
  the topic's retention and anyone who can read the topic can read it. With only that
  scope, a stolen token grants exactly what the thief could already attempt by producing
  to the topic, and only until it expires.
- Outcome events, logs and metrics **never** echo the token.

**Authorisation — `seed_sources` allowlist.** One row per app slug:

| Field | Meaning |
|---|---|
| `app` | the seed source (`source.app`); `platform` is reserved and rejected |
| `allowed_subjects` | introspected `subject`s allowed to seed for this app; the token's subject must be in it → else `SOURCE_NOT_ALLOWED` |
| `key_prefixes` | allowed list-key namespaces; default `['<app>-']` → else `NAMESPACE_VIOLATION` |
| `max_lists_per_request`, `max_items_per_request` | ≤ the contract caps (20 / 2000) → else `LIMIT_EXCEEDED` |
| `enabled` | kill switch for one source |

The source of truth is a **reviewed file in git**,
`services/selection-list-service/seed-sources.json` (schema-validated at boot), synced
to the table on startup (upsert; rows missing from the file are disabled, never deleted,
so audit provenance keeps resolving). Adding a source is therefore a PR, reviewed like
any other code.

**Bounded blast radius even if everything above failed:** seeding can only *create* lists
in the source's namespace and *update/archive rows that source itself seeded and nobody
edited*; it never deletes, never touches user-authored or user-edited rows, never grants
access, and is capped by the org quota. The worst case of a forged request is unwanted
lists in one namespace, visible in audit with their seed source.

**Known gap until FuzeInfra adds SASL/ACLs:** the platform-wide lifecycle topics
(`identity.org.deleted`, which drives a **hard purge** here) are forgeable by anything on
the broker network. That is a family-level risk, not introduced by this contract, and is
the main reason for the delegation in §15.

## 9. The seed algorithm (one transaction per request)

All of it runs in **one DB transaction**; outcome + list/item/translation events go to the
outbox in the same transaction. A failure at any step rolls back everything and emits
only `seed.failed` (in its own transaction). There is no partial success.

**Ledger key:** `(organization_id, seed_source, seed_key, version)` where `seed_key` is
the pack key. Take `pg_advisory_xact_lock(hash(organization_id, seed_source, seed_key))`
first so concurrent duplicates serialise.

1. **Version check** against the highest applied version `V_max` for (org, source, pack):
   - `version < V_max` → `seed.completed` `outcome: 'superseded'`, no changes.
   - `version == V_max` → compare the request's **content hash** (SHA-256 over the
     canonical JSON of `lists`) with the ledger's: equal → `already-applied` (re-emit the
     stored per-list result; duplicate delivery and re-sends land here); different →
     `seed.failed` / `PACK_CONTENT_MISMATCH` (a version's content is immutable).
   - no row → first application (`applied`); `version > V_max` → upgrade (`upgraded`).
2. **Plan** each list in the pack against existing rows found **by provenance**
   (`seed_source, seed_key, seed_list_key`) — not by current key, because users may rename:
   - not seeded before, key free → **create** (list + items in array order, `sort_order`
     = `(index + 1) * 100`, translations).
   - not seeded before, key taken by a row this source/pack did not seed → `KEY_CONFLICT`
     (retryable once the user renames theirs) — the whole request fails.
   - seeded before and the row **was purged** by a user (a ledger manifest entry exists but
     no row) → **skip** (`skipped-user-deleted`); never recreated.
   - seeded before and the **list** is **user-modified** (§9.1) → **skip the whole list**
     (`skipped-user-edited`), including items new in this version. A user-edited list is
     left entirely alone: predictable beats clever, and a user who renamed or retranslated
     a list has taken ownership of it.
   - seeded before, unmodified → **update** to the new content: changed text,
     added items (appended after the current max `sort_order`), items removed from the
     pack **archived** (still resolve), items the user edited/archived/purged skipped.
     **Never** reorder existing items.
   - in the previous version's manifest but **not in this one**, unmodified → **archive**
     (`archived`); modified → leave it.
3. **Quota** — counting every list the plan creates against the org's
   `max_lists` (default 100) and every list's resulting item count against
   `max_items_per_list` (default 500). Any excess → `QUOTA_EXCEEDED` with `details`
   (`quotaScope`, `limit`, `current`, `requested`), nothing written. Seeded lists **do**
   count toward the org quota. The per-creator `max_lists_per_user` (20) is a cap on
   *humans*; the system principal is exempt from it.
4. **Write** rows with provenance (§13), the ledger row (version, content hash, manifest
   of list keys + item codes, per-list result), audit rows, and the outbox events.

### 9.1 "Seeded-then-edited" detection

Each seeded list/item row stores `seed_hash` — SHA-256 of exactly the content seeding
wrote (list: key, source locale, name, description, seeded translations; item: label,
description, seeded translations, status). At upgrade time the service recomputes the
hash of the row's *current* values; **any difference = user-modified**, permanently
(`seed_user_modified = true` is then persisted so the snapshot's
`seed.userModified` is cheap to emit). Hash comparison, not a "did an HTTP route set a
flag" bit, so a code path that forgets to set the flag still cannot cause an overwrite.
Machine translations from autofill on a seeded list count as an edit only for that
translation row, not for the item (they are tracked by `is_machine`, and seeding never
touches a translation row it did not write).

### 9.2 Seeding actor, `created_by`, audit, access

- Actor in events: `{ type: 'system', principal: 'selection-list-service', seedSource }`.
- `created_by` on seeded rows: the system principal string
  **`system:selection-list-service`**. Audit rows: `actor_id` = the same,
  `action = 'seed.applied' | 'seed.upgraded' | 'seed.archived'`, `after` includes
  `{ seedSource, packKey, packVersion, requestId }`.
- **No per-instance `list-owner` grant** is written for seeded lists (there is no human
  creator). They are administered by org admins through the tenant-level role, exactly
  like "a list nobody but an org admin can administer" in `routes/lists.ts`. The
  last-owner guard (`countActiveOwners`) must treat seeded lists with zero owners as
  valid, so the first human grant on one is not blocked. Open question Q3.
- **HTTP contract ripple (prerequisite, see §13.1).**

## 10. Platform default seed packs

**Format:** `services/selection-list-service/seed-packs/platform/<packKey>.v<version>.json`,
validated at boot (and in a unit test) against `selectionListSeedPackSchemaV1` from
`@fuzefront/shared/kafka` — the same list/item rules as `seed.requested`. A pack version
file is immutable once released; a change is a new `v<N+1>` file. The service refuses to
start if two files claim the same (packKey, version) or a file fails validation.

```json
{
  "packKey": "platform-defaults",
  "version": 1,
  "appliesTo": ["organization", "personal"],
  "lists": [
    { "key": "yes-no", "sourceLocale": "en", "name": "Yes / No",
      "translations": [{ "locale": "es", "name": "Sí / No" }],
      "items": [ { "code": "YES", "label": "Yes", "translations": [{ "locale": "es", "label": "Sí" }] },
                 { "code": "NO",  "label": "No",  "translations": [{ "locale": "es", "label": "No" }] } ] }
  ]
}
```

**Proposed initial catalogue — `platform-defaults` v1** (3 lists, 10 items):

| Key | Items (code → en label) | Why it earns a place |
|---|---|---|
| `yes-no` | `YES` Yes, `NO` No | The most common "labelled boolean" in forms; every product re-invents it. |
| `priority` | `LOW` Low, `MEDIUM` Medium, `HIGH` High, `URGENT` Urgent | Tickets, tasks, CRM, alerts — the canonical shared vocabulary across Fuze products. |
| `work-status` | `NOT_STARTED` Not started, `IN_PROGRESS` In progress, `BLOCKED` Blocked, `DONE` Done | Generic workflow state; demonstrates seeded lists that orgs are expected to customise (and upgrades then respecting that). |

All 11 locales ship in the pack file (human-reviewed; produced through the
`packages/i18n-translate` pipeline in the implementation PR, `is_machine = false` once
reviewed).

**Deliberately excluded:** countries, currencies, languages, time zones. They are
*reference data* — large (≈250 × 11 locales), externally governed (ISO 3166 / 4217,
CLDR) and identical for every org. Copying them into every org (100-list quota, 500-item
cap — countries alone is ~250) is the wrong model; they belong in a future platform-global
read-only list type. Open question Q2.

`appliesTo` excludes `platform` (the root org) by default; it can opt in later.

## 11. Feature flag

| Key | `fuzefront.selection-lists.seed-defaults` |
|---|---|
| Type | release, **default OFF** (in-code fail-safe default OFF) |
| Evaluated | per message, context `{ organizationId, app: 'selection-list-service' }` |
| Gates | **both** new consumers: `identity.org.created` seeding and `seed.requested` handling, plus the reconciler |
| OFF behaviour | `org.created`: skip (reconciler catches up when ON). `seed.requested`: `seed.failed` / `SEEDING_DISABLED`, `retryable: true` |
| Independent of | `fuzefront.selection-lists.service` (master gate). Seeding also requires the master gate ON for the org. |
| Owner / removal | izzywdev; remove once seeding has been ON for all orgs for 30 days with zero `selection-lists.seed.failed` in that window (and the reconciler has backfilled every existing org) |

Registered by `feature-flags-engineer`: `packages/feature-flags/flag-registry.yaml` entry,
`FLAG_KEYS.SELECTION_LISTS_SEED_DEFAULTS` (server-only — deliberately not in
`WEB_EXPOSED_FLAGS`), and the service helper `isSeedDefaultsEnabled(ctx)` in
`services/selection-list-service/src/flags.ts` (fails closed). Both consumers must call the
helper per message with `{ organizationId }`.

Publishing of the change events (§4) is **not** flagged: it is a pure side effect with no
user-visible behaviour, and gating it would leave holes in consumers' read models.

## 12. gate-microservice-events policy change

`governance/microservice-events-policy.json` currently lists `selection-list-service`
under `knownUnhandled`. The **implementation PR** (not this one — no handler exists yet,
and the gate fails a service declared handled that is not) must, in the same commit that
adds the `identity.org.created` subscription:

1. Remove `"selection-list-service"` from `knownUnhandled` (the gate fails if it stays
   while the service handles its events).
2. Add:

```json
"notApplicable": {
  "selection-list-service": {
    "identity.user.created": "No user-scoped lists exist (selection_lists is keyed by organization_id; user_lists is a per-creator quota). Seeding for a user scope is answered SCOPE_UNSUPPORTED; see docs/planning/selection-lists-events.md section 2."
  }
}
```

3. Update the `$comment` block's selection-list-service sentence ("notApplicable
   candidate on the created pair in a later PR") to record the resolution: org.created
   is handled (platform seeding), user.created is N/A.

The anti-vacuity check needs a write in `src/` — the seed algorithm's inserts satisfy it.
Run `python3 scripts/gate_microservice_events.py --report` before and after.

## 13. DB schema sketch (for `database-engineer`)

```sql
-- provenance on seeded rows (NULL for user-authored rows)
ALTER TABLE selection_lists
  ADD COLUMN revision           BIGINT  NOT NULL DEFAULT 1,     -- listRevision (§5)
  ADD COLUMN seed_source        TEXT,                            -- 'platform' | app slug
  ADD COLUMN seed_key           TEXT,                            -- pack key
  ADD COLUMN seed_list_key      TEXT,                            -- key as seeded (survives renames)
  ADD COLUMN seed_version       INTEGER,
  ADD COLUMN seed_hash          TEXT,
  ADD COLUMN seed_user_modified BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN is_seeded          BOOLEAN GENERATED ALWAYS AS (seed_source IS NOT NULL) STORED;
CREATE UNIQUE INDEX ux_sl_seed_identity
  ON selection_lists (organization_id, seed_source, seed_key, seed_list_key)
  WHERE seed_source IS NOT NULL;

ALTER TABLE selection_list_items
  ADD COLUMN seed_source TEXT, ADD COLUMN seed_key TEXT, ADD COLUMN seed_version INTEGER,
  ADD COLUMN seed_hash TEXT, ADD COLUMN seed_user_modified BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN is_seeded BOOLEAN GENERATED ALWAYS AS (seed_source IS NOT NULL) STORED;

CREATE TABLE selection_list_seed_ledger (
  organization_id TEXT        NOT NULL,
  seed_source     TEXT        NOT NULL,
  seed_key        TEXT        NOT NULL,          -- pack key
  version         INTEGER     NOT NULL,
  scope           TEXT        NOT NULL DEFAULT 'org' CHECK (scope IN ('org','user')),
  content_hash    TEXT        NOT NULL,
  manifest        JSONB       NOT NULL,          -- { listKey: [itemCode, ...] } as applied
  result          JSONB       NOT NULL,          -- the seed.completed `lists` array
  request_id      TEXT,                          -- NULL for platform seeds
  trigger         TEXT        NOT NULL,
  applied_by      TEXT        NOT NULL,          -- 'system:selection-list-service'
  attested_subject TEXT,                         -- introspected subject; NULL for platform
  applied_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, seed_source, seed_key, version)
);

CREATE TABLE selection_list_seed_sources (
  app                    TEXT PRIMARY KEY CHECK (app <> 'platform'),
  allowed_subjects       TEXT[]  NOT NULL,
  key_prefixes           TEXT[]  NOT NULL,
  max_lists_per_request  INTEGER NOT NULL CHECK (max_lists_per_request BETWEEN 1 AND 20),
  max_items_per_request  INTEGER NOT NULL CHECK (max_items_per_request BETWEEN 1 AND 2000),
  enabled                BOOLEAN NOT NULL DEFAULT true,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- the outbox, as in backend/core (event_outbox: id, topic, payload jsonb,
-- correlation_id, status, attempts, created_at, sent_at) + organization_id for
-- per-org ordered relay (§6 step 4).
-- the org projection: the ref-index store (packages/identity/src/ref-index.ts).
```

The org-deleted **hard** purge must also delete the org's ledger rows; the **soft**
cascade keeps them (a restore must not re-seed).

### 13.1 HTTP contract ripple — prerequisite for the implementation wave

`openapi.yaml` (v2.0.0) types `SelectionList.created_by`, `SelectionListItem.created_by`
and `SelectionListAccessGrant.granted_by` as `UserId` (`^usr_[0-9a-z]+$`), and the
resources are `additionalProperties: false`. Seeded rows (`created_by =
'system:selection-list-service'`) would violate the response contract. Before seeding
ships, `contract-designer` amends the HTTP contract (major bump, client regen):

- `created_by` → `oneOf: [UserId, SystemPrincipal]` (`SystemPrincipal`: `^system:[a-z0-9-]+$`).
- add a read-only `seed` object (`source`, `pack_key`, `pack_version`, `user_modified`)
  or `null` to `SelectionList` and `SelectionListItem`.

**Existing defect found while checking this:** `user-deleted.handler.ts` already writes
the sentinel `'[deleted-user]'` into `created_by` / `granted_by`, which equally violates
`^usr_…`. The same amendment must cover it (e.g. widen to a `DeletedUser` sentinel), or
the handler must change. Not fixed here: it is an HTTP-contract + behaviour change outside
this event-contract PR; it is listed so the amendment PR picks it up.

## 14. Implementation wave (for the orchestrator)

Gated on this PR merging. Streams and what each owns:

| Stream | Work |
|---|---|
| `contract-designer` | §13.1 HTTP amendment (+ the `[deleted-user]` sentinel) — **before** backend seeding merges |
| `database-engineer` | §13 migrations (provenance, revision, ledger, seed_sources, outbox, ref-index store) |
| `backend-engineer` | outbox writer in every mutating route; per-org ordered relay; `org-created` + `seed-requested` consumers; seed algorithm; reconciler; attestation verification; pack loader; `seed-sources.json` loader; `platform-defaults.v1.json` |
| `feature-flags-engineer` | register `fuzefront.selection-lists.seed-defaults` + `FLAG_KEYS` constant |
| `devops-engineer` | add the 16 topics + `selection-lists.seed.requested.dlq` + DLQs for the two new consumed identity topics to `deploy/helm/fuzefront/values.yaml` `kafkaTopics.topics`; `KAFKA_GROUP_ID` unchanged; Authentik `client_credentials` clients with scope `selection-lists:seed` for each allowlisted source |
| `test-engineer` | the test plan below |
| `docs-maintainer` | keep `docs/guides/SELECTION_LIST_EVENTS.md` and `SELECTION_LIST_SERVICE.md` in sync |
| governance | §12 policy edit, in the backend PR |

Suggested topic config: 3 partitions (matches the identity topics), replication per
cluster, retention 7 days, `cleanup.policy=delete`; `seed.requested` retention **1 day**
(it carries bearer tokens; shorter retention shrinks the exposure window).

### Test plan

Publishing (P):
- P1 every mutating route enqueues exactly the event(s) in §4 in the same transaction; a rolled-back request enqueues nothing.
- P2 every enqueued payload validates against `schemaForTopic(topic)`; the fixtures in `shared/tests/fixtures/selection-lists/published-examples.json` stay valid.
- P3 `listRevision` strictly increases per list across list/item/translation events.
- P4 key rename emits `list.updated` with `previousKey`; restore emits `updated` with `status`.
- P5 purge emits only `list.deleted` / `item.deleted` (no cascade events); org cascade emits nothing.
- P6 source-locale writes emit `*.updated`, never `translation.*`.

Ordering / delivery (O):
- O1 relay publishes with key = `organizationId`.
- O2 relay retry: 10 failures → parked + DLQ + metric.
- O3 per-org ordering preserved across a transient publish failure (row N+1 waits).

Platform seeding (S):
- S1 happy path: org.created (type organization) → 3 lists, 10 items, translations, ledger row, `seed.completed` `applied`, all events.
- S2 duplicate delivery of the same org.created → `already-applied`, no new rows, no duplicate list/item events.
- S3 `isActive: false` → nothing seeded. S4 `type: platform` → not seeded (appliesTo).
- S5 flag OFF → nothing seeded; flag ON + reconciler → seeded with `trigger: backfill`.
- S6 org.deleted processed before org.created → no lists created (`ORG_INACTIVE`).
- S7 pack v2: unedited list updated, edited list skipped, user-purged list not recreated, dropped list archived, new items appended, existing order untouched.
- S8 invalid pack file → service refuses to start (and a unit test validates every shipped pack).

App seeding (R):
- R1 happy path: allowlisted source, valid attestation → `applied`, rows carry provenance, `created_by = system:selection-list-service`.
- R2 duplicate (same requestId, same content) → `already-applied`, identical `lists` result.
- R3 same version, different content → `PACK_CONTENT_MISMATCH`, nothing written.
- R4 older version after newer → `superseded`.
- R5 `scope: 'user'` → `SCOPE_UNSUPPORTED`.
- R6 attestation inactive / expired / missing scope → `ATTESTATION_INVALID` (retryable); token never in outcome/logs.
- R7 subject not in `allowed_subjects`, unknown or disabled source → `SOURCE_NOT_ALLOWED`.
- R8 key outside `key_prefixes` → `NAMESPACE_VIOLATION`; over per-source caps → `LIMIT_EXCEEDED`.
- R9 **partial failure is impossible**: a request whose 3rd list exceeds the item quota writes nothing for lists 1–2 (`QUOTA_EXCEEDED`, details populated).
- R10 org quota: 99/100 used + 2 lists → `QUOTA_EXCEEDED`, nothing written.
- R11 key taken by a user list → `KEY_CONFLICT`; after rename, retry succeeds.
- R12 unknown org → `ORG_UNKNOWN` (retryable); after org.created arrives, retry succeeds.
- R13 schema-invalid message → DLQ + best-effort `VALIDATION_ERROR`.
- R14 concurrent duplicates (two consumers / rebalance) → advisory lock → one `applied`, one `already-applied`.
- R15 handler crash after commit but before offset commit → redelivery → `already-applied` (idempotent).

Gate: `python3 scripts/gate_microservice_events.py` green with the §12 policy.

## 15. Drafted, UNSENT `@fuze` delegation to FuzeInfra

> Not sent. FuzeInfra is never edited from this repo; this is the text for the owner to
> post (or to adapt) on the FuzeInfra tracker. Topic **creation** is NOT part of it —
> FuzeFront pre-creates its topics with its own `kafka-topics` Helm hook job.

```text
@fuze FuzeInfra — Kafka authentication + ACLs for the FuzeFront selection-lists topics

Context: izzywdev/FuzeFront docs/planning/selection-lists-events.md (§8, §15).
FuzeFront services connect to fuzeinfra-kafka.fuzeinfra.svc.cluster.local:9092 with no
authentication, so any pod that reaches the broker can produce to any topic. The new
selection-lists.seed.requested topic lets other services ask selection-list-service to
write data into an organization; today it relies on an in-message service token.
Broker-level identity would make that defence in depth instead of the only line.

Requested:
1. Enable SASL/SCRAM-SHA-512 (or mTLS) listeners on the FuzeInfra Kafka, keeping the
   PLAINTEXT listener during a migration window, with an announced cut-over date.
2. One principal per FuzeFront service (at minimum: selection-list-service,
   security-service/identity producer, and each service on the seed allowlist), with
   credentials delivered as sealed secrets per FuzeInfra convention.
3. ACLs:
   - selection-lists.*  (prefixed):   WRITE only User:selection-list-service
     EXCEPT selection-lists.seed.requested (literal): WRITE for the allowlisted
     principals only (initial list provided with the first seed-source PR);
     READ for User:selection-list-service.
   - selection-lists.* (prefixed):    READ for any authenticated FuzeFront principal
     (consumers of the change events), group ACLs per consumer group.
   - identity.* (prefixed):           WRITE only the identity producer principal
     (closes forgeable identity.org.deleted, which drives hard purges).
   - *.dlq: WRITE for the consuming service of the base topic.
4. allow.everyone.if.no.acl.found=false once all FuzeFront services have migrated.

No FuzeFront change depends on this landing first; selection-list-service will move to
SASL via @fuzefront/shared createKafkaClient once credentials exist.
```

## 16. Open questions

| # | Question | Default until answered |
|---|---|---|
| Q1 | Do we want user-scoped lists (a user's private lists, or per-user defaults)? It needs a data model (`owner_type`/`owner_id`), quotas, authz and an HTTP contract change. | `scope: 'user'` → `SCOPE_UNSUPPORTED`; `identity.user.created` N/A |
| Q2 | Platform-global, read-only reference lists (countries, currencies, languages) instead of per-org copies? | Excluded from the platform pack |
| Q3 | Should seeded lists get a human `list-owner` (e.g. the org owner from `identity.org.created.ownerId`) instead of relying on org-admin tenant roles? | No instance grant; org admins administer |
| Q4 | Should users be prevented from creating lists in an allowlisted source's namespace (e.g. reject `fuzecrm-*` over HTTP) to make `KEY_CONFLICT` impossible? | Allowed; conflicts surface as retryable `KEY_CONFLICT` |
| Q5 | Is the attestation token acceptable operationally, or should app seeding move to the HTTP runner-up (§3)? Decide with FuzeInfra's answer on §15. | Attestation required in v1 |
| Q6 | Should the core outbox relay also adopt per-org ordered retry (§6 step 4)? It affects every service using it. | Selection-list relay only |
