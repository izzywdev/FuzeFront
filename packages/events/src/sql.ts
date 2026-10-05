// DDL for the v2 event tables. Normative shape: contracts/events/tables.md.
// Exposed as SQL strings (any migration tool: knex, Alembic via raw SQL, psql) and
// as a knex migration pair. Every statement is idempotent.

import type { KnexLike } from './db'

export const OUTBOX_STATUS_ENUM_SQL = `
DO $$ BEGIN
  CREATE TYPE outbox_status_enum AS ENUM ('pending', 'sent', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;`

/** Fresh v2 `event_outbox` (new services / a clean database). */
export const CREATE_EVENT_OUTBOX_V2_SQL = `
CREATE TABLE IF NOT EXISTS event_outbox (
  id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          text         NOT NULL,
  topic             varchar(255) NOT NULL,
  payload           jsonb        NOT NULL,
  aggregate_type    varchar(64)  NOT NULL,
  aggregate_id      text         NOT NULL,
  aggregate_version bigint       NOT NULL CHECK (aggregate_version >= 1),
  producer          varchar(128) NOT NULL,
  correlation_id    varchar(128) NOT NULL,
  causation_id      text,
  schema_version    integer      NOT NULL DEFAULT 1,
  status            outbox_status_enum NOT NULL DEFAULT 'pending',
  attempts          integer      NOT NULL DEFAULT 0,
  last_error        text,
  created_at        timestamptz  NOT NULL DEFAULT now(),
  sent_at           timestamptz
);`

/** Indexes + uniqueness the contract requires (idempotent; safe after UPGRADE too). */
export const EVENT_OUTBOX_V2_INDEXES_SQL = [
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_event_outbox_event_id ON event_outbox (event_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_event_outbox_aggregate_version ON event_outbox (aggregate_type, aggregate_id, aggregate_version)`,
  `CREATE INDEX IF NOT EXISTS idx_event_outbox_relay_pending ON event_outbox (aggregate_type, aggregate_id, aggregate_version) WHERE status = 'pending'`,
  `CREATE INDEX IF NOT EXISTS idx_event_outbox_status ON event_outbox (status)`,
  `CREATE INDEX IF NOT EXISTS idx_event_outbox_topic ON event_outbox (topic)`,
]

/**
 * Step 1 of upgrading an existing v1 `event_outbox` (id, topic, payload, correlation_id,
 * status, attempts, last_error, created_at, sent_at): add the new columns NULLABLE so
 * pre-v2 producers keep working during the window. Backfill is service-specific
 * (see tables.md "Migration of existing rows"); then run FINALIZE.
 */
export const UPGRADE_EVENT_OUTBOX_V1_TO_V2_SQL = [
  `ALTER TABLE event_outbox ADD COLUMN IF NOT EXISTS event_id text`,
  `ALTER TABLE event_outbox ADD COLUMN IF NOT EXISTS aggregate_type varchar(64)`,
  `ALTER TABLE event_outbox ADD COLUMN IF NOT EXISTS aggregate_id text`,
  `ALTER TABLE event_outbox ADD COLUMN IF NOT EXISTS aggregate_version bigint`,
  `ALTER TABLE event_outbox ADD COLUMN IF NOT EXISTS producer varchar(128)`,
  `ALTER TABLE event_outbox ADD COLUMN IF NOT EXISTS causation_id text`,
  `ALTER TABLE event_outbox ADD COLUMN IF NOT EXISTS schema_version integer NOT NULL DEFAULT 1`,
  // Postgres unique indexes ignore NULLs, so v1 rows (all-NULL) do not collide.
  ...EVENT_OUTBOX_V2_INDEXES_SQL,
]

/** Step 2: after every row is backfilled (and no v1 producer remains), enforce NOT NULL + CHECK. */
export const FINALIZE_EVENT_OUTBOX_V2_SQL = [
  `ALTER TABLE event_outbox ALTER COLUMN event_id SET NOT NULL`,
  `ALTER TABLE event_outbox ALTER COLUMN aggregate_type SET NOT NULL`,
  `ALTER TABLE event_outbox ALTER COLUMN aggregate_id SET NOT NULL`,
  `ALTER TABLE event_outbox ALTER COLUMN aggregate_version SET NOT NULL`,
  `ALTER TABLE event_outbox ALTER COLUMN producer SET NOT NULL`,
  `ALTER TABLE event_outbox DROP CONSTRAINT IF EXISTS ck_event_outbox_aggregate_version`,
  `ALTER TABLE event_outbox ADD CONSTRAINT ck_event_outbox_aggregate_version CHECK (aggregate_version >= 1)`,
]

/** Consumer inbox (tables.md `processed_events`). Verbatim from the contract. */
export const CREATE_PROCESSED_EVENTS_SQL = `
CREATE TABLE IF NOT EXISTS processed_events (
  consumer     text        NOT NULL,
  event_id     text        NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, event_id)
);`

/** Retention prune for the inbox (suggested 30 days — tables.md). `$1` = retention in days. */
export const PRUNE_PROCESSED_EVENTS_SQL = `DELETE FROM processed_events WHERE processed_at < now() - make_interval(days => $1::int)`

/** Everything a fresh producer+consumer service database needs, in order. */
export const CREATE_ALL_EVENT_TABLES_SQL: string[] = [
  OUTBOX_STATUS_ENUM_SQL,
  CREATE_EVENT_OUTBOX_V2_SQL,
  ...EVENT_OUTBOX_V2_INDEXES_SQL,
  CREATE_PROCESSED_EVENTS_SQL,
]

export interface EventTablesOptions {
  /** Create the producer side (`event_outbox`). Default true. */
  outbox?: boolean
  /** Create the consumer side (`processed_events`). Default true. */
  inbox?: boolean
}

/** knex migration `up`: `export const up = createEventTablesUp()` or call with options. */
export async function createEventTables(knex: KnexLike, opts: EventTablesOptions = {}): Promise<void> {
  const { outbox = true, inbox = true } = opts
  if (outbox) {
    await knex.raw(OUTBOX_STATUS_ENUM_SQL)
    await knex.raw(CREATE_EVENT_OUTBOX_V2_SQL)
    for (const s of EVENT_OUTBOX_V2_INDEXES_SQL) await knex.raw(s)
  }
  if (inbox) {
    await knex.raw(CREATE_PROCESSED_EVENTS_SQL)
  }
}

/** knex migration `down`. Does NOT drop `outbox_status_enum` (shared with v1 migrations). */
export async function dropEventTables(knex: KnexLike, opts: EventTablesOptions = {}): Promise<void> {
  const { outbox = true, inbox = true } = opts
  if (inbox) {
    await knex.raw('DROP TABLE IF EXISTS processed_events')
  }
  if (outbox) await knex.raw('DROP TABLE IF EXISTS event_outbox')
}

/** knex migration `up` for an existing v1 outbox: add the v2 columns nullable (step 1). */
export async function upgradeEventOutboxToV2(knex: KnexLike): Promise<void> {
  for (const s of UPGRADE_EVENT_OUTBOX_V1_TO_V2_SQL) await knex.raw(s)
  await knex.raw(CREATE_PROCESSED_EVENTS_SQL)
}

/** Step 2 after backfill: enforce NOT NULL + CHECK. */
export async function finalizeEventOutboxV2(knex: KnexLike): Promise<void> {
  for (const s of FINALIZE_EVENT_OUTBOX_V2_SQL) await knex.raw(s)
}
