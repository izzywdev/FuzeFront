"""THE ONLY FILE that knows `fuzefront_events`' API (slice B3). Adapt HERE when B2's signatures land."""

import asyncio
import json
import os
import pathlib
import random
import string
import time

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[3]
PG_URL = os.environ.get("DATABASE_URL")
BROKERS = os.environ.get("KAFKA_BROKERS", "")
# CI sets KAFKA_BROKERS (real broker). Without it an in-process bus honouring the same package ports
# (Publisher / EventProcessor.process) is used - fast local verification only.
USE_KAFKA = bool(BROKERS)
INFRA_READY = bool(PG_URL)
SQL = pathlib.Path(__file__).resolve().parents[1] / "sql" / "schema.sql"

try:
    import fuzefront_events as pkg

    PKG_AVAILABLE, _err = True, ""
except Exception as e:  # noqa
    pkg, PKG_AVAILABLE, _err = None, False, str(e)
PKG_REASON = f"RED pending packages/events-py (fuzefront-events, slice B2) - not importable: {_err}"

# RED-by-design until the package lands: xfail (non-strict) with the reason; real tests afterwards.
acc = pytest.mark.xfail(
    not PKG_AVAILABLE, reason=PKG_REASON, strict=False, run=PKG_AVAILABLE
)
needs_infra = pytest.mark.skipif(
    not INFRA_READY,
    reason="DATABASE_URL not set (needs Postgres + Kafka; CI job provides them)",
)


def vectors(name):
    return json.loads((ROOT / "packages/conformance-vectors/events" / name).read_text())


def envelope_validator():
    import jsonschema

    schema = json.loads((ROOT / "contracts/events/envelope.v2.schema.json").read_text())
    return jsonschema.Draft202012Validator(
        schema, format_checker=jsonschema.FormatChecker()
    )


def _url(driver):
    base = PG_URL.split("://", 1)[1]
    return f"postgresql+{driver}://{base}"


def async_session_factory():
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    eng = create_async_engine(_url("asyncpg"))
    return eng, async_sessionmaker(eng, expire_on_commit=False)


async def reset_schema():
    import asyncpg

    conn = await asyncpg.connect("postgresql://" + PG_URL.split("://", 1)[1])
    try:
        await conn.execute(
            SQL.read_text()
        )  # asyncpg runs multi-statement scripts without params
    finally:
        await conn.close()


_B32 = "0123456789abcdefghjkmnpqrstvwxyz"


def rnd():
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=8))


def type_id(prefix):
    return f"{prefix}_0" + "".join(random.choices(_B32, k=25))


def new_topic():
    return f"acc.t{rnd()}"


def raw_envelope(
    topic,
    aggregate_id,
    aggregate_version,
    payload=None,
    event_id=None,
    aggregate_type="organization",
):
    return {
        "eventId": event_id or type_id("evt"),
        "topic": topic,
        "schemaVersion": 1,
        "aggregateType": aggregate_type,
        "aggregateId": aggregate_id,
        "aggregateVersion": aggregate_version,
        "producer": "acceptance-suite",
        "occurredAt": "2026-10-05T12:00:00Z",
        "correlationId": "corr-" + rnd(),
        "payload": payload if payload is not None else {"kind": "updated", "data": {}},
    }


# ---------- message bus: real Kafka (CI) or in-process (local) ----------
_mem: dict = {}  # topic -> [ {key, value(bytes), headers, partition, offset} ]
_listeners: dict = {}  # topic -> [async callable(msg_dict)]


async def _mem_push(topic, key, value, headers=()):
    lst = _mem.setdefault(topic, [])
    m = {
        "key": key,
        "value": value,
        "headers": {k: (v.decode() if isinstance(v, bytes) else v) for k, v in headers},
        "partition": 0,
        "offset": len(lst),
    }
    lst.append(m)
    for ls in list(_listeners.get(topic, [])):
        await ls(m)  # sequential, append order (single partition)


class MemPublisher:
    async def send(self, topic, key, value, headers=()):
        await _mem_push(
            topic, key.decode() if isinstance(key, bytes) else key, value, headers
        )


_kproducer = None


async def _kafka_publisher():
    global _kproducer
    if _kproducer is None:
        from fuzefront_events import AIOKafkaPublisher

        _kproducer = AIOKafkaPublisher(BROKERS)
        await _kproducer.start()
    return _kproducer


async def publisher():
    return await _kafka_publisher() if USE_KAFKA else MemPublisher()


async def create_topic(topic, partitions=1):
    if not USE_KAFKA:
        _mem.setdefault(topic, [])
        _mem.setdefault(topic + ".dlq", [])
        return
    from aiokafka.admin import AIOKafkaAdminClient, NewTopic

    admin = AIOKafkaAdminClient(bootstrap_servers=BROKERS)
    await admin.start()
    try:
        await admin.create_topics(
            [NewTopic(topic, partitions, 1), NewTopic(topic + ".dlq", 1, 1)]
        )
    finally:
        await admin.close()


async def produce_raw(topic, msgs):
    p = await publisher()
    for key, value in msgs:
        await p.send(topic, key.encode() if key else None, json.dumps(value).encode())


async def read_all_h(topic, idle=4.0):
    """-> [(key, value_dict, headers_dict)]"""
    if not USE_KAFKA:
        return [
            (m["key"], json.loads(m["value"]), m["headers"])
            for m in _mem.get(topic, [])
        ]
    from aiokafka import AIOKafkaConsumer

    c = AIOKafkaConsumer(
        topic,
        bootstrap_servers=BROKERS,
        group_id="acc-read-" + rnd(),
        auto_offset_reset="earliest",
        enable_auto_commit=False,
    )
    await c.start()
    out = []
    try:
        while True:
            batch = await c.getmany(timeout_ms=int(idle * 1000))
            if not batch:
                break
            for recs in batch.values():
                for m in recs:
                    out.append(
                        (
                            m.key.decode() if m.key else None,
                            json.loads(m.value),
                            {
                                k: (v.decode() if v else "")
                                for k, v in (m.headers or [])
                            },
                        )
                    )
    finally:
        await c.stop()
    return out


async def read_all(topic, idle=4.0):
    return [(k, v) for k, v, _ in await read_all_h(topic, idle)]


# ---------- package adapter (fuzefront_events; wired to packages/events-py on PR #1292) ----------
def build_event(topic, aggregate_type, aggregate_id, aggregate_version, payload):
    return pkg.build_event(
        topic=topic,
        aggregate_type=aggregate_type,
        aggregate_id=aggregate_id,
        aggregate_version=aggregate_version,
        payload=payload,
        producer="acceptance-suite",
        correlation_id="corr-" + rnd(),
        schema_version=1,
    )


async def enqueue(session, event):
    await pkg.enqueue_event_async(session, event)


async def drain(sf, pub, max_attempts=3, rounds=10, batch_size=20):
    for _ in range(rounds):
        await pkg.drain_once(sf, pub, max_attempts=max_attempts, batch_size=batch_size)


async def requeue(sf, event_id):
    async with sf() as s, s.begin():
        return await pkg.requeue_failed_event(s, event_id)


class Handle:
    def __init__(self, consumer, topics):
        self.c, self.topics, self.ls = consumer, topics, []

    async def stop(self):
        for t in self.topics:
            for ls in self.ls:
                if ls in _listeners.get(t, []):
                    _listeners[t].remove(ls)
        await self.c.stop()

    async def redeliver(self, topic, partition, offset, value):
        return await self.c.process(
            pkg.Message(topic, partition, offset, None, json.dumps(value).encode())
        )


async def start_consumer(group_id, topics, sf, handler, max_attempts=3):
    """handler(NormalizedEnvelope, AsyncSession) runs inside the dedupe transaction."""
    from sqlalchemy import text

    async def stored(session, env):
        r = (
            await session.execute(
                text("SELECT version FROM acc_proj WHERE aggregate_id=:a"),
                {"a": env.aggregate_id},
            )
        ).first()
        return int(r[0]) if r else None

    if USE_KAFKA:
        dlq = await _kafka_publisher()
        c = pkg.create_consumer(
            group_id,
            topics,
            sf,
            handler,
            bootstrap_servers=BROKERS,
            dlq=dlq,
            get_stored_version=stored,
            max_attempts=max_attempts,
            backoff_s=0.02,
        )
        await c.start()
        await asyncio.sleep(3)  # let the group join before producers send
        return Handle(c, topics)
    c = pkg.create_consumer(
        group_id,
        topics,
        sf,
        handler,
        dlq=MemPublisher(),
        get_stored_version=stored,
        max_attempts=max_attempts,
        backoff_s=0.02,
    )
    h = Handle(c, topics)
    for t in topics:

        async def ls(m, t=t):
            await c.process(
                pkg.Message(t, m["partition"], m["offset"], m["key"], m["value"])
            )

        _listeners.setdefault(t, []).append(ls)
        h.ls.append(ls)
        for m in list(_mem.get(t, [])):
            await ls(m)  # fromBeginning replay
    return h


async def wait_for(fn, secs=40, what="condition"):
    end = time.time() + secs
    while time.time() < end:
        r = fn()
        if asyncio.iscoroutine(r):
            r = await r
        if r:
            return
        await asyncio.sleep(0.1)
    raise TimeoutError(what)


async def projection_handler(env, session):
    from sqlalchemy import text

    await session.execute(
        text("INSERT INTO acc_effects(event_key, aggregate_id) VALUES (:k, :a)"),
        {"k": env.event_id or "v1", "a": env.aggregate_id},
    )
    if not env.aggregate_id:
        return
    p = env.payload or {}
    kind = p.get("kind")
    await session.execute(
        text(
            """INSERT INTO acc_proj(aggregate_id, version, deleted, data) VALUES (:a,:v,:d,CAST(:data AS jsonb))
               ON CONFLICT (aggregate_id) DO UPDATE SET version=:v, deleted=:d, data=CAST(:data AS jsonb)"""
        ),
        {
            "a": env.aggregate_id,
            "v": env.aggregate_version,
            "d": kind == "deleted",
            "data": None if kind == "deleted" else json.dumps(p.get("data")),
        },
    )


async def proj_state(sf):
    from sqlalchemy import text

    async with sf() as s:
        rows = (
            await s.execute(
                text("SELECT aggregate_id, version, deleted, data FROM acc_proj")
            )
        ).all()
        return {
            r[0]: {"version": int(r[1]), "deleted": r[2], "data": r[3]} for r in rows
        }


async def scalar(sf, sql, **kw):
    from sqlalchemy import text

    async with sf() as s:
        return (await s.execute(text(sql), kw)).scalar()


async def execute(sf, sql, **kw):
    from sqlalchemy import text

    async with sf() as s, s.begin():
        await s.execute(text(sql), kw)
