"""
Typed client for the FuzeFront config-service.

Hand-authored from ``services/config-service/openapi.yaml`` v1.0.0 -- the
frozen contract. That spec is the single source of truth; the Node client
(``@fuzefront/config-client``) and this package are both projections of it
and must agree with each other (see ``tests/test_contract_parity.py``).

Zero runtime dependencies -- uses ``urllib.request`` from the stdlib, same
as ``fuzefront-selection-list-client``.

Usage::

    from fuzefront_config_client import ConfigClient, Scope, ScopeType

    client = ConfigClient(
        base_url="http://fuzefront-config-service:3011",
        token="<your-bearer-token>",
    )
    resolved = client.get_effective_config(
        "fuzefront.chat", Scope(scope_type=ScopeType.ORG, scope_id=org_id)
    )
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable, Dict, Generator, Optional, Union

from ._paginator import paginate as _paginate
from .errors import ConfigApiError
from .types import (
    ConfigOperation,
    ConfigWriteRequest,
    ConfigWriteResult,
    EffectiveConfig,
    EffectiveConfigEntry,
    KeyDefinition,
    KeyDefinitionInput,
    KeyDefinitionManifest,
    KeyDefinitionManifestResult,
    Namespace,
    Paged,
    Precedence,
    Scope,
    ScopeType,
    ValueType,
    enum_value,
    page_info_from_wire,
    scope_from_wire,
    scope_to_wire,
)

TokenProvider = Union[str, Callable[[], Optional[str]]]

_ALLOWED_SCHEMES = frozenset(("http", "https"))


class NotModified:
    """
    Sentinel result of a conditional :meth:`ConfigClient.get_effective_config`
    read that the server answered with ``304``.

    A distinct type (rather than ``None`` or a bare ``bool``) so callers must
    explicitly narrow -- see :func:`is_not_modified` -- mirroring the Node
    client's ``NotModified`` discriminated-union member exactly.
    """

    __slots__ = ()

    def __repr__(self) -> str:
        return "NotModified()"

    def __eq__(self, other: object) -> bool:
        return isinstance(other, NotModified)

    def __hash__(self) -> int:
        return hash(NotModified)


NOT_MODIFIED = NotModified()

ConditionalEffectiveConfig = Union[EffectiveConfig, NotModified]
"""A conditional read either returns the config or reports it unchanged."""


def is_not_modified(result: ConditionalEffectiveConfig) -> bool:
    """Narrowing guard for a 304 answer from :meth:`ConfigClient.get_effective_config`."""
    return isinstance(result, NotModified)


class ConfigClient:
    """
    Typed client for the FuzeFront config-service.

    :param base_url:
        Base URL of the service, e.g. ``http://fuzefront-config-service:3011``
        (Kubernetes Service DNS) or an ingress host. Only ``http``/``https``
        are accepted. Trailing slashes are stripped.

        A **relative** base (e.g. ``/api/config``, the same-origin form the
        Node browser client requires) is accepted and preserved verbatim by
        URL construction -- it is never silently rewritten into a fabricated
        absolute host such as ``http://localhost/api/config``. But because
        this client dispatches real network requests via ``urllib`` and has
        no browser page-origin to resolve a relative base against, an
        attempt to actually *make a request* with a relative base raises a
        clear :class:`ValueError` rather than guessing a host. Python
        config-service consumers are server-side microservices, which always
        have a real DNS host to give it.
    :param token:
        Bearer token string, or a callable that returns one (so short-lived
        tokens can refresh between calls).
    :param headers:
        Extra headers merged into every request (tracing, tenant hints).
    """

    def __init__(
        self,
        base_url: str,
        token: Optional[TokenProvider] = None,
        *,
        headers: Optional[Dict[str, str]] = None,
    ) -> None:
        if not base_url:
            raise ValueError("ConfigClient: base_url is required")
        self._base_url = base_url.rstrip("/")
        # An EMPTY scheme means a same-origin relative base ('/api/config') --
        # accepted, see the class docstring. A NON-EMPTY scheme that isn't
        # http/https (e.g. 'file://') is rejected outright: unlike the
        # relative case, that is not "no host to resolve against yet", it is
        # a base_url that will never be resolvable by this transport.
        scheme = urllib.parse.urlparse(self._base_url).scheme.lower()
        self._is_absolute = bool(scheme)
        if self._is_absolute and scheme not in _ALLOWED_SCHEMES:
            raise ValueError(
                f"ConfigClient: base_url must use http or https, got '{scheme}'"
            )
        self._token = token
        self._headers = dict(headers or {})

    # ------------------------------------------------------------------
    # Token resolution
    # ------------------------------------------------------------------

    def _resolve_token(self) -> Optional[str]:
        if callable(self._token):
            return self._token()
        return self._token  # type: ignore[return-value]

    # ------------------------------------------------------------------
    # URL construction
    # ------------------------------------------------------------------

    def _build_url(self, path: str, query: Optional[Dict[str, Any]] = None) -> str:
        # Plain concatenation -- NEVER urllib.parse.urljoin. urljoin silently
        # drops any path segment already present in base_url (e.g. a
        # same-origin '/api/config' prefix, or an ingress path rewrite like
        # 'https://host/api/config') the moment the target path starts with
        # '/', which every endpoint path in this client does. Preserving the
        # caller-supplied base -- including its path -- is the whole point of
        # `base_url`; see the class docstring.
        url = f"{self._base_url}{path}"
        if query:
            qs = urllib.parse.urlencode(
                {k: str(v) for k, v in query.items() if v is not None}
            )
            if qs:
                url = f"{url}?{qs}"
        return url

    # ------------------------------------------------------------------
    # HTTP transport (urllib.request -- stdlib only, zero deps)
    # ------------------------------------------------------------------

    def _do_request(
        self,
        method: str,
        path: str,
        *,
        query: Optional[Dict[str, Any]] = None,
        body: Optional[dict] = None,
        extra_headers: Optional[Dict[str, str]] = None,
    ) -> "tuple[int, Optional[dict]]":
        """
        Make an HTTP request. Returns ``(status, parsed_body_or_None)``.
        Never raises on a non-2xx status -- callers decide what a given
        status means (e.g. ``304`` is a distinct, non-error result for the
        conditional read).
        """
        if not self._is_absolute:
            raise ValueError(
                f"ConfigClient: base_url '{self._base_url}' has no http/https "
                "scheme. Unlike the Node client's browser fetch() (which "
                "resolves a same-origin relative path against the page's own "
                "origin), this Python client makes a real network call via "
                "urllib and needs an explicit host. Pass the service's "
                "absolute base URL (e.g. Kubernetes Service DNS). The "
                "relative string you passed was preserved as-is up to this "
                "point -- it was never rewritten into a fabricated absolute "
                "host."
            )

        url = self._build_url(path, query)
        headers: Dict[str, str] = {
            "Accept": "application/json",
            **self._headers,
            **(extra_headers or {}),
        }
        token = self._resolve_token()
        if token:
            headers["Authorization"] = f"Bearer {token}"

        data: Optional[bytes] = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"

        req = urllib.request.Request(url, data=data, headers=headers, method=method)

        try:
            with urllib.request.urlopen(req) as resp:  # noqa: S310 -- scheme is validated above
                return resp.status, _parse_body(resp.read())
        except urllib.error.HTTPError as exc:
            # urllib raises HTTPError for EVERY non-2xx status, including 304
            # (RFC 7232 "Not Modified" is not a redirect urllib special-cases),
            # so this is the one path that also carries a conditional-read hit.
            return exc.code, _parse_body(exc.read())

    def _request(
        self,
        method: str,
        path: str,
        *,
        query: Optional[Dict[str, Any]] = None,
        body: Optional[dict] = None,
    ) -> dict:
        status, parsed = self._do_request(method, path, query=query, body=body)
        if not (200 <= status < 300):
            _raise_api_error(status, parsed)
        if parsed is None:
            raise ConfigApiError(
                status, "UNKNOWN", f"config-service request failed with {status}: empty or non-JSON body"
            )
        return parsed

    # ------------------------------------------------------------------
    # Namespaces
    # ------------------------------------------------------------------

    def list_namespaces(
        self, *, cursor: Optional[str] = None, limit: Optional[int] = None
    ) -> "Paged[Namespace]":
        """``GET /v1/namespaces`` -- the namespaces the caller may see, newest first."""
        raw = self._request(
            "GET", "/v1/namespaces", query={"cursor": cursor, "limit": limit}
        )
        return Paged(
            items=[_parse_namespace(n) for n in raw.get("items", [])],
            page_info=page_info_from_wire(raw.get("pageInfo", {})),
        )

    def create_namespace(
        self,
        namespace: str,
        display_name: str,
        *,
        description: Optional[str] = None,
        owner_app_id: Optional[str] = None,
    ) -> Namespace:
        """
        ``POST /v1/namespaces`` -- register a namespace.

        Idempotent on ``namespace``: re-registering an existing namespace
        updates its presentation metadata (200) rather than failing (201),
        so an app can register unconditionally at startup.
        """
        body: dict = {"namespace": namespace, "displayName": display_name}
        if description is not None:
            body["description"] = description
        if owner_app_id is not None:
            body["ownerAppId"] = owner_app_id
        raw = self._request("POST", "/v1/namespaces", body=body)
        return _parse_namespace(raw)

    # ------------------------------------------------------------------
    # Key definitions (the catalog)
    # ------------------------------------------------------------------

    def list_key_definitions(
        self,
        namespace: str,
        *,
        cursor: Optional[str] = None,
        limit: Optional[int] = None,
        search: Optional[str] = None,
        category: Optional[str] = None,
        include_hidden: Optional[bool] = None,
    ) -> "Paged[KeyDefinition]":
        """
        ``GET /v1/namespaces/{namespace}/keys`` -- the catalog view.

        ``is_hidden`` keys are omitted server-side for ordinary callers --
        this client does no filtering of its own, because a hidden key that
        reached the caller would already have failed to be hidden.
        """
        query: Dict[str, Any] = {
            "cursor": cursor,
            "limit": limit,
            "search": search,
            "category": category,
        }
        if include_hidden is not None:
            query["includeHidden"] = "true" if include_hidden else "false"
        raw = self._request(
            "GET",
            f"/v1/namespaces/{urllib.parse.quote(namespace, safe='')}/keys",
            query=query,
        )
        return Paged(
            items=[_parse_key_definition(k) for k in raw.get("items", [])],
            page_info=page_info_from_wire(raw.get("pageInfo", {})),
        )

    def get_key_definition(self, namespace: str, key: str) -> KeyDefinition:
        """``GET /v1/namespaces/{namespace}/keys/{key}`` -- one key's metadata."""
        raw = self._request(
            "GET",
            f"/v1/namespaces/{urllib.parse.quote(namespace, safe='')}"
            f"/keys/{urllib.parse.quote(key, safe='')}",
        )
        return _parse_key_definition(raw)

    def register_key_definitions(
        self, namespace: str, manifest: KeyDefinitionManifest
    ) -> KeyDefinitionManifestResult:
        """
        ``PUT /v1/namespaces/{namespace}/keys`` -- declare (upsert) the key
        definitions a namespace owns.

        Idempotent: re-registering an unchanged manifest is a no-op. Set
        ``complete=True`` only when the manifest really is the whole catalog
        -- that is the flag that lets omitted keys be deprecated.
        """
        raw = self._request(
            "PUT",
            f"/v1/namespaces/{urllib.parse.quote(namespace, safe='')}/keys",
            body=_manifest_to_wire(manifest),
        )
        return KeyDefinitionManifestResult(
            created=raw.get("created", []),
            updated=raw.get("updated", []),
            deprecated=raw.get("deprecated", []),
            unchanged=raw.get("unchanged", []),
        )

    # ------------------------------------------------------------------
    # Effective configuration
    # ------------------------------------------------------------------

    def get_effective_config(
        self,
        namespace: str,
        scope: Scope,
        *,
        if_none_match: Optional[str] = None,
    ) -> ConditionalEffectiveConfig:
        """
        ``GET /v1/config`` -- read a scope's fully-resolved configuration.

        Pass ``if_none_match`` (a ``version`` from a previous read) to get a
        cheap :class:`NotModified` answer -- a **distinct result, not an
        error** -- when nothing changed. Use :func:`is_not_modified` to
        narrow. The version reflects the **resolved view**, so a change at
        an ancestor scope invalidates it too.
        """
        scope_type = enum_value(scope.scope_type)
        query: Dict[str, Any] = {
            "namespace": namespace,
            "scopeType": scope_type,
            "scopeId": scope.scope_id,
        }
        extra_headers = {"If-None-Match": if_none_match} if if_none_match else None
        status, parsed = self._do_request(
            "GET", "/v1/config", query=query, extra_headers=extra_headers
        )

        if status == 304:
            return NOT_MODIFIED
        if not (200 <= status < 300):
            _raise_api_error(status, parsed)
        if parsed is None:
            raise ConfigApiError(
                status, "UNKNOWN", f"config-service request failed with {status}: empty or non-JSON body"
            )
        return _parse_effective_config(parsed)

    # ------------------------------------------------------------------
    # Values
    # ------------------------------------------------------------------

    def write_config_values(self, request: ConfigWriteRequest) -> ConfigWriteResult:
        """
        ``PUT /v1/config`` -- apply a batch of value operations to one
        scope, atomically. All operations succeed or none do.

        A refusal raises :class:`~fuzefront_config_client.errors.ConfigApiError`;
        check ``is_locked_by_ancestor`` (carries ``locked_by``) and
        ``is_version_conflict`` (carries ``current_version``) to tell a
        policy refusal from a concurrent-edit collision. **Never blind-retry
        on ``is_version_conflict``** -- re-read at ``current_version`` and
        merge, or you will silently overwrite a concurrent editor's change.
        """
        raw = self._request("PUT", "/v1/config", body=_write_request_to_wire(request))
        return ConfigWriteResult(
            namespace=raw["namespace"],
            scope=scope_from_wire(raw["scope"]),
            version=raw["version"],
            applied=raw.get("applied", []),
        )

    # ------------------------------------------------------------------
    # Paginator helper
    # ------------------------------------------------------------------

    def paginate(
        self,
        method: Callable[..., "Paged[Any]"],
        *,
        cursor: Optional[str] = None,
        limit: Optional[int] = None,
        **kwargs: object,
    ) -> Generator[Any, None, None]:
        """
        Walk every page of a cursor-paginated endpoint, yielding one item
        at a time. See :func:`fuzefront_config_client._paginator.paginate`.
        """
        return _paginate(method, cursor=cursor, limit=limit, **kwargs)


# ---------------------------------------------------------------------------
# Private parsing / serialisation helpers
# ---------------------------------------------------------------------------


def _parse_body(raw: bytes) -> Optional[dict]:
    if not raw:
        return None
    try:
        return json.loads(raw.decode("utf-8", errors="replace"))
    except (json.JSONDecodeError, ValueError):
        # Not a contract response at all -- an ingress error page, a proxy
        # timeout. Deliberately returns None so callers report UNKNOWN rather
        # than inventing a contract code (matches config-client/src/client.ts).
        return None


def _raise_api_error(status: int, parsed: Optional[dict]) -> None:
    if parsed and isinstance(parsed.get("code"), str) and isinstance(parsed.get("message"), str):
        raise ConfigApiError(status, parsed["code"], parsed["message"], body=parsed)
    raise ConfigApiError(
        status, "UNKNOWN", f"config-service request failed with {status}", body=parsed
    )


def _parse_namespace(raw: dict) -> Namespace:
    return Namespace(
        id=raw["id"],
        namespace=raw["namespace"],
        display_name=raw["displayName"],
        created_at=raw["createdAt"],
        description=raw.get("description"),
        owner_app_id=raw.get("ownerAppId"),
    )


def _parse_key_definition(raw: dict) -> KeyDefinition:
    return KeyDefinition(
        id=raw["id"],
        key=raw["key"],
        display_name=raw["displayName"],
        value_type=ValueType(raw["valueType"]),
        default_value=raw.get("defaultValue"),
        allowed_scopes=[ScopeType(s) for s in raw.get("allowedScopes", [])],
        is_system=raw["isSystem"],
        is_hidden=raw["isHidden"],
        is_secret=raw["isSecret"],
        is_readonly=raw["isReadonly"],
        precedence=Precedence(raw["precedence"]),
        requires_restart=raw["requiresRestart"],
        description=raw.get("description"),
        help_url=raw.get("helpUrl"),
        category=raw.get("category"),
        sort_order=raw.get("sortOrder"),
        tags=raw.get("tags"),
        schema=raw.get("schema"),
        enum_values=raw.get("enumValues"),
        deprecated_at=raw.get("deprecatedAt"),
        replaced_by=raw.get("replacedBy"),
    )


def _parse_effective_config_entry(raw: dict) -> EffectiveConfigEntry:
    return EffectiveConfigEntry(
        key=raw["key"],
        value=raw.get("value"),
        source=scope_from_wire(raw["source"]),
        locked=raw["locked"],
        editable=raw["editable"],
        definition=_parse_key_definition(raw["definition"]),
        is_set=raw.get("isSet"),
        locked_by=scope_from_wire(raw.get("lockedBy")),
        lock_reason=raw.get("lockReason"),
        warning=raw.get("warning"),
    )


def _parse_effective_config(raw: dict) -> EffectiveConfig:
    return EffectiveConfig(
        namespace=raw["namespace"],
        scope=scope_from_wire(raw["scope"]),
        version=raw["version"],
        entries=[_parse_effective_config_entry(e) for e in raw.get("entries", [])],
    )


def _key_definition_input_to_wire(k: KeyDefinitionInput) -> dict:
    wire: dict = {
        "key": k.key,
        "displayName": k.display_name,
        "valueType": enum_value(k.value_type),
        "defaultValue": k.default_value,
        "allowedScopes": [enum_value(s) for s in k.allowed_scopes],
        "isSystem": k.is_system,
        "isHidden": k.is_hidden,
        "isSecret": k.is_secret,
        "isReadonly": k.is_readonly,
        "requiresRestart": k.requires_restart,
    }
    if k.description is not None:
        wire["description"] = k.description
    if k.help_url is not None:
        wire["helpUrl"] = k.help_url
    if k.category is not None:
        wire["category"] = k.category
    if k.sort_order is not None:
        wire["sortOrder"] = k.sort_order
    if k.tags is not None:
        wire["tags"] = k.tags
    if k.schema is not None:
        wire["schema"] = k.schema
    if k.enum_values is not None:
        wire["enumValues"] = k.enum_values
    if k.precedence is not None:
        wire["precedence"] = enum_value(k.precedence)
    if k.replaced_by is not None:
        wire["replacedBy"] = k.replaced_by
    return wire


def _manifest_to_wire(m: KeyDefinitionManifest) -> dict:
    return {
        "keys": [_key_definition_input_to_wire(k) for k in m.keys],
        "complete": m.complete,
    }


def _config_operation_to_wire(op: ConfigOperation) -> dict:
    wire: dict = {"key": op.key, "op": enum_value(op.op)}
    if op.value is not None:
        wire["value"] = op.value
    if op.lock_reason is not None:
        wire["lockReason"] = op.lock_reason
    return wire


def _write_request_to_wire(r: ConfigWriteRequest) -> dict:
    wire: dict = {
        "namespace": r.namespace,
        "scope": scope_to_wire(r.scope),
        "operations": [_config_operation_to_wire(o) for o in r.operations],
    }
    if r.expected_version is not None:
        wire["expectedVersion"] = r.expected_version
    if r.reason is not None:
        wire["reason"] = r.reason
    return wire
