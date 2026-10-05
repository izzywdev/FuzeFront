import random
import pytest
import adapter as A

pytestmark = [A.needs_infra, A.acc]

def run(eng, events, topic=None, group=None):
    if topic is None:
        topic = A.new_topic(); A.create_topic(topic)
    calls = []
    def handler(env, conn):
        calls.append(env); A.projection_handler(env, conn)
    h = A.start_consumer(group or "acc-g-" + A.rnd(), [topic], eng, handler)
    sentinel = A.raw_envelope(topic, A.type_id("org"), 1, {"kind": "created", "data": {"s": 1}})
    A.produce_raw(topic, [(e.get("aggregateId"), e) for e in events + [sentinel]])
    A.wait_for(lambda: any(c.get("eventId") == sentinel["eventId"] for c in calls), 40, "sentinel consumed")
    h.stop()
    return topic, [c for c in calls if c.get("eventId") != sentinel["eventId"]], sentinel

def state(eng, sentinel):
    s = A.proj_state(eng); s.pop(sentinel["aggregateId"], None); return s

def test_case3_same_event_id_twice_effect_once(eng):
    topic = A.new_topic(); A.create_topic(topic)
    e = A.raw_envelope(topic, A.type_id("org"), 1, {"kind": "created", "data": {"n": 1}})
    _, calls, _ = run(eng, [e, e, e], topic)
    assert len([c for c in calls if c["eventId"] == e["eventId"]]) == 1
    assert A.scalar(eng, "SELECT count(*) FROM acc_effects WHERE event_key=:k", k=e["eventId"]) == 1
    assert A.scalar(eng, "SELECT count(*) FROM processed_events WHERE event_id=:k", k=e["eventId"]) == 1

@pytest.mark.parametrize("case", A.vectors("version-guard.json")["cases"], ids=lambda c: c["name"])
def test_case4_version_guard_vector(eng, case):
    topic = A.new_topic(); A.create_topic(topic)
    evs = [A.raw_envelope(topic, e["aggregateId"], e["aggregateVersion"], {"kind": e["kind"], "data": e["data"]}, event_id=e["eventId"]) for e in case["events"]]
    _, calls, sentinel = run(eng, evs, topic)
    applied = {c["eventId"] for c in calls}
    assert ["applied" if e["eventId"] in applied else "ignored" for e in evs] == case["expectedOutcomes"]
    assert state(eng, sentinel) == case["expectedFinalState"]

def history(topic):
    evs = []
    for i in range(6):
        agg = A.type_id("org")
        evs.append(A.raw_envelope(topic, agg, 1, {"kind": "created", "data": {"n": 1}}))
        for v in (2, 3, 4): evs.append(A.raw_envelope(topic, agg, v, {"kind": "updated", "data": {"n": v}}))
        if i % 2: evs.append(A.raw_envelope(topic, agg, 5, {"kind": "deleted", "data": None}))
    return evs

def test_case5_ordered_shuffled_replay_identical(eng):
    from sqlalchemy import text
    t1 = A.new_topic(); A.create_topic(t1); evs = history(t1)
    _, _, sentinel = run(eng, evs, t1)
    expected = {}
    for e in evs:
        cur = expected.get(e["aggregateId"])
        if cur is None or e["aggregateVersion"] > cur["version"]:
            expected[e["aggregateId"]] = {"version": e["aggregateVersion"], "deleted": e["payload"]["kind"] == "deleted", "data": e["payload"]["data"]}
    assert state(eng, sentinel) == expected
    with eng.begin() as c:  # from-scratch replay: wipe consumer state, brand-new group
        c.execute(text("DELETE FROM acc_proj")); c.execute(text("DELETE FROM processed_events")); c.execute(text("DELETE FROM acc_effects"))
    h = A.start_consumer("acc-replay-" + A.rnd(), [t1], eng, A.projection_handler)
    A.wait_for(lambda: len(A.proj_state(eng)) == len(expected) + 1, 40, "replay"); h.stop()
    assert state(eng, sentinel) == expected
    with eng.begin() as c:
        c.execute(text("DELETE FROM acc_proj")); c.execute(text("DELETE FROM processed_events")); c.execute(text("DELETE FROM acc_effects"))
    t2 = A.new_topic(); A.create_topic(t2)
    mixed = evs + evs[:5]; random.Random(42).shuffle(mixed)
    _, _, s2 = run(eng, [{**e, "topic": t2} for e in mixed], t2)
    assert state(eng, s2) == expected

def v1(topic):
    return {"version": "1.0", "topic": topic, "correlationId": "corr-v1-" + A.rnd(), "occurredAt": "2026-10-05T12:00:00Z", "payload": {"id": "x", "note": "legacy"}}

def test_case6_v1_envelope_still_consumed(eng):
    topic = A.new_topic(); A.create_topic(topic); m = v1(topic)
    _, calls, _ = run(eng, [m], topic)
    assert len(calls) == 1 and calls[0]["payload"] == m["payload"] and calls[0].get("eventId") is None

# The contract does not NAME the v1 fallback dedupe key; this asserts the behaviour any fallback must give.
def test_case6b_same_v1_message_redelivered_applied_once(eng):
    topic = A.new_topic(); A.create_topic(topic); m = v1(topic)
    _, calls, _ = run(eng, [m, m], topic)
    assert len(calls) == 1
