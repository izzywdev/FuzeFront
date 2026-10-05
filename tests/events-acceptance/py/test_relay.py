import pytest
from sqlalchemy.orm import Session
import adapter as A

pytestmark = [A.needs_infra, A.acc]

def enq(eng, topic, agg, v):
    with Session(eng) as s, s.begin():
        A.enqueue(s, A.build_event(topic, "organization", agg, v, {"id": agg, "v": v}))

def test_per_aggregate_version_order_regardless_of_insertion_order(eng):
    topic = A.new_topic(); A.create_topic(topic); a, b = A.type_id("org"), A.type_id("org")
    for agg, v in [(a, 3), (b, 1), (a, 1), (b, 2), (a, 2), (a, 4)]: enq(eng, topic, agg, v)
    A.drain(eng, A.real_publisher())
    msgs = A.read_all(topic)
    assert len(msgs) == 6
    assert [m[1]["aggregateVersion"] for m in msgs if m[0] == a] == [1, 2, 3, 4]
    assert [m[1]["aggregateVersion"] for m in msgs if m[0] == b] == [1, 2]

def test_failed_head_blocks_same_aggregate_not_others_then_dlq(eng):
    from sqlalchemy import text
    topic = A.new_topic(); A.create_topic(topic); a, b = A.type_id("org"), A.type_id("org")
    for v in (1, 2, 3): enq(eng, topic, a, v); enq(eng, topic, b, v)
    real = A.real_publisher(); MAX = 3
    def failing(t, key, env):
        if t == topic and key == a and env["aggregateVersion"] == 1: raise RuntimeError("broker rejected")
        return real(t, key, env)
    A.drain(eng, failing, max_attempts=MAX, rounds=MAX + 2)
    with eng.connect() as c:
        rows = {(r[0], int(r[1])): (r[2], r[3], r[4]) for r in c.execute(text(
            "SELECT aggregate_id, aggregate_version, status::text, attempts, event_id FROM event_outbox"))}
    assert all(rows[(b, v)][0] == "sent" for v in (1, 2, 3))
    assert rows[(a, 1)][0] == "failed" and rows[(a, 1)][1] >= MAX
    assert rows[(a, 2)][0] == "pending" and rows[(a, 3)][0] == "pending"
    main = A.read_all(topic)
    assert [m for m in main if m[0] == a] == []
    assert [m[1]["aggregateVersion"] for m in main if m[0] == b] == [1, 2, 3]
    dlq = A.read_all(topic + ".dlq")
    assert dlq and rows[(a, 1)][2] in str(dlq[0][1])
