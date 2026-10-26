"""Envelope, dlq_topic, and partition-key helpers."""

from __future__ import annotations

from fuzefront_events import (
    TOPICS,
    build_envelope,
    dlq_topic,
    partition_key_for_payload,
)
from fuzefront_events.envelope import FuzeEvent


def test_build_envelope_shape():
    ev = build_envelope("identity.org.created", {"organizationId": "o1"}, "corr-1")
    assert isinstance(ev, FuzeEvent)
    d = ev.to_dict()
    assert d["version"] == "1.0"
    assert d["topic"] == "identity.org.created"
    assert d["correlationId"] == "corr-1"
    assert d["payload"] == {"organizationId": "o1"}
    assert d["occurredAt"]  # populated
    assert FuzeEvent.from_dict(d) == ev


def test_build_envelope_occurred_at_override():
    ev = build_envelope("portal.created", {}, "c", occurred_at="2026-01-01T00:00:00Z")
    assert ev.occurredAt == "2026-01-01T00:00:00Z"


def test_dlq_topic():
    assert dlq_topic("identity.org.deleted") == "identity.org.deleted.dlq"


def test_partition_key_fallback_order():
    # organizationId wins over everything else.
    assert partition_key_for_payload(
        {"organizationId": "org1", "userId": "u1", "appId": "a1"}
    ) == "org1"
    assert partition_key_for_payload({"userId": "u1", "portalId": "p1"}) == "u1"
    assert partition_key_for_payload({"portalId": "p1"}) == "p1"
    assert partition_key_for_payload({"entityId": "e1"}) == "e1"
    assert partition_key_for_payload({"appId": "a1"}) == "a1"
    assert partition_key_for_payload({"other": "x"}) is None
    assert partition_key_for_payload("not-a-mapping") is None
    # None values are skipped.
    assert partition_key_for_payload({"organizationId": None, "userId": "u1"}) == "u1"


def test_topics_count():
    assert len(TOPICS) == 46
