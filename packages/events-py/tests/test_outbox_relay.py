import json

import pytest
from helpers import ORG1, ORG2, enqueue, ev
from sqlalchemy import create_engine, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from fuzefront_events import drain_once, enqueue_event, event_outbox, validate_envelope
from fuzefront_events.testkit import InMemoryBroker


async def statuses(sf):
    async with sf() as s:
        rows = (await s.execute(select(event_outbox).order_by(event_outbox.c.aggregate_version))).all()
    return [(r.aggregate_id, r.aggregate_version, r.status, r.attempts) for r in rows]


async def test_enqueue_writes_v2_columns_and_relay_publishes_valid_envelope(sf):
    e = ev(version=1)
    await enqueue(sf, e)
    async with sf() as s:
        r = (await s.execute(select(event_outbox))).one()
    assert (
        r.event_id,
        r.aggregate_type,
        r.aggregate_id,
        r.aggregate_version,
        r.producer,
        r.schema_version,
        r.status,
        r.attempts,
    ) == (e["eventId"], "organization", ORG1, 1, "svc", 1, "pending", 0)
    broker = InMemoryBroker()
    res = await drain_once(sf, broker)
    assert res.sent == 1
    [m] = broker.messages()
    assert m.key == ORG1.encode() and m.topic == "identity.org.updated"
    wire = json.loads(m.value)
    assert validate_envelope(wire) == []
    assert wire["eventId"] == e["eventId"] and wire["payload"] == e["payload"]
    assert wire["occurredAt"] == e["occurredAt"]
    assert (await statuses(sf))[0][2:] == ("sent", 1)


async def test_duplicate_version_or_event_id_rejected(sf):
    e = ev(version=1)
    await enqueue(sf, e)
    with pytest.raises(IntegrityError):
        await enqueue(sf, ev(version=1))  # same aggregate version
    with pytest.raises(IntegrityError):
        await enqueue(sf, e)  # same event id


async def test_rollback_leaves_no_outbox_row(sf):
    with pytest.raises(RuntimeError):
        async with sf() as s, s.begin():
            from fuzefront_events import enqueue_event_async

            await enqueue_event_async(s, ev())
            raise RuntimeError("business tx failed")
    assert await statuses(sf) == []


async def test_per_aggregate_order_and_aggregates_interleave(sf):
    await enqueue(sf, ev(ORG1, 3), ev(ORG1, 1), ev(ORG2, 1), ev(ORG1, 2), ev(ORG2, 2))
    broker = InMemoryBroker()
    res = await drain_once(sf, broker)
    assert res.sent == 5
    got = [(m.key.decode(), json.loads(m.value)["aggregateVersion"]) for m in broker.messages()]
    for org in (ORG1, ORG2):
        assert [v for k, v in got if k == org] == sorted(v for k, v in got if k == org)
    assert len(got) == 5


async def test_failed_head_blocks_aggregate_not_others(sf):
    await enqueue(sf, ev(ORG1, 1), ev(ORG1, 2), ev(ORG2, 1))
    broker = InMemoryBroker()
    broker.fail_if = lambda t, k, v: k == ORG1.encode() and t == "identity.org.updated"
    res = await drain_once(sf, broker, max_attempts=3)
    assert (res.sent, res.failed) == (1, 1)  # ORG2 sent; ORG1 v1 failed; v2 NOT published
    assert [m.key for m in broker.messages()] == [ORG2.encode()]
    st = {(a, v): (s, n) for a, v, s, n in await statuses(sf)}
    assert st[(ORG1, 1)] == ("pending", 1) and st[(ORG1, 2)] == ("pending", 0)
    broker.heal()
    await drain_once(sf, broker, max_attempts=3)
    got = [json.loads(m.value)["aggregateVersion"] for m in broker.messages() if m.key == ORG1.encode()]
    assert got == [1, 2]


async def test_bounded_attempts_then_dlq_and_blocks_later_versions(sf):
    await enqueue(sf, ev(ORG1, 1), ev(ORG1, 2))
    broker = InMemoryBroker()
    broker.fail_topic("identity.org.updated")
    for _ in range(3):
        await drain_once(sf, broker, max_attempts=3)
    dlq = broker.messages("identity.org.updated.dlq")
    assert len(dlq) == 1 and json.loads(dlq[0].value)["aggregateVersion"] == 1
    st = {(a, v): (s, n) for a, v, s, n in await statuses(sf)}
    assert st[(ORG1, 1)] == ("failed", 3)
    broker.heal()
    res = await drain_once(sf, broker, max_attempts=3)
    assert res.sent == 0  # parked head blocks v2 (never publish v2 without v1)
    assert broker.messages("identity.org.updated") == []
    async with sf() as s:
        err = (
            await s.execute(select(event_outbox.c.last_error).where(event_outbox.c.aggregate_version == 1))
        ).scalar()
    assert "unavailable" in err


async def test_dlq_send_failure_keeps_row_pending(sf):
    await enqueue(sf, ev(ORG1, 1))
    broker = InMemoryBroker()
    broker.fail_if = lambda t, k, v: True  # DLQ topic fails too
    res = await drain_once(sf, broker, max_attempts=1)
    assert res.dead_lettered == 0
    assert (await statuses(sf))[0][2] == "pending"


async def test_crash_between_commit_and_publish_is_recovered(sf):
    """State change committed, relay never ran (crash) -> a later relay still publishes it once."""
    e = ev(ORG1, 1)
    await enqueue(sf, e)  # committed; process 'dies' before any publish
    broker = InMemoryBroker()
    await drain_once(sf, broker)
    await drain_once(sf, broker)  # a second pass publishes nothing new
    assert [json.loads(m.value)["eventId"] for m in broker.messages()] == [e["eventId"]]


async def test_crash_after_publish_before_mark_sent_republishes_same_event_id(sf):
    """At-least-once: publish acked, then the claim tx aborts -> row stays pending, same eventId re-sent."""
    e = ev(ORG1, 1)
    await enqueue(sf, e)

    class Boom(InMemoryBroker):
        async def send(self, *a, **k):
            await super().send(*a, **k)
            raise KeyboardInterrupt  # simulates process death after the broker acked

    b1 = Boom()
    with pytest.raises(KeyboardInterrupt):
        await drain_once(sf, b1)
    assert (await statuses(sf))[0][2] == "pending"
    b2 = InMemoryBroker()
    await drain_once(sf, b2)
    assert (
        json.loads(b1.messages()[0].value)["eventId"]
        == json.loads(b2.messages()[0].value)["eventId"]
        == e["eventId"]
    )


def test_sync_session_enqueue(tmp_path):
    eng = create_engine(f"sqlite:///{tmp_path / 's.db'}")
    from fuzefront_events import metadata

    metadata.create_all(eng)
    with Session(eng) as s, s.begin():
        eid = enqueue_event(s, ev())
    with Session(eng) as s:
        assert s.execute(select(event_outbox.c.event_id)).scalar() == eid


@pytest.mark.postgres
async def test_skip_locked_two_relays_never_double_publish(sf):
    """Two concurrent relays on Postgres: every row published exactly once, order kept per aggregate."""
    import asyncio

    if sf.kw["bind"].dialect.name != "postgresql":
        pytest.skip("SKIP LOCKED needs Postgres (SQLite has no row locks)")
    aggs = [f"org_01h455vb4pex5vsknk084sn{i:02d}q" for i in range(10, 16)]
    await enqueue(sf, *[ev(a, v) for a in aggs for v in (1, 2, 3)])
    broker = InMemoryBroker()
    await asyncio.gather(*[drain_once(sf, broker, batch_size=3) for _ in range(4)])
    for _ in range(5):
        await asyncio.gather(*[drain_once(sf, broker, batch_size=3) for _ in range(3)])
    ids = [json.loads(m.value)["eventId"] for m in broker.messages()]
    assert len(ids) == len(set(ids)) == 18
    for a in aggs:
        vs = [json.loads(m.value)["aggregateVersion"] for m in broker.messages() if m.key == a.encode()]
        assert vs == [1, 2, 3]
