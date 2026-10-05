"""Idempotent consumer runtime.

For each message, in ONE database transaction:

1. ``INSERT INTO processed_events (consumer, event_id) ... ON CONFLICT DO NOTHING``
   — zero rows inserted means a duplicate: skip the effect, commit nothing new.
2. Version guard (optional ``get_stored_version``): an event whose
   ``aggregateVersion`` is not strictly greater than the projection's stored
   version is *ignored* (still recorded as processed).
3. ``handler(envelope, session)``; then commit. A handler exception rolls the
   whole transaction back (including the dedupe row), so the retry is clean.

Bounded retries (exponential backoff) then ``<topic>.dlq``; the offset is only
committed after the message is applied, ignored, duplicate or dead-lettered.
Undecodable / invalid envelopes go straight to the DLQ.

v1 envelopes have no ``eventId``: the dedupe key falls back to
``<topic>:<partition>:<offset>`` and there is no version guard.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable, Iterable, Sequence
from dataclasses import dataclass
from typing import Any

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from .envelope import NormalizedEnvelope, parse_envelope_bytes
from .publisher import Publisher
from .relay import dlq_topic
from .tables import processed_events

log = logging.getLogger("fuzefront_events.consumer")

Handler = Callable[[NormalizedEnvelope, AsyncSession], Awaitable[None]]
StoredVersion = Callable[[AsyncSession, NormalizedEnvelope], Awaitable[int | None]]

APPLIED = "applied"
DUPLICATE = "duplicate"
IGNORED = "ignored"
DEAD_LETTERED = "dead_lettered"


@dataclass(frozen=True)
class Message:
    topic: str
    partition: int
    offset: int
    key: bytes | None
    value: bytes


def dedupe_key(envelope: NormalizedEnvelope, msg: Message) -> str:
    if envelope.event_id is not None:
        return envelope.event_id
    return f"{msg.topic}:{msg.partition}:{msg.offset}"  # v1 fallback


def _insert_ignore(dialect: str):
    if dialect == "postgresql":
        return pg_insert
    if dialect == "sqlite":
        return sqlite_insert
    raise NotImplementedError(f"ON CONFLICT DO NOTHING not supported for dialect {dialect!r}")


class EventProcessor:
    """Transport-independent core; ``EventConsumer`` and the testkit both drive it."""

    def __init__(
        self,
        group_id: str,
        session_factory: async_sessionmaker[AsyncSession],
        handler: Handler,
        *,
        dlq: Publisher | None = None,
        get_stored_version: StoredVersion | None = None,
        max_attempts: int = 5,
        backoff_s: float = 0.5,
        reject_v1: bool = False,
    ):
        self.group_id = group_id
        self._sf = session_factory
        self._handler = handler
        self._dlq = dlq
        self._stored = get_stored_version
        self._max_attempts = max_attempts
        self._backoff = backoff_s
        self._reject_v1 = reject_v1

    async def _attempt(self, msg: Message, env: NormalizedEnvelope) -> str:
        async with self._sf() as session, session.begin():
            dialect = session.get_bind().dialect.name
            res = await session.execute(
                _insert_ignore(dialect)(processed_events)
                .values(consumer=self.group_id, event_id=dedupe_key(env, msg))
                .on_conflict_do_nothing()
            )
            if res.rowcount == 0:
                return DUPLICATE
            if self._stored is not None and env.aggregate_version is not None:
                stored = await self._stored(session, env)
                if env.aggregate_version <= (stored or 0):
                    return IGNORED
            await self._handler(env, session)
            return APPLIED

    async def _dead_letter(self, msg: Message, reason: str) -> str:
        if self._dlq is None:
            raise RuntimeError(f"no DLQ publisher configured; cannot dead-letter: {reason}")
        await self._dlq.send(
            dlq_topic(msg.topic),
            msg.key,
            msg.value,
            [("x-error", reason[:1000].encode()), ("x-consumer", self.group_id.encode())],
        )
        return DEAD_LETTERED

    async def process(self, msg: Message) -> str:
        parsed = parse_envelope_bytes(msg.value)
        if not parsed.success or parsed.envelope is None:
            return await self._dead_letter(msg, "invalid envelope: " + "; ".join(parsed.errors))
        env = parsed.envelope
        if env.envelope_version == 1 and self._reject_v1:
            return await self._dead_letter(msg, "v1 envelope rejected by this consumer")
        last: Exception | None = None
        for attempt in range(1, self._max_attempts + 1):
            try:
                return await self._attempt(msg, env)
            except Exception as exc:  # noqa: BLE001
                last = exc
                log.error(
                    "handler failed group=%s topic=%s event=%s attempt=%d: %s",
                    self.group_id,
                    msg.topic,
                    dedupe_key(env, msg),
                    attempt,
                    exc,
                )
                if attempt < self._max_attempts:
                    await asyncio.sleep(self._backoff * 2 ** (attempt - 1))
        return await self._dead_letter(msg, f"handler failed after {self._max_attempts} attempts: {last}")


class EventConsumer(EventProcessor):
    """aiokafka-backed consumer: manual commit after each message is settled."""

    def __init__(self, *args: Any, topics: Sequence[str], bootstrap_servers: str | None = None, **kw: Any):
        super().__init__(*args, **kw)
        self.topics = list(topics)
        self._bootstrap = bootstrap_servers
        self._consumer = None
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        from aiokafka import AIOKafkaConsumer

        if not self._bootstrap:
            raise RuntimeError("bootstrap_servers required to start against Kafka")
        self._consumer = AIOKafkaConsumer(
            *self.topics,
            bootstrap_servers=self._bootstrap,
            group_id=self.group_id,
            enable_auto_commit=False,
            auto_offset_reset="earliest",
        )
        await self._consumer.start()
        self._task = asyncio.create_task(self._run())

    async def _run(self) -> None:
        assert self._consumer is not None
        async for rec in self._consumer:
            await self.process(Message(rec.topic, rec.partition, rec.offset, rec.key, rec.value))
            await self._consumer.commit()

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        if self._consumer:
            await self._consumer.stop()


def create_consumer(
    group_id: str,
    topics: Iterable[str],
    session_factory: async_sessionmaker[AsyncSession],
    handler: Handler,
    *,
    bootstrap_servers: str | None = None,
    dlq: Publisher | None = None,
    get_stored_version: StoredVersion | None = None,
    max_attempts: int = 5,
    backoff_s: float = 0.5,
    reject_v1: bool = False,
) -> EventConsumer:
    """Build a consumer. ``await consumer.start()`` / ``await consumer.stop()``.

    ``handler(envelope, session)`` runs inside the dedupe transaction: do the
    effect with ``session`` and do NOT commit it. ``dlq`` is the publisher for
    ``<topic>.dlq`` (use ``AIOKafkaPublisher``).
    """
    return EventConsumer(
        group_id,
        session_factory,
        handler,
        topics=list(topics),
        bootstrap_servers=bootstrap_servers,
        dlq=dlq,
        get_stored_version=get_stored_version,
        max_attempts=max_attempts,
        backoff_s=backoff_s,
        reject_v1=reject_v1,
    )
