"""
Client projection of contract 4.1.0 (shared lists, common lists, forks).

Same in-process stub server as ``test_client.py``. Verifies only what the
client does with the wire: the request it sends and how it parses the new
fields — never the service's behaviour.
"""

from __future__ import annotations

from typing import Any

import pytest
from fuzefront_selection_list_client import (
    SelectionListApiError,
    SelectionListClient,
    SelectionListVisibility,
)
from test_client import StubServer

_NOW = "2026-10-05T12:00:00Z"
_COMMON = "front_sl_01h455vb4pex5vsknk084sn02q"
_FORK = "front_sl_01h455vb4pex5vsknk084sn03r"


def _list(**over: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "id": _FORK,
        "organization_id": "org_01h455vb4pex5vsknk084sn02q",
        "key": "priority",
        "source_locale": "en",
        "status": "active",
        "name": "Priority",
        "resolved_locale": "en",
        "is_machine": False,
        "seed": None,
        "visibility": "org",
        "forked_from": {
            "list_id": _COMMON,
            "organization_id": "org_01h455vb4pex5vsknk084sn0pf",
            "revision": 3,
            "forked_at": _NOW,
        },
        "editable": True,
        "created_by": "usr_01h455vb4pex5vsknk084sn02q",
        "created_at": _NOW,
        "updated_at": _NOW,
    }
    base.update(over)
    return base


def test_get_lists_sends_include_shared_and_visibility_as_wire_values() -> None:
    seen: dict[str, Any] = {}

    def handler(h: Any, parsed: Any, qs: dict, body: Any) -> None:
        seen.update(qs)
        h.send_json({"items": [_list()], "page": {"nextCursor": None, "hasMore": False}})

    with StubServer({("GET", "/v1/selection-lists"): handler}) as srv:
        client = SelectionListClient(srv.base_url, token="t")
        page = client.get_lists(include_shared=True, visibility="platform")
    assert seen["include_shared"] == ["true"]
    assert seen["visibility"] == ["platform"]
    sl = page.items[0]
    assert sl.visibility is SelectionListVisibility.ORG
    assert sl.editable is True
    assert sl.forked_from is not None and sl.forked_from.list_id == _COMMON
    assert sl.forked_from.revision == 3


def test_absent_4_1_fields_parse_to_their_4_0_meaning() -> None:
    # Optional on the wire at 4.1.0 until the implementation ships behind
    # ``fuzefront.selection-lists.shared-lists``: a 4.0.0-shaped response omits them.
    legacy_list = _list()
    for field in ("visibility", "forked_from", "editable"):
        del legacy_list[field]
    legacy_item = {
        "id": "front_sli_01h455vb4pex5vsknk084sn02q",
        "list_id": _FORK,
        "code": "P1",
        "sort_order": 100,
        "status": "active",
        "label": "Urgent",
        "resolved_locale": "en",
        "is_machine": False,
        "seed": None,
        "created_by": "usr_01h455vb4pex5vsknk084sn02q",
        "created_at": _NOW,
        "updated_at": _NOW,
    }

    def lists(h: Any, parsed: Any, qs: dict, body: Any) -> None:
        h.send_json({"items": [legacy_list], "page": {"nextCursor": None, "hasMore": False}})

    def items(h: Any, parsed: Any, qs: dict, body: Any) -> None:
        h.send_json({"items": [legacy_item], "page": {"nextCursor": None, "hasMore": False}})

    routes = {
        ("GET", "/v1/selection-lists"): lists,
        ("GET", f"/v1/selection-lists/{_FORK}/items"): items,
    }
    with StubServer(routes) as srv:
        client = SelectionListClient(srv.base_url, token="t")
        sl = client.get_lists().items[0]
        it = client.get_items(_FORK).items[0]
    assert sl.visibility is SelectionListVisibility.PRIVATE
    assert sl.forked_from is None
    assert sl.editable is None  # unknown -- never coerced to False
    assert it.origin_item_id is None


def test_get_effective_list_is_one_key_lookup_with_include_shared() -> None:
    seen: dict[str, Any] = {}

    def handler(h: Any, parsed: Any, qs: dict, body: Any) -> None:
        seen.update(qs)
        h.send_json({"items": [], "page": {"nextCursor": None, "hasMore": False}})

    with StubServer({("GET", "/v1/selection-lists"): handler}) as srv:
        client = SelectionListClient(srv.base_url, token="t")
        assert client.get_effective_list("priority") is None
    assert seen["key"] == ["priority"]
    assert seen["include_shared"] == ["true"]
    assert seen["limit"] == ["1"]


@pytest.mark.parametrize(("status", "created"), [(201, True), (200, False)])
def test_fork_list_posts_no_id_and_reports_created(status: int, created: bool) -> None:
    bodies: list[Any] = []

    def handler(h: Any, parsed: Any, qs: dict, body: Any) -> None:
        bodies.append(body)
        h.send_json(_list(), status=status)

    with StubServer({("POST", f"/v1/selection-lists/{_COMMON}/fork"): handler}) as srv:
        client = SelectionListClient(srv.base_url, token="t")
        fork, was_created = client.fork_list(_COMMON, visibility="private")
    assert bodies == [{"visibility": "private"}]
    assert was_created is created
    assert fork.id == _FORK


def test_fork_required_conflict_exposes_fork_hints() -> None:
    def handler(h: Any, parsed: Any, qs: dict, body: Any) -> None:
        h.send_json(
            {
                "code": "CONFLICT",
                "message": "Fork the common list to change it.",
                "reason": "fork_required",
                "fork_url": f"/v1/selection-lists/{_COMMON}/fork",
                "source_list_id": _COMMON,
            },
            status=409,
        )

    with StubServer({("PATCH", f"/v1/selection-lists/{_COMMON}"): handler}) as srv:
        client = SelectionListClient(srv.base_url, token="t")
        with pytest.raises(SelectionListApiError) as info:
            client.update_list(_COMMON, name="Urgency")
    err = info.value
    assert err.is_conflict and err.is_fork_required
    assert err.source_list_id == _COMMON
    assert err.fork_url == f"/v1/selection-lists/{_COMMON}/fork"


def test_resolve_parses_effective_item_id() -> None:
    def resolve(h: Any, parsed: Any, qs: dict, body: Any) -> None:
        h.send_json(
            {
                "results": {
                    "front_sli_01h455vb4pex5vsknk084sn02q": {
                        "label": "Urgent",
                        "locale": "en",
                        "is_machine": False,
                        "status": "active",
                        "effective_item_id": "front_sli_01h455vb4pex5vsknk084sn03r",
                    }
                },
                "missing": [],
            }
        )

    with StubServer({("POST", "/v1/resolve"): resolve}) as srv:
        client = SelectionListClient(srv.base_url, token="t")
        res = client.resolve_ids(["front_sli_01h455vb4pex5vsknk084sn02q"])
    r = res.results["front_sli_01h455vb4pex5vsknk084sn02q"]
    assert r.effective_item_id == "front_sli_01h455vb4pex5vsknk084sn03r"
