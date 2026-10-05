"""THE ONLY FILE that knows `fuzefront_events`' API (slice B3). Adapt HERE when B2's signatures land."""
import json, os, pathlib, random, string, time, uuid
import pytest

ROOT = pathlib.Path(__file__).resolve().parents[3]
PG_URL = os.environ.get("DATABASE_URL")
BROKERS = os.environ.get("KAFKA_BROKERS", "localhost:9094")
INFRA_READY = bool(PG_URL)
SQL = pathlib.Path(__file__).resolve().parents[1] / "sql" / "schema.sql"

try:
    import fuzefront_events as pkg  # noqa
    PKG_AVAILABLE, _err = True, ""
except Exception as e:  # noqa
    pkg, PKG_AVAILABLE, _err = None, False, str(e)
PKG_REASON = f"RED pending packages/events-py (fuzefront-events, slice B2) - not importable: {_err}"

# RED-by-design until the package lands: xfail (non-strict) with the reason; real tests afterwards.
acc = pytest.mark.xfail(not PKG_AVAILABLE, reason=PKG_REASON, strict=False, run=PKG_AVAILABLE)
needs_infra = pytest.mark.skipif(not INFRA_READY, reason="DATABASE_URL not set (needs Postgres + Kafka; CI job provides them)")


def vectors(name):
    return json.loads((ROOT / "packages/conformance-vectors/events" / name).read_text())


def envelope_validator():
    import jsonschema
    schema = json.loads((ROOT / "contracts/events/envelope.v2.schema.json").read_text())
    return jsonschema.Draft202012Validator(schema, format_checker=jsonschema.FormatChecker())


def engine():
    from sqlalchemy import create_engine
    url = PG_URL.replace("postgres://", "postgresql+psycopg2://", 1) if PG_URL.startswith("postgres://") else PG_URL
    return create_engine(url)


def reset_schema(eng):
    raw = eng.raw_connection()
    try:
        cur = raw.cursor(); cur.execute(SQL.read_text()); raw.commit()
    finally:
        raw.close()


_B32 = "0123456789abcdefghjkmnpqrstvwxyz"
def rnd(): return "".join(random.choices(string.ascii_lowercase + string.digits, k=8))
def type_id(prefix): return f"{prefix}_0" + "".join(random.choices(_B32, k=25))
def new_topic(): return f"acc.t{rnd()}"


def raw_envelope(topic, aggregate_id, aggregate_version, payload=None, event_id=None, aggregate_type="organization"):
    return {
        "eventId": event_id or type_id("evt"), "topic": topic, "schemaVersion": 1,
        "aggregateType": aggregate_type, "aggregateId": aggregate_id, "aggregateVersion": aggregate_version,
        "producer": "acceptance-suite", "occurredAt": "2026-10-05T12:00:00Z",
        "correlationId": "corr-" + rnd(), "payload": payload if payload is not None else {"kind": "updated", "data": {}},
    }


# ---------- Kafka raw access (no package involvement) ----------
def create_topic(topic, partitions=1):
    from confluent_kafka.admin import AdminClient, NewTopic
    a = AdminClient({"bootstrap.servers": BROKERS})
    for f in a.create_topics([NewTopic(topic, partitions, 1), NewTopic(topic + ".dlq", 1, 1)]).values():
        f.result()

_producer = None
def produce_raw(topic, msgs):
    global _producer
    from confluent_kafka import Producer
    _producer = _producer or Producer({"bootstrap.servers": BROKERS})
    for key, value in msgs:
        _producer.produce(topic, key=key, value=json.dumps(value).encode())
    _producer.flush(30)

def read_all(topic, idle=4.0):
    from confluent_kafka import Consumer
    c = Consumer({"bootstrap.servers": BROKERS, "group.id": "acc-read-" + rnd(), "auto.offset.reset": "earliest"})
    c.subscribe([topic]); out = []; last = time.time()
    while time.time() - last < idle:
        m = c.poll(0.5)
        if m is None or m.error(): continue
        last = time.time()
        out.append((m.key().decode() if m.key() else None, json.loads(m.value())))
    c.close(); return out


# ---------- package adapter (ADAPT HERE when B2 lands) ----------
def build_event(topic, aggregate_type, aggregate_id, aggregate_version, payload):
    return pkg.build_event(topic=topic, aggregate_type=aggregate_type, aggregate_id=aggregate_id,
                           aggregate_version=aggregate_version, payload=payload,
                           producer="acceptance-suite", correlation_id="corr-" + rnd(), schema_version=1)

def enqueue(session, event):
    pkg.enqueue_event(session, event)

def real_publisher():
    return lambda topic, key, envelope: produce_raw(topic, [(key, envelope)])

def drain(eng, publish, max_attempts=3, rounds=10):
    for _ in range(rounds):
        pkg.drain_outbox_once(eng, publish=publish, max_attempts=max_attempts)

class Handle:
    def __init__(self, c): self.c = c
    def stop(self): self.c.stop()

def start_consumer(group_id, topics, eng, handler):
    """handler(envelope, conn) runs inside the consumer's dedupe transaction (conn = SQLAlchemy Connection)."""
    c = pkg.create_consumer(group_id=group_id, topics=topics, db=eng, handler=handler, brokers=BROKERS, from_beginning=True)
    c.start(); time.sleep(3)
    return Handle(c)

def wait_for(fn, secs=40, what="condition"):
    end = time.time() + secs
    while time.time() < end:
        if fn(): return
        time.sleep(0.3)
    raise TimeoutError(what)

def projection_handler(env, conn):
    from sqlalchemy import text
    conn.execute(text("INSERT INTO acc_effects(event_key, aggregate_id) VALUES (:k, :a)"),
                 {"k": env.get("eventId") or "v1", "a": env.get("aggregateId")})
    if not env.get("aggregateId"): return
    p = env.get("payload") or {}; kind = p.get("kind")
    conn.execute(text("""INSERT INTO acc_proj(aggregate_id, version, deleted, data) VALUES (:a,:v,:d,CAST(:data AS jsonb))
                         ON CONFLICT (aggregate_id) DO UPDATE SET version=:v, deleted=:d, data=CAST(:data AS jsonb)"""),
                 {"a": env["aggregateId"], "v": env["aggregateVersion"], "d": kind == "deleted",
                  "data": None if kind == "deleted" else json.dumps(p.get("data"))})

def proj_state(eng):
    from sqlalchemy import text
    with eng.connect() as c:
        return {r[0]: {"version": int(r[1]), "deleted": r[2], "data": r[3]} for r in c.execute(text("SELECT aggregate_id, version, deleted, data FROM acc_proj"))}

def scalar(eng, sql, **kw):
    from sqlalchemy import text
    with eng.connect() as c:
        return c.execute(text(sql), kw).scalar()
