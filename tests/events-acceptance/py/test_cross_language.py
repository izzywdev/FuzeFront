"""Case 7 - cross-language: TS relay -> Python consumer and Python relay -> TS consumer.

Skipped-with-reason (never deleted) unless BOTH packages are importable AND a real broker is configured
(KAFKA_BROKERS); the two runtimes can only meet over Kafka.
"""

import asyncio
import importlib.util
import json
import os
import pathlib
import shutil
import subprocess

import adapter as A
import pytest

HERE = pathlib.Path(__file__).resolve().parents[1]
TS_PKG = (A.ROOT / "packages/events/package.json").exists()
PY_PKG = importlib.util.find_spec("fuzefront_events") is not None

pytestmark = [
    A.needs_infra,
    pytest.mark.skipif(
        not (TS_PKG and PY_PKG),
        reason=f"needs BOTH packages: packages/events present={TS_PKG}, fuzefront_events importable={PY_PKG}",
    ),
    pytest.mark.skipif(
        not A.USE_KAFKA, reason="cross-language needs a real broker (KAFKA_BROKERS)"
    ),
    pytest.mark.skipif(shutil.which("npx") is None, reason="npx not found"),
]


def cli(*args):
    r = subprocess.run(
        ["npx", "tsx", "cli.ts", *args],
        cwd=HERE / "ts",
        capture_output=True,
        text=True,
        timeout=120,
        env=os.environ,
        check=False,
    )
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout.strip().splitlines()[-1])


async def test_ts_relay_event_consumed_by_python_consumer(sf):
    topic = A.new_topic()
    await A.create_topic(topic)
    agg = A.type_id("org")
    calls = []

    async def handler(env, session):
        calls.append(env)
        await A.projection_handler(env, session)

    h = await A.start_consumer("acc-x-py-" + A.rnd(), [topic], sf, handler)
    out = await asyncio.to_thread(cli, "produce", topic, agg, "1")
    await A.wait_for(lambda: calls, 40, "python consumer got TS event")
    await h.stop()
    assert calls[0].event_id == out["eventId"]
    assert calls[0].aggregate_id == agg
    assert (await A.proj_state(sf))[agg]["version"] == 1
    assert (
        await A.scalar(
            sf,
            "SELECT count(*) FROM processed_events WHERE event_id=:e",
            e=out["eventId"],
        )
        == 1
    )


async def test_python_relay_event_consumed_by_ts_consumer(sf):
    topic = A.new_topic()
    await A.create_topic(topic)
    agg = A.type_id("org")
    async with sf() as s, s.begin():
        await A.enqueue(
            s,
            A.build_event(
                topic,
                "organization",
                agg,
                1,
                {"kind": "created", "data": {"from": "py"}},
            ),
        )
    event_id = await A.scalar(sf, "SELECT event_id FROM event_outbox")
    consume = asyncio.create_task(
        asyncio.to_thread(cli, "consume", topic, "acc-x-ts-" + A.rnd(), event_id)
    )
    await asyncio.sleep(8)  # the TS consumer joins the group first
    await A.drain(sf, await A.publisher())
    out = await consume
    assert out["proj"][agg]["version"] == 1
    assert out["processed"] == 1
