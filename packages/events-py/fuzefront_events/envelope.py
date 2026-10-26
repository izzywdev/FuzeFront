"""The FuzeEvent envelope — mirror of the `FuzeEvent<T>` interface in types.ts.

Every event published on a FuzeFront Kafka topic is wrapped in this envelope.
The field names are the wire contract and are serialized in camelCase exactly as
the Node producer emits them, so a Python producer and a Node consumer agree.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Mapping, Optional

# Semver-style envelope schema version emitted by producers (matches Node "1.0").
ENVELOPE_VERSION = "1.0"


def _now_iso() -> str:
    """Current time as an ISO-8601 UTC string (e.g. 2026-01-01T00:00:00.000Z)."""
    return (
        datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


@dataclass(frozen=True)
class FuzeEvent:
    """Wrapper for every event on a FuzeFront Kafka topic.

    Attributes are camelCase to match the wire contract (``to_dict`` preserves
    them verbatim), not the usual Python snake_case.
    """

    version: str
    topic: str
    correlationId: str  # noqa: N815 - wire contract field name
    occurredAt: str  # noqa: N815 - wire contract field name
    payload: Any

    def to_dict(self) -> dict:
        return {
            "version": self.version,
            "topic": self.topic,
            "correlationId": self.correlationId,
            "occurredAt": self.occurredAt,
            "payload": self.payload,
        }

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> "FuzeEvent":
        return cls(
            version=data["version"],
            topic=data["topic"],
            correlationId=data["correlationId"],
            occurredAt=data["occurredAt"],
            payload=data.get("payload"),
        )


def build_envelope(
    topic: str,
    payload: Any,
    correlation_id: str,
    occurred_at: Optional[str] = None,
) -> FuzeEvent:
    """Build a ``FuzeEvent`` for ``topic`` (version 1.0; occurredAt defaults to now)."""
    return FuzeEvent(
        version=ENVELOPE_VERSION,
        topic=topic,
        correlationId=correlation_id,
        occurredAt=occurred_at or _now_iso(),
        payload=payload,
    )
