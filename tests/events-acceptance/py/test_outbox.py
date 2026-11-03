import re

import adapter as A
import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

pytestmark = [A.needs_infra, A.acc]


def ev(topic, agg, v=1):
    return A.build_event(topic, "organization", agg, v, {"id": agg, "name": "Acme"})


async def test_rollback_leaves_neither_state_nor_outbox_row_nor_message(sf):
    topic = A.new_topic()
    await A.create_topic(topic)
    agg = A.type_id("org")
    with pytest.raises(RuntimeError):
        async with sf() as s, s.begin():
            await s.execute(
                text("INSERT INTO acc_business VALUES (:i,'Acme')"), {"i": agg}
            )
            await A.enqueue(s, ev(topic, agg))
            raise RuntimeError("boom")
    assert await A.scalar(sf, "SELECT count(*) FROM acc_business") == 0
    assert await A.scalar(sf, "SELECT count(*) FROM event_outbox") == 0
    await A.drain(sf, await A.publisher())
    assert await A.read_all(topic, 2.5) == []


async def test_commit_writes_pending_row_with_contract_columns(sf):
    topic = A.new_topic()
    agg = A.type_id("org")
    async with sf() as s, s.begin():
        await s.execute(text("INSERT INTO acc_business VALUES (:i,'Acme')"), {"i": agg})
        await A.enqueue(s, ev(topic, agg))
    async with sf() as s:
        r = (
            await s.execute(
                text(
                    "SELECT topic, aggregate_type, aggregate_id, aggregate_version, status::text, attempts, event_id "
                    "FROM event_outbox"
                )
            )
        ).all()
    assert len(r) == 1
    assert tuple(r[0][:6]) == (topic, "organization", agg, 1, "pending", 0)
    assert re.fullmatch(r"evt_[0-7][0-9a-hjkmnp-tv-z]{25}", r[0][6])


async def test_crash_after_commit_before_relay_then_relay_publishes_exactly_once(sf):
    topic = A.new_topic()
    await A.create_topic(topic)
    agg = A.type_id("org")
    async with sf() as s, s.begin():
        await A.enqueue(s, ev(topic, agg))
    event_id = await A.scalar(sf, "SELECT event_id FROM event_outbox")
    pub = await A.publisher()
    await A.drain(sf, pub)
    await A.drain(sf, pub)  # 2nd relay must not re-publish
    msgs = await A.read_all(topic)
    assert len(msgs) == 1
    assert msgs[0][0] == agg
    assert msgs[0][1]["eventId"] == event_id
    assert not list(A.envelope_validator().iter_errors(msgs[0][1]))
    assert await A.scalar(sf, "SELECT status::text FROM event_outbox") == "sent"


async def test_one_event_per_aggregate_version(sf):
    topic = A.new_topic()
    agg = A.type_id("org")
    async with sf() as s, s.begin():
        await A.enqueue(s, ev(topic, agg, 1))
    with pytest.raises(IntegrityError):
        async with sf() as s, s.begin():
            await A.enqueue(s, ev(topic, agg, 1))
    assert await A.scalar(sf, "SELECT count(*) FROM event_outbox") == 1
