import json

import pytest
from conftest import VECTORS
from helpers import ev
from sqlalchemy import func, select

from fuzefront_events import (
    APPLIED,
    DEAD_LETTERED,
    DUPLICATE,
    EventProcessor,
    Message,
    ProjectionGuard,
    processed_events,
)
from fuzefront_events.testkit import InMemoryBroker, deliver, duplicate, replay, shuffle

DEDUPE = json.loads((VECTORS / "dedupe.json").read_text())["cases"]
GUARD = json.loads((VECTORS / "version-guard.json").read_text())["cases"]


def msg(envelope, offset=0, topic=None, partition=0):
    return Message(
        topic or envelope.get("topic", "a.b"), partition, offset, b"k", json.dumps(envelope).encode()
    )


def wire(event_id, agg="org_01h455vb4pex5vsknk084sn02q", version=1, data=None):
    e = ev(agg, version)
    e["eventId"] = event_id
    e["payload"] = data
    return e


@pytest.mark.parametrize("case", DEDUPE, ids=lambda c: c["name"])
async def test_dedupe_vectors(sf, case):
    effects: dict[str, int] = {}
    procs: dict[str, EventProcessor] = {}

    def proc(consumer):
        async def handler(env, session):
            effects[consumer] = effects.get(consumer, 0) + 1

        return procs.setdefault(consumer, EventProcessor(consumer, sf, handler))

    outcomes = []
    for i, d in enumerate(case["deliveries"]):
        outcomes.append(await proc(d["consumer"]).process(msg(wire(d["eventId"]), offset=i)))
    assert outcomes == case["expectedOutcomes"]
    assert effects == case["expectedEffects"]


@pytest.mark.parametrize("case", GUARD, ids=lambda c: c["name"])
async def test_version_guard_vectors_through_runtime(sf, case):
    guard = ProjectionGuard()

    async def stored(session, env):
        st = guard.state.get(env.aggregate_id)
        return st.version if st else None

    kinds = {}

    async def handler(env, session):
        k = kinds[env.event_id]
        out = guard.apply(env.aggregate_id, env.aggregate_version, k["kind"], k["data"])
        assert out == "applied"  # runtime must only call the handler for applicable events

    p = EventProcessor("g", sf, handler, get_stored_version=stored)
    got = []
    for i, e in enumerate(case["events"]):
        kinds[e["eventId"]] = e
        got.append(
            await p.process(msg(wire(e["eventId"], e["aggregateId"], e["aggregateVersion"]), offset=i))
        )
    assert got == case["expectedOutcomes"]
    assert {
        k: {"version": s.version, "deleted": s.deleted, "data": s.data} for k, s in guard.state.items()
    } == case["expectedFinalState"]


@pytest.mark.parametrize("case", GUARD, ids=lambda c: c["name"])
def test_version_guard_vectors_reference(case):
    g = ProjectionGuard()
    got = [g.apply(e["aggregateId"], e["aggregateVersion"], e["kind"], e["data"]) for e in case["events"]]
    assert got == case["expectedOutcomes"]


async def test_duplicate_shuffle_replay_converge(sf):
    seen = []

    async def handler(env, session):
        seen.append(env.aggregate_version)

    async def stored(session, env):
        return max(seen, default=0)

    p = EventProcessor("c", sf, handler, get_stored_version=stored)
    base = [msg(wire(f"evt_01h455vb4pex5vsknk084sn0{i}q", version=i), offset=i) for i in range(1, 6)]
    stream = replay(duplicate(shuffle(base, seed=7), times=2))
    await deliver(p, stream)
    assert seen == sorted(seen) and len(seen) == len(set(seen))  # applied versions only ever increase
    assert max(seen) == 5


async def test_handler_failure_rolls_back_dedupe_row_then_retries(sf):
    calls = {"n": 0}

    async def handler(env, session):
        calls["n"] += 1
        if calls["n"] < 3:
            raise RuntimeError("boom")

    p = EventProcessor("c", sf, handler, backoff_s=0, max_attempts=5)
    assert await p.process(msg(wire("evt_01h455vb4pex5vsknk084sn02q"))) == APPLIED
    assert calls["n"] == 3
    async with sf() as s:
        assert (await s.execute(select(func.count()).select_from(processed_events))).scalar() == 1


async def test_dlq_after_bounded_retries_and_effect_not_committed(sf):
    dlq = InMemoryBroker()

    async def handler(env, session):
        raise RuntimeError("always")

    p = EventProcessor("c", sf, handler, dlq=dlq, backoff_s=0, max_attempts=3)
    m = msg(wire("evt_01h455vb4pex5vsknk084sn02q"), topic="identity.org.updated")
    assert await p.process(m) == DEAD_LETTERED
    [d] = dlq.messages("identity.org.updated.dlq")
    assert d.value == m.value
    async with sf() as s:
        assert (await s.execute(select(func.count()).select_from(processed_events))).scalar() == 0


async def test_invalid_envelope_goes_to_dlq_without_calling_handler(sf):
    dlq = InMemoryBroker()
    called = []

    async def handler(env, session):
        called.append(1)

    p = EventProcessor("c", sf, handler, dlq=dlq)
    bad = Message("a.b", 0, 0, None, b'{"eventId":"evt_x","topic":"a.b"}')
    garbage = Message("a.b", 0, 1, None, b"\xff not json")
    assert await deliver(p, [bad, garbage]) == [DEAD_LETTERED, DEAD_LETTERED]
    assert not called and len(dlq.messages("a.b.dlq")) == 2


async def test_v1_fallback_dedupe_key_topic_partition_offset(sf):
    n = []

    async def handler(env, session):
        n.append(env.envelope_version)

    p = EventProcessor("c", sf, handler)
    v1 = {
        "version": "1.0",
        "topic": "a.b",
        "correlationId": "c",
        "occurredAt": "2026-10-05T12:00:00Z",
        "payload": {},
    }
    body = json.dumps(v1).encode()
    out = await deliver(
        p,
        [
            Message("a.b", 0, 5, None, body),
            Message("a.b", 0, 5, None, body),
            Message("a.b", 1, 5, None, body),
            Message("a.b", 0, 6, None, body),
        ],
    )
    assert out == [APPLIED, DUPLICATE, APPLIED, APPLIED] and n == [1, 1, 1]
    async with sf() as s:
        keys = {r[0] for r in (await s.execute(select(processed_events.c.event_id))).all()}
    assert keys == {"a.b:0:5", "a.b:1:5", "a.b:0:6"}
