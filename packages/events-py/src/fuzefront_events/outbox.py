"""Transactional-outbox writer — Python mirror of enqueueEvent in
backend/core/src/events/outbox.ts.

``enqueue_event`` inserts ONE ``event_outbox`` row inside the caller's open DB
transaction, so the event is persisted atomically with the state change it
describes (no dual-write gap). A separate relay (see ``relay.py``) later
publishes pending rows to Kafka.

The DB handle is injected via the ``OutboxDb`` protocol so the enqueue logic is
unit-testable with an in-memory fake; ``PsycopgOutboxDb`` (behind the
``postgres`` extra) is the concrete Postgres adapter and applies the required
``%s::jsonb`` cast, exactly like the Node ``?::jsonb``.

event_outbox columns (migration 009): id uuid, topic varchar(255), payload jsonb,
correlation_id varchar(128), status outbox_status_enum('pending','sent','failed'),
attempts int, last_error text, created_at, sent_at.
"""

from __future__ import annotations

import json
import uuid
from typing import Any, Protocol, runtime_checkable

# INSERT used by the Postgres adapter. The payload placeholder is cast to jsonb
# because Postgres rejects an implicit text->jsonb coercion in a parameterized
# query (identical reason to the Node `?::jsonb`).
_INSERT_SQL = (
    "INSERT INTO event_outbox "
    "(id, topic, payload, correlation_id, status, attempts) "
    "VALUES (%s, %s, %s::jsonb, %s, 'pending', 0)"
)


@runtime_checkable
class OutboxDb(Protocol):
    """Minimal DB surface the outbox writer needs.

    ``execute`` runs a parameterized statement on the caller's current
    transaction — it must NOT commit (atomicity is the caller's).
    """

    def execute(self, sql: str, params: tuple) -> Any:  # pragma: no cover - protocol
        ...


def enqueue_event(db: OutboxDb, topic: str, payload: Any, correlation_id: str) -> str:
    """Write one pending ``event_outbox`` row inside the caller's transaction.

    MUST be called with the same transaction/connection that performs the state
    change: if that transaction rolls back, the event is dropped with it.
    Returns the generated row id.
    """
    row_id = str(uuid.uuid4())
    db.execute(
        _INSERT_SQL,
        (row_id, topic, json.dumps(payload), correlation_id),
    )
    return row_id


class PsycopgOutboxDb:
    """``OutboxDb`` backed by a psycopg connection/cursor (``postgres`` extra).

    Pass either a connection or a cursor already enlisted in the caller's
    transaction. ``execute`` does not commit.
    """

    def __init__(self, conn_or_cursor: Any):
        self._target = conn_or_cursor

    def execute(self, sql: str, params: tuple) -> Any:
        cur = self._target
        # psycopg Connection.execute exists in v3; a cursor has .execute too.
        return cur.execute(sql, params)
