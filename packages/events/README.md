# @izzywdev/fuzefront-events

Envelope v2 builder, transactional outbox, relay and idempotent consumer runtime
(FuzeSDLC data-consistency standard §3-§4). The wire contract lives in
`contracts/events/` and `@fuzefront/shared/kafka`; this package implements it.

```ts
import { buildEvent, enqueueEvent, createOutboxRelay, kafkaTransport, pgDb, createConsumer } from '@izzywdev/fuzefront-events'

// producer: same transaction as the state change
await enqueueEvent(trx, buildEvent({ topic, aggregateType, aggregateId, aggregateVersion, producer, payload, correlationId }))
createOutboxRelay({ db: pgDb(pool), transport: kafkaTransport(kafkaProducer) }).start()

// consumer: dedupe + handler effect in ONE transaction
createConsumer({ groupId, topics, db: pgDb(pool), kafka, handler: async (event, { tx }) => { /* write with tx */ } }).start()
```

Migrations: `createEventTables(knex)` / `upgradeEventOutboxToV2(knex)` + `finalizeEventOutboxV2(knex)`, or the exported SQL strings.
Tests: `@izzywdev/fuzefront-events/testkit` (`InMemoryKafka`, `duplicate`, `shuffle`, `replay`, `ProjectionGuard`, memory stores).
Postgres tests run when `EVENTS_TEST_PG_URL` is set.
