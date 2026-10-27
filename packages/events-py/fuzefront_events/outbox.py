"""Transactional outbox writer. Call inside the same transaction as the state change."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from .envelope import EnvelopeError, validate_envelope
from .tables import event_outbox, new_row_id


def _row_values(event: dict[str, Any]) -> dict[str, Any]:
    errs = validate_envelope(event)
    if errs:
        raise EnvelopeError(errs)
    occurred = datetime.fromisoformat(event["occurredAt"])
    if occurred.tzinfo is None:  # pattern forbids this; defensive
        occurred = occurred.replace(tzinfo=UTC)
    return {
        "id": new_row_id(),
        "event_id": event["eventId"],
        "topic": event["topic"],
        "payload": event["payload"],
        "aggregate_type": event["aggregateType"],
        "aggregate_id": event["aggregateId"],
        "aggregate_version": event["aggregateVersion"],
        "producer": event["producer"],
        "correlation_id": event["correlationId"],
        "causation_id": event.get("causationId"),
        "schema_version": event["schemaVersion"],
        "status": "pending",
        "attempts": 0,
        # envelope occurredAt == time of the state change, set at enqueue (tables.md)
        "created_at": occurred,
    }


def enqueue_event(session: Session, event: dict[str, Any]) -> str:
    """Insert one v2 outbox row via a sync Session; returns ``eventId``.

    Does NOT commit: the row commits (or rolls back) with the caller's state
    change. A duplicate ``(aggregate_type, aggregate_id, aggregate_version)``
    raises ``IntegrityError`` at flush/commit — a racing second writer fails
    instead of forking the aggregate's history.
    """
    session.execute(event_outbox.insert().values(**_row_values(event)))
    return event["eventId"]


async def enqueue_event_async(session: AsyncSession, event: dict[str, Any]) -> str:
    """Async twin of :func:`enqueue_event` for ``AsyncSession``."""
    await session.execute(event_outbox.insert().values(**_row_values(event)))
    return event["eventId"]
