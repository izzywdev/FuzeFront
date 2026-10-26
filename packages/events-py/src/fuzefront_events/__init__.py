"""fuzefront-events — Python mirror of the FuzeFront Kafka event contract.

Public surface is re-exported flat from the submodules (topics, envelope,
schemas/registry, outbox, relay, publisher). Kept in lockstep with the Node
contract in shared/src/kafka by tests/test_contract_parity.py.
"""

from __future__ import annotations

from .envelope import ENVELOPE_VERSION, FuzeEvent, build_envelope
from .errors import SchemaValidationError
from .topics import (
    TOPIC_VALUES,
    TOPICS,
    dlq_topic,
    partition_key_for_payload,
)

__version__ = "1.0.0"

__all__ = [
    "ENVELOPE_VERSION",
    "FuzeEvent",
    "SchemaValidationError",
    "TOPICS",
    "TOPIC_VALUES",
    "__version__",
    "build_envelope",
    "dlq_topic",
    "partition_key_for_payload",
]
