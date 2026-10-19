"""Tests for MeteringClient: produce payload shape, error-swallowing, flush.

The confluent-kafka Producer is mocked throughout via the ``_producer_factory``
constructor override -- no real Kafka broker is required.
"""

from __future__ import annotations

import json

from fuzefront_metered_usage import MeteringClient, UsageEvent


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


class FakeProducer:
    """In-memory stand-in for ``confluent_kafka.Producer``."""

    def __init__(self, config: dict) -> None:
        self.config = config
        self.produced: list[dict] = []
        self.flush_calls: list[float] = []
        self._raise_on_produce: Exception | None = None

    def produce(self, topic: str, *, value: bytes) -> None:
        if self._raise_on_produce is not None:
            raise self._raise_on_produce
        self.produced.append({"topic": topic, "value": value})

    def flush(self, timeout: float) -> None:
        self.flush_calls.append(timeout)


def make_client(brokers: list[str] | None = None) -> tuple[MeteringClient, FakeProducer]:
    """Return a (client, fake_producer) pair."""
    created: list[FakeProducer] = []

    def factory(config):
        p = FakeProducer(config)
        created.append(p)
        return p

    client = MeteringClient(
        brokers=brokers or ["kafka:9092"],
        _producer_factory=factory,
    )
    return client, created[0]


def make_event(**kwargs) -> UsageEvent:
    defaults = dict(
        meter_event_name="api_calls",
        quantity=1.0,
        entity_type="organization",
        entity_id="org_abc",
        timestamp="2026-01-01T00:00:00+00:00",
    )
    defaults.update(kwargs)
    return UsageEvent(**defaults)


# ---------------------------------------------------------------------------
# Payload shape
# ---------------------------------------------------------------------------


def test_emit_calls_produce_with_correct_json_payload():
    client, producer = make_client()

    client.emit(make_event(
        meter_event_name="api_calls",
        quantity=3.0,
        entity_type="organization",
        entity_id="org_xyz",
        timestamp="2026-06-01T12:00:00+00:00",
    ))

    assert len(producer.produced) == 1
    msg = producer.produced[0]
    assert msg["topic"] == "billing.usage"
    payload = json.loads(msg["value"].decode("utf-8"))
    assert payload == {
        "meterEventName": "api_calls",
        "quantity": 3.0,
        "entityType": "organization",
        "entityId": "org_xyz",
        "timestamp": "2026-06-01T12:00:00+00:00",
    }


def test_emit_user_entity_type():
    client, producer = make_client()
    client.emit(make_event(entity_type="user", entity_id="usr_123"))
    payload = json.loads(producer.produced[0]["value"].decode("utf-8"))
    assert payload["entityType"] == "user"
    assert payload["entityId"] == "usr_123"


def test_emit_custom_meter_and_quantity():
    client, producer = make_client()
    client.emit(make_event(meter_event_name="tokens_consumed", quantity=512.0))
    payload = json.loads(producer.produced[0]["value"].decode("utf-8"))
    assert payload["meterEventName"] == "tokens_consumed"
    assert payload["quantity"] == 512.0


def test_emit_uses_configured_topic():
    created: list[FakeProducer] = []

    def factory(config):
        p = FakeProducer(config)
        created.append(p)
        return p

    client = MeteringClient(
        brokers=["kafka:9092"],
        topic="my.custom.topic",
        _producer_factory=factory,
    )
    client.emit(make_event())
    assert created[0].produced[0]["topic"] == "my.custom.topic"


def test_producer_config_receives_brokers():
    _, producer = make_client(brokers=["broker1:9092", "broker2:9092"])
    assert producer.config["bootstrap.servers"] == "broker1:9092,broker2:9092"


# ---------------------------------------------------------------------------
# Error swallowing -- emit() must NEVER raise
# ---------------------------------------------------------------------------


def test_emit_on_producer_error_does_not_raise():
    client, producer = make_client()
    producer._raise_on_produce = RuntimeError("Kafka broker unavailable")

    # Must not raise; caller's request path must continue
    client.emit(make_event())


def test_emit_when_producer_init_failed_does_not_raise():
    """When the producer could not be created (e.g. bad config), emit is a no-op."""

    def failing_factory(config):
        raise RuntimeError("bad config")

    client = MeteringClient(brokers=["bad:9092"], _producer_factory=failing_factory)
    # Must not raise
    client.emit(make_event())


# ---------------------------------------------------------------------------
# flush()
# ---------------------------------------------------------------------------


def test_flush_delegates_to_producer_flush():
    client, producer = make_client()
    client.flush(timeout=3.0)
    assert producer.flush_calls == [3.0]


def test_flush_default_timeout():
    client, producer = make_client()
    client.flush()
    assert producer.flush_calls == [5.0]


def test_flush_when_producer_unavailable_does_not_raise():
    def failing_factory(config):
        raise RuntimeError("no kafka")

    client = MeteringClient(brokers=["x:9092"], _producer_factory=failing_factory)
    client.flush()  # must not raise


# ---------------------------------------------------------------------------
# from_env()
# ---------------------------------------------------------------------------


def test_from_env_reads_kafka_brokers(monkeypatch):
    monkeypatch.setenv("KAFKA_BROKERS", "broker-a:9092,broker-b:9092")
    created: list[FakeProducer] = []

    original_init = MeteringClient.__init__

    def patched_init(self, brokers, topic="billing.usage", service_name="", **kwargs):
        created.append(brokers)
        # Use factory so no real kafka import happens
        kwargs["_producer_factory"] = lambda cfg: FakeProducer(cfg)
        original_init(self, brokers, topic, service_name, **kwargs)

    monkeypatch.setattr(MeteringClient, "__init__", patched_init)
    MeteringClient.from_env(service_name="svc")
    assert created[0] == ["broker-a:9092", "broker-b:9092"]


def test_from_env_default_broker_when_env_absent(monkeypatch):
    monkeypatch.delenv("KAFKA_BROKERS", raising=False)
    created: list[list[str]] = []

    original_init = MeteringClient.__init__

    def patched_init(self, brokers, topic="billing.usage", service_name="", **kwargs):
        created.append(brokers)
        kwargs["_producer_factory"] = lambda cfg: FakeProducer(cfg)
        original_init(self, brokers, topic, service_name, **kwargs)

    monkeypatch.setattr(MeteringClient, "__init__", patched_init)
    MeteringClient.from_env()
    assert created[0] == ["localhost:9092"]
