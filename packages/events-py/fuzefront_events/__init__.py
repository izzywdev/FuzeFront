"""fuzefront-events — Python mirror of the FuzeFront Kafka event contract.

Public surface is re-exported flat from the submodules (topics, envelope,
schemas/registry, outbox, relay, publisher). Kept in lockstep with the Node
contract in shared/src/kafka by tests/test_contract_parity.py.
"""

from __future__ import annotations

from . import schemas as schemas
from .envelope import ENVELOPE_VERSION, FuzeEvent, build_envelope
from .errors import SchemaValidationError
from .outbox import OutboxDb, PsycopgOutboxDb, enqueue_event
from .publisher import (
    ConfluentProducer,
    OutboxPublisher,
    Producer,
    make_outbox_publisher,
    start_outbox_relay_from_env,
)
from .registry import SCHEMA_BY_TOPIC, schema_for_topic
from .relay import (
    DrainResult,
    OutboxRecord,
    OutboxRelayHandle,
    PsycopgRelayDb,
    RelayDb,
    drain_outbox_once,
    start_outbox_relay,
)
from .topics import (
    TOPIC_VALUES,
    TOPICS,
    dlq_topic,
    partition_key_for_payload,
)

__version__ = "1.0.0"

__all__ = [
    "ConfluentProducer",
    "DrainResult",
    "ENVELOPE_VERSION",
    "FuzeEvent",
    "OutboxDb",
    "OutboxPublisher",
    "OutboxRecord",
    "OutboxRelayHandle",
    "Producer",
    "PsycopgOutboxDb",
    "PsycopgRelayDb",
    "RelayDb",
    "SCHEMA_BY_TOPIC",
    "SchemaValidationError",
    "TOPICS",
    "TOPIC_VALUES",
    "__version__",
    "build_envelope",
    "dlq_topic",
    "drain_outbox_once",
    "enqueue_event",
    "make_outbox_publisher",
    "partition_key_for_payload",
    "partition_key_for_payload",
    "schema_for_topic",
    "schemas",
    "start_outbox_relay",
    "start_outbox_relay_from_env",
]
