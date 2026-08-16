"""
Unit tests for SelectionListClient.

Uses an in-process ``http.server`` (stdlib) stub — no external services,
no third-party test dependencies, zero network traffic.

Tests cover:
- URL construction and token injection
- Two-page cursor walk (no duplicates, stops at nextCursor=None)
- SelectionListApiError raised on 403 with QUOTA_EXCEEDED fields populated
- 204 -> None (archive/delete/revoke_access endpoints)
- Token provider callable (refreshes per call)
- Paginate generator walks multi-page results correctly
"""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any, Dict, List, Optional
from urllib.parse import parse_qs, urlparse

import pytest

from fuzefront_selection_list_client import (
    SelectionListApiError,
    SelectionListClient,
    paginate,
)
from fuzefront_selection_list_client.types import LifecycleStatus


# ---------------------------------------------------------------------------
# Stub HTTP server helpers
# ---------------------------------------------------------------------------


class _Handler(BaseHTTPRequestHandler):
    """Minimal stub handler. Routes are registered on the class before use."""

    # class-level registry: (method, path_prefix) -> callable(handler) -> None
    routes: Dict[tuple, Any] = {}

    def log_message(self, *args: Any) -> None:  # silence access log in tests
        pass

    def _dispatch(self, method: str) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)
        key = (method, path)
        handler = self.routes.get(key)
        if handler is None:
            # Try prefix match
            for (m, p), h in self.routes.items():
                if m == method and path.startswith(p) and p != "/":
                    handler = h
                    break
        if handler is None:
            self.send_response(404)
            self.end_headers()
            return

        length = int(self.headers.get("Content-Length", 0))
        body_bytes = self.rfile.read(length) if length else b""
        body = json.loads(body_bytes) if body_bytes else None
        handler(self, parsed, qs, body)

    def do_GET(self) -> None:
        self._dispatch("GET")

    def do_POST(self) -> None:
        self._dispatch("POST")

    def do_PATCH(self) -> None:
        self._dispatch("PATCH")

    def do_DELETE(self) -> None:
        self._dispatch("DELETE")

    def do_PUT(self) -> None:
        self._dispatch("PUT")

    def send_json(self, data: Any, status: int = 200) -> None:
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_no_content(self) -> None:
        self.send_response(204)
        self.end_headers()


class StubServer:
    """Context manager that starts a stub HTTP server in a background thread."""

    def __init__(self, routes: Dict[tuple, Any]) -> None:
        _Handler.routes = routes
        self._server = HTTPServer(("127.0.0.1", 0), _Handler)
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)

    def __enter__(self) -> "StubServer":
        self._thread.start()
        return self

    def __exit__(self, *_: Any) -> None:
        self._server.shutdown()

    @property
    def base_url(self) -> str:
        host, port = self._server.server_address
        return f"http://{host}:{port}"


# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------

_NOW = "2026-08-10T12:00:00Z"

_LIST_FIXTURE: Dict[str, Any] = {
    "id": "sl_01h455vb4pex5vsknk084sn02q",
    "organization_id": "org_01h455vb4pex5vsknk084sn02q",
    "key": "countries",
    "source_locale": "en",
    "status": "active",
    "name": "Countries",
    "resolved_locale": "en",
    "is_machine": False,
    "item_count": 249,
    "created_by": "usr_01h455vb4pex5vsknk084sn02q",
    "created_at": _NOW,
    "updated_at": _NOW,
}

_ITEM_FIXTURE: Dict[str, Any] = {
    "id": "sli_01h455vb4pex5vsknk084sn02q",
    "list_id": "sl_01h455vb4pex5vsknk084sn02q",
    "code": "US",
    "sort_order": 100,
    "status": "active",
    "label": "United States",
    "resolved_locale": "en",
    "is_machine": False,
    "created_by": "usr_01h455vb4pex5vsknk084sn02q",
    "created_at": _NOW,
    "updated_at": _NOW,
}


def _page(items: List[Any], next_cursor: Optional[str] = None, has_more: bool = False) -> dict:
    return {
        "items": items,
        "page": {
            "nextCursor": next_cursor,
            "hasMore": has_more,
            "total": len(items),
        },
    }


# ---------------------------------------------------------------------------
# Test: URL construction and token injection
# ---------------------------------------------------------------------------


class TestUrlAndToken:
    def test_bearer_token_injected(self) -> None:
        received_headers: List[dict] = []

        def handle(handler: _Handler, parsed: Any, qs: Any, body: Any) -> None:
            received_headers.append(dict(handler.headers))
            handler.send_json(_page([_LIST_FIXTURE]))

        routes = {("GET", "/v1/selection-lists"): handle}
        with StubServer(routes) as srv:
            client = SelectionListClient(base_url=srv.base_url, token="test-token-abc")
            client.get_lists()

        assert len(received_headers) == 1
        assert received_headers[0].get("Authorization") == "Bearer test-token-abc"

    def test_callable_token_called_per_request(self) -> None:
        call_count = 0
        received_auth: List[str] = []

        def token_fn() -> str:
            nonlocal call_count
            call_count += 1
            return f"token-{call_count}"

        def handle(handler: _Handler, parsed: Any, qs: Any, body: Any) -> None:
            received_auth.append(handler.headers.get("Authorization", ""))
            handler.send_json(_page([_LIST_FIXTURE]))

        routes = {("GET", "/v1/selection-lists"): handle}
        with StubServer(routes) as srv:
            client = SelectionListClient(base_url=srv.base_url, token=token_fn)
            client.get_lists()
            client.get_lists()

        assert call_count == 2
        assert received_auth == ["Bearer token-1", "Bearer token-2"]

    def test_query_parameters_forwarded(self) -> None:
        received_qs: list = []

        def handle(handler: _Handler, parsed: Any, qs: Any, body: Any) -> None:
            received_qs.append(qs)
            handler.send_json(_page([]))

        routes = {("GET", "/v1/selection-lists"): handle}
        with StubServer(routes) as srv:
            client = SelectionListClient(base_url=srv.base_url, token="tok")
            client.get_lists(limit=10, status="active", locale="fr")

        assert len(received_qs) == 1
        qs = received_qs[0]
        assert qs.get("limit") == ["10"]
        assert qs.get("status") == ["active"]
        assert qs.get("locale") == ["fr"]

    def test_base_url_trailing_slash_stripped(self) -> None:
        """A base_url with trailing slash must not produce double slashes."""
        received_paths: list = []

        def handle(handler: _Handler, parsed: Any, qs: Any, body: Any) -> None:
            received_paths.append(urlparse(handler.path).path)
            handler.send_json(_page([]))

        routes = {("GET", "/v1/selection-lists"): handle}
        with StubServer(routes) as srv:
            # pass trailing slash
            client = SelectionListClient(
                base_url=srv.base_url + "/", token="tok"
            )
            client.get_lists()

        assert received_paths[0] == "/v1/selection-lists"

    def test_no_token_no_auth_header(self) -> None:
        received_headers: List[dict] = []

        def handle(handler: _Handler, parsed: Any, qs: Any, body: Any) -> None:
            received_headers.append(dict(handler.headers))
            handler.send_json({"results": {}, "missing": []})

        routes = {("POST", "/v1/resolve"): handle}
        with StubServer(routes) as srv:
            client = SelectionListClient(base_url=srv.base_url)
            client.resolve_ids(["sli_01h455vb4pex5vsknk084sn02q"])

        assert "Authorization" not in received_headers[0]


# ---------------------------------------------------------------------------
# Test: two-page cursor walk
# ---------------------------------------------------------------------------


class TestCursorWalk:
    """The paginator must walk exactly two pages and yield no duplicates."""

    def test_two_page_cursor_walk(self) -> None:
        page1_item = dict(_ITEM_FIXTURE, id="sli_page1_item")
        page2_item = dict(_ITEM_FIXTURE, id="sli_page2_item")

        page1_cursor = "cursor-page-2"
        call_log: List[Optional[str]] = []

        def handle_items(handler: _Handler, parsed: Any, qs: Any, body: Any) -> None:
            cursor = qs.get("cursor", [None])[0]
            call_log.append(cursor)
            if cursor is None:
                handler.send_json(_page([page1_item], next_cursor=page1_cursor, has_more=True))
            else:
                handler.send_json(_page([page2_item], next_cursor=None, has_more=False))

        routes = {("GET", "/v1/selection-lists/sl_01h455vb4pex5vsknk084sn02q/items"): handle_items}
        with StubServer(routes) as srv:
            client = SelectionListClient(base_url=srv.base_url, token="tok")
            results = list(
                client.paginate(
                    lambda **kw: client.get_items("sl_01h455vb4pex5vsknk084sn02q", **kw)
                )
            )

        assert len(results) == 2, f"Expected 2 items, got {len(results)}"
        ids = [r.id for r in results]
        assert "sli_page1_item" in ids
        assert "sli_page2_item" in ids
        # No duplicates
        assert len(ids) == len(set(ids))
        # Called twice: first with no cursor, second with the page1 cursor
        assert call_log == [None, page1_cursor]

    def test_single_page_walk_stops_immediately(self) -> None:
        """When has_more=False on page 1, paginate must not make a second request."""
        call_count = 0

        def handle_items(handler: _Handler, parsed: Any, qs: Any, body: Any) -> None:
            nonlocal call_count
            call_count += 1
            handler.send_json(_page([_ITEM_FIXTURE], next_cursor=None, has_more=False))

        routes = {("GET", "/v1/selection-lists/sl_01h455vb4pex5vsknk084sn02q/items"): handle_items}
        with StubServer(routes) as srv:
            client = SelectionListClient(base_url=srv.base_url, token="tok")
            items = list(
                client.paginate(
                    lambda **kw: client.get_items("sl_01h455vb4pex5vsknk084sn02q", **kw)
                )
            )

        assert call_count == 1
        assert len(items) == 1

    def test_paginate_three_pages(self) -> None:
        """Paginator must handle N>2 pages correctly."""
        pages = [
            (f"sli_item_{i}", f"cursor-page-{i + 1}", True)
            for i in range(3)
        ]
        # Last page: no cursor, no more
        pages[-1] = (pages[-1][0], None, False)

        call_index = 0

        def handle_items(handler: _Handler, parsed: Any, qs: Any, body: Any) -> None:
            nonlocal call_index
            item_id, next_c, has_m = pages[call_index]
            call_index += 1
            handler.send_json(
                _page([dict(_ITEM_FIXTURE, id=item_id)], next_cursor=next_c, has_more=has_m)
            )

        routes = {("GET", "/v1/selection-lists/sl_01h455vb4pex5vsknk084sn02q/items"): handle_items}
        with StubServer(routes) as srv:
            client = SelectionListClient(base_url=srv.base_url, token="tok")
            results = list(
                client.paginate(
                    lambda **kw: client.get_items("sl_01h455vb4pex5vsknk084sn02q", **kw)
                )
            )

        assert len(results) == 3
        assert {r.id for r in results} == {f"sli_item_{i}" for i in range(3)}


# ---------------------------------------------------------------------------
# Test: SelectionListApiError on 403 with QUOTA_EXCEEDED
# ---------------------------------------------------------------------------


class TestApiError:
    def test_quota_exceeded_error_fields_populated(self) -> None:
        def handle(handler: _Handler, parsed: Any, qs: Any, body: Any) -> None:
            handler.send_json(
                {
                    "code": "QUOTA_EXCEEDED",
                    "message": "Organization list quota exhausted.",
                    "scope": "org_lists",
                    "limit": 100,
                    "current": 100,
                },
                status=403,
            )

        routes = {("POST", "/v1/selection-lists"): handle}
        with StubServer(routes) as srv:
            client = SelectionListClient(base_url=srv.base_url, token="tok")
            with pytest.raises(SelectionListApiError) as exc_info:
                client.create_list(key="countries", name="Countries")

        err = exc_info.value
        assert err.code == "QUOTA_EXCEEDED"
        assert err.status == 403
        assert err.scope == "org_lists"
        assert err.limit == 100
        assert err.current == 100
        assert err.is_quota_exceeded

    def test_not_found_error(self) -> None:
        def handle(handler: _Handler, parsed: Any, qs: Any, body: Any) -> None:
            handler.send_json(
                {"code": "NOT_FOUND", "message": "No such list."},
                status=404,
            )

        routes = {("GET", "/v1/selection-lists/sl_nosuchlist"): handle}
        with StubServer(routes) as srv:
            client = SelectionListClient(base_url=srv.base_url, token="tok")
            with pytest.raises(SelectionListApiError) as exc_info:
                client.get_list("sl_nosuchlist")

        err = exc_info.value
        assert err.code == "NOT_FOUND"
        assert err.status == 404
        assert err.is_not_found

    def test_conflict_error(self) -> None:
        def handle(handler: _Handler, parsed: Any, qs: Any, body: Any) -> None:
            handler.send_json(
                {"code": "CONFLICT", "message": "Key already exists."},
                status=409,
            )

        routes = {("POST", "/v1/selection-lists"): handle}
        with StubServer(routes) as srv:
            client = SelectionListClient(base_url=srv.base_url, token="tok")
            with pytest.raises(SelectionListApiError) as exc_info:
                client.create_list(key="countries", name="Countries")

        err = exc_info.value
        assert err.code == "CONFLICT"
        assert err.is_conflict

    def test_unknown_error_on_502(self) -> None:
        """Non-contract status with no body returns UNKNOWN code."""

        def handle(handler: _Handler, parsed: Any, qs: Any, body: Any) -> None:
            # Return a non-JSON body to simulate a gateway error
            raw = b"Bad Gateway"
            handler.send_response(502)
            handler.send_header("Content-Length", str(len(raw)))
            handler.end_headers()
            handler.wfile.write(raw)

        routes = {("GET", "/v1/selection-lists"): handle}
        with StubServer(routes) as srv:
            client = SelectionListClient(base_url=srv.base_url, token="tok")
            with pytest.raises(SelectionListApiError) as exc_info:
                client.get_lists()

        assert exc_info.value.code == "UNKNOWN"
        assert exc_info.value.status == 502

    def test_validation_error_details(self) -> None:
        def handle(handler: _Handler, parsed: Any, qs: Any, body: Any) -> None:
            handler.send_json(
                {
                    "code": "VALIDATION_ERROR",
                    "message": "Invalid body.",
                    "details": [{"field": "/key", "message": "must match pattern"}],
                },
                status=400,
            )

        routes = {("POST", "/v1/selection-lists"): handle}
        with StubServer(routes) as srv:
            client = SelectionListClient(base_url=srv.base_url, token="tok")
            with pytest.raises(SelectionListApiError) as exc_info:
                client.create_list(key="INVALID!", name="Test")

        err = exc_info.value
        assert err.code == "VALIDATION_ERROR"
        assert err.details is not None
        assert err.details[0]["field"] == "/key"


# ---------------------------------------------------------------------------
# Test: 204 -> None (archive/delete endpoints)
# ---------------------------------------------------------------------------


class TestEmptyResponse:
    def test_delete_list_purge_returns_none(self) -> None:
        def handle(handler: _Handler, parsed: Any, qs: Any, body: Any) -> None:
            handler.send_no_content()

        routes = {("DELETE", "/v1/selection-lists/sl_01h455vb4pex5vsknk084sn02q"): handle}
        with StubServer(routes) as srv:
            client = SelectionListClient(base_url=srv.base_url, token="tok")
            result = client.delete_list("sl_01h455vb4pex5vsknk084sn02q", purge=True)

        assert result is None

    def test_delete_item_purge_returns_none(self) -> None:
        def handle(handler: _Handler, parsed: Any, qs: Any, body: Any) -> None:
            handler.send_no_content()

        routes = {
            (
                "DELETE",
                "/v1/selection-lists/sl_01h455vb4pex5vsknk084sn02q/items/sli_01h455vb4pex5vsknk084sn02q",
            ): handle
        }
        with StubServer(routes) as srv:
            client = SelectionListClient(base_url=srv.base_url, token="tok")
            result = client.delete_item(
                "sl_01h455vb4pex5vsknk084sn02q",
                "sli_01h455vb4pex5vsknk084sn02q",
                purge=True,
            )

        assert result is None

    def test_revoke_access_204_returns_none(self) -> None:
        def handle(handler: _Handler, parsed: Any, qs: Any, body: Any) -> None:
            handler.send_no_content()

        routes = {
            (
                "DELETE",
                "/v1/selection-lists/sl_01h455vb4pex5vsknk084sn02q/access/usr_01h455vb4pex5vsknk084sn02q",
            ): handle
        }
        with StubServer(routes) as srv:
            client = SelectionListClient(base_url=srv.base_url, token="tok")
            result = client.revoke_access(
                "sl_01h455vb4pex5vsknk084sn02q",
                "usr_01h455vb4pex5vsknk084sn02q",
            )

        assert result is None

    def test_delete_list_archive_returns_list(self) -> None:
        """DELETE without purge returns the archived list body (200)."""

        archived = dict(_LIST_FIXTURE, status="archived")

        def handle(handler: _Handler, parsed: Any, qs: Any, body: Any) -> None:
            handler.send_json(archived)

        routes = {("DELETE", "/v1/selection-lists/sl_01h455vb4pex5vsknk084sn02q"): handle}
        with StubServer(routes) as srv:
            client = SelectionListClient(base_url=srv.base_url, token="tok")
            result = client.delete_list("sl_01h455vb4pex5vsknk084sn02q")

        assert result is not None
        assert result.status == LifecycleStatus.ARCHIVED


# ---------------------------------------------------------------------------
# Test: endpoint coverage spot-checks
# ---------------------------------------------------------------------------


class TestEndpointCoverage:
    def test_create_list(self) -> None:
        received_bodies: list = []

        def handle(handler: _Handler, parsed: Any, qs: Any, body: Any) -> None:
            received_bodies.append(body)
            handler.send_json(_LIST_FIXTURE, status=201)

        routes = {("POST", "/v1/selection-lists"): handle}
        with StubServer(routes) as srv:
            client = SelectionListClient(base_url=srv.base_url, token="tok")
            sl = client.create_list(key="countries", name="Countries", source_locale="en")

        assert sl.id == "sl_01h455vb4pex5vsknk084sn02q"
        assert received_bodies[0] == {"key": "countries", "name": "Countries", "source_locale": "en"}

    def test_get_quota(self) -> None:
        quota_body = {
            "organization_id": "org_01h455vb4pex5vsknk084sn02q",
            "quotas": [
                {"scope": "org_lists", "applies_to": "organization", "limit": 100, "current": 12},
                {"scope": "user_lists", "applies_to": "user", "limit": 50, "current": 3},
                {"scope": "list_items", "applies_to": "list", "limit": 5000, "current": None},
                {"scope": "list_locales", "applies_to": "list", "limit": 11, "current": None},
            ],
        }

        def handle(handler: _Handler, parsed: Any, qs: Any, body: Any) -> None:
            handler.send_json(quota_body)

        routes = {("GET", "/v1/selection-lists/quota"): handle}
        with StubServer(routes) as srv:
            client = SelectionListClient(base_url=srv.base_url, token="tok")
            status = client.get_quota()

        assert status.organization_id == "org_01h455vb4pex5vsknk084sn02q"
        assert len(status.quotas) == 4
        assert status.quotas[0].scope.value == "org_lists"
        assert status.quotas[0].current == 12

    def test_resolve_ids(self) -> None:
        item_id = "sli_01h455vb4pex5vsknk084sn02q"
        resolve_body = {
            "results": {
                item_id: {
                    "label": "United States",
                    "locale": "en",
                    "is_machine": False,
                    "status": "active",
                }
            },
            "missing": [],
        }

        def handle(handler: _Handler, parsed: Any, qs: Any, body: Any) -> None:
            handler.send_json(resolve_body)

        routes = {("POST", "/v1/resolve"): handle}
        with StubServer(routes) as srv:
            client = SelectionListClient(base_url=srv.base_url, token="tok")
            result = client.resolve_ids([item_id])

        assert item_id in result.results
        assert result.results[item_id].label == "United States"
        assert result.missing == []

    def test_reorder_items(self) -> None:
        item2 = dict(_ITEM_FIXTURE, id="sli_item_2", sort_order=200)
        reorder_response = {"items": [_ITEM_FIXTURE, item2]}

        def handle(handler: _Handler, parsed: Any, qs: Any, body: Any) -> None:
            handler.send_json(reorder_response)

        routes = {
            (
                "PUT",
                "/v1/selection-lists/sl_01h455vb4pex5vsknk084sn02q/items/reorder",
            ): handle
        }
        with StubServer(routes) as srv:
            client = SelectionListClient(base_url=srv.base_url, token="tok")
            items = client.reorder_items(
                "sl_01h455vb4pex5vsknk084sn02q",
                [
                    "sli_01h455vb4pex5vsknk084sn02q",
                    "sli_item_2",
                ],
            )

        assert len(items) == 2

    def test_upsert_list_translation(self) -> None:
        translation_body = {
            "list_id": "sl_01h455vb4pex5vsknk084sn02q",
            "locale": "fr",
            "name": "Pays",
            "is_machine": False,
            "updated_at": _NOW,
        }

        def handle(handler: _Handler, parsed: Any, qs: Any, body: Any) -> None:
            handler.send_json(translation_body)

        routes = {
            (
                "PUT",
                "/v1/selection-lists/sl_01h455vb4pex5vsknk084sn02q/translations/fr",
            ): handle
        }
        with StubServer(routes) as srv:
            client = SelectionListClient(base_url=srv.base_url, token="tok")
            t = client.upsert_list_translation(
                "sl_01h455vb4pex5vsknk084sn02q", "fr", "Pays"
            )

        assert t.locale == "fr"
        assert t.name == "Pays"

    def test_set_access(self) -> None:
        grant_body = {
            "list_id": "sl_01h455vb4pex5vsknk084sn02q",
            "user_id": "usr_01h455vb4pex5vsknk084sn02q",
            "role": "list-editor",
            "granted_by": "usr_01h455vb4pex5vsknk084sn02q",
            "granted_at": _NOW,
            "updated_at": _NOW,
        }

        def handle(handler: _Handler, parsed: Any, qs: Any, body: Any) -> None:
            handler.send_json(grant_body)

        routes = {
            (
                "PUT",
                "/v1/selection-lists/sl_01h455vb4pex5vsknk084sn02q/access/usr_01h455vb4pex5vsknk084sn02q",
            ): handle
        }
        with StubServer(routes) as srv:
            client = SelectionListClient(base_url=srv.base_url, token="tok")
            grant = client.set_access(
                "sl_01h455vb4pex5vsknk084sn02q",
                "usr_01h455vb4pex5vsknk084sn02q",
                "list-editor",
            )

        assert grant.role.value == "list-editor"

    def test_autofill_translations(self) -> None:
        autofill_body = {
            "locale": "fr",
            "source_locale": "en",
            "list_translated": True,
            "items_translated": 248,
            "items_skipped": 1,
        }

        def handle(handler: _Handler, parsed: Any, qs: Any, body: Any) -> None:
            handler.send_json(autofill_body)

        routes = {
            (
                "POST",
                "/v1/selection-lists/sl_01h455vb4pex5vsknk084sn02q/translations/fr/autofill",
            ): handle
        }
        with StubServer(routes) as srv:
            client = SelectionListClient(base_url=srv.base_url, token="tok")
            result = client.autofill_translations(
                "sl_01h455vb4pex5vsknk084sn02q", "fr"
            )

        assert result.items_translated == 248
        assert result.items_skipped == 1

    def test_get_access_page(self) -> None:
        grant = {
            "list_id": "sl_01h455vb4pex5vsknk084sn02q",
            "user_id": "usr_01h455vb4pex5vsknk084sn02q",
            "role": "list-owner",
            "granted_by": "usr_01h455vb4pex5vsknk084sn02q",
            "granted_at": _NOW,
            "updated_at": _NOW,
        }

        def handle(handler: _Handler, parsed: Any, qs: Any, body: Any) -> None:
            handler.send_json(_page([grant]))

        routes = {
            ("GET", "/v1/selection-lists/sl_01h455vb4pex5vsknk084sn02q/access"): handle
        }
        with StubServer(routes) as srv:
            client = SelectionListClient(base_url=srv.base_url, token="tok")
            result = client.get_access("sl_01h455vb4pex5vsknk084sn02q")

        assert len(result.items) == 1
        assert result.items[0].role.value == "list-owner"
        assert result.page.has_more is False

    def test_archive_list(self) -> None:
        archived = dict(_LIST_FIXTURE, status="archived")

        def handle(handler: _Handler, parsed: Any, qs: Any, body: Any) -> None:
            handler.send_json(archived)

        routes = {
            ("POST", "/v1/selection-lists/sl_01h455vb4pex5vsknk084sn02q/archive"): handle
        }
        with StubServer(routes) as srv:
            client = SelectionListClient(base_url=srv.base_url, token="tok")
            result = client.archive_list("sl_01h455vb4pex5vsknk084sn02q")

        assert result.status == LifecycleStatus.ARCHIVED

    def test_archive_item(self) -> None:
        archived_item = dict(_ITEM_FIXTURE, status="archived")

        def handle(handler: _Handler, parsed: Any, qs: Any, body: Any) -> None:
            handler.send_json(archived_item)

        routes = {
            (
                "POST",
                "/v1/selection-lists/sl_01h455vb4pex5vsknk084sn02q/items/sli_01h455vb4pex5vsknk084sn02q/archive",
            ): handle
        }
        with StubServer(routes) as srv:
            client = SelectionListClient(base_url=srv.base_url, token="tok")
            result = client.archive_item(
                "sl_01h455vb4pex5vsknk084sn02q",
                "sli_01h455vb4pex5vsknk084sn02q",
            )

        assert result.status == LifecycleStatus.ARCHIVED


# ---------------------------------------------------------------------------
# Test: pagination envelope shape
# ---------------------------------------------------------------------------


class TestPaginationEnvelope:
    def test_page_next_cursor_and_has_more(self) -> None:
        item1 = dict(_LIST_FIXTURE, id="sl_page1")
        page1_cursor = "eyJsYXN0SWQiOiJzbF8wMSJ9"

        call_num = 0

        def handle(handler: _Handler, parsed: Any, qs: Any, body: Any) -> None:
            nonlocal call_num
            call_num += 1
            if call_num == 1:
                handler.send_json(
                    _page([item1], next_cursor=page1_cursor, has_more=True)
                )
            else:
                handler.send_json(_page([], next_cursor=None, has_more=False))

        routes = {("GET", "/v1/selection-lists"): handle}
        with StubServer(routes) as srv:
            client = SelectionListClient(base_url=srv.base_url, token="tok")
            page = client.get_lists()

        assert page.page.next_cursor == page1_cursor
        assert page.page.has_more is True

    def test_limit_forwarded_to_server(self) -> None:
        received_qs: list = []

        def handle(handler: _Handler, parsed: Any, qs: Any, body: Any) -> None:
            received_qs.append(qs)
            handler.send_json(_page([]))

        routes = {("GET", "/v1/selection-lists"): handle}
        with StubServer(routes) as srv:
            client = SelectionListClient(base_url=srv.base_url, token="tok")
            client.get_lists(limit=25)

        assert received_qs[0].get("limit") == ["25"]

    def test_cursor_forwarded_on_second_page(self) -> None:
        received_cursors: list = []

        def handle(handler: _Handler, parsed: Any, qs: Any, body: Any) -> None:
            received_cursors.append(qs.get("cursor", [None])[0])
            handler.send_json(_page([]))

        routes = {("GET", "/v1/selection-lists"): handle}
        with StubServer(routes) as srv:
            client = SelectionListClient(base_url=srv.base_url, token="tok")
            client.get_lists(cursor="some-opaque-cursor")

        assert received_cursors[0] == "some-opaque-cursor"


# ---------------------------------------------------------------------------
# Test: constructor validation
# ---------------------------------------------------------------------------


class TestConstructor:
    def test_empty_base_url_raises(self) -> None:
        with pytest.raises(ValueError, match="base_url"):
            SelectionListClient(base_url="")

    def test_default_locale_applied(self) -> None:
        received_qs: list = []

        def handle(handler: _Handler, parsed: Any, qs: Any, body: Any) -> None:
            received_qs.append(qs)
            handler.send_json(_page([]))

        routes = {("GET", "/v1/selection-lists"): handle}
        with StubServer(routes) as srv:
            client = SelectionListClient(
                base_url=srv.base_url, token="tok", default_locale="de"
            )
            client.get_lists()

        assert received_qs[0].get("locale") == ["de"]

    def test_explicit_locale_overrides_default(self) -> None:
        received_qs: list = []

        def handle(handler: _Handler, parsed: Any, qs: Any, body: Any) -> None:
            received_qs.append(qs)
            handler.send_json(_page([]))

        routes = {("GET", "/v1/selection-lists"): handle}
        with StubServer(routes) as srv:
            client = SelectionListClient(
                base_url=srv.base_url, token="tok", default_locale="de"
            )
            client.get_lists(locale="fr")

        assert received_qs[0].get("locale") == ["fr"]
