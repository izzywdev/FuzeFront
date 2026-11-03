"""
``get_effective_list`` follows empty, non-terminal pages (2.2.0).

The service paginates BEFORE it drops rows the caller cannot read, so a key
lookup can return an EMPTY page that still carries a next cursor. Verifies only
what the client sends and how it walks -- never the service.
"""

from __future__ import annotations

from typing import Any

from fuzefront_selection_list_client import (
    MAX_EFFECTIVE_LOOKUP_PAGES,
    EffectiveLookupIncompleteError,
    SelectionListApiError,
    SelectionListClient,
)
from test_client import StubServer

_NOW = "2026-10-05T12:00:00Z"
_COMMON: dict[str, Any] = {
    "id": "front_sl_01h455vb4pex5vsknk084sn02q",
    "organization_id": "org_01h455vb4pex5vsknk084sn0pf",
    "key": "priority",
    "source_locale": "en",
    "status": "active",
    "name": "Priority",
    "resolved_locale": "en",
    "is_machine": False,
    "seed": None,
    "visibility": "platform",
    "forked_from": None,
    "editable": False,
    "created_by": "system:platform",
    "created_at": _NOW,
    "updated_at": _NOW,
}


def _page(items: list[dict[str, Any]], next_cursor: str | None) -> dict[str, Any]:
    return {"items": items, "page": {"nextCursor": next_cursor, "hasMore": next_cursor is not None}}


def _walk(replies: list[tuple[int, dict[str, Any]]]) -> tuple[Any, list[dict]]:
    """Run get_effective_list against scripted replies; return (result-or-exception, queries seen)."""
    seen: list[dict] = []

    def handler(h: Any, parsed: Any, qs: dict, body: Any) -> None:
        seen.append(qs)
        status, payload = replies[len(seen) - 1]
        h.send_json(payload, status)

    with StubServer({("GET", "/v1/selection-lists"): handler}) as srv:
        client = SelectionListClient(base_url=srv.base_url, token="t")
        try:
            return client.get_effective_list("priority"), seen
        except Exception as exc:  # noqa: BLE001 -- the test inspects it
            return exc, seen


def _cursor(qs: dict) -> str | None:
    v = qs.get("cursor")
    return v[0] if isinstance(v, list) else v


def _one(qs: dict, name: str) -> Any:
    v = qs.get(name)
    return v[0] if isinstance(v, list) else v


def test_follows_an_empty_non_terminal_page_then_returns_the_hit() -> None:
    result, seen = _walk([(200, _page([], "c1")), (200, _page([_COMMON], None))])
    assert result.id == _COMMON["id"]
    assert len(seen) == 2
    for qs in seen:
        assert (_one(qs, "key"), _one(qs, "include_shared"), _one(qs, "limit")) == ("priority", "true", "1")
    assert [_cursor(qs) for qs in seen] == [None, "c1"]


def test_walks_several_empty_pages() -> None:
    result, seen = _walk(
        [(200, _page([], "c1")), (200, _page([], "c2")), (200, _page([], "c3")), (200, _page([_COMMON], "c4"))]
    )
    assert result.key == "priority"
    assert [_cursor(qs) for qs in seen] == [None, "c1", "c2", "c3"]


def test_terminal_empty_page_is_none() -> None:
    result, seen = _walk([(200, _page([], "c1")), (200, _page([], None))])
    assert result is None
    assert len(seen) == 2


def test_ignores_a_row_for_another_key() -> None:
    other = dict(_COMMON, key="urgency")
    result, _ = _walk([(200, _page([other], "c1")), (200, _page([_COMMON], None))])
    assert result.key == "priority"


def test_exhaustion_raises_incomplete_never_none() -> None:
    replies = [(200, _page([], f"c{i + 1}")) for i in range(MAX_EFFECTIVE_LOOKUP_PAGES + 1)]
    result, seen = _walk(replies)
    assert isinstance(result, EffectiveLookupIncompleteError)
    assert result.incomplete is True
    assert result.pages == MAX_EFFECTIVE_LOOKUP_PAGES
    assert len(seen) == MAX_EFFECTIVE_LOOKUP_PAGES


def test_a_failed_page_raises_without_fallback() -> None:
    result, seen = _walk([(200, _page([], "c1")), (500, {"code": "INTERNAL_ERROR", "message": "boom"})])
    assert isinstance(result, SelectionListApiError)
    assert len(seen) == 2


def test_bound_matches_the_ts_client() -> None:
    assert MAX_EFFECTIVE_LOOKUP_PAGES == 10
