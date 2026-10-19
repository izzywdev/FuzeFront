"""Metered usage Kafka producer for FuzeFront-family Python services.

Emits ``billing.usage`` events consumed by ``services/billing-service`` which
flushes them to Stripe Billing Meter Events. The producer is fire-and-forget
and NEVER raises -- metering must not break the caller's request path.

Event shape (mirrors the TypeScript billing-service contract)::

    {
      "meterEventName": str,   # e.g. 'api_calls', 'tokens_consumed'
      "quantity": float,
      "entityType": "organization" | "user",
      "entityId": str,
      "timestamp": str,        # ISO8601 UTC
    }
"""

from __future__ import annotations

import json
import logging
import os
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Literal

logger = logging.getLogger(__name__)

EntityType = Literal["organization", "user"]


@dataclass
class UsageEvent:
    """A single metered usage event to emit to the billing pipeline.

    Attributes:
        meter_event_name: Identifies the meter to increment
            (e.g. ``'api_calls'``, ``'tokens_consumed'``, ``'storage_bytes'``).
        quantity: How much to add to the meter.
        entity_type: Whether the entity is an ``'organization'`` or ``'user'``.
        entity_id: The entity's identifier (organization id or user id).
        timestamp: ISO8601 UTC timestamp of the event.
    """

    meter_event_name: str
    quantity: float
    entity_type: EntityType
    entity_id: str
    timestamp: str  # ISO8601


class MeteringClient:
    """Emits usage events to the Kafka ``billing.usage`` topic.

    Fire-and-forget: :meth:`emit` never raises -- a Kafka error is logged at
    WARNING level but the caller's request continues uninterrupted. Metering
    infrastructure problems must not degrade the product.

    Example::

        client = MeteringClient.from_env(service_name="my-service")
        client.emit(UsageEvent(
            meter_event_name="api_calls",
            quantity=1,
            entity_type="organization",
            entity_id="org_01abc",
            timestamp=datetime.now(timezone.utc).isoformat(),
        ))
        # on shutdown:
        client.flush()
    """

    def __init__(
        self,
        brokers: list[str],
        topic: str = "billing.usage",
        service_name: str = "",
        *,
        _producer_factory: Callable | None = None,
    ) -> None:
        """
        Args:
            brokers: Kafka broker addresses, e.g. ``["kafka:9092"]``.
            topic: Kafka topic name (default ``billing.usage``).
            service_name: Identifies the emitting service in log messages.
            _producer_factory: Override for testing -- called instead of
                ``confluent_kafka.Producer``.
        """
        self._topic = topic
        self._service_name = service_name
        self._producer: object | None = None

        try:
            if _producer_factory is not None:
                self._producer = _producer_factory({"bootstrap.servers": ",".join(brokers)})
            else:
                from confluent_kafka import Producer  # type: ignore[import]

                self._producer = Producer({"bootstrap.servers": ",".join(brokers)})
        except Exception:
            logger.warning(
                "metered-usage: failed to create Kafka producer for service=%r brokers=%r; "
                "usage events will be dropped",
                service_name,
                brokers,
                exc_info=True,
            )

    @classmethod
    def from_env(cls, service_name: str = "") -> MeteringClient:
        """Construct a client from environment variables.

        Reads ``KAFKA_BROKERS`` (comma-separated broker list).  Falls back to
        ``localhost:9092`` when the variable is absent so local dev works
        out-of-the-box.

        Example::

            # export KAFKA_BROKERS=kafka-1:9092,kafka-2:9092
            client = MeteringClient.from_env(service_name="billing-proxy")
        """
        raw = os.environ.get("KAFKA_BROKERS", "localhost:9092")
        brokers = [b.strip() for b in raw.split(",") if b.strip()]
        return cls(brokers=brokers, service_name=service_name)

    def emit(self, event: UsageEvent) -> None:
        """Emit a usage event to the Kafka topic.

        Fire-and-forget -- any error is logged at WARNING level and silently
        swallowed so the caller's request path is never disrupted.
        """
        if self._producer is None:
            logger.warning(
                "metered-usage: producer not available; dropping event meter=%r entity=%r",
                event.meter_event_name,
                event.entity_id,
            )
            return

        payload = {
            "meterEventName": event.meter_event_name,
            "quantity": event.quantity,
            "entityType": event.entity_type,
            "entityId": event.entity_id,
            "timestamp": event.timestamp,
        }
        try:
            self._producer.produce(  # type: ignore[union-attr]
                self._topic,
                value=json.dumps(payload).encode("utf-8"),
            )
        except Exception:
            logger.warning(
                "metered-usage: produce() failed meter=%r entity=%r; event dropped",
                event.meter_event_name,
                event.entity_id,
                exc_info=True,
            )

    def flush(self, timeout: float = 5.0) -> None:
        """Flush pending messages and wait for delivery confirmations.

        Call this during graceful shutdown to avoid losing in-flight events.

        Args:
            timeout: Maximum seconds to wait for delivery (default 5).
        """
        if self._producer is None:
            return
        try:
            self._producer.flush(timeout)  # type: ignore[union-attr]
        except Exception:
            logger.warning(
                "metered-usage: flush() failed for service=%r",
                self._service_name,
                exc_info=True,
            )


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
