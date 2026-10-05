-- Contract DDL for the acceptance suite, transcribed from contracts/events/tables.md.
-- The suite owns its DDL so it verifies the packages against the CONTRACT, not against
-- whatever migrations the packages ship. Plus two suite-private tables (acc_*) the test
-- handlers write their effects into.
DROP TABLE IF EXISTS event_outbox, processed_events, acc_business, acc_effects, acc_proj CASCADE;
DROP TYPE IF EXISTS outbox_status_enum;
CREATE TYPE outbox_status_enum AS ENUM ('pending', 'sent', 'failed');

CREATE TABLE event_outbox (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          text NOT NULL UNIQUE,
  topic             varchar(255) NOT NULL,
  payload           jsonb NOT NULL,
  aggregate_type    varchar(64) NOT NULL,
  aggregate_id      text NOT NULL,
  aggregate_version bigint NOT NULL CHECK (aggregate_version >= 1),
  producer          varchar(128) NOT NULL,
  correlation_id    varchar(128) NOT NULL,
  causation_id      text,
  schema_version    integer NOT NULL DEFAULT 1,
  status            outbox_status_enum NOT NULL DEFAULT 'pending',
  attempts          integer NOT NULL DEFAULT 0,
  last_error        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  sent_at           timestamptz,
  UNIQUE (aggregate_type, aggregate_id, aggregate_version)
);
CREATE INDEX event_outbox_pending_idx
  ON event_outbox (aggregate_type, aggregate_id, aggregate_version) WHERE status = 'pending';

CREATE TABLE processed_events (
  consumer     text NOT NULL,
  event_id     text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, event_id)
);

-- suite-private
CREATE TABLE acc_business (id text PRIMARY KEY, name text NOT NULL);
-- one row per handler invocation (the "effect")
CREATE TABLE acc_effects (seq bigserial PRIMARY KEY, event_key text NOT NULL, aggregate_id text);
-- projection written by the test handler: {version, deleted, data}
CREATE TABLE acc_proj (aggregate_id text PRIMARY KEY, version bigint NOT NULL, deleted boolean NOT NULL, data jsonb);
