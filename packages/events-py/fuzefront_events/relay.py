"""Outbox relay — Python mirror of drainOutboxOnce / startOutboxRelay in
backend/core/src/events/outboxRelay.ts.

The relay claims pending ``event_outbox`` rows (on Postgres with
``FOR UPDATE SKIP LOCKED`` so replicas never double-publish), publishes each, and
on success marks it ``sent``; on a publish failure it increments ``attempts`` and
leaves the row ``pending`` until ``max_attempts``, after which it is parked
``failed`` and dead-lettered. The retry/attempts/DLQ decision logic lives here
(and is unit-tested with a fake); the DB access is injected via ``RelayDb`` and
the concrete Postgres claim/update SQL lives in ``PsycopgRelayDb`` behind the
``postgres`` extra.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Callable, List, Optional, Protocol, runtime_checkable

PENDING = "pending"
SENT = "sent"
FAILED = "failed"

DEFAULT_BATCH_SIZE = 20
DEFAULT_MAX_ATTEMPTS = 10


@dataclass
class OutboxRecord:
    """One decoded outbox row handed to the publisher (mirror of OutboxRecord)."""

    id: str
    topic: str
    payload: Any
    correlationId: str  # noqa: N815 - wire-ish; mirrors the Node field
    attempts: int


@dataclass
class DrainResult:
    sent: int
    failed: int


# publish(record) -> None; raise to signal a retryable failure.
Publish = Callable[[OutboxRecord], None]
OnDeadLetter = Callable[[OutboxRecord, BaseException], None]


@runtime_checkable
class RelayDb(Protocol):
    """Transactional claim/update surface the relay needs.

    ``claim_pending`` opens a transaction and returns up to ``batch_size`` pending
    rows locked ``FOR UPDATE SKIP LOCKED``; ``mark_sent`` / ``mark_retry`` update a
    claimed row; ``commit`` ends the claim transaction.
    """

    def claim_pending(self, batch_size: int) -> List[OutboxRecord]: ...  # pragma: no cover
    def mark_sent(self, record: OutboxRecord) -> None: ...  # pragma: no cover
    def mark_retry(
        self, record: OutboxRecord, *, attempts: int, status: str, last_error: str
    ) -> None: ...  # pragma: no cover
    def commit(self) -> None: ...  # pragma: no cover
    def rollback(self) -> None: ...  # pragma: no cover


def drain_outbox_once(
    db: RelayDb,
    publish: Publish,
    *,
    batch_size: int = DEFAULT_BATCH_SIZE,
    max_attempts: int = DEFAULT_MAX_ATTEMPTS,
    on_dead_letter: Optional[OnDeadLetter] = None,
    logger: Any = None,
) -> DrainResult:
    """Drain one batch of pending outbox rows. Returns {sent, failed}."""
    sent = 0
    failed = 0
    try:
        # The claim must be inside the try: a failed SELECT ... FOR UPDATE (e.g. a
        # statement timeout or query cancellation) aborts the psycopg transaction,
        # and without a rollback the same connection stays poisoned so every later
        # claim fails. Rolling back here lets the relay loop recover on the next tick.
        rows = db.claim_pending(batch_size)
        for row in rows:
            try:
                publish(row)
                db.mark_sent(row)
                sent += 1
            except BaseException as err:  # noqa: BLE001 - mirror the TS catch-all
                attempts = row.attempts + 1
                parked = attempts >= max_attempts
                db.mark_retry(
                    row,
                    attempts=attempts,
                    status=FAILED if parked else PENDING,
                    last_error=str(err)[:1000],
                )
                failed += 1
                if logger is not None:
                    logger.error(
                        f"outbox publish failed for {row.topic} ({row.id}) "
                        f"attempt {attempts}: {err}"
                    )
                if parked and on_dead_letter is not None:
                    try:
                        on_dead_letter(row, err)
                    except BaseException:  # noqa: BLE001 - DLQ is best-effort
                        pass
        db.commit()
    except BaseException:
        db.rollback()
        raise
    return DrainResult(sent=sent, failed=failed)


class OutboxRelayHandle:
    def __init__(self) -> None:
        self._stopped = False

    def stop(self) -> None:
        self._stopped = True

    @property
    def stopped(self) -> bool:
        return self._stopped


def start_outbox_relay(
    db: RelayDb,
    publish: Publish,
    *,
    interval_ms: int = 1000,
    batch_size: int = DEFAULT_BATCH_SIZE,
    max_attempts: int = DEFAULT_MAX_ATTEMPTS,
    on_dead_letter: Optional[OnDeadLetter] = None,
    logger: Any = None,
) -> OutboxRelayHandle:
    """Run drain_outbox_once on an interval in a background thread.

    A Kafka outage simply means rows accumulate as ``pending`` and drain once
    publishing recovers. Returns a handle whose ``stop()`` ends the loop.
    """
    import threading

    handle = OutboxRelayHandle()

    def _loop() -> None:
        while not handle.stopped:
            try:
                result = drain_outbox_once(
                    db,
                    publish,
                    batch_size=batch_size,
                    max_attempts=max_attempts,
                    on_dead_letter=on_dead_letter,
                    logger=logger,
                )
                if (result.sent or result.failed) and logger is not None:
                    logger.info(
                        f"outbox relay: sent={result.sent} failed={result.failed}"
                    )
            except BaseException as err:  # noqa: BLE001
                if logger is not None:
                    logger.error(f"outbox relay drain error: {err}")
            time.sleep(interval_ms / 1000.0)

    thread = threading.Thread(target=_loop, name="fuzefront-outbox-relay", daemon=True)
    thread.start()
    return handle


class PsycopgRelayDb:
    """``RelayDb`` backed by a psycopg (v3) connection (``postgres`` extra).

    Each ``claim_pending`` opens a transaction; ``commit``/``rollback`` close it.
    Uses ``FOR UPDATE SKIP LOCKED`` so multiple relay replicas never publish the
    same row.
    """

    _CLAIM_SQL = (
        "SELECT id, topic, payload, correlation_id, attempts "
        "FROM event_outbox WHERE status = 'pending' "
        "ORDER BY created_at ASC LIMIT %s FOR UPDATE SKIP LOCKED"
    )
    _SENT_SQL = (
        "UPDATE event_outbox SET status='sent', attempts=attempts+1, "
        "sent_at=now() WHERE id=%s"
    )
    _RETRY_SQL = (
        "UPDATE event_outbox SET status=%s, attempts=%s, last_error=%s WHERE id=%s"
    )

    def __init__(self, conn: Any):
        self._conn = conn

    def claim_pending(self, batch_size: int) -> List[OutboxRecord]:
        cur = self._conn.cursor()
        cur.execute(self._CLAIM_SQL, (batch_size,))
        rows = cur.fetchall()
        self._cur = cur
        return [
            OutboxRecord(
                id=str(r[0]), topic=r[1], payload=r[2], correlationId=r[3], attempts=r[4]
            )
            for r in rows
        ]

    def mark_sent(self, record: OutboxRecord) -> None:
        self._cur.execute(self._SENT_SQL, (record.id,))

    def mark_retry(
        self, record: OutboxRecord, *, attempts: int, status: str, last_error: str
    ) -> None:
        self._cur.execute(self._RETRY_SQL, (status, attempts, last_error, record.id))

    def commit(self) -> None:
        self._conn.commit()

    def rollback(self) -> None:
        self._conn.rollback()
