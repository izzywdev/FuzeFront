"""
Unit tests for ConfigClient.

Uses an in-process ``http.server`` (stdlib) stub -- no external services, no
third-party test dependencies, zero real network traffic. Mirrors the stub
pattern in ``packages/selection-list-client-py/tests/test_client.py``.

Coverage:
- URL construction: token injection, query forwarding, base-path preservation
  (never dropped by a urljoin-style rebase), relative-base handling
- 304 handled as a distinct NotModified result, not an error
- LOCKED_BY_ANCESTOR vs VERSION_CONFLICT -- the two refusals a caller must
  tell apart, each carrying its documented field
- A non-contract response (ingress 502 / HTML body) surfaces as UNKNOWN,
  never mapped onto a real contract code
- Cursor pagination: envelope shape (`has_next_page`/`next_cursor`), a
  multi-page walk with no gaps/dupes, and the paginate() generator
- Every operation on the write batch serializes per the contract
  (`unset`/`unlock` carry no `value`; `lock` carries `lockReason`)
"""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any, Dict, List, Optional
from urllib.parse import parse_qs, urlparse

import pytest

from fuzefront_config_client import (
    ConfigApiError,
    ConfigClient,
    ConfigOperation,
    ConfigOperationType,
    ConfigWriteRequest,
    KeyDefinitionInput,
    KeyDefinitionManifest,
    Scope,
    ScopeType,
    ValueType,
    is_not_modified,
)


# ---------------------------------------------------------------------------
# Stub HTTP server helpers (same pattern as selection-list-client-py)
# ---------------------------------------------------------------------------


class _Handler(BaseHTTPRequestHandler):
    routes: Dict[tuple, Any] = {}

    def log_message(self, *args: Any) -> None:  # silence access log in tests
        pass

    def _dispatch(self, method: str) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)
        handler = self.routes.get((method, path))
        if handler is None:
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

    def do_PUT(self) -> None:
        self._dispatch("PUT")

    def send_json(self, data: Any, status: int = 200) -> None:
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_not_modified(self) -> None:
        self.send_response(304)
        self.end_headers()

    def send_bad_gateway(self) -> None:
        raw = b"<html>Bad Gateway</html>"
        self.send_response(502)
        self.send_header("Content-Type", "text/html")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


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
# Fixtures
# ---------------------------------------------------------------------------

_NOW = "2026-08-16T12:00:00Z"

_NAMESPACE_FIXTURE: Dict[str, Any] = {
    "id": "cns_01h455vb4pex5vsknk084sn02q",
    "namespace": "fuzefront.chat",
    "displayName": "Chat",
    "description": "Chat settings",
    "ownerAppId": "app_chat",
    "createdAt": _NOW,
}

_KEY_DEFINITION_FIXTURE: Dict[str, Any] = {
    "id": "ckd_01h455vb4pex5vsknk084sn02q",
    "key": "ui.theme.density",
    "displayName": "Density",
    "description": "UI density",
    "helpUrl": None,
    "category": "Appearance",
    "sortOrder": 1,
    "tags": ["ui"],
    "valueType": "enum",
    "schema": None,
    "enumValues": ["comfortable", "compact"],
    "defaultValue": "comfortable",
    "allowedScopes": ["org", "user"],
    "isSystem": False,
    "isHidden": False,
    "isSecret": False,
    "isReadonly": False,
    "precedence": "most-specific-wins",
    "requiresRestart": False,
    "deprecatedAt": None,
    "replacedBy": None,
}


def _page(items: List[Any], next_cursor: Optional[str] = None, has_next_page: bool = False) -> dict:
    return {"items": items, "pageInfo": {"hasNextPage": has_next_page, "nextCursor": next_cursor}}


def _effective_config_entry(**overrides: Any) -> Dict[str, Any]:
    entry = {
        "key": "ui.theme.density",
        "value": "compact",
        "source": {"scopeType": "org", "scopeId": "org_1"},
        "locked": False,
        "lockedBy": None,
        "lockReason": None,
        "editable": True,
        "warning": None,
        "definition": _KEY_DEFINITION_FIXTURE,
    }
    entry.update(overrides)
    return entry


# ---------------------------------------------------------------------------
# Constructor / URL construction
# ---------------------------------------------------------------------------


class TestConstructorAndUrl:
    def test_empty_base_url_raises(self) -> None:
        with pytest.raises(ValueError, match="base_url"):
            ConfigClient(base_url="")

    def test_rejects_non_http_scheme(self) -> None:
        with pytest.raises(ValueError, match="http or https"):
            ConfigClient(base_url="file:///etc/passwd")

    def test_trailing_slash_stripped(self) -> None:
        received_paths: List[str] = []

        def handle(handler: _Handler, parsed: Any, qs: Any, body: Any) -> None:
            received_paths.append(urlparse(handler.path).path)
            handler.send_json(_page([]))

        routes = {("GET", "/v1/namespaces"): handle}
        with StubServer(routes) as srv:
            client = ConfigClient(base_url=srv.base_url + "/", token="tok")
            client.list_namespaces()

        assert received_paths[0] == "/v1/namespaces"

    def test_base_url_path_prefix_is_preserved_not_dropped(self) -> None:
        """
        The base_url's own path (e.g. an ingress rewrite to '/api/config')
        must survive concatenation with an endpoint path -- a naive
        urllib.parse.urljoin('http://host/api/config', '/v1/namespaces')
        would silently produce 'http://host/v1/namespaces', dropping
        '/api/config' entirely. This is exactly the bug CLAUDE.md's
        same-origin-base rule exists to prevent.
        """
        received_paths: List[str] = []

        def handle(handler: _Handler, parsed: Any, qs: Any, body: Any) -> None:
            received_paths.append(handler.path)
            handler.send_json(_page([]))

        routes = {("GET", "/api/config/v1/namespaces"): handle}
        with StubServer(routes) as srv:
            client = ConfigClient(base_url=srv.base_url + "/api/config", token="tok")
            client.list_namespaces()

        assert received_paths == ["/api/config/v1/namespaces"]

    def test_relative_base_url_is_accepted_at_construction(self) -> None:
        """
        A same-origin relative base (what the Node browser client requires)
        must not be rejected at construction, and must not be silently
        rewritten into a fabricated absolute host.
        """
        client = ConfigClient(base_url="/api/config")
        # _build_url is pure string construction -- no network involved --
        # and must preserve the relative form verbatim.
        assert client._build_url("/v1/namespaces") == "/api/config/v1/namespaces"
        assert "localhost" not in client._build_url("/v1/namespaces")
        assert "http://" not in client._build_url("/v1/namespaces")

    def test_relative_base_url_raises_a_clear_error_on_an_actual_request(self) -> None:
        """
        Unlike a browser fetch(), this client makes a real network call and
        has no page origin to resolve a relative base against. It must fail
        loudly and explain why -- not silently invent a host.
        """
        client = ConfigClient(base_url="/api/config")
        with pytest.raises(ValueError, match="no http/https"):
            client.list_namespaces()

    def test_bearer_token_injected(self) -> None:
        received_headers: List[dict] = []

        def handle(handler: _Handler, parsed: Any, qs: Any, body: Any) -> None:
            received_headers.append(dict(handler.headers))
            handler.send_json(_page([_NAMESPACE_FIXTURE]))

        routes = {("GET", "/v1/namespaces"): handle}
        with StubServer(routes) as srv:
            client = ConfigClient(base_url=srv.base_url, token="test-token-abc")
            client.list_namespaces()

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
            handler.send_json(_page([]))

        routes = {("GET", "/v1/namespaces"): handle}
        with StubServer(routes) as srv:
            client = ConfigClient(base_url=srv.base_url, token=token_fn)
            client.list_namespaces()
            client.list_namespaces()

        assert call_count == 2
        assert received_auth == ["Bearer token-1", "Bearer token-2"]

    def test_no_token_no_auth_header(self) -> None:
        received_headers: List[dict] = []

        def handle(handler: _Handler, parsed: Any, qs: Any, body: Any) -> None:
            received_headers.append(dict(handler.headers))
            handler.send_json(_page([]))

        routes = {("GET", "/v1/namespaces"): handle}
        with StubServer(routes) as srv:
            client = ConfigClient(base_url=srv.base_url)
            client.list_namespaces()

        assert "Authorization" not in received_headers[0]

    def test_extra_headers_merged(self) -> None:
        received_headers: List[dict] = []

        def handle(handler: _Handler, parsed: Any, qs: Any, body: Any) -> None:
            received_headers.append(dict(handler.headers))
            handler.send_json(_page([]))

        routes = {("GET", "/v1/namespaces"): handle}
        with StubServer(routes) as srv:
            client = ConfigClient(base_url=srv.base_url, headers={"X-Trace-Id": "abc123"})
            client.list_namespaces()

        assert received_headers[0].get("X-Trace-Id") == "abc123"


# ---------------------------------------------------------------------------
# Namespaces
# ---------------------------------------------------------------------------


class TestNamespaces:
    def test_list_namespaces_query_forwarded(self) -> None:
        received_qs: list = []

        def handle(handler: _Handler, parsed: Any, qs: Any, body: Any) -> None:
            received_qs.append(qs)
            handler.send_json(_page([_NAMESPACE_FIXTURE]))

        routes = {("GET", "/v1/namespaces"): handle}
        with StubServer(routes) as srv:
            client = ConfigClient(base_url=srv.base_url, token="tok")
            page = client.list_namespaces(cursor="abc", limit=10)

        assert received_qs[0].get("cursor") == ["abc"]
        assert received_qs[0].get("limit") == ["10"]
        assert page.items[0].namespace == "fuzefront.chat"
        assert page.items[0].id == "cns_01h455vb4pex5vsknk084sn02q"

    def test_create_namespace_body_omits_none_fields(self) -> None:
        received_bodies: list = []

        def handle(handler: _Handler, parsed: Any, qs: Any, body: Any) -> None:
            received_bodies.append(body)
            handler.send_json(_NAMESPACE_FIXTURE, status=201)

        routes = {("POST", "/v1/namespaces"): handle}
        with StubServer(routes) as srv:
            client = ConfigClient(base_url=srv.base_url, token="tok")
            ns = client.create_namespace("fuzefront.chat", "Chat")

        assert received_bodies[0] == {"namespace": "fuzefront.chat", "displayName": "Chat"}
        assert ns.namespace == "fuzefront.chat"

    def test_create_namespace_idempotent_200(self) -> None:
        """Re-registering an existing namespace returns 200, not 201 -- both must parse."""

        def handle(handler: _Handler, parsed: Any, qs: Any, body: Any) -> None:
            handler.send_json(_NAMESPACE_FIXTURE, status=200)

        routes = {("POST", "/v1/namespaces"): handle}
        with StubServer(routes) as srv:
            client = ConfigClient(base_url=srv.base_url, token="tok")
            ns = client.create_namespace(
                "fuzefront.chat", "Chat", description="d", owner_app_id="app_chat"
            )

        assert ns.id == "cns_01h455vb4pex5vsknk084sn02q"


# ---------------------------------------------------------------------------
# Key definitions
# ---------------------------------------------------------------------------


class TestKeyDefinitions:
    def test_list_key_definitions_filters_forwarded(self) -> None:
        received_qs: list = []

        def handle(handler: _Handler, parsed: Any, qs: Any, body: Any) -> None:
            received_qs.append(qs)
            handler.send_json(_page([_KEY_DEFINITION_FIXTURE]))

        routes = {("GET", "/v1/namespaces/fuzefront.chat/keys"): handle}
        with StubServer(routes) as srv:
            client = ConfigClient(base_url=srv.base_url, token="tok")
            page = client.list_key_definitions(
                "fuzefront.chat", search="density", category="Appearance", include_hidden=True
            )

        assert received_qs[0].get("search") == ["density"]
        assert received_qs[0].get("category") == ["Appearance"]
        assert received_qs[0].get("includeHidden") == ["true"]
        assert page.items[0].value_type.value == "enum"
        assert page.items[0].allowed_scopes[0].value == "org"

    def test_get_key_definition(self) -> None:
        def handle(handler: _Handler, parsed: Any, qs: Any, body: Any) -> None:
            handler.send_json(_KEY_DEFINITION_FIXTURE)

        routes = {("GET", "/v1/namespaces/fuzefront.chat/keys/ui.theme.density"): handle}
        with StubServer(routes) as srv:
            client = ConfigClient(base_url=srv.base_url, token="tok")
            kd = client.get_key_definition("fuzefront.chat", "ui.theme.density")

        assert kd.key == "ui.theme.density"
        assert kd.precedence.value == "most-specific-wins"

    def test_get_key_definition_hidden_is_404(self) -> None:
        def handle(handler: _Handler, parsed: Any, qs: Any, body: Any) -> None:
            handler.send_json({"code": "NOT_FOUND", "message": "No such key."}, status=404)

        routes = {("GET", "/v1/namespaces/fuzefront.chat/keys/secret.hidden"): handle}
        with StubServer(routes) as srv:
            client = ConfigClient(base_url=srv.base_url, token="tok")
            with pytest.raises(ConfigApiError) as excinfo:
                client.get_key_definition("fuzefront.chat", "secret.hidden")

        assert excinfo.value.code == "NOT_FOUND"
        assert excinfo.value.status == 404

    def test_register_key_definitions_serializes_manifest(self) -> None:
        received_bodies: list = []

        def handle(handler: _Handler, parsed: Any, qs: Any, body: Any) -> None:
            received_bodies.append(body)
            handler.send_json(
                {"created": ["ui.theme.density"], "updated": [], "deprecated": [], "unchanged": []}
            )

        routes = {("PUT", "/v1/namespaces/fuzefront.chat/keys"): handle}
        with StubServer(routes) as srv:
            client = ConfigClient(base_url=srv.base_url, token="tok")
            manifest = KeyDefinitionManifest(
                keys=[
                    KeyDefinitionInput(
                        key="ui.theme.density",
                        display_name="Density",
                        value_type=ValueType.ENUM,
                        default_value="comfortable",
                        allowed_scopes=[ScopeType.ORG, ScopeType.USER],
                        enum_values=["comfortable", "compact"],
                    )
                ],
                complete=True,
            )
            result = client.register_key_definitions("fuzefront.chat", manifest)

        body = received_bodies[0]
        assert body["complete"] is True
        key_wire = body["keys"][0]
        assert key_wire["key"] == "ui.theme.density"
        assert key_wire["valueType"] == "enum"
        assert key_wire["allowedScopes"] == ["org", "user"]
        assert key_wire["isSystem"] is False
        assert key_wire["isHidden"] is False
        assert "description" not in key_wire  # omitted -- was never set
        assert result.created == ["ui.theme.density"]


# ---------------------------------------------------------------------------
# Effective configuration -- conditional read (304)
# ---------------------------------------------------------------------------


class TestEffectiveConfig:
    def test_returns_resolved_config_with_provenance(self) -> None:
        def handle(handler: _Handler, parsed: Any, qs: Any, body: Any) -> None:
            handler.send_json(
                {
                    "namespace": "fuzefront.chat",
                    "scope": {"scopeType": "org", "scopeId": "org_1"},
                    "version": "v1",
                    "entries": [_effective_config_entry()],
                }
            )

        routes = {("GET", "/v1/config"): handle}
        with StubServer(routes) as srv:
            client = ConfigClient(base_url=srv.base_url, token="tok")
            resolved = client.get_effective_config(
                "fuzefront.chat", Scope(scope_type=ScopeType.ORG, scope_id="org_1")
            )

        assert not is_not_modified(resolved)
        assert resolved.version == "v1"
        entry = resolved.entries[0]
        assert entry.value == "compact"
        assert entry.source.scope_type == ScopeType.ORG
        assert entry.locked is False
        assert entry.editable is True
        assert entry.definition.key == "ui.theme.density"

    def test_scope_and_namespace_query_forwarded(self) -> None:
        received_qs: list = []

        def handle(handler: _Handler, parsed: Any, qs: Any, body: Any) -> None:
            received_qs.append(qs)
            handler.send_json(
                {
                    "namespace": "fuzefront.chat",
                    "scope": {"scopeType": "platform", "scopeId": None},
                    "version": "v1",
                    "entries": [],
                }
            )

        routes = {("GET", "/v1/config"): handle}
        with StubServer(routes) as srv:
            client = ConfigClient(base_url=srv.base_url, token="tok")
            client.get_effective_config("fuzefront.chat", Scope(scope_type=ScopeType.PLATFORM))

        assert received_qs[0].get("namespace") == ["fuzefront.chat"]
        assert received_qs[0].get("scopeType") == ["platform"]
        assert "scopeId" not in received_qs[0]  # None omitted, not stringified to 'None'

    def test_304_returns_not_modified_not_an_error(self) -> None:
        """The core AC: 304 is a distinct successful result, never raised as an error."""
        received_headers: List[dict] = []

        def handle(handler: _Handler, parsed: Any, qs: Any, body: Any) -> None:
            received_headers.append(dict(handler.headers))
            handler.send_not_modified()

        routes = {("GET", "/v1/config"): handle}
        with StubServer(routes) as srv:
            client = ConfigClient(base_url=srv.base_url, token="tok")
            result = client.get_effective_config(
                "fuzefront.chat",
                Scope(scope_type=ScopeType.ORG, scope_id="org_1"),
                if_none_match="v1",
            )

        assert is_not_modified(result)
        assert received_headers[0].get("If-None-Match") == "v1"

    def test_forbidden_scope_raises_and_reveals_nothing(self) -> None:
        def handle(handler: _Handler, parsed: Any, qs: Any, body: Any) -> None:
            handler.send_json(
                {"code": "FORBIDDEN", "message": "No authority over this scope."}, status=403
            )

        routes = {("GET", "/v1/config"): handle}
        with StubServer(routes) as srv:
            client = ConfigClient(base_url=srv.base_url, token="tok")
            with pytest.raises(ConfigApiError) as excinfo:
                client.get_effective_config(
                    "fuzefront.chat", Scope(scope_type=ScopeType.ORG, scope_id="org_1")
                )

        assert excinfo.value.code == "FORBIDDEN"


# ---------------------------------------------------------------------------
# Values -- writes and the two refusals worth distinguishing
# ---------------------------------------------------------------------------


class TestWriteConfigValues:
    def test_operations_serialize_per_op_type(self) -> None:
        """`unset`/`unlock` must NOT carry a `value` key; `lock` carries `lockReason`."""
        received_bodies: list = []

        def handle(handler: _Handler, parsed: Any, qs: Any, body: Any) -> None:
            received_bodies.append(body)
            handler.send_json(
                {
                    "namespace": "fuzefront.chat",
                    "scope": {"scopeType": "org", "scopeId": "org_1"},
                    "version": "v2",
                    "applied": ["ui.theme.density", "ui.sidebar.collapsed"],
                }
            )

        routes = {("PUT", "/v1/config"): handle}
        with StubServer(routes) as srv:
            client = ConfigClient(base_url=srv.base_url, token="tok")
            request = ConfigWriteRequest(
                namespace="fuzefront.chat",
                scope=Scope(scope_type=ScopeType.ORG, scope_id="org_1"),
                operations=[
                    ConfigOperation(key="ui.theme.density", op=ConfigOperationType.SET, value="compact"),
                    ConfigOperation(key="ui.sidebar.collapsed", op=ConfigOperationType.UNSET),
                    ConfigOperation(
                        key="ui.banner",
                        op=ConfigOperationType.LOCK,
                        value="on",
                        lock_reason="Portal policy",
                    ),
                    ConfigOperation(key="ui.banner2", op=ConfigOperationType.UNLOCK),
                ],
                expected_version="v1",
                reason="settings page save",
            )
            result = client.write_config_values(request)

        wire_ops = received_bodies[0]["operations"]
        assert wire_ops[0] == {"key": "ui.theme.density", "op": "set", "value": "compact"}
        assert wire_ops[1] == {"key": "ui.sidebar.collapsed", "op": "unset"}
        assert wire_ops[2] == {
            "key": "ui.banner",
            "op": "lock",
            "value": "on",
            "lockReason": "Portal policy",
        }
        assert wire_ops[3] == {"key": "ui.banner2", "op": "unlock"}
        assert received_bodies[0]["expectedVersion"] == "v1"
        assert received_bodies[0]["reason"] == "settings page save"
        assert result.version == "v2"
        assert result.applied == ["ui.theme.density", "ui.sidebar.collapsed"]

    def test_locked_by_ancestor_carries_locked_by(self) -> None:
        def handle(handler: _Handler, parsed: Any, qs: Any, body: Any) -> None:
            handler.send_json(
                {
                    "code": "LOCKED_BY_ANCESTOR",
                    "message": "Locked by portal.",
                    "lockedBy": {"scopeType": "portal", "scopeId": "portal_1"},
                },
                status=409,
            )

        routes = {("PUT", "/v1/config"): handle}
        with StubServer(routes) as srv:
            client = ConfigClient(base_url=srv.base_url, token="tok")
            request = ConfigWriteRequest(
                namespace="fuzefront.chat",
                scope=Scope(scope_type=ScopeType.ORG, scope_id="org_1"),
                operations=[ConfigOperation(key="ui.banner", op=ConfigOperationType.SET, value="x")],
            )
            with pytest.raises(ConfigApiError) as excinfo:
                client.write_config_values(request)

        err = excinfo.value
        assert err.code == "LOCKED_BY_ANCESTOR"
        assert err.is_locked_by_ancestor is True
        assert err.is_version_conflict is False
        assert err.locked_by is not None
        assert err.locked_by.scope_type == ScopeType.PORTAL
        assert err.locked_by.scope_id == "portal_1"

    def test_version_conflict_carries_current_version_and_does_not_auto_retry(self) -> None:
        call_count = 0

        def handle(handler: _Handler, parsed: Any, qs: Any, body: Any) -> None:
            nonlocal call_count
            call_count += 1
            handler.send_json(
                {
                    "code": "VERSION_CONFLICT",
                    "message": "Resolved view moved.",
                    "currentVersion": "v7",
                },
                status=409,
            )

        routes = {("PUT", "/v1/config"): handle}
        with StubServer(routes) as srv:
            client = ConfigClient(base_url=srv.base_url, token="tok")
            request = ConfigWriteRequest(
                namespace="fuzefront.chat",
                scope=Scope(scope_type=ScopeType.ORG, scope_id="org_1"),
                operations=[ConfigOperation(key="ui.banner", op=ConfigOperationType.SET, value="x")],
                expected_version="v1",
            )
            with pytest.raises(ConfigApiError) as excinfo:
                client.write_config_values(request)

        err = excinfo.value
        assert err.code == "VERSION_CONFLICT"
        assert err.is_version_conflict is True
        assert err.is_locked_by_ancestor is False
        assert err.current_version == "v7"
        # The client itself never blind-retries a version conflict -- exactly
        # one request was made. Re-reading and merging is the CALLER's job.
        assert call_count == 1

    def test_validation_error_details_populated(self) -> None:
        def handle(handler: _Handler, parsed: Any, qs: Any, body: Any) -> None:
            handler.send_json(
                {
                    "code": "VALIDATION_ERROR",
                    "message": "Invalid value.",
                    "details": [
                        {
                            "key": "ui.theme.density",
                            "field": None,
                            "message": "must be one of the enum values",
                            "allowedValues": ["comfortable", "compact"],
                        }
                    ],
                },
                status=400,
            )

        routes = {("PUT", "/v1/config"): handle}
        with StubServer(routes) as srv:
            client = ConfigClient(base_url=srv.base_url, token="tok")
            request = ConfigWriteRequest(
                namespace="fuzefront.chat",
                scope=Scope(scope_type=ScopeType.ORG, scope_id="org_1"),
                operations=[
                    ConfigOperation(key="ui.theme.density", op=ConfigOperationType.SET, value="huge")
                ],
            )
            with pytest.raises(ConfigApiError) as excinfo:
                client.write_config_values(request)

        err = excinfo.value
        assert err.code == "VALIDATION_ERROR"
        assert err.details is not None
        assert err.details[0].key == "ui.theme.density"
        assert err.details[0].allowed_values == ["comfortable", "compact"]

    def test_non_contract_response_is_unknown_not_a_guessed_code(self) -> None:
        """
        An ingress 502 / HTML error page is not a contract response at all.
        It must surface as UNKNOWN, never mapped onto a real contract code --
        doing so would send the caller down the wrong recovery path.
        """

        def handle(handler: _Handler, parsed: Any, qs: Any, body: Any) -> None:
            handler.send_bad_gateway()

        routes = {("PUT", "/v1/config"): handle}
        with StubServer(routes) as srv:
            client = ConfigClient(base_url=srv.base_url, token="tok")
            request = ConfigWriteRequest(
                namespace="fuzefront.chat",
                scope=Scope(scope_type=ScopeType.ORG, scope_id="org_1"),
                operations=[ConfigOperation(key="ui.banner", op=ConfigOperationType.SET, value="x")],
            )
            with pytest.raises(ConfigApiError) as excinfo:
                client.write_config_values(request)

        assert excinfo.value.code == "UNKNOWN"
        assert excinfo.value.status == 502
        assert excinfo.value.locked_by is None
        assert excinfo.value.current_version is None


# ---------------------------------------------------------------------------
# Pagination envelope + cursor walk
# ---------------------------------------------------------------------------


class TestPagination:
    def test_page_envelope_shape(self) -> None:
        cursor = "eyJsYXN0SWQiOiJjbnNfMDEifQ"

        def handle(handler: _Handler, parsed: Any, qs: Any, body: Any) -> None:
            handler.send_json(_page([_NAMESPACE_FIXTURE], next_cursor=cursor, has_next_page=True))

        routes = {("GET", "/v1/namespaces"): handle}
        with StubServer(routes) as srv:
            client = ConfigClient(base_url=srv.base_url, token="tok")
            page = client.list_namespaces()

        assert page.page_info.has_next_page is True
        assert page.page_info.next_cursor == cursor

    def test_last_page_has_null_next_cursor(self) -> None:
        def handle(handler: _Handler, parsed: Any, qs: Any, body: Any) -> None:
            handler.send_json(_page([], next_cursor=None, has_next_page=False))

        routes = {("GET", "/v1/namespaces"): handle}
        with StubServer(routes) as srv:
            client = ConfigClient(base_url=srv.base_url, token="tok")
            page = client.list_namespaces()

        assert page.page_info.has_next_page is False
        assert page.page_info.next_cursor is None

    def test_two_page_cursor_walk_no_gaps_no_dupes(self) -> None:
        page1_item = dict(_NAMESPACE_FIXTURE, id="cns_page1", namespace="a")
        page2_item = dict(_NAMESPACE_FIXTURE, id="cns_page2", namespace="b")
        page1_cursor = "cursor-page-2"
        call_log: List[Optional[str]] = []

        def handle(handler: _Handler, parsed: Any, qs: Any, body: Any) -> None:
            cursor = qs.get("cursor", [None])[0]
            call_log.append(cursor)
            if cursor is None:
                handler.send_json(_page([page1_item], next_cursor=page1_cursor, has_next_page=True))
            else:
                handler.send_json(_page([page2_item], next_cursor=None, has_next_page=False))

        routes = {("GET", "/v1/namespaces"): handle}
        with StubServer(routes) as srv:
            client = ConfigClient(base_url=srv.base_url, token="tok")
            results = list(client.paginate(client.list_namespaces))

        assert len(results) == 2
        ids = [r.id for r in results]
        assert ids == ["cns_page1", "cns_page2"]
        assert len(ids) == len(set(ids))  # no duplicates
        assert call_log == [None, page1_cursor]  # cursor echoed back verbatim

    def test_single_page_stops_after_one_call(self) -> None:
        call_count = 0

        def handle(handler: _Handler, parsed: Any, qs: Any, body: Any) -> None:
            nonlocal call_count
            call_count += 1
            handler.send_json(_page([_NAMESPACE_FIXTURE], next_cursor=None, has_next_page=False))

        routes = {("GET", "/v1/namespaces"): handle}
        with StubServer(routes) as srv:
            client = ConfigClient(base_url=srv.base_url, token="tok")
            results = list(client.paginate(client.list_namespaces))

        assert call_count == 1
        assert len(results) == 1

    def test_limit_forwarded_verbatim_clamping_is_the_service_not_this_client(self) -> None:
        """
        `limit`'s min/max/default (1-200, default 50) is enforced SERVER-side
        per the contract's `Limit` parameter schema. This client is a thin
        HTTP projection and must forward exactly what the caller passed --
        it must not invent its own clamping the service would then reject or
        silently disagree with.
        """
        received_qs: list = []

        def handle(handler: _Handler, parsed: Any, qs: Any, body: Any) -> None:
            received_qs.append(qs)
            handler.send_json(_page([]))

        routes = {("GET", "/v1/namespaces"): handle}
        with StubServer(routes) as srv:
            client = ConfigClient(base_url=srv.base_url, token="tok")
            client.list_namespaces(limit=500)  # over the contract max -- server's call, not ours

        assert received_qs[0].get("limit") == ["500"]
