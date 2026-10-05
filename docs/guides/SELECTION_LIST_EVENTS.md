# Selection lists — Kafka events: consumer & producer guide

How another Fuze service (1) seeds selection lists for its app into an organization and
(2) consumes the selection-list-service's change events.

> **Status — what is real, and what is not live yet.** The service now **emits** every
> change event (transactional outbox in every mutating route) and **consumes**
> `identity.org.created`, `selection-lists.seed.requested`, `identity.org.deleted` and
> `identity.user.deleted`. That is **code on `master`**, not a switched-on feature:
>
> - **Seeding is not live until the flag is on and your source is allowlisted.** It is gated
>   by *two* release flags, both **default OFF** and both evaluated per message, per
>   organization: `fuzefront.selection-lists.service` (master) **and**
>   `fuzefront.selection-lists.seed-defaults`. With either OFF, a `seed.requested` is answered
>   `seed.failed` / `SEEDING_DISABLED`; nothing is written. On top of that your app must be an
>   enabled row in `services/selection-list-service/seed-sources.json` — the shipped file lists
>   **only the internal `platform` source**, so every app request is currently refused with
>   `SOURCE_NOT_ALLOWED`.
> - The service is **not deployed in production** yet (`selectionListService.enabled: false` in
>   `deploy/helm/fuzefront/values-prod.yaml`), so no topic traffic exists there. Enablement
>   order and safety checks: [`docs/runbooks/selection-lists-seeding-operations.md`](../runbooks/selection-lists-seeding-operations.md).
> - **Not built:** the reconciler/backfill (no code path re-seeds an org whose
>   `identity.org.created` arrived while the flag was OFF) and an `identity.org.updated`
>   consumer. See "What you cannot rely on" below.
>
> Contract: schemas in `@fuzefront/shared` ≥ 1.1.0
> (`shared/src/kafka/schemas/selection-lists.*.ts` are the source of truth). Design and
> rationale: [`docs/planning/selection-lists-events.md`](../planning/selection-lists-events.md).
> HTTP API: [`SELECTION_LIST_SERVICE.md`](SELECTION_LIST_SERVICE.md).

## Topics at a glance

Every message is a `FuzeEvent` envelope `{ version, topic, correlationId, occurredAt, payload }`
(`version` is `"1.0"`). The Kafka message **key is the `organizationId`** (an `org_…` TypeID), so
one organization's messages stay on one partition and in order. Dead letters go to
`<topic>.dlq`.

| Topic | Who produces | You would… |
|---|---|---|
| `selection-lists.list.created` / `.updated` / `.archived` / `.deleted` | selection-list-service | keep a read model of an org's lists |
| `selection-lists.item.created` / `.updated` / `.archived` / `.deleted` / `.reordered` | selection-list-service | keep item labels / order in sync, denormalise labels |
| `selection-lists.translation.upserted` / `.deleted` | selection-list-service | keep non-source-locale labels in sync |
| `selection-lists.access.granted` / `.revoked` | selection-list-service | show who can edit a list (never authorize from it) |
| `selection-lists.seed.requested` | **you** (allowlisted) | ask for your app's lists to be seeded into an org |
| `selection-lists.seed.completed` / `.failed` | selection-list-service | learn the outcome of your seed request |

Imports (TypeScript):

```ts
import {
  TOPICS,
  schemaForTopic,
  selectionListsItemUpdatedSchemaV1,
  type SelectionListsItemUpdatedPayloadV1,
} from '@fuzefront/shared/kafka'
```

Example payloads for every topic:
`shared/tests/fixtures/selection-lists/published-examples.json` (validated in CI).

---

## Part 1 — Seeding lists for your app

Two things seed lists into an organization; only the second is yours.

1. **Platform defaults** (`source: platform`): the service seeds its own reviewed pack
   (`yes-no`, `priority`, `work-status`, in 11 locales) into every new org when it consumes
   `identity.org.created` — if both flags are ON for that org at that moment. You do not
   request these.
2. **App seeding** (`seed.requested`): you send a versioned **pack** of lists for your app;
   the service applies it atomically and answers with `seed.completed` or `seed.failed`.

### 1. Get on the allowlist (a reviewed PR — nothing is self-service)

Seeding is authorised per **app slug** (your registry slug, e.g. `fuzecrm` — free-form and
immutable, see the naming rule in the repo `CLAUDE.md`; this is **not** the display name).
Open a PR adding your app to `services/selection-list-service/seed-sources.json`. The file is
schema-validated at service boot (an invalid file **stops the service from starting**) and
synced into the `selection_list_seed_sources` table; a source removed from the file is
**disabled, never deleted**.

```json
{
  "app": "fuzecrm",
  "allowedSubjects": ["<introspected subject of your seed client>"],
  "keyPrefixes": ["fuzecrm-"],
  "maxListsPerRequest": 20,
  "maxItemsPerRequest": 2000,
  "enabled": true
}
```

| Field | Meaning | Constraint (verified in `src/seed/sources.ts`) |
|---|---|---|
| `app` | the allowlist key and `source.app` you send | a slug (`^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$`); `platform` is reserved |
| `allowedSubjects` | the **introspected token subject(s)** allowed to seed for this app — the authentication-to-authorisation binding | ≥ 1 entry; a token whose subject is not listed is `SOURCE_NOT_ALLOWED` |
| `keyPrefixes` | allowed list-key namespaces; **optional, defaults to `["<app>-"]`** | every list you seed must start with one of them (`fuzecrm-deal-stages`), else `NAMESPACE_VIOLATION` |
| `maxListsPerRequest` / `maxItemsPerRequest` | your per-request caps | required; ≤ the contract caps 20 / 2000 |
| `enabled` | per-source kill switch | defaults to `true`; `false` ⇒ `SOURCE_NOT_ALLOWED` |

The keys are **camelCase** (`allowedSubjects`, `keyPrefixes`); older drafts of this page and the
runbook said `allowed_subjects` / `key_prefixes` — that is the DB column spelling, not the file's.

You also need a **dedicated OAuth `client_credentials` client** whose only scope is
`selection-lists:seed` (devops provisions it in Authentik; procedure:
[`docs/runbooks/selection-lists-seed-clients.md`](../runbooks/selection-lists-seed-clients.md)).
Find the exact value for `allowedSubjects` by introspecting a real token for that client
(`POST /api/v1/security/tokens/introspect` → `subject`) — do not guess its format.
The allowlist change ships with the next service release; until then you get
`SOURCE_NOT_ALLOWED`.

### 2. Get the attestation token (`client_credentials`, scope `selection-lists:seed`)

The topic itself is unauthenticated (FuzeInfra Kafka has no SASL/ACLs for it), so
authentication rides **inside the message**: `attestation: { kind: 'service-token', token }`.
The service introspects the token through the Security API and requires `active == true`, an
unexpired `exp`, a `subject`, and the scope `selection-lists:seed`. The introspected subject must
then be in your `allowedSubjects`.

Mint it with `@fuzefront/service-auth` (the same helper the service itself uses for its own
machine identity; it caches the token and refreshes it shortly before expiry):

```ts
import { createServiceAuthClient } from '@fuzefront/service-auth'

const seedTokenClient = createServiceAuthClient({
  baseUrl: 'https://app.fuzefront.com', // ORIGIN ONLY — the package appends /api/v1/security/tokens
  clientId: process.env.SEED_CLIENT_ID!,
  clientSecret: process.env.SEED_CLIENT_SECRET!,
  scope: 'selection-lists:seed',
})
// ...later:  await seedTokenClient.getToken()
```

- **Dedicated client, dedicated token.** The token sits in the Kafka log for the topic's
  retention (1 day when the topic is created from the chart — see the runbook; the broker
  default if it is auto-created). A broader scope (`authz:admin`, …) would turn a log read into
  a privilege escalation. Never reuse a token minted for another purpose.
- On `ATTESTATION_INVALID`, call `seedTokenClient.invalidate()` and re-send with a fresh token.
- Tokens are short-lived (Authentik default one hour); do not mint one days ahead and park it
  in a queue.
- What the service verifies is **only** the token, never `source.service` (that field is audit
  metadata, "authenticated via the attestation, not trusted from the payload").

### 3. Build and send the request

Use the builder from the selection-list client (`@fuzeone/selection-list-client` ≥ 2.0.0 /
`fuzefront-selection-list-client` ≥ 2.0.0) — it validates everything the schema does, reports
every problem at once, and enforces the key prefix on your side.

```ts
import { buildSeedRequest, buildSeedRequestEnvelope, seedRequestKafkaKey, SEED_REQUESTED_TOPIC } from '@fuzeone/selection-list-client'
import { fromUuid } from '@izzywdev/fuzefront-identity'

const payload = buildSeedRequest({
  // Echoed on the outcome event. Deterministic => a re-send is recognisably the same request.
  requestId: `fuzecrm:${orgId}:crm-defaults:v2`,
  organizationId: fromUuid('organization', event.payload.organizationId), // identity.* carries bare UUIDs
  app: 'fuzecrm',
  service: 'crm-service',
  packKey: 'crm-defaults',
  packVersion: 2,
  serviceToken: await seedTokenClient.getToken(),
  trigger: 'app-installed',
  lists: [
    {
      key: 'fuzecrm-deal-stages',
      name: 'Deal stages',
      translations: [{ locale: 'es', name: 'Etapas del trato' }],
      items: [
        { code: 'LEAD', label: 'Lead' },
        { code: 'WON', label: 'Won' },
      ],
    },
  ],
})

await producer.send({
  topic: SEED_REQUESTED_TOPIC,
  messages: [{
    key: seedRequestKafkaKey(payload),
    value: JSON.stringify(buildSeedRequestEnvelope(payload, { correlationId })),
  }],
})
```

Python:

```python
from fuzefront_selection_list_client import (
    build_seed_request, build_seed_request_envelope, seed_request_kafka_key, SEED_REQUESTED_TOPIC,
)

payload = build_seed_request(
    request_id=f"fuzecrm:{org_id}:crm-defaults:v2",
    organization_id=org_id,            # org_… TypeID
    app="fuzecrm", service="crm-service",
    pack_key="crm-defaults", pack_version=2,
    service_token=seed_token,
    lists=[{"key": "fuzecrm-deal-stages", "name": "Deal stages",
            "items": [{"code": "LEAD", "label": "Lead"}, {"code": "WON", "label": "Won"}]}],
)
producer.produce(SEED_REQUESTED_TOPIC, key=seed_request_kafka_key(payload),
                 value=json.dumps(build_seed_request_envelope(payload, correlation_id=cid)))
```

`TypedProducer` from `@fuzefront/shared/kafka` with `selectionListsSeedRequestedSchemaV1`
works equally well and re-validates. Wire shape reference (all objects `.strict()` — an unknown
field, including an `id`, is a validation failure):

| Field | Notes |
|---|---|
| `requestId` | `^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$` |
| `organizationId` | `org_…` TypeID (not a bare UUID) |
| `scope` | `org`; `user` is accepted by the schema but refused `SCOPE_UNSUPPORTED` |
| `source` | `{ app, service }` — `app` ≠ `platform` |
| `pack` | `{ key (slug), version (positive int) }` |
| `trigger` | `org-created` \| `app-installed` \| `app-upgraded` \| `backfill` \| `manual` — recorded for audit; it does not change behaviour |
| `attestation` | `{ kind: 'service-token', token }`, token ≤ 4096 chars |
| `lists[]` | `{ key, sourceLocale, name, description?, translations?[], items[] }` |

`sourceLocale` is **required on the wire**; the **builders** default it to `en` for you.
`translations` are for the *other* locales only (the source-locale text is `name`/`label`).

### 4. Rules you must design for

- **No ids.** Lists and items are minted by the service; an `id` field is rejected.
- **Item order = array order.** You cannot set `sortOrder`.
- **Idempotency and versions — the ledger key is `(organization, source app, pack key, version)`,
  not `requestId`.** The service records every applied pack version with a content hash of the
  `lists` array. Consequently:
  - the same version + identical content again → `seed.completed` / `already-applied`, nothing
    written (this is what makes duplicate delivery and crash-resend safe);
  - the same version + **different** content → `seed.failed` / `PACK_CONTENT_MISMATCH`. **A
    version's content is immutable once applied anywhere** — change the content, bump the version;
  - a lower version than the one applied → `seed.completed` / `superseded`, nothing written;
  - a higher version → `upgraded` (see below).
  `requestId` is only echoed on the outcome (and stored for audit); two requests with different
  `requestId`s but the same pack version are the same request to the ledger.
- **All-or-nothing.** A request applies completely or writes nothing; a failed request leaves no
  list, item, translation or ledger row. Requests for one `(org, source, pack)` are serialised.
- **"Seeded-then-edited" — what it means for you.** Every seeded list and item stores a hash of
  exactly what seeding wrote. A row counts as *edited* (`seed.user_modified: true` on the HTTP
  API, permanent) as soon as a human changes its **content**: for a list its source-locale
  name/description, its status (archive/restore), or a human-written translation; for an item its
  label/description, status, or a human-written translation. Not edits: reordering, and machine
  translations written by autofill. Upgrades then behave like this:
  - an **edited item** is skipped (counted in `itemsSkipped`); the rest of the list still upgrades;
  - an **edited list** is skipped **as a whole, including any new items you added** —
    `skipped-user-edited` for that list;
  - a list or item a user **purged** is never recreated (`skipped-user-deleted`);
  - lists/items you **drop** from a newer version are **archived** (they still resolve), never
    deleted, and only if untouched;
  - existing item order is never changed; new items are appended after the current last item.
  Design your app so it does not depend on seeded content staying pristine, and never assume
  `seed.completed` means "the org now has exactly your pack".
- **Who owns the seeded lists.** Seeded rows are written by the system principal
  (`created_by: "system:selection-list-service"`) and **no `list-owner` grant is created**. Until
  someone with authority grants a role on a seeded list, members cannot see it through the HTTP
  API (see [`SELECTION_LIST_SERVICE.md`](SELECTION_LIST_SERVICE.md#seeded-lists-and-who-can-see-them)).
  Your app can still `resolve` item ids and can read the change events.
- **Quotas apply.** Seeded lists count toward the org's list quota (default 100 active lists) and
  the per-list item quota (default 500); a per-org override wins. The per-user list cap does not
  apply to seeding. Archived lists do not count.
- **Limits** (all enforced by the service unless noted):

  | Limit | Value |
  |---|---|
  | lists per request | ≤ 20 |
  | items per list | ≤ 500 |
  | items per request (all lists) | ≤ 2000 |
  | your allowlist caps | ≤ the three above (`LIMIT_EXCEEDED`) |
  | serialized request size | ≤ 900,000 bytes — enforced by the **builders only** (Kafka's default max message is 1 MiB) |
  | `name` / `label` | 1–200 chars; `description` ≤ 2000 |
  | translations per list/item | ≤ 10 (every supported locale but the source) |
  | supported locales | `en es fr de pt ru zh ja hi ar he` |
  | attestation token | ≤ 4096 chars |

- **When to send:** on `identity.org.created` for orgs that get your app by default, when your app
  is installed into an org, and after you release a new pack version (send it for every org that
  has your app; `superseded` / `already-applied` make that safe). **Because the platform has no
  backfill (below), re-send yourself** when a `SEEDING_DISABLED` / `ORG_UNKNOWN` failure tells you
  the org was not ready.
- **Send nothing before the org exists to the service.** The service learns about an org from
  `identity.org.created` (always projected, regardless of flags). A request that outruns it gets
  `ORG_UNKNOWN` (retryable).

### 5. Handle the outcome

Consume `selection-lists.seed.completed` and `selection-lists.seed.failed`, filter on
`source.app === '<your app>'`, and correlate on `requestId`. Exactly one outcome event is
produced per processed request. Outcomes travel through the same outbox relay as every other
event, so expect them a moment after the work commits.

`seed.completed.outcome`:

| Outcome | Meaning |
|---|---|
| `applied` | first application for this org |
| `upgraded` | a higher version replaced a lower one |
| `already-applied` | duplicate / re-send of the applied version — nothing changed |
| `superseded` | a higher version is already applied — nothing changed |

Treat an **unknown** outcome as success. `appliedVersion` is the highest version applied after
processing. `lists[]` reports per list:
`created | updated | unchanged | archived | skipped-user-edited | skipped-user-deleted`
plus item counters (`itemsCreated/Updated/Archived/Skipped`) and the minted `listId` (null only
for `skipped-user-deleted`).

`seed.failed` — **nothing was written for any reason.** `reason`, `message` (≤ 1000 chars),
`retryable`, and `details[]` (≤ 50 entries: `listKey`, `itemCode`, `path`, and for
limits/quota `quotaScope`, `limit`, `current`, `requested`):

| Reason | Retry the same request? | What to do |
|---|---|---|
| `SCOPE_UNSUPPORTED` | no | `scope: 'user'` is not supported; selection lists are organization-scoped |
| `SEEDING_DISABLED` | yes, later | a flag (master or `seed-defaults`) is OFF for this org. Nothing re-sends for you: re-send after the owner turns it on |
| `ATTESTATION_INVALID` | yes, with a **fresh token** | token inactive/expired/revoked, missing `selection-lists:seed`, or no subject. `invalidate()` your token client and re-send |
| `SOURCE_NOT_ALLOWED` | no | not on the allowlist, source disabled, or the token's subject is not in `allowedSubjects` — an allowlist PR / wrong client |
| `NAMESPACE_VIOLATION` | no | a key outside your `keyPrefixes`; `details[].listKey` names them |
| `LIMIT_EXCEEDED` | no | beyond your per-request caps; split the pack (`details[].quotaScope`: `request_lists` / `request_items`) |
| `QUOTA_EXCEEDED` | yes, after the org frees quota | org list quota or a list's item quota; `details` carry `limit`/`current`/`requested` |
| `KEY_CONFLICT` | yes, after the key is freed | a list with that key exists that this pack did not seed (a user list, another pack); rename/archive it, then re-send |
| `PACK_CONTENT_MISMATCH` | no | same version already applied with different content — bump the version |
| `ORG_UNKNOWN` | yes, with backoff | the org's `identity.org.created` has not reached the service |
| `ORG_INACTIVE` | no | the org was deleted, or was inactive when created (the projection is not updated on later deactivation) |
| `VALIDATION_ERROR` | no | fix the payload (the builders prevent this). Best-effort: only emitted if `requestId`, `organizationId`, `scope`, `source`, `pack` and `trigger` are individually valid; the message is also dead-lettered |
| `INTERNAL_ERROR` | yes, with backoff | a fault persisted through the service's in-process retries (up to 5 attempts per message); re-send |

The event's own `retryable` flag is authoritative. Treat an **unknown** reason as
non-retryable. Retry with exponential backoff and a cap; do not re-send in a tight loop — a
deterministic refusal (`retryable: false`) will never succeed.

If you see **no outcome at all** for a request: the service does not hold the offset on business
refusals, so silence means the message never reached it (topic missing, wrong topic name, service
down or Kafka consumers not running), or the outcome is held in the service's outbox. In the
second case it is operational — see the runbook's monitoring section.

### What you cannot rely on

- **No backfill.** If an org was created while a flag was OFF, the platform pack is **not**
  seeded when the flag later turns ON, and nothing re-sends your request either. (The code and
  flag description mention a "reconciler"; it is **not implemented** — there is no such job in
  `services/selection-list-service/src`.)
- **No deactivation tracking.** The service consumes `identity.org.created` and `.deleted` but
  not `identity.org.updated`, so an org deactivated after creation still looks active to it.
- **Seeded lists have no owner** — see above; visibility through the HTTP API needs a grant.
- **User-scoped seeding does not exist.**
- Other topics' retention/partitions in production depend on how the topics were created (the
  runbook explains why this matters for `seed.requested`).

---

## Part 2 — Consuming change events

The service writes each event to its `event_outbox` table **in the same database transaction as
the change**, and a relay publishes them. Nothing is published for a change that rolled back,
and nothing is lost if Kafka is down at that moment (events wait in the table).

### Delivery semantics

- **At-least-once.** Dedupe on `payload.eventId` (identical on redelivery; it is the outbox row id).
- **Ordered per (topic, organization).** *Not* across topics: you may see
  `item.created` before the `list.created` for its list. Within one organization the relay never
  publishes a later event past one that is still being retried.
- **`occurredAt`** is when the change committed, not when it was published.
- **A parked event leaves a gap.** After 10 failed publish attempts (or a schema-invalid payload)
  an event is copied to `<topic>.dlq` and the organization moves on to later events. You will see
  a `listRevision` gap — that is your cue to refetch the list over HTTP.
- **`listRevision`** is monotonic per list across list/item/translation events. Keep the
  last applied revision per `listId`; ignore an event whose revision is not greater; on a
  gap you care about, refetch the list over HTTP.
- **`list.deleted` is a tombstone** for its `listId`; it implies its items, translations
  and grants are gone (no separate events are sent for them).
- An org's teardown is **not** re-broadcast: subscribe to `identity.org.deleted` yourself.
- Publishing of change events is **not** behind the seeding flag, but the relay only runs when
  the service has `KAFKA_BROKERS` configured.

### Payload shape

Every list-scoped event carries `eventId`, `organizationId`, `actor`, `listId`,
`listKey`, `listRevision`. `created` / `updated` / `archived` add a full snapshot
(`list` or `item`) in the list's **source locale**, including `seed` provenance
(`{ source, packKey, packVersion, userModified }`, or `null` for user-authored rows; the HTTP
API spells the same object in snake_case).

`actor` is either `{ type: 'user', userId }` or
`{ type: 'system', principal: 'selection-list-service', seedSource }` (seeding or a
lifecycle cascade; `seedSource` is `null` for a cascade).

Things that catch people out:

- `list.updated` with `"key"` in `changedFields` carries `previousKey` — **re-key** any
  index you keep by key. Prefer storing `listId`.
- A **restore** (archived → active) is `*.updated` with `"status"` in `changedFields`.
- **Archived** lists/items still resolve: keep showing stored values, just stop offering
  them for new selections.
- `item.reordered.order` is the **complete** new order — replace, do not merge.
- Source-locale text changes arrive as `*.updated` (`name` / `label`), never as
  `translation.upserted`, which is for the other locales only. `isMachine: true` means
  an unreviewed machine translation.
- `access.*` is informational. Authorization stays with the Security API / Permit.
- Seeded content produces the same events as human edits, with the system `actor` above.

### Minimal consumer

```ts
import { createKafkaClient, TypedConsumer, TypedProducer, TOPICS,
  selectionListsItemUpdatedSchemaV1, type FuzeEvent, type SelectionListsItemUpdatedPayloadV1 } from '@fuzefront/shared/kafka'

const consumer = new TypedConsumer(kafka, `${groupId}-sl-item-updated`)
await consumer.connect()
await consumer.subscribe(TOPICS.SELECTION_LISTS_ITEM_UPDATED)
await consumer.run<SelectionListsItemUpdatedPayloadV1>(async (e: FuzeEvent<SelectionListsItemUpdatedPayloadV1>) => {
  const p = e.payload
  if (await alreadyProcessed(p.eventId)) return
  if (p.listRevision <= (await lastRevision(p.listId))) return markProcessed(p.eventId)
  await upsertLabel(p.organizationId, p.item.itemId, p.item.label, p.listRevision)
  await markProcessed(p.eventId)
}, selectionListsItemUpdatedSchemaV1, dlqProducer)
```

### Versioning promise

- Additive optional fields arrive without notice (envelope `version` `1.x`); the shared
  schemas strip unknown fields, so do not use `.strict()` on our payloads.
- A breaking change ships as a new topic `<topic>.v2`, dual-published during an announced
  deprecation window.
