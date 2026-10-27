import random
import re

import adapter as A
import pytest

pytestmark = [A.needs_infra, A.acc]


async def run(sf, events, topic=None, group=None, handler=None):
    if topic is None:
        topic = A.new_topic()
        await A.create_topic(topic)
    calls = []

    async def h(env, session):
        calls.append(env)
        await (handler or A.projection_handler)(env, session)

    hd = await A.start_consumer(group or "acc-g-" + A.rnd(), [topic], sf, h)
    sentinel = A.raw_envelope(
        topic, A.type_id("org"), 1, {"kind": "created", "data": {"s": 1}}
    )
    await A.produce_raw(topic, [(e.get("aggregateId"), e) for e in [*events, sentinel]])
    await A.wait_for(
        lambda: any(c.event_id == sentinel["eventId"] for c in calls),
        40,
        "sentinel consumed",
    )
    await hd.stop()
    return topic, [c for c in calls if c.event_id != sentinel["eventId"]], sentinel, hd


async def state(sf, sentinel):
    s = await A.proj_state(sf)
    s.pop(sentinel["aggregateId"], None)
    return s


async def test_case3_same_event_id_twice_effect_once(sf):
    topic = A.new_topic()
    await A.create_topic(topic)
    e = A.raw_envelope(
        topic, A.type_id("org"), 1, {"kind": "created", "data": {"n": 1}}
    )
    _, calls, _, _ = await run(sf, [e, e, e], topic)
    assert len([c for c in calls if c.event_id == e["eventId"]]) == 1
    assert (
        await A.scalar(
            sf, "SELECT count(*) FROM acc_effects WHERE event_key=:k", k=e["eventId"]
        )
        == 1
    )
    assert (
        await A.scalar(
            sf,
            "SELECT count(*) FROM processed_events WHERE event_id=:k",
            k=e["eventId"],
        )
        == 1
    )


@pytest.mark.parametrize(
    "case", A.vectors("version-guard.json")["cases"], ids=lambda c: c["name"]
)
async def test_case4_version_guard_vector(sf, case):
    topic = A.new_topic()
    await A.create_topic(topic)
    evs = [
        A.raw_envelope(
            topic,
            e["aggregateId"],
            e["aggregateVersion"],
            {"kind": e["kind"], "data": e["data"]},
            event_id=e["eventId"],
        )
        for e in case["events"]
    ]
    _, calls, sentinel, _ = await run(sf, evs, topic)
    applied = {c.event_id for c in calls}
    assert ["applied" if e["eventId"] in applied else "ignored" for e in evs] == case[
        "expectedOutcomes"
    ]
    assert await state(sf, sentinel) == case["expectedFinalState"]
    for e in evs:  # IGNORED events are still recorded in processed_events (tables.md)
        assert (
            await A.scalar(
                sf,
                "SELECT count(*) FROM processed_events WHERE event_id=:k",
                k=e["eventId"],
            )
            == 1
        )


def history(topic):
    evs = []
    for i in range(6):
        agg = A.type_id("org")
        evs.append(A.raw_envelope(topic, agg, 1, {"kind": "created", "data": {"n": 1}}))
        for v in (2, 3, 4):
            evs.append(
                A.raw_envelope(topic, agg, v, {"kind": "updated", "data": {"n": v}})
            )
        if i % 2:
            evs.append(A.raw_envelope(topic, agg, 5, {"kind": "deleted", "data": None}))
    return evs


async def wipe(sf):
    for t in ("acc_proj", "processed_events", "acc_effects"):
        await A.execute(sf, f"DELETE FROM {t}")


async def test_case5_ordered_shuffled_replay_identical(sf):
    t1 = A.new_topic()
    await A.create_topic(t1)
    evs = history(t1)
    _, _, sentinel, _ = await run(sf, evs, t1)
    expected = {}
    for e in evs:
        cur = expected.get(e["aggregateId"])
        if cur is None or e["aggregateVersion"] > cur["version"]:
            expected[e["aggregateId"]] = {
                "version": e["aggregateVersion"],
                "deleted": e["payload"]["kind"] == "deleted",
                "data": e["payload"]["data"],
            }
    assert await state(sf, sentinel) == expected
    await wipe(sf)  # from-scratch replay: wipe consumer state, brand-new group
    h = await A.start_consumer("acc-replay-" + A.rnd(), [t1], sf, A.projection_handler)

    async def done():
        return len(await A.proj_state(sf)) == len(expected) + 1

    await A.wait_for(done, 40, "replay")
    await h.stop()
    assert await state(sf, sentinel) == expected
    await wipe(sf)
    t2 = A.new_topic()
    await A.create_topic(t2)
    mixed = evs + evs[:5]
    random.Random(42).shuffle(mixed)
    _, _, s2, _ = await run(sf, [{**e, "topic": t2} for e in mixed], t2)
    assert await state(sf, s2) == expected


def v1(topic):
    return {
        "version": "1.0",
        "topic": topic,
        "correlationId": "corr-v1-" + A.rnd(),
        "occurredAt": "2026-10-05T12:00:00Z",
        "payload": {"id": "x", "note": "legacy"},
    }


async def test_case6_v1_envelope_still_consumed(sf):
    topic = A.new_topic()
    await A.create_topic(topic)
    m = v1(topic)
    _, calls, _, _ = await run(sf, [m], topic)
    assert len(calls) == 1
    assert calls[0].payload == m["payload"]
    assert calls[0].event_id is None


# tables.md: v1 dedupe key is <topic>:<partition>:<offset>; absorbs redelivery of the SAME record only.
async def test_case6b_v1_dedupe_key_is_topic_partition_offset(sf):
    topic = A.new_topic()
    await A.create_topic(topic)
    m = v1(topic)
    calls = []

    async def h(env, s):
        calls.append(env)
        await A.projection_handler(env, s)

    hd = await A.start_consumer("acc-v1-" + A.rnd(), [topic], sf, h)
    await A.produce_raw(topic, [(None, m)])
    await A.wait_for(lambda: len(calls) == 1, 40, "v1 consumed")
    key = await A.scalar(sf, "SELECT event_id FROM processed_events")
    mt = re.fullmatch(re.escape(topic) + r":(\d+):(\d+)", key)
    assert mt, key
    assert await hd.redeliver(topic, int(mt[1]), int(mt[2]), m) == "duplicate"
    assert await A.scalar(sf, "SELECT count(*) FROM acc_effects") == 1
    await A.produce_raw(
        topic, [(None, m)]
    )  # same payload, NEW record -> different key (documented limit)
    await A.wait_for(lambda: len(calls) == 2, 40, "second record consumed")
    await hd.stop()
    assert await A.scalar(sf, "SELECT count(*) FROM processed_events") == 2


async def test_consumer_handler_failure_retried_rolled_back_dead_lettered_and_flow_continues(
    sf,
):
    topic = A.new_topic()
    await A.create_topic(topic)
    bad = A.raw_envelope(
        topic, A.type_id("org"), 1, {"kind": "created", "data": {"poison": True}}
    )
    good = A.raw_envelope(
        topic, A.type_id("org"), 1, {"kind": "created", "data": {"ok": True}}
    )
    attempts = []

    async def handler(env, s):
        await A.projection_handler(env, s)
        if env.event_id == bad["eventId"]:
            attempts.append(1)
            raise RuntimeError("handler boom")

    _, calls, _, _ = await run(sf, [bad, good], topic, handler=handler)
    assert len(attempts) >= 2
    assert any(c.event_id == good["eventId"] for c in calls)
    assert (
        await A.scalar(
            sf, "SELECT count(*) FROM acc_effects WHERE event_key=:k", k=bad["eventId"]
        )
        == 0
    )
    assert (
        await A.scalar(
            sf,
            "SELECT count(*) FROM acc_proj WHERE aggregate_id=:a",
            a=bad["aggregateId"],
        )
        == 0
    )
    assert (
        await A.scalar(
            sf,
            "SELECT count(*) FROM processed_events WHERE event_id=:k",
            k=bad["eventId"],
        )
        == 0
    )
    dlq = await A.read_all_h(topic + ".dlq")
    assert dlq
    assert dlq[0][1]["eventId"] == bad["eventId"]
    assert "handler boom" in dlq[0][2].get("x-error", "")
