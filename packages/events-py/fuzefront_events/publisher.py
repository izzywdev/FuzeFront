"""Kafka transport for the outbox relay — Python mirror of
backend/core/src/events/kafkaPublisher.ts.

``make_outbox_publisher`` wraps an injected producer into the ``publish`` /
``dead_letter`` callables the relay drives: it builds the ``FuzeEvent`` envelope,
derives the partition key, validates the payload against the registered schema
(unregistered topics publish raw), and routes exhausted records to
``<topic>.dlq``. The concrete Kafka producer is injected via the ``Producer``
protocol so this logic is unit-testable with a fake; ``ConfluentProducer``
(behind the ``kafka`` extra) is the real adapter.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any, Callable, Optional, Protocol, runtime_checkable

from .envelope import build_envelope
from .registry import schema_for_topic
from .relay import OutboxRecord
from .topics import dlq_topic, partition_key_for_payload

DEAD_LETTER_REASON = "outbox max attempts exhausted"


@runtime_checkable
class Producer(Protocol):
    """Minimal producer surface: send one message (value is a UTF-8 string)."""

    def send(self, topic: str, key: Optional[str], value: str) -> Any:  # pragma: no cover
        ...


@dataclass
class OutboxPublisher:
    publish: Callable[[OutboxRecord], None]
    dead_letter: Callable[..., None]


def make_outbox_publisher(get_producer: Callable[[], Producer]) -> OutboxPublisher:
    """Build the publish/dead_letter callables around a lazily-obtained producer.

    ``get_producer`` is called on each use (callers typically memoise it). A
    connect/send failure propagates so the relay leaves the row ``pending``.
    """

    def publish(record: OutboxRecord) -> None:
        payload = record.payload
        validator = schema_for_topic(record.topic)
        if validator is not None:
            # Validates (and raises) exactly like TypedProducer.send on Node.
            validator(payload)
        event = build_envelope(record.topic, payload, record.correlationId)
        key = partition_key_for_payload(payload)
        get_producer().send(record.topic, key, json.dumps(event.to_dict()))

    def dead_letter(record: OutboxRecord, err: Optional[BaseException] = None) -> None:
        body = {
            "raw": {
                "id": record.id,
                "topic": record.topic,
                "payload": record.payload,
                "correlationId": record.correlationId,
                "attempts": record.attempts,
            },
            "reason": DEAD_LETTER_REASON,
        }
        get_producer().send(dlq_topic(record.topic), None, json.dumps(body))

    return OutboxPublisher(publish=publish, dead_letter=dead_letter)


class ConfluentProducer:
    """``Producer`` backed by ``confluent_kafka.Producer`` (``kafka`` extra)."""

    def __init__(
        self,
        config: Optional[dict] = None,
        brokers: Optional[str] = None,
        *,
        flush_timeout: float = 10.0,
    ):
        from confluent_kafka import Producer as _CKProducer  # type: ignore

        conf = dict(config or {})
        if brokers:
            conf.setdefault("bootstrap.servers", brokers)
        self._producer = _CKProducer(conf)
        self._flush_timeout = flush_timeout

    def send(self, topic: str, key: Optional[str], value: str) -> Any:
        # The Node transport this mirrors is kafkajs' producer.send(), which
        # resolves only AFTER the broker acknowledges. confluent-kafka's
        # produce() merely enqueues locally — poll(0) does not wait — so we
        # attach a delivery callback and flush to confirm the ack, then RAISE on
        # any delivery failure. That failure propagates up through the relay,
        # which leaves the row 'pending' (retryable) rather than committing a
        # lost event as 'sent'. Without this, a broker outage or async reject
        # would permanently bypass the outbox retry/DLQ machinery.
        errors: list = []

        def _on_delivery(err: Any, _msg: Any) -> None:
            if err is not None:
                errors.append(err)

        self._producer.produce(
            topic,
            value=value.encode("utf-8"),
            key=key.encode("utf-8") if key is not None else None,
            on_delivery=_on_delivery,
        )
        remaining = self._producer.flush(self._flush_timeout)
        if remaining > 0:
            raise RuntimeError(
                f"Kafka delivery timed out: {remaining} message(s) unacknowledged "
                f"within {self._flush_timeout}s"
            )
        if errors:
            raise RuntimeError(f"Kafka delivery failed: {errors[0]}")
        return None

    def flush(self, timeout: float = 10.0) -> int:
        return self._producer.flush(timeout)


def start_outbox_relay_from_env(
    db: Any,
    *,
    brokers: Optional[str] = None,
    client_id: Optional[str] = None,
    interval_ms: Optional[int] = None,
    logger: Any = None,
):
    """Start the relay with a Kafka transport wired from the environment.

    Returns ``None`` (a no-op) when no broker is configured (``KAFKA_BROKERS``
    unset), so events stay durably in ``event_outbox`` until one is — mirroring
    ``startOutboxRelayFromEnv``.
    """
    brokers_raw = brokers if brokers is not None else os.environ.get("KAFKA_BROKERS")
    if not brokers_raw:
        if logger is not None:
            logger.info("KAFKA_BROKERS unset — outbox relay disabled (events held in event_outbox)")
        return None

    from .relay import start_outbox_relay

    producer = ConfluentProducer(
        config={"client.id": client_id} if client_id else None, brokers=brokers_raw
    )
    publisher = make_outbox_publisher(lambda: producer)
    interval = interval_ms
    if interval is None:
        interval = int(os.environ.get("OUTBOX_RELAY_INTERVAL_MS", "1000"))
    return start_outbox_relay(
        db,
        publisher.publish,
        interval_ms=interval,
        on_dead_letter=publisher.dead_letter,
        logger=logger,
    )
