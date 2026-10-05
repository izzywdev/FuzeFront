"""DDL for ``event_outbox`` (v2) and ``processed_events`` — shape per ``contracts/events/tables.md``.

Two forms: SQLAlchemy ``Table`` objects on :data:`metadata` (for ``create_all``
or Alembic ``target_metadata``) and raw Postgres SQL (:data:`OUTBOX_V2_SQL`,
:data:`PROCESSED_EVENTS_SQL`) for services that migrate with plain SQL. Both
must not diverge from tables.md; ``tests/test_tables.py`` pins the columns.
"""

from __future__ import annotations

import uuid

from fuzefront_identity import bytes_to_uuid, uuidv7_bytes
from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Column,
    DateTime,
    Enum,
    Index,
    Integer,
    MetaData,
    String,
    Table,
    Text,
    UniqueConstraint,
    Uuid,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.types import JSON

metadata = MetaData()


def new_row_id() -> uuid.UUID:
    """Internal row key (not an entity id). Minted by the identity codec, never uuid4."""
    return uuid.UUID(bytes_to_uuid(uuidv7_bytes()))


OUTBOX_STATUS = ("pending", "sent", "failed")

_Payload = JSON().with_variant(JSONB(), "postgresql")

event_outbox = Table(
    "event_outbox",
    metadata,
    # Python-side default (codec-minted UUIDv7) so the Table also works on SQLite; the
    # raw Postgres DDL below keeps the contract's `DEFAULT gen_random_uuid()`.
    Column("id", Uuid, primary_key=True, default=new_row_id),
    Column("event_id", Text, nullable=False),
    Column("topic", String(255), nullable=False),
    Column("payload", _Payload, nullable=False),
    Column("aggregate_type", String(64), nullable=False),
    Column("aggregate_id", Text, nullable=False),
    Column("aggregate_version", BigInteger, nullable=False),
    Column("producer", String(128), nullable=False),
    Column("correlation_id", String(128), nullable=False),
    Column("causation_id", Text, nullable=True),
    Column("schema_version", Integer, nullable=False, server_default=text("1")),
    Column(
        "status",
        Enum(*OUTBOX_STATUS, name="outbox_status_enum"),
        nullable=False,
        server_default=text("'pending'"),
    ),
    Column("attempts", Integer, nullable=False, server_default=text("0")),
    Column("last_error", Text, nullable=True),
    Column("created_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
    Column("sent_at", DateTime(timezone=True), nullable=True),
    UniqueConstraint("event_id", name="uq_event_outbox_event_id"),
    UniqueConstraint(
        "aggregate_type", "aggregate_id", "aggregate_version", name="uq_event_outbox_aggregate_version"
    ),
    CheckConstraint("aggregate_version >= 1", name="ck_event_outbox_aggregate_version_pos"),
    Index("idx_event_outbox_status", "status"),
    Index("idx_event_outbox_topic", "topic"),
    Index(
        "idx_event_outbox_pending_aggregate",
        "aggregate_type",
        "aggregate_id",
        "aggregate_version",
        postgresql_where=text("status = 'pending'"),
        sqlite_where=text("status = 'pending'"),
    ),
)

processed_events = Table(
    "processed_events",
    metadata,
    Column("consumer", Text, primary_key=True),
    Column("event_id", Text, primary_key=True),
    Column("processed_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
)

#: Postgres DDL for a fresh service database. Existing knex-era tables migrate
#: via the add-nullable / backfill / set-NOT-NULL path in tables.md instead.
OUTBOX_V2_SQL = """\
DO $$ BEGIN
  CREATE TYPE outbox_status_enum AS ENUM ('pending', 'sent', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS event_outbox (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          text        NOT NULL,
  topic             varchar(255) NOT NULL,
  payload           jsonb       NOT NULL,
  aggregate_type    varchar(64) NOT NULL,
  aggregate_id      text        NOT NULL,
  aggregate_version bigint      NOT NULL,
  producer          varchar(128) NOT NULL,
  correlation_id    varchar(128) NOT NULL,
  causation_id      text,
  schema_version    integer     NOT NULL DEFAULT 1,
  status            outbox_status_enum NOT NULL DEFAULT 'pending',
  attempts          integer     NOT NULL DEFAULT 0,
  last_error        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  sent_at           timestamptz,
  CONSTRAINT uq_event_outbox_event_id UNIQUE (event_id),
  CONSTRAINT uq_event_outbox_aggregate_version UNIQUE (aggregate_type, aggregate_id, aggregate_version),
  CONSTRAINT ck_event_outbox_aggregate_version_pos CHECK (aggregate_version >= 1)
);
CREATE INDEX IF NOT EXISTS idx_event_outbox_status ON event_outbox (status);
CREATE INDEX IF NOT EXISTS idx_event_outbox_topic ON event_outbox (topic);
CREATE INDEX IF NOT EXISTS idx_event_outbox_pending_aggregate
  ON event_outbox (aggregate_type, aggregate_id, aggregate_version) WHERE status = 'pending';
"""

PROCESSED_EVENTS_SQL = """\
CREATE TABLE IF NOT EXISTS processed_events (
  consumer     text        NOT NULL,
  event_id     text        NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, event_id)
);
"""

#: Pruning is the package's scheduled job; call from yours. Retention is a parameter.
PRUNE_PROCESSED_EVENTS_SQL = (
    "DELETE FROM processed_events WHERE processed_at < now() - make_interval(days => :days)"
)
