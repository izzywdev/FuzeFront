"""ConfluentProducer delivery-confirmation semantics (finding: a queued-but-
unacknowledged message must not be reported as published). confluent-kafka is
not a test dependency, so a fake module is injected for the duration of each
test — the logic under test is adapter-only and needs no real broker."""

from __future__ import annotations

import sys
import types

import pytest


def _install_fake_confluent(behavior: str):
    """behavior: 'ok' (acked), 'error' (delivery callback reports an error),
    or 'timeout' (flush returns unacknowledged messages)."""
    mod = types.ModuleType("confluent_kafka")

    class FakeProducer:
        def __init__(self, conf):
            self.conf = conf
            self._pending = []

        def produce(self, topic, value=None, key=None, on_delivery=None):
            self._pending.append(on_delivery)

        def flush(self, timeout):
            if behavior == "timeout":
                return len(self._pending)  # nothing acknowledged in time
            for cb in self._pending:
                if cb is not None:
                    cb(None if behavior == "ok" else "broker down", object())
            self._pending.clear()
            return 0

        def poll(self, _):
            return 0

    mod.Producer = FakeProducer
    sys.modules["confluent_kafka"] = mod


@pytest.fixture(autouse=True)
def _cleanup_fake():
    yield
    sys.modules.pop("confluent_kafka", None)


def _producer(**kw):
    from fuzefront_events.publisher import ConfluentProducer

    return ConfluentProducer(brokers="localhost:9092", **kw)


def test_send_returns_once_delivery_is_acknowledged():
    _install_fake_confluent("ok")
    assert _producer().send("t", "k", "{}") is None


def test_send_raises_when_delivery_reports_an_error():
    _install_fake_confluent("error")
    with pytest.raises(RuntimeError, match="delivery failed"):
        _producer().send("t", "k", "{}")


def test_send_raises_when_flush_times_out():
    _install_fake_confluent("timeout")
    with pytest.raises(RuntimeError, match="timed out"):
        _producer(flush_timeout=0.01).send("t", "k", "{}")
