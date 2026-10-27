# ruff: noqa: F401
"""fuzefront-events — event envelope v2, transactional outbox, relay, idempotent consumer.

Standard: FuzeSDLC ``governance/data-consistency-standard.md`` sections 3-4.
Contract: ``contracts/events/`` (envelope schema + ``tables.md``). TS peer:
``@izzywdev/fuzefront-events``; both are pinned by ``packages/conformance-vectors/events``.
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
from .outbox import enqueue_event, enqueue_event_async
from .publisher import AIOKafkaPublisher, Publisher
from .relay import DrainResult, OutboxRelay, dlq_topic, drain_once, requeue_failed_event, row_to_envelope
from .tables import (
    OUTBOX_V2_SQL,
    PROCESSED_EVENTS_SQL,
    PRUNE_PROCESSED_EVENTS_SQL,
    event_outbox,
    metadata,
    processed_events,
)
from .version_guard import AggregateState, ProjectionGuard, should_apply

__all__ = [n for n in dir() if not n.startswith("_")]
