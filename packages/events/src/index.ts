// @izzywdev/fuzefront-events — public API (data-consistency standard §3-§4).
export { buildEvent, validateEnvelope, EnvelopeValidationError } from './envelope'
export type { BuildEventInput, EnvelopeV2, NormalizedEnvelope } from './envelope'

export { enqueueEvent } from './outbox'

export {
  asSqlClient,
  knexDb,
  knexSql,
  pgDb,
  pgSql,
  toKnexBindings,
} from './db'
export type { Db, SqlClient, QueryResult, TxLike, KnexLike, KnexRootLike, PgQueryable, PgPoolLike } from './db'

export {
  createOutboxRelay,
  pgOutboxStore,
  kafkaTransport,
  rowToEnvelope,
  requeueFailedEvent,
} from './relay'
export type {
  OutboxRow,
  OutboxStore,
  ClaimOps,
  RelayTransport,
  RelayHooks,
  OutboxRelay,
  OutboxRelayOptions,
  DrainResult,
} from './relay'

export { createConsumer, pgInboxStore, NonRetryableError } from './consumer'
export type {
  CreateConsumerOptions,
  EventsConsumer,
  EventHandler,
  HandlerContext,
  ConsumeOutcome,
  ConsumeInfo,
  ConsumerHooks,
  InboxStore,
  InboxTx,
  KafkaLike,
  KafkaConsumerLike,
  KafkaProducerLike,
  KafkaMessageLike,
  EachMessageLike,
} from './consumer'

export * from './sql'
export { childLogger, silentLogger } from './logger'
export type { EventsLogger } from './logger'
export { ProjectionGuard } from './testkit'
