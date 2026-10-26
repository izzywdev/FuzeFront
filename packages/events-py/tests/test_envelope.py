import json
from pathlib import Path

import pytest
from conftest import REPO, VECTORS

from fuzefront_events import (
    EnvelopeError,
    build_event,
    load_v2_schema,
    parse_envelope,
    partition_key,
    validate_envelope,
)

VALID = json.loads((VECTORS / "envelopes.valid.json").read_text())["vectors"]
INVALID = json.loads((VECTORS / "envelopes.invalid.json").read_text())["vectors"]
PKG_SCHEMA = Path(__file__).resolve().parents[1] / "fuzefront_events" / "envelope.v2.schema.json"
ORG = "org_01h455vb4pex5vsknk084sn02q"


def test_vendored_schema_is_byte_identical_to_contract():
    contract = REPO / "contracts" / "events" / "envelope.v2.schema.json"
    assert PKG_SCHEMA.read_bytes() == contract.read_bytes()
    assert load_v2_schema()["title"] == "FuzeEnvelopeV2"


@pytest.mark.parametrize("v", VALID, ids=lambda v: v["name"])
def test_valid_vectors(v):
    assert validate_envelope(v["envelope"]) == []
    r = parse_envelope(v["envelope"])
    assert r.success and r.envelope.envelope_version == 2
    assert r.envelope.schema_version == str(v["envelope"]["schemaVersion"])
    assert partition_key(v["envelope"]) == v["envelope"]["aggregateId"]


@pytest.mark.parametrize("v", INVALID, ids=lambda v: v["name"])
def test_invalid_vectors(v):
    assert validate_envelope(v["envelope"]) != [], v["why"]
    r = parse_envelope(v["envelope"])
    # same routing as TS: v2-only key => v2 parser. v1-fields-mixed-in etc. must still fail.
    assert not r.success, v["why"]


def test_v1_normalizes_and_half_v2_is_rejected():
    v1 = {
        "version": "1.0",
        "topic": "a.b",
        "correlationId": "c",
        "occurredAt": "2026-10-05T12:00:00Z",
        "payload": {},
    }
    r = parse_envelope(v1)
    assert r.success and r.envelope.envelope_version == 1 and r.envelope.schema_version == "1.0"
    assert r.envelope.event_id is None and r.envelope.aggregate_version is None
    assert not parse_envelope({**v1, "eventId": "evt_01h455vb4pex5vsknk084sn02q"}).success
    assert not parse_envelope({**v1, "producer": "x"}).success
    assert not parse_envelope({**v1, "extra": 1}).success
    assert not parse_envelope("nope").success and not parse_envelope([]).success


def test_build_event_mints_event_id_and_validates():
    e = build_event(
        topic="identity.org.updated",
        aggregate_type="organization",
        aggregate_id=ORG,
        aggregate_version=2,
        producer="svc",
        payload={"a": 1},
        correlation_id="c1",
    )
    assert e["eventId"].startswith("evt_") and validate_envelope(e) == []
    assert e["occurredAt"].endswith("Z")
    assert (
        build_event(
            topic="a.b",
            aggregate_type="x",
            aggregate_id=ORG,
            aggregate_version=1,
            producer="s",
            payload=None,
            correlation_id="c",
        )["eventId"]
        != e["eventId"]
    )
    with pytest.raises(EnvelopeError):
        build_event(
            topic="a.b",
            aggregate_type="x",
            aggregate_id="not-a-typeid",
            aggregate_version=1,
            producer="s",
            payload={},
            correlation_id="c",
        )
    with pytest.raises(EnvelopeError):
        build_event(
            topic="a.b",
            aggregate_type="x",
            aggregate_id=ORG,
            aggregate_version=0,
            producer="s",
            payload={},
            correlation_id="c",
        )
