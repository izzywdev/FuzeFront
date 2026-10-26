# ruff: noqa: F401
"""fuzefront-events — event envelope v2, transactional outbox, relay, idempotent consumer.

Standard: FuzeSDLC ``governance/data-consistency-standard.md`` sections 3-4.
Contract: ``contracts/events/`` (envelope schema + ``tables.md``). TS peer:
``@izzywdev/fuzefront-events``; both are pinned by ``packages/conformance-vectors/events``.

Also exports the **v1 Kafka payload-contract mirror** — the Python peer of
``shared/src/kafka``'s v1 layer: the topic list (``TOPICS``) and the per-topic
payload schemas (``SCHEMA_BY_TOPIC`` / ``schema_for_topic``) that v1 ``FuzeEvent``
producers validate their payloads against, plus ``partition_key_for_payload``
(the v1-payload fallback keyer) and ``SchemaValidationError``. That layer is
stdlib-only; ``tests/test_contract_parity.py`` fails CI if it drifts from the
Node source of truth. (The v2 runtime's own keying / ``dlq_topic`` live in
``envelope`` / ``relay``.)
"""

from .consumer import (
    APPLIED,
    DEAD_LETTERED,
    DUPLICATE,
    IGNORED,
    EventConsumer,
    EventProcessor,
    Message,
    create_consumer,
    dedupe_key,
)
from .envelope import (
    V2_ONLY_KEYS,
    EnvelopeError,
    NormalizedEnvelope,
    ParseResult,
    build_event,
    load_v2_schema,
    parse_envelope,
    parse_envelope_bytes,
    partition_key,
    validate_envelope,
)

from .errors import SchemaValidationError
from .outbox import enqueue_event, enqueue_event_async
from .publisher import AIOKafkaPublisher, Publisher
from .registry import SCHEMA_BY_TOPIC, schema_for_topic
from .relay import DrainResult, OutboxRelay, dlq_topic, drain_once, requeue_failed_event, row_to_envelope
from .tables import (
    OUTBOX_V2_SQL,
    PROCESSED_EVENTS_SQL,
    PRUNE_PROCESSED_EVENTS_SQL,
    event_outbox,
    metadata,
    processed_events,
)
from .topics import TOPIC_VALUES, TOPICS, partition_key_for_payload
from .version_guard import AggregateState, ProjectionGuard, should_apply

__all__ = [n for n in dir() if not n.startswith("_")]
