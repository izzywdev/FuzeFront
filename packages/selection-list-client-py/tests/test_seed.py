"""
Unit tests for the seed-request builder.

Pinned to the SAME golden fixtures as the Zod schema tests (shared/) and the
TypeScript helper tests (selection-list-client/), so the three cannot drift
apart without a red test. Pure functions -- no Kafka, no network.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

import pytest
from fuzefront_selection_list_client import (
    SEED_LIMITS,
    SEED_REQUESTED_TOPIC,
    SeedRequestValidationError,
    build_seed_request,
    build_seed_request_envelope,
    seed_request_kafka_key,
)

_REPO = Path(__file__).resolve().parents[3]
_FIXTURES = _REPO / "shared" / "tests" / "fixtures" / "selection-lists"


def _load(name: str) -> Any:
    return json.loads((_FIXTURES / name).read_text(encoding="utf-8"))


def _kwargs() -> dict[str, Any]:
    raw = _load("seed-request.input.json")
    return {
        "request_id": raw["requestId"],
        "organization_id": raw["organizationId"],
        "app": raw["app"],
        "service": raw["service"],
        "pack_key": raw["packKey"],
        "pack_version": raw["packVersion"],
        "service_token": raw["serviceToken"],
        "trigger": raw["trigger"],
        "lists": raw["lists"],
    }


def _issues(**kwargs: Any) -> list[str]:
    with pytest.raises(SeedRequestValidationError) as exc:
        build_seed_request(**kwargs)
    return [f"{i['path']}: {i['message']}" for i in exc.value.issues]


def test_produces_the_golden_payload() -> None:
    assert build_seed_request(**_kwargs()) == _load("seed-request.expected.json")


def test_defaults() -> None:
    kw = _kwargs()
    del kw["trigger"]
    payload = build_seed_request(**kw)
    assert payload["scope"] == "org"
    assert payload["trigger"] == "app-installed"
    assert payload["lists"][0]["sourceLocale"] == "en"
    assert "userId" not in payload


def test_does_not_mutate_input() -> None:
    kw = _kwargs()
    before = copy.deepcopy(kw)
    build_seed_request(**kw)
    assert kw == before


def test_rejects_smuggled_ids() -> None:
    kw = _kwargs()
    kw["lists"][0]["id"] = "front_sl_01h455vb4pex5vsknk084sn02q"
    kw["lists"][0]["items"][0]["id"] = "front_sli_01h455vb4pex5vsknk084sn02q"
    issues = _issues(**kw)
    assert "lists.0.id: ids are minted by the service; do not send one" in issues
    assert (
        "lists.0.items.0.id: ids are minted by the service; do not send one" in issues
    )


def test_namespace_prefix_default_and_override() -> None:
    kw = _kwargs()
    kw["lists"][0]["key"] = "deal-stages"
    assert 'lists.0.key: must start with the namespace prefix "fuzecrm-"' in _issues(
        **kw
    )
    build_seed_request(**kw, key_prefix="")


def test_platform_source_is_reserved() -> None:
    kw = _kwargs()
    kw["app"] = "platform"
    assert 'source.app: "platform" is reserved for the service\'s own packs' in _issues(
        **kw, key_prefix=""
    )


def test_bare_uuid_org_is_rejected() -> None:
    kw = _kwargs()
    kw["organization_id"] = "0195a8f2-7c1e-7b3a-9f00-1a2b3c4d5e6f"
    assert any(m.startswith("organizationId:") for m in _issues(**kw))


def test_scope_user_rules() -> None:
    assert 'userId: is required when scope is "user"' in _issues(
        **_kwargs(), scope="user"
    )
    ok = build_seed_request(
        **_kwargs(), scope="user", user_id="usr_01h455vb4pex5vsknk084sn02q"
    )
    assert ok["userId"] == "usr_01h455vb4pex5vsknk084sn02q"
    assert 'userId: must be omitted when scope is "org"' in _issues(
        **_kwargs(), user_id="usr_01h455vb4pex5vsknk084sn02q"
    )


def test_duplicates_and_source_locale_translation() -> None:
    kw = _kwargs()
    kw["lists"][1]["key"] = kw["lists"][0]["key"]
    kw["lists"][0]["items"][1]["code"] = "LEAD"
    kw["lists"][0]["translations"] = [
        {"locale": "en", "name": "x"},
        {"locale": "es", "name": "a"},
        {"locale": "es", "name": "b"},
    ]
    issues = _issues(**kw)
    assert 'lists.1.key: duplicate list key "fuzecrm-deal-stages"' in issues
    assert (
        'lists.0.items.1.code: duplicate item code "LEAD" in list "fuzecrm-deal-stages"'
        in issues
    )
    assert (
        'lists.0.translations.0.locale: "en" is the source locale; put that text in name'
        in issues
    )
    assert 'lists.0.translations.2.locale: duplicate locale "es"' in issues


def test_reports_every_problem() -> None:
    kw = _kwargs()
    kw.update(request_id="", pack_version=0, service_token="")
    assert len(_issues(**kw)) >= 3


def test_count_ceilings() -> None:
    kw = _kwargs()
    kw["lists"] = [
        {"key": f"fuzecrm-l{n}", "name": f"L{n}", "items": []}
        for n in range(SEED_LIMITS["MAX_LISTS_PER_SEED"] + 1)
    ]
    assert "lists: at most 20 lists per request" in _issues(**kw)

    kw = _kwargs()
    kw["lists"] = [
        {
            "key": f"fuzecrm-l{l}",
            "name": f"L{l}",
            "items": [{"code": f"C{n}", "label": f"C{n}"} for n in range(401)],
        }
        for l in range(5)
    ]
    assert any("items in total" in m for m in _issues(**kw))


def test_oversized_request() -> None:
    kw = _kwargs()
    kw["lists"] = [
        {
            "key": f"fuzecrm-l{l}",
            "name": f"L{l}",
            "items": [
                {"code": f"C{n}", "label": "x" * 200, "description": "y" * 300}
                for n in range(500)
            ],
        }
        for l in range(4)
    ]
    assert any("bytes" in m for m in _issues(**kw))


def test_envelope_and_key() -> None:
    payload = build_seed_request(**_kwargs())
    env = build_seed_request_envelope(
        payload, correlation_id="c-1", occurred_at="2026-10-04T12:00:00.000Z"
    )
    assert env == {
        "version": "1.0",
        "topic": SEED_REQUESTED_TOPIC,
        "correlationId": "c-1",
        "occurredAt": "2026-10-04T12:00:00.000Z",
        "payload": payload,
    }
    assert seed_request_kafka_key(payload) == "org_01h455vb4pex5vsknk084sn02q"
    assert build_seed_request_envelope(payload, correlation_id="c")[
        "occurredAt"
    ].endswith("Z")
