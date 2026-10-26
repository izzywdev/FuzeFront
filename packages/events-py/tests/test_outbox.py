"""Outbox writer + relay drain logic, exercised with in-memory fakes (no real
Postgres or Kafka). Mirrors the assertions in
backend/core/tests/events/outbox.integration.test.ts."""

from __future__ import annotations

from fuzefront_events import enqueue_event
from fuzefront_events.relay import OutboxRecord, drain_outbox_once


class FakeOutboxDb:
    """Captures enqueue INSERTs."""

    def __init__(self):
        self.calls = []

    def execute(self, sql, params):
        self.calls.append((sql, params))


class FakeRelayDb:
    """In-memory event_outbox the relay drains. Rows are dicts with status/attempts."""

    def __init__(self, rows):
        self.rows = rows  # list of dicts: id, topic, payload, correlation_id, status, attempts
        self.committed = 0
        self.rolled_back = 0

    def claim_pending(self, batch_size):
        pending = [r for r in self.rows if r["status"] == "pending"][:batch_size]
        return [
            OutboxRecord(r["id"], r["topic"], r["payload"], r["correlation_id"], r["attempts"])
            for r in pending
        ]

    def _row(self, rid):
        return next(r for r in self.rows if r["id"] == rid)

    def mark_sent(self, record):
        r = self._row(record.id)
        r["status"] = "sent"
        r["attempts"] += 1

    def mark_retry(self, record, *, attempts, status, last_error):
        r = self._row(record.id)
        r["attempts"] = attempts
        r["status"] = status
        r["last_error"] = last_error

    def commit(self):
        self.committed += 1

    def rollback(self):
        self.rolled_back += 1


def _row(rid, topic="identity.org.created", payload=None):
    return {
        "id": rid, "topic": topic, "payload": payload or {"organizationId": "o1"},
        "correlation_id": "c" + rid, "status": "pending", "attempts": 0,
    }


def test_enqueue_writes_pending_row_with_jsonb_cast():
    db = FakeOutboxDb()
    rid = enqueue_event(db, "identity.org.created", {"organizationId": "o1"}, "corr-1")
    assert len(rid) == 36  # uuid4
    sql, params = db.calls[0]
    assert "event_outbox" in sql
    assert "::jsonb" in sql
    assert params[0] == rid
    assert params[1] == "identity.org.created"
    assert '"organizationId"' in params[2]  # json.dumps of payload
    assert params[3] == "corr-1"


def test_drain_publishes_and_marks_sent():
    db = FakeRelayDb([_row("a"), _row("b")])
    published = []
    res = drain_outbox_once(db, publish=lambda r: published.append(r.topic))
    assert (res.sent, res.failed) == (2, 0)
    assert [r["status"] for r in db.rows] == ["sent", "sent"]
    assert db.committed == 1


def test_drain_keeps_pending_and_increments_attempts_on_failure():
    db = FakeRelayDb([_row("a")])

    def boom(_):
        raise RuntimeError("kafka down")

    res = drain_outbox_once(db, publish=boom)
    assert (res.sent, res.failed) == (0, 1)
    assert db.rows[0]["status"] == "pending"
    assert db.rows[0]["attempts"] == 1
    assert "kafka down" in db.rows[0]["last_error"]


def test_drain_parks_failed_and_dead_letters_after_max_attempts():
    db = FakeRelayDb([_row("a")])
    dead = []

    def boom(_):
        raise RuntimeError("permanent")

    opts = dict(publish=boom, max_attempts=2, on_dead_letter=lambda r, e: dead.append(r.id))
    drain_outbox_once(db, **opts)  # attempts -> 1, pending
    assert db.rows[0]["status"] == "pending"
    drain_outbox_once(db, **opts)  # attempts -> 2, parked failed + dead-lettered
    assert db.rows[0]["status"] == "failed"
    assert db.rows[0]["attempts"] == 2
    assert dead == ["a"]


def test_drain_recovers_after_outage():
    db = FakeRelayDb([_row("a"), _row("b"), _row("c")])
    broker_up = {"v": False}

    def publish(_):
        if not broker_up["v"]:
            raise RuntimeError("kafka down")

    down = drain_outbox_once(db, publish=publish)
    assert (down.sent, down.failed) == (0, 3)
    assert all(r["status"] == "pending" for r in db.rows)

    broker_up["v"] = True
    up = drain_outbox_once(db, publish=publish)
    assert (up.sent, up.failed) == (3, 0)
    assert all(r["status"] == "sent" for r in db.rows)
