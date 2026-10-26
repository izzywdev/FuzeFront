"""Outbox relay: drains ``event_outbox`` to the broker, in order per aggregate.

Rules (contracts/events/tables.md "Relay ordering and claim rule"):

* Claim with ``SELECT ... FOR UPDATE SKIP LOCKED`` (Postgres) — replicas never
  publish the same row. SQLite has no row locks; it is for single-relay tests.
* Order is per aggregate by ``aggregate_version``. Only the *head* of an
  aggregate (no lower-version row that is not ``sent``) is claimable, so a
  ``failed`` head **blocks** its aggregate; different aggregates interleave.
  After claiming a head the relay publishes the aggregate's whole pending chain
  in version order inside the same transaction (replicas cannot see/claim the
  later rows: the head is still unsent from their snapshot).
* Key = ``aggregate_id``; ``sent`` only after broker ack. Publishing is inside
  the claim transaction, so a crash after publish but before commit republishes
  (at-least-once; consumers dedupe on ``eventId``).
* After ``max_attempts`` the row is dead-lettered to ``<topic>.dlq`` and parked
  ``failed``. If the DLQ send itself fails the row stays ``pending`` and is retried.
"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import and_, exists, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from .envelope import format_occurred_at
from .publisher import Publisher
from .tables import event_outbox as o

log = logging.getLogger("fuzefront_events.relay")

_lower = o.alias("lower_rows")


def row_to_envelope(row: Any) -> dict[str, Any]:
    """Rebuild the wire envelope from an outbox row (payload is the topic payload only)."""
    env: dict[str, Any] = {
        "eventId": row.event_id,
        "topic": row.topic,
        "schemaVersion": row.schema_version,
        "aggregateType": row.aggregate_type,
        "aggregateId": row.aggregate_id,
        "aggregateVersion": int(row.aggregate_version),
        "producer": row.producer,
        "occurredAt": format_occurred_at(row.created_at),
        "correlationId": row.correlation_id,
        "payload": row.payload if not isinstance(row.payload, str) else json.loads(row.payload),
    }
    if row.causation_id is not None:
        env["causationId"] = row.causation_id
    return env


def dlq_topic(topic: str) -> str:
    return f"{topic}.dlq"


@dataclass(frozen=True)
class DrainResult:
    sent: int = 0
    failed: int = 0  # publish attempts that failed (row retried or parked)
    dead_lettered: int = 0


def _head_query(batch_size: int):
    blocked = exists().where(
        and_(
            _lower.c.aggregate_type == o.c.aggregate_type,
            _lower.c.aggregate_id == o.c.aggregate_id,
            _lower.c.aggregate_version < o.c.aggregate_version,
            _lower.c.status != "sent",
        )
    )
    return (
        select(o.c.aggregate_type, o.c.aggregate_id)
        .where(o.c.status == "pending", ~blocked)
        .order_by(o.c.created_at, o.c.aggregate_version)
        .limit(batch_size)
        .with_for_update(skip_locked=True)
    )


async def drain_once(
    session_factory: async_sessionmaker[AsyncSession],
    publisher: Publisher,
    *,
    batch_size: int = 20,
    max_attempts: int = 10,
    chain_limit: int = 100,
) -> DrainResult:
    """One claim-publish-commit pass. Safe to run from many replicas on Postgres."""
    sent = failed = dead = 0
    async with session_factory() as session, session.begin():
        heads = (await session.execute(_head_query(batch_size))).all()
        for agg_type, agg_id in heads:
            rows = (
                await session.execute(
                    select(o)
                    .where(
                        o.c.aggregate_type == agg_type, o.c.aggregate_id == agg_id, o.c.status == "pending"
                    )
                    .order_by(o.c.aggregate_version)
                    .limit(chain_limit)
                    .with_for_update()
                )
            ).all()
            for row in rows:
                envelope = row_to_envelope(row)
                value = json.dumps(envelope, separators=(",", ":")).encode()
                try:
                    await publisher.send(row.topic, row.aggregate_id.encode(), value)
                except Exception as exc:  # noqa: BLE001
                    attempts = row.attempts + 1
                    err = str(exc)[:1000]
                    failed += 1
                    log.error(
                        "outbox publish failed topic=%s event_id=%s attempt=%d: %s",
                        row.topic,
                        row.event_id,
                        attempts,
                        err,
                    )
                    parked = False
                    if attempts >= max_attempts:
                        try:
                            await publisher.send(
                                dlq_topic(row.topic),
                                row.aggregate_id.encode(),
                                value,
                                [("x-error", err.encode()), ("x-attempts", str(attempts).encode())],
                            )
                            parked = True
                            dead += 1
                        except Exception as dlq_exc:  # noqa: BLE001
                            log.error("DLQ publish failed event_id=%s: %s", row.event_id, dlq_exc)
                    await session.execute(
                        update(o)
                        .where(o.c.id == row.id)
                        .values(status="failed" if parked else "pending", attempts=attempts, last_error=err)
                    )
                    break  # head-of-line block: never publish a later version past a failed one
                await session.execute(
                    update(o)
                    .where(o.c.id == row.id)
                    .values(status="sent", attempts=row.attempts + 1, sent_at=datetime.now(UTC))
                )
                sent += 1
    return DrainResult(sent, failed, dead)


async def requeue_failed_event(session: AsyncSession, event_id: str) -> bool:
    """Operator action: put a dead-lettered (``failed``) row back to ``pending``.

    Resets ``attempts`` to 0 (``last_error`` is kept for the record). Until this
    (or a deliberate mark-``sent``) runs, the failed row blocks later versions of
    its aggregate. Runs in the caller's transaction; returns whether a ``failed``
    row was found and requeued.
    """
    res = await session.execute(
        update(o).where(o.c.event_id == event_id, o.c.status == "failed").values(status="pending", attempts=0)
    )
    return res.rowcount == 1


class OutboxRelay:
    """Background poller around :func:`drain_once`."""

    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        publisher: Publisher,
        *,
        interval_s: float = 1.0,
        **drain_kwargs: Any,
    ):
        self._sf = session_factory
        self._publisher = publisher
        self._interval = interval_s
        self._kwargs = drain_kwargs
        self._task: asyncio.Task | None = None
        self._stop = asyncio.Event()

    async def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                res = await drain_once(self._sf, self._publisher, **self._kwargs)
                if res.sent or res.failed:
                    log.info("outbox relay sent=%d failed=%d dlq=%d", res.sent, res.failed, res.dead_lettered)
                if res.sent:
                    continue  # more may be waiting; drain without sleeping
            except Exception:
                log.exception("outbox relay drain error")
            try:
                await asyncio.wait_for(self._stop.wait(), self._interval)
            except TimeoutError:
                pass

    def start(self) -> None:
        if self._task is None:
            self._stop.clear()
            self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        self._stop.set()
        if self._task:
            await self._task
            self._task = None
