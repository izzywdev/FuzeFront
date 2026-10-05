# Event tables contract (Postgres)

Normative DDL shape for the tables every event-producing and event-consuming service carries
(FuzeSDLC `governance/data-consistency-standard.md` §3, §4). This file is the **contract**: column
names, types, nullability, keys and the ordering rule. Migrations (knex, Alembic, SQLAlchemy models)
are implementation and belong to the `@izzywdev/fuzefront-events` / `fuzefront-events` packages and
each service's `database-engineer` stream. Wire shape of the event itself:
`contracts/events/envelope.v2.schema.json` (Zod twin: `shared/src/kafka/envelope.ts`).

Ids are stored as native `uuid` and rendered as TypeIDs on the wire (identifier standard); the
`event_id`/`aggregate_id` columns below are `text` holding the **wire TypeID** because the relay
copies them verbatim into the envelope and the prefix carries the aggregate type check.

## `event_outbox` (v2)

One per service database, written in the **same transaction** as the state change.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | `uuid` PK | no | `gen_random_uuid()`. Existing column, unchanged. |
| `event_id` | `text` | no, UNIQUE | `evt_...` TypeID minted at enqueue. **New.** Becomes envelope `eventId`. |
| `topic` | `varchar(255)` | no | Existing. |
| `payload` | `jsonb` | no | Existing. Topic payload only (not the envelope). |
| `aggregate_type` | `varchar(64)` | no | **New.** Envelope `aggregateType`. |
| `aggregate_id` | `text` | no | **New.** Typed id of the entity. Kafka partition key. |
| `aggregate_version` | `bigint` | no | **New.** Positive, monotonic per `(aggregate_type, aggregate_id)`; equals the entity row's `aggregate_version` after the change. |
| `producer` | `varchar(128)` | no | **New.** Owning service name. |
| `correlation_id` | `varchar(128)` | no | Existing. |
| `causation_id` | `text` | yes | **New (optional).** `eventId` of the triggering event. |
| `schema_version` | `integer` | no | **New.** Default `1`. Envelope `schemaVersion`. |
| `status` | `outbox_status_enum` | no | Existing: `pending` / `sent` / `failed`. Default `pending`. |
| `attempts` | `integer` | no | Existing. Default 0. |
| `last_error` | `text` | yes | Existing. |
| `created_at` | `timestamptz` | no | Existing; the envelope `occurredAt` is the time of the state change, set at enqueue. |
| `sent_at` | `timestamptz` | yes | Existing. |

Constraints and indexes:

- `UNIQUE (event_id)`.
- `UNIQUE (aggregate_type, aggregate_id, aggregate_version)` — one event per aggregate version;
  a second writer racing the same version fails instead of forking history.
- `CHECK (aggregate_version >= 1)`.
- Partial index for the relay: `(aggregate_type, aggregate_id, aggregate_version) WHERE status = 'pending'`.
- Existing `status` and `topic` indexes stay.

**Migration of existing rows** (package/DB streams, not this PR): add the new columns nullable,
backfill, then set NOT NULL; rows enqueued by pre-v2 producers during the window keep v1 envelopes
(no `event_id`) and are drained as v1 until Wave C moves the producer.

### Relay ordering and claim rule

- Claim with `SELECT ... FOR UPDATE SKIP LOCKED` (replicas never publish the same row).
- **Order is per aggregate, by `aggregate_version` ascending** — not global `created_at`. A pending
  row is claimable only if no row for the same `(aggregate_type, aggregate_id)` with a lower
  `aggregate_version` is still `pending` (or `failed` and not dead-lettered). Different aggregates
  interleave freely; the broker partition key `aggregate_id` preserves the order downstream.
- Publish with key = `aggregate_id`; mark `sent` only after broker acknowledgement.
- After bounded attempts: `failed` + dead-letter (`<topic>.dlq`) + alert. A `failed` head row
  **blocks** later versions of that aggregate until resolved (intentional: skipping would let a
  consumer apply v3 without v2).

## `processed_events` (consumer inbox)

One per consuming service database. Insert in the **same transaction** as the handler's effect.

```sql
CREATE TABLE processed_events (
  consumer     text        NOT NULL,
  event_id     text        NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, event_id)
);
```

- `consumer` — stable consumer-group / handler name; the same `event_id` for two consumers is two rows.
- Dedupe is `INSERT ... ON CONFLICT DO NOTHING`; zero rows inserted means duplicate, skip the effect.
- **v1 envelopes** (no `eventId`) are still consumed during the migration window. Their dedupe key is
  `<topic>:<partition>:<offset>`, written to `processed_events.event_id`. It is stable for a given
  Kafka record, so redelivery of that record is absorbed; it does not dedupe a v1 event re-published
  as a new record, which is why producers move to v2 (Wave C). The version guard applies only to v2.
- Version-guard outcome when `aggregateVersion <= stored`: the effect is skipped (`IGNORED`) and the
  `eventId` is still recorded in `processed_events`. The stored version is owned by the consumer's
  projection, not by the runtime.
- Retention: rows may be pruned after a period well beyond the broker retention + max redelivery
  horizon (suggested: 30 days). Pruning is the package's scheduled job.

## `aggregate_version` on owned entity tables

Every table that holds an entity the service **owns** (and so emits events for) carries:

```sql
aggregate_version bigint NOT NULL DEFAULT 1 CHECK (aggregate_version >= 1)
```

Convention:

- Starts at `1` on insert; the `*.created` event carries `aggregateVersion = 1`.
- **Every state change increments it by exactly 1 in the same transaction** that updates the row and
  inserts the outbox row — `UPDATE ... SET aggregate_version = aggregate_version + 1 ... RETURNING
  aggregate_version`, and that returned value is the outbox `aggregate_version`.
- A soft delete is a change (bump + `*.deleted` event). A hard delete emits `*.deleted` with the next
  version; the owner needs no tombstone row (consumers keep theirs).
- Never decremented, never reused, never set by a client. API write responses return
  `{entity, version}` with this value (standard §9).

## Consumer-side projection rows

A projection / `ref_index` row stores `aggregate_version` per source aggregate (standard §6.3) and
applies an event iff `event.aggregateVersion > stored`; a tombstone keeps its version. Reference
semantics: `packages/conformance-vectors/events/version-guard.json`.

## Equivalents

SQLAlchemy / knex / Alembic definitions are produced by the `fuzefront-events` and
`@izzywdev/fuzefront-events` packages from this file; they must not diverge from the columns above.
