"""Case 7 - cross-language: TS relay -> Python consumer and Python relay -> TS consumer.
Skipped-with-reason (never deleted) unless BOTH packages are present; infra via DATABASE_URL / KAFKA_BROKERS."""
import json, os, pathlib, shutil, subprocess, sys
import pytest
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "py"))
import adapter as A  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

HERE = pathlib.Path(__file__).resolve().parents[1]
TS_PKG = (A.ROOT / "packages/events/package.json").exists()
try:
    import importlib.util; PY_PKG = importlib.util.find_spec("fuzefront_events") is not None
except Exception:  # noqa
    PY_PKG = False

pytestmark = [
    A.needs_infra,
    pytest.mark.skipif(not (TS_PKG and PY_PKG), reason=f"needs BOTH packages: packages/events (B1) present={TS_PKG}, packages/events-py (B2) importable={PY_PKG}"),
    pytest.mark.skipif(shutil.which("npx") is None, reason="npx not found"),
]

def cli(*args):
    r = subprocess.run(["npx", "tsx", "cli.ts", *args], cwd=HERE / "ts", capture_output=True, text=True, timeout=120, env=os.environ)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout.strip().splitlines()[-1])

def test_ts_relay_event_consumed_by_python_consumer():
    eng = A.engine(); A.reset_schema(eng)
    topic = A.new_topic(); A.create_topic(topic); agg = A.type_id("org"); calls = []
    h = A.start_consumer("acc-x-py-" + A.rnd(), [topic], eng, lambda env, conn: (calls.append(env), A.projection_handler(env, conn)))
    out = cli("produce", topic, agg, "1")
    A.wait_for(lambda: calls, 40, "python consumer got TS event"); h.stop()
    assert calls[0]["eventId"] == out["eventId"] and calls[0]["aggregateId"] == agg
    assert A.proj_state(eng)[agg]["version"] == 1
    assert A.scalar(eng, "SELECT count(*) FROM processed_events WHERE event_id=:e", e=out["eventId"]) == 1

def test_python_relay_event_consumed_by_ts_consumer():
    eng = A.engine(); A.reset_schema(eng)
    topic = A.new_topic(); A.create_topic(topic); agg = A.type_id("org")
    with Session(eng) as s, s.begin():
        A.enqueue(s, A.build_event(topic, "organization", agg, 1, {"kind": "created", "data": {"from": "py"}}))
    event_id = A.scalar(eng, "SELECT event_id FROM event_outbox")
    import threading
    box = {}
    t = threading.Thread(target=lambda: box.update(out=cli("consume", topic, "acc-x-ts-" + A.rnd(), event_id))); t.start()
    import time; time.sleep(8)  # TS consumer joins the group first
    A.drain(eng, A.real_publisher()); t.join(90)
    assert box["out"]["proj"][agg]["version"] == 1 and box["out"]["processed"] == 1
