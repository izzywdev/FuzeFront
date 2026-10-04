# Selection lists — Kafka events: consumer & producer guide

How another Fuze service (1) seeds selection lists for its app into an organization and
(2) consumes the selection-list-service's change events.

> **Contract status.** The schemas below are frozen in `@fuzefront/shared` ≥ 1.1.0.
> The selection-list-service **does not emit or consume them yet** — the implementation
> wave follows this contract. Design and rationale:
> [`docs/planning/selection-lists-events.md`](../planning/selection-lists-events.md).
> HTTP API: [`SELECTION_LIST_SERVICE.md`](SELECTION_LIST_SERVICE.md).

## Topics at a glance

All topics are keyed by `organizationId` (an `org_…` TypeID). Dead letters go to
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

### 1. Get on the allowlist

Seeding is authorised per **app slug** (your registry slug, e.g. `fuzecrm`). Open a PR
adding your app to `services/selection-list-service/seed-sources.json` with:

- `allowed_subjects` — the OAuth client subject(s) your service authenticates as;
- `key_prefixes` — normally just `["<app>-"]`: every list you seed must be named
  `<app>-something` (e.g. `fuzecrm-deal-stages`);
- per-request caps (≤ 20 lists, ≤ 2000 items).

You also need an OAuth `client_credentials` client whose tokens can carry the scope
**`selection-lists:seed`** (devops provisions it).

### 2. Build the request

Use the builder from the selection-list client — it validates everything the schema does
and reports every problem at once.

```ts
import { buildSeedRequest, buildSeedRequestEnvelope, seedRequestKafkaKey, SEED_REQUESTED_TOPIC } from '@fuzeone/selection-list-client'
import { fromUuid } from '@izzywdev/fuzefront-identity'

const payload = buildSeedRequest({
  // Deterministic => a re-send after a crash is recognisably the same request.
  requestId: `fuzecrm:${orgId}:crm-defaults:v2`,
  organizationId: fromUuid('organization', event.payload.organizationId), // identity.* carries bare UUIDs
  app: 'fuzecrm',
  service: 'crm-service',
  packKey: 'crm-defaults',
  packVersion: 2,
  serviceToken: await seedTokenClient.getToken(), // a DEDICATED token, scope selection-lists:seed only
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
works equally well and re-validates.

### 3. Rules you must design for

- **No ids.** Lists and items are minted by the service; an `id` field is rejected.
- **Item order = array order.** You cannot set `sortOrder`.
- **`sourceLocale`** defaults to `en`; `translations` are for the *other* locales only.
- **Versions are immutable.** Once `crm-defaults` v2 is applied anywhere, its content
  must never change — change the content, bump the version. Re-sending v2 with different
  content fails with `PACK_CONTENT_MISMATCH`.
- **Upgrades never overwrite users.** Sending v3 updates only lists/items nobody has
  edited since seeding; edited lists are skipped, user-purged lists are not recreated,
  lists/items you drop from the pack are **archived** (still resolve), never deleted.
  Existing item order is never changed; new items are appended.
- **All-or-nothing.** A request either applies completely or writes nothing.
- **Quotas apply.** Seeded lists count toward the org's list quota (default 100) and the
  per-list item quota (default 500).
- **`scope: 'user'`** is accepted by the schema but answered `SCOPE_UNSUPPORTED` until
  user-scoped lists exist.
- When to send: on `identity.org.created` for orgs that get your app by default, when
  your app is installed into an org, and after you release a new pack version (send it
  for every org that has your app; `superseded`/`already-applied` make that safe).
- **Token hygiene.** The token is stored in the Kafka log for the topic's retention.
  Mint a dedicated token with *only* `selection-lists:seed`; never send a broader one.

### 4. Handle the outcome

Consume `selection-lists.seed.completed` and `selection-lists.seed.failed`, filter on
`source.app === '<your app>'`, and correlate on `requestId`.

`seed.completed.outcome`:

| Outcome | Meaning |
|---|---|
| `applied` | first application for this org |
| `upgraded` | a higher version replaced a lower one |
| `already-applied` | duplicate / re-send of the applied version — nothing changed |
| `superseded` | a higher version is already applied — nothing changed |

Treat an **unknown** outcome as success. `lists[]` reports per list:
`created | updated | unchanged | archived | skipped-user-edited | skipped-user-deleted`
plus item counters.

`seed.failed.reason` (nothing was written for any of them):

| Reason | Retry same request later? | What to do |
|---|---|---|
| `SCOPE_UNSUPPORTED` | no | user scope not supported yet |
| `SEEDING_DISABLED` | yes | the flag is off for this org; retry later / on backfill |
| `ATTESTATION_INVALID` | yes | re-send with a fresh token that carries `selection-lists:seed` |
| `SOURCE_NOT_ALLOWED` | no | allowlist PR / wrong client subject |
| `NAMESPACE_VIOLATION` | no | rename keys to your prefix |
| `LIMIT_EXCEEDED` | no | split the pack or raise your allowlist caps |
| `QUOTA_EXCEEDED` | yes | org admin raises quota or removes lists; `details` has the numbers |
| `KEY_CONFLICT` | yes | a user list holds the key; retry after it is renamed |
| `PACK_CONTENT_MISMATCH` | no | bump the version |
| `ORG_UNKNOWN` | yes | the org's creation has not reached the service yet; retry with backoff |
| `ORG_INACTIVE` | no | org deactivated/deleted |
| `VALIDATION_ERROR` | no | fix the payload (the builders prevent this) |
| `INTERNAL_ERROR` | yes | retry with backoff |

The event's own `retryable` flag is authoritative. Treat an **unknown** reason as
non-retryable.

---

## Part 2 — Consuming change events

### Delivery semantics

- **At-least-once.** Dedupe on `payload.eventId` (identical on redelivery).
- **Ordered per (topic, organization).** *Not* across topics: you may see
  `item.created` before the `list.created` for its list.
- **`listRevision`** is monotonic per list across list/item/translation events. Keep the
  last applied revision per `listId`; ignore an event whose revision is not greater; on a
  gap you care about, refetch the list over HTTP.
- **`list.deleted` is a tombstone** for its `listId`; it implies its items, translations
  and grants are gone (no separate events are sent for them).
- An org's teardown is **not** re-broadcast: subscribe to `identity.org.deleted` yourself.

### Payload shape

Every list-scoped event carries `eventId`, `organizationId`, `actor`, `listId`,
`listKey`, `listRevision`. `created` / `updated` / `archived` add a full snapshot
(`list` or `item`) in the list's **source locale**, including `seed` provenance
(`null` for user-authored rows).

`actor` is either `{ type: 'user', userId }` or
`{ type: 'system', principal: 'selection-list-service', seedSource }` (seeding or a
lifecycle cascade).

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
