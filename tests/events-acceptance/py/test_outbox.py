import pytest
from sqlalchemy import text
import adapter as A

pytestmark = [A.needs_infra, A.acc]

def ev(topic, agg, v=1):
    return A.build_event(topic, "organization", agg, v, {"id": agg, "name": "Acme"})

def test_rollback_leaves_neither_state_nor_outbox_row_nor_message(eng):
    topic = A.new_topic(); A.create_topic(topic); agg = A.type_id("org")
    from sqlalchemy.orm import Session
    s = Session(eng)
    s.execute(text("INSERT INTO acc_business VALUES (:i,'Acme')"), {"i": agg}); A.enqueue(s, ev(topic, agg)); s.rollback(); s.close()
    assert A.scalar(eng, "SELECT count(*) FROM acc_business") == 0
    assert A.scalar(eng, "SELECT count(*) FROM event_outbox") == 0
    A.drain(eng, A.real_publisher())
    assert A.read_all(topic, 2.5) == []

def test_commit_writes_pending_row_with_contract_columns(eng):
    from sqlalchemy.orm import Session
    topic = A.new_topic(); agg = A.type_id("org")
    with Session(eng) as s, s.begin():
        s.execute(text("INSERT INTO acc_business VALUES (:i,'Acme')"), {"i": agg}); A.enqueue(s, ev(topic, agg))
    with eng.connect() as c:
        r = c.execute(text("SELECT topic, aggregate_type, aggregate_id, aggregate_version, status, attempts, event_id FROM event_outbox")).all()
    assert len(r) == 1
    assert (r[0][0], r[0][1], r[0][2], r[0][3], r[0][4], r[0][5]) == (topic, "organization", agg, 1, "pending", 0)
    import re; assert re.fullmatch(r"evt_[0-7][0-9a-hjkmnp-tv-z]{25}", r[0][6])

def test_crash_after_commit_before_relay_then_relay_publishes_exactly_once(eng):
    from sqlalchemy.orm import Session
    topic = A.new_topic(); A.create_topic(topic); agg = A.type_id("org")
    with Session(eng) as s, s.begin():
        A.enqueue(s, ev(topic, agg))
    event_id = A.scalar(eng, "SELECT event_id FROM event_outbox")
    A.drain(eng, A.real_publisher()); A.drain(eng, A.real_publisher())  # 2nd relay must not re-publish
    msgs = A.read_all(topic)
    assert len(msgs) == 1 and msgs[0][0] == agg and msgs[0][1]["eventId"] == event_id
    assert not list(A.envelope_validator().iter_errors(msgs[0][1]))
    assert A.scalar(eng, "SELECT status::text FROM event_outbox") == "sent"

def test_one_event_per_aggregate_version(eng):
    from sqlalchemy.orm import Session
    topic = A.new_topic(); agg = A.type_id("org")
    with Session(eng) as s, s.begin():
        A.enqueue(s, ev(topic, agg, 1))
    with pytest.raises(Exception):
        with Session(eng) as s, s.begin():
            A.enqueue(s, ev(topic, agg, 1))
    assert A.scalar(eng, "SELECT count(*) FROM event_outbox") == 1
