import asyncio
import json

import adapter as A
from sqlalchemy import text

pytestmark = [A.needs_infra, A.acc]


async def enq(sf, topic, agg, v):
    async with sf() as s, s.begin():
        await A.enqueue(
            s, A.build_event(topic, "organization", agg, v, {"id": agg, "v": v})
        )


class Faulty:
    """Publisher wrapper: fail on predicate; optionally slow; records non-DLQ sends."""

    def __init__(self, real, fail=None, delay=0.0):
        self.real, self.fail, self.delay, self.sent = real, fail, delay, []

    async def send(self, topic, key, value, headers=()):
        env = json.loads(value)
        if self.fail and self.fail(topic, key.decode(), env):
            raise RuntimeError("broker rejected")
        if self.delay:
            await asyncio.sleep(self.delay)
        if not topic.endswith(".dlq"):
            self.sent.append(env["eventId"])
        await self.real.send(topic, key, value, headers)


async def test_per_aggregate_version_order_regardless_of_insertion_order(sf):
    topic = A.new_topic()
    await A.create_topic(topic)
    a, b = A.type_id("org"), A.type_id("org")
    for agg, v in [(a, 3), (b, 1), (a, 1), (b, 2), (a, 2), (a, 4)]:
        await enq(sf, topic, agg, v)
    await A.drain(sf, await A.publisher())
    msgs = await A.read_all(topic)
    assert len(msgs) == 6
    assert [m[1]["aggregateVersion"] for m in msgs if m[0] == a] == [1, 2, 3, 4]
    assert [m[1]["aggregateVersion"] for m in msgs if m[0] == b] == [1, 2]


async def test_failed_head_dlq_still_blocks_then_requeue_publishes_in_order(sf):
    topic = A.new_topic()
    await A.create_topic(topic)
    a, b = A.type_id("org"), A.type_id("org")
    for v in (1, 2, 3):
        await enq(sf, topic, a, v)
        await enq(sf, topic, b, v)
    max_attempts = 3
    poisoned = {"on": True}
    pub = Faulty(
        await A.publisher(),
        fail=lambda t, k, e: (
            poisoned["on"] and t == topic and k == a and e["aggregateVersion"] == 1
        ),
    )
    await A.drain(sf, pub, max_attempts=max_attempts, rounds=max_attempts + 3)

    async def rows():
        async with sf() as s:
            res = await s.execute(
                text(
                    "SELECT aggregate_id, aggregate_version, status::text, attempts, last_error, event_id "
                    "FROM event_outbox"
                )
            )
            return {(r[0], int(r[1])): r for r in res.all()}

    rs = await rows()
    assert [rs[(b, v)][2] for v in (1, 2, 3)] == ["sent"] * 3
    assert rs[(a, 1)][2] == "failed"
    assert rs[(a, 1)][3] >= max_attempts
    assert "broker rejected" in rs[(a, 1)][4]
    assert rs[(a, 2)][2] == "pending"
    assert rs[(a, 3)][2] == "pending"
    main = await A.read_all(topic)
    assert [m for m in main if m[0] == a] == []
    assert [m[1]["aggregateVersion"] for m in main if m[0] == b] == [1, 2, 3]
    dlq = await A.read_all(topic + ".dlq")
    assert dlq
    assert dlq[0][1]["eventId"] == rs[(a, 1)][5]
    # dead-lettering does NOT unblock
    poisoned["on"] = False
    await A.drain(sf, pub, max_attempts=max_attempts, rounds=3)
    assert [m for m in await A.read_all(topic) if m[0] == a] == []
    # operator requeue: pending, attempts reset, last_error kept; then ordered publish
    assert await A.requeue(sf, rs[(a, 1)][5]) is True
    rs = await rows()
    assert rs[(a, 1)][2] == "pending"
    assert rs[(a, 1)][3] == 0
    assert "broker rejected" in rs[(a, 1)][4]
    await A.drain(sf, pub, max_attempts=max_attempts, rounds=5)
    assert [m[1]["aggregateVersion"] for m in await A.read_all(topic) if m[0] == a] == [
        1,
        2,
        3,
    ]
    final = await rows()
    assert [final[(a, v)][2] for v in (1, 2, 3)] == ["sent"] * 3


async def test_two_concurrent_relays_never_publish_the_same_row_twice(sf):
    topic = A.new_topic()
    await A.create_topic(topic)
    aggs = [A.type_id("org") for _ in range(10)]
    for agg in aggs:
        for v in (1, 2, 3):
            await enq(sf, topic, agg, v)
    pub = Faulty(await A.publisher(), delay=0.04)
    await asyncio.gather(
        A.drain(sf, pub, rounds=12, batch_size=4),
        A.drain(sf, pub, rounds=12, batch_size=4),
    )
    assert len(pub.sent) == 30
    assert len(set(pub.sent)) == 30
    assert (
        await A.scalar(sf, "SELECT count(*) FROM event_outbox WHERE status='sent'")
        == 30
    )
    msgs = await A.read_all(topic)
    for agg in aggs:
        assert [m[1]["aggregateVersion"] for m in msgs if m[0] == agg] == [1, 2, 3]
