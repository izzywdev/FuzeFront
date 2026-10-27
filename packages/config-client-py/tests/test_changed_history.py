"""
Tests for the reveal/history surface and the ``config.changed`` cache
(FF-EPIC-18-S4). Reuses the stdlib stub server from ``test_client.py``.
"""

from __future__ import annotations

from typing import Any

from fuzefront_config_client import (
    CONFIG_CHANGED_TOPIC,
    ConfigCache,
    ConfigClient,
    ConfigHistoryAction,
    Scope,
    ScopeType,
    parse_config_changed_event,
)
from test_client import StubServer

ORG = Scope(scope_type=ScopeType.ORG, scope_id="o1")


def test_reveal_secret_posts_to_contract_path() -> None:
    seen: dict[str, Any] = {}

    def handler(h: Any, parsed: Any, qs: Any, body: Any) -> None:
        seen["body"] = body
        h.send_json(
            {
                "namespace": "ns",
                "scope": {"scopeType": "org", "scopeId": "o1"},
                "key": "api.token",
                "value": "s3cret",
                "revealedAt": "2026-01-01T00:00:00Z",
                "historyEntryId": "cvh_01h455vb4pex5vsknk084sn02q",
            }
        )

    with StubServer({("POST", "/v1/config/secrets/reveal"): handler}) as srv:
        out = ConfigClient(base_url=srv.base_url).reveal_secret("ns", ORG, "api.token", "rotate")
    assert out.value == "s3cret"
    assert out.history_entry_id.startswith("cvh_")
    assert seen["body"] == {
        "namespace": "ns",
        "scope": {"scopeType": "org", "scopeId": "o1"},
        "key": "api.token",
        "reason": "rotate",
    }


def test_list_config_history_forwards_scope_key_and_paging() -> None:
    seen: dict[str, Any] = {}

    def handler(h: Any, parsed: Any, qs: Any, body: Any) -> None:
        seen["qs"] = qs
        h.send_json(
            {
                "items": [
                    {
                        "id": "cvh_01h455vb4pex5vsknk084sn02q",
                        "namespace": "ns",
                        "key": "api.token",
                        "scope": {"scopeType": "org", "scopeId": "o1"},
                        "action": "set",
                        "redacted": True,
                        "actor": {"actorType": "user", "actorId": "u1", "actorRedacted": False},
                        "occurredAt": "2026-01-01T00:00:00Z",
                    }
                ],
                "pageInfo": {"hasNextPage": True, "nextCursor": "c2"},
            }
        )

    with StubServer({("GET", "/v1/config/history"): handler}) as srv:
        page = ConfigClient(base_url=srv.base_url).list_config_history(
            "ns", ORG, "api.token", cursor="c1", limit=5
        )
    assert seen["qs"]["key"] == ["api.token"]
    assert seen["qs"]["scopeType"] == ["org"]
    assert seen["qs"]["limit"] == ["5"]
    assert seen["qs"]["cursor"] == ["c1"]
    assert page.items[0].action is ConfigHistoryAction.SET
    assert page.items[0].redacted is True and page.items[0].old_value is None
    assert page.page_info.next_cursor == "c2"


def test_parse_config_changed_event() -> None:
    payload = {"namespace": "ns", "scope": {"scopeType": "org", "scopeId": "o1"}, "changedKeys": ["a"]}
    assert CONFIG_CHANGED_TOPIC == "config.changed"
    for raw in (payload, {"topic": CONFIG_CHANGED_TOPIC, "payload": payload}):
        parsed = parse_config_changed_event(raw)
        assert parsed is not None and parsed.changed_keys == ["a"]
        assert parsed.scope.scope_type is ScopeType.ORG
    assert parse_config_changed_event(None) is None
    assert parse_config_changed_event({**payload, "changedKeys": [1]}) is None
    assert parse_config_changed_event({**payload, "scope": {"scopeType": "x", "scopeId": None}}) is None


class _FakeClient:
    def __init__(self, versions: list[str | None]) -> None:
        self.versions = versions
        self.etags: list[str | None] = []

    def get_effective_config(self, namespace: str, scope: Scope, *, if_none_match: str | None = None) -> Any:
        from fuzefront_config_client import NOT_MODIFIED, EffectiveConfig

        self.etags.append(if_none_match)
        v = self.versions.pop(0)
        if v is None:
            return NOT_MODIFIED
        return EffectiveConfig(namespace=namespace, scope=scope, version=v, entries=[])


def _cache(versions: list[str | None], max_age: float = 60.0) -> tuple[ConfigCache, _FakeClient, list[float]]:
    t = [0.0]
    fake = _FakeClient(versions)
    return ConfigCache(fake, max_age_seconds=max_age, clock=lambda: t[0]), fake, t  # type: ignore[arg-type]


def test_cache_serves_within_max_age() -> None:
    cache, fake, _ = _cache(["v1"])
    cache.get("ns", ORG)
    cache.get("ns", ORG)
    assert fake.etags == [None]


def test_event_invalidates_then_full_reresolve() -> None:
    cache, fake, _ = _cache(["v1", "v2"])
    cache.get("ns", ORG)
    assert cache.handle_event({"namespace": "ns", "scope": {"scopeType": "portal", "scopeId": "p"}, "changedKeys": ["a"]})
    assert cache.get("ns", ORG).version == "v2"
    assert fake.etags == [None, None]  # unconditional after an event


def test_event_for_other_namespace_or_malformed_is_ignored() -> None:
    cache, _, _ = _cache(["v1"])
    cache.get("ns", ORG)
    assert not cache.handle_event({"namespace": "other", "scope": {"scopeType": "org", "scopeId": "o1"}, "changedKeys": ["a"]})
    assert not cache.handle_event({"junk": 1})


def test_missed_event_backstopped_by_version_poll() -> None:
    cache, fake, t = _cache(["v1", None, "v3"], max_age=1.0)
    cache.get("ns", ORG)
    t[0] = 2.0
    assert cache.get("ns", ORG).version == "v1"  # 304 keeps the cache
    assert fake.etags[1] == "v1"
    t[0] = 4.0
    assert cache.get("ns", ORG).version == "v3"  # changed version picked up
