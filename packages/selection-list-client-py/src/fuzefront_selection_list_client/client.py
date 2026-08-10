"""
Typed client for the FuzeFront selection-list-service.

One method per endpoint of ``services/selection-list-service/openapi.yaml``
v1.0.0. Zero runtime dependencies — uses ``urllib.request`` from the stdlib.

Usage::

    from fuzefront_selection_list_client import SelectionListClient

    client = SelectionListClient(
        base_url="http://fuzefront-selection-list-service:3011",
        token="eyJhbGciOiJSUzI1NiJ9...",
    )
    page = client.get_lists()
    for sl in page.items:
        print(sl.id, sl.name)
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Callable, Dict, Generator, List, Optional, Union

from ._paginator import paginate as _paginate
from .errors import SelectionListApiError, _code_from_status
from .types import (
    AccessEntry,
    AutofillRequest,
    AutofillResult,
    CreateItemRequest,
    CreateListRequest,
    Page,
    PagedResponse,
    QuotaInfo,
    QuotaScope,
    ResolveResponse,
    ResolveResult,
    SelectionList,
    SelectionListAccessRole,
    SelectionListErrorCode,
    SelectionListItem,
    SelectionListItemTranslation,
    SelectionListQuotaStatus,
    Translation,
    UpdateItemRequest,
    UpdateListRequest,
    UpsertItemTranslationRequest,
    UpsertListTranslationRequest,
    LifecycleStatus,
)

TokenProvider = Union[str, Callable[[], str]]


def _to_dict_omit_none(obj: object) -> dict:
    """Shallow-serialise a dataclass, dropping ``None`` values."""
    if hasattr(obj, "__dataclass_fields__"):
        return {
            k: v
            for k, v in vars(obj).items()
            if v is not None
        }
    return {}


def _parse_page(raw: dict) -> Page:
    pg = raw.get("page", {})
    return Page(
        next_cursor=pg.get("nextCursor"),
        has_more=pg.get("hasMore", False),
        total=pg.get("total"),
    )


def _parse_selection_list(raw: dict) -> SelectionList:
    return SelectionList(
        id=raw["id"],
        organization_id=raw["organization_id"],
        key=raw["key"],
        source_locale=raw["source_locale"],
        status=LifecycleStatus(raw["status"]),
        name=raw["name"],
        resolved_locale=raw["resolved_locale"],
        is_machine=raw["is_machine"],
        created_by=raw["created_by"],
        created_at=raw["created_at"],
        updated_at=raw["updated_at"],
        description=raw.get("description"),
        item_count=raw.get("item_count"),
    )


def _parse_item(raw: dict) -> SelectionListItem:
    return SelectionListItem(
        id=raw["id"],
        list_id=raw["list_id"],
        code=raw["code"],
        sort_order=raw["sort_order"],
        status=LifecycleStatus(raw["status"]),
        label=raw["label"],
        resolved_locale=raw["resolved_locale"],
        is_machine=raw["is_machine"],
        created_by=raw["created_by"],
        created_at=raw["created_at"],
        updated_at=raw["updated_at"],
        description=raw.get("description"),
    )


def _parse_translation(raw: dict) -> Translation:
    return Translation(
        list_id=raw["list_id"],
        locale=raw["locale"],
        name=raw["name"],
        is_machine=raw["is_machine"],
        updated_at=raw["updated_at"],
        description=raw.get("description"),
        source_hash=raw.get("source_hash"),
    )


def _parse_item_translation(raw: dict) -> SelectionListItemTranslation:
    return SelectionListItemTranslation(
        item_id=raw["item_id"],
        locale=raw["locale"],
        label=raw["label"],
        is_machine=raw["is_machine"],
        updated_at=raw["updated_at"],
        description=raw.get("description"),
        source_hash=raw.get("source_hash"),
    )


def _parse_autofill_result(raw: dict) -> AutofillResult:
    return AutofillResult(
        locale=raw["locale"],
        source_locale=raw["source_locale"],
        list_translated=raw["list_translated"],
        items_translated=raw["items_translated"],
        items_skipped=raw["items_skipped"],
    )


def _parse_access_entry(raw: dict) -> AccessEntry:
    return AccessEntry(
        list_id=raw["list_id"],
        user_id=raw["user_id"],
        role=SelectionListAccessRole(raw["role"]),
        granted_by=raw["granted_by"],
        granted_at=raw["granted_at"],
        updated_at=raw["updated_at"],
    )


def _parse_quota_status(raw: dict) -> SelectionListQuotaStatus:
    quotas = [
        QuotaInfo(
            scope=QuotaScope(q["scope"]),
            applies_to=q["applies_to"],
            limit=q["limit"],
            current=q.get("current"),
        )
        for q in raw.get("quotas", [])
    ]
    return SelectionListQuotaStatus(
        organization_id=raw["organization_id"],
        quotas=quotas,
    )


def _parse_resolve_response(raw: dict) -> ResolveResponse:
    results = {
        k: ResolveResult(
            label=v["label"],
            locale=v["locale"],
            is_machine=v["is_machine"],
            status=LifecycleStatus(v["status"]),
        )
        for k, v in raw.get("results", {}).items()
    }
    return ResolveResponse(
        results=results,
        missing=raw.get("missing", []),
    )


class SelectionListClient:
    """
    Typed client for the FuzeFront selection-list-service.

    :param base_url:
        Base URL of the service. Trailing slashes are stripped.
    :param token:
        Bearer token string, or a callable that returns one (so short-lived
        tokens can refresh between calls). Optional — ``resolve_ids`` may be
        called unauthenticated by a trusted in-cluster caller.
    :param default_locale:
        Locale applied to every request that does not pass its own.
    """

    def __init__(
        self,
        base_url: str,
        token: Optional[TokenProvider] = None,
        *,
        default_locale: Optional[str] = None,
    ) -> None:
        if not base_url:
            raise ValueError("SelectionListClient: base_url is required")
        self._base_url = base_url.rstrip("/")
        self._token = token
        self._default_locale = default_locale

    # ------------------------------------------------------------------
    # Token resolution
    # ------------------------------------------------------------------

    def _resolve_token(self) -> Optional[str]:
        if callable(self._token):
            return self._token()
        return self._token

    # ------------------------------------------------------------------
    # HTTP transport (urllib.request — stdlib only, zero deps)
    # ------------------------------------------------------------------

    def _build_url(self, path: str, query: Optional[Dict[str, str]] = None) -> str:
        url = f"{self._base_url}{path}"
        if query:
            qs = urllib.parse.urlencode({k: v for k, v in query.items() if v is not None})
            if qs:
                url = f"{url}?{qs}"
        return url

    def _request(
        self,
        method: str,
        path: str,
        *,
        query: Optional[Dict[str, str]] = None,
        body: Optional[dict] = None,
        allow_empty: bool = False,
    ) -> Optional[dict]:
        """
        Make an HTTP request. Returns the parsed JSON body, or ``None`` on
        ``204`` when ``allow_empty=True``. Raises ``SelectionListApiError`` on
        non-2xx.
        """
        url = self._build_url(path, query)

        headers: Dict[str, str] = {"Accept": "application/json"}
        tok = self._resolve_token()
        if tok:
            headers["Authorization"] = f"Bearer {tok}"

        data: Optional[bytes] = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"

        req = urllib.request.Request(url, data=data, headers=headers, method=method)

        try:
            with urllib.request.urlopen(req) as resp:
                status: int = resp.status
                raw_body: bytes = resp.read()
        except urllib.error.HTTPError as exc:
            status = exc.code
            raw_body = exc.read()
            parsed_error: Optional[dict] = None
            if raw_body:
                try:
                    parsed_error = json.loads(raw_body.decode("utf-8", errors="replace"))
                except (json.JSONDecodeError, ValueError):
                    parsed_error = None
            _raise_api_error(status, parsed_error)

        # 204 / 205 — empty body
        if status in (204, 205):
            if allow_empty:
                return None
            raise SelectionListApiError(
                code="UNKNOWN",
                message=f"Unexpected empty response from {method} {path}",
                status=status,
            )

        parsed: Optional[dict] = None
        if raw_body:
            try:
                parsed = json.loads(raw_body.decode("utf-8", errors="replace"))
            except (json.JSONDecodeError, ValueError):
                parsed = None

        if not (200 <= status < 300):
            _raise_api_error(status, parsed)

        if parsed is None:
            if allow_empty:
                return None
            raise SelectionListApiError(
                code="UNKNOWN",
                message=f"Malformed JSON in response to {method} {path}",
                status=status,
            )

        return parsed

    # ------------------------------------------------------------------
    # Lists
    # ------------------------------------------------------------------

    def get_lists(
        self,
        *,
        limit: Optional[int] = None,
        cursor: Optional[str] = None,
        status: Optional[str] = None,
        locale: Optional[str] = None,
        key: Optional[str] = None,
    ) -> PagedResponse[SelectionList]:
        """``GET /v1/selection-lists`` — a page of lists in the caller's org."""
        query = _build_query(
            limit=limit,
            cursor=cursor,
            status=status,
            locale=locale or self._default_locale,
            key=key,
        )
        raw = self._request("GET", "/v1/selection-lists", query=query)
        assert raw is not None
        return PagedResponse(
            items=[_parse_selection_list(sl) for sl in raw.get("items", [])],
            page=_parse_page(raw),
        )

    def create_list(
        self,
        key: str,
        name: str,
        *,
        source_locale: Optional[str] = None,
        description: Optional[str] = None,
    ) -> SelectionList:
        """``POST /v1/selection-lists`` — create a list. The service mints the id."""
        body: dict = {"key": key, "name": name}
        if source_locale is not None:
            body["source_locale"] = source_locale
        if description is not None:
            body["description"] = description
        raw = self._request("POST", "/v1/selection-lists", body=body)
        assert raw is not None
        return _parse_selection_list(raw)

    def get_list(
        self,
        list_id: str,
        *,
        locale: Optional[str] = None,
    ) -> SelectionList:
        """``GET /v1/selection-lists/{listId}`` — one list, text resolved for locale."""
        query = _build_query(locale=locale or self._default_locale)
        raw = self._request(
            "GET",
            f"/v1/selection-lists/{urllib.parse.quote(list_id, safe='')}",
            query=query,
        )
        assert raw is not None
        return _parse_selection_list(raw)

    def update_list(
        self,
        list_id: str,
        *,
        key: Optional[str] = None,
        source_locale: Optional[str] = None,
        status: Optional[str] = None,
        name: Optional[str] = None,
        description: Optional[str] = None,
    ) -> SelectionList:
        """``PATCH /v1/selection-lists/{listId}`` — partial update."""
        body = _omit_none(
            key=key,
            source_locale=source_locale,
            status=status,
            name=name,
            description=description,
        )
        raw = self._request(
            "PATCH",
            f"/v1/selection-lists/{urllib.parse.quote(list_id, safe='')}",
            body=body,
        )
        assert raw is not None
        return _parse_selection_list(raw)

    def archive_list(self, list_id: str) -> SelectionList:
        """``POST /v1/selection-lists/{listId}/archive`` — archive a list. Idempotent."""
        raw = self._request(
            "POST",
            f"/v1/selection-lists/{urllib.parse.quote(list_id, safe='')}/archive",
        )
        assert raw is not None
        return _parse_selection_list(raw)

    def delete_list(
        self,
        list_id: str,
        *,
        purge: bool = False,
    ) -> Optional[SelectionList]:
        """
        ``DELETE /v1/selection-lists/{listId}`` — archives by default.

        Pass ``purge=True`` only deliberately: it is irreversible and
        permanently breaks every consumer row holding one of the list's item
        ids. Returns the archived list, or ``None`` when purged (the service
        answers ``204``).
        """
        query = _build_query(purge="true" if purge else None)
        raw = self._request(
            "DELETE",
            f"/v1/selection-lists/{urllib.parse.quote(list_id, safe='')}",
            query=query,
            allow_empty=True,
        )
        if raw is None:
            return None
        return _parse_selection_list(raw)

    # ------------------------------------------------------------------
    # Items
    # ------------------------------------------------------------------

    def get_items(
        self,
        list_id: str,
        *,
        limit: Optional[int] = None,
        cursor: Optional[str] = None,
        status: Optional[str] = None,
        locale: Optional[str] = None,
    ) -> PagedResponse[SelectionListItem]:
        """``GET /v1/selection-lists/{listId}/items`` — a page of items, in sort_order."""
        query = _build_query(
            limit=limit,
            cursor=cursor,
            status=status,
            locale=locale or self._default_locale,
        )
        raw = self._request(
            "GET",
            f"/v1/selection-lists/{urllib.parse.quote(list_id, safe='')}/items",
            query=query,
        )
        assert raw is not None
        return PagedResponse(
            items=[_parse_item(it) for it in raw.get("items", [])],
            page=_parse_page(raw),
        )

    def create_item(
        self,
        list_id: str,
        code: str,
        label: str,
        *,
        description: Optional[str] = None,
        sort_order: Optional[int] = None,
    ) -> SelectionListItem:
        """``POST /v1/selection-lists/{listId}/items`` — add an item."""
        body: dict = {"code": code, "label": label}
        if description is not None:
            body["description"] = description
        if sort_order is not None:
            body["sort_order"] = sort_order
        raw = self._request(
            "POST",
            f"/v1/selection-lists/{urllib.parse.quote(list_id, safe='')}/items",
            body=body,
        )
        assert raw is not None
        return _parse_item(raw)

    def update_item(
        self,
        list_id: str,
        item_id: str,
        *,
        label: Optional[str] = None,
        description: Optional[str] = None,
        sort_order: Optional[int] = None,
        status: Optional[str] = None,
    ) -> SelectionListItem:
        """``PATCH /v1/selection-lists/{listId}/items/{itemId}`` — partial update."""
        body = _omit_none(
            label=label,
            description=description,
            sort_order=sort_order,
            status=status,
        )
        raw = self._request(
            "PATCH",
            (
                f"/v1/selection-lists/{urllib.parse.quote(list_id, safe='')}/"
                f"items/{urllib.parse.quote(item_id, safe='')}"
            ),
            body=body,
        )
        assert raw is not None
        return _parse_item(raw)

    def archive_item(self, list_id: str, item_id: str) -> SelectionListItem:
        """``POST /v1/selection-lists/{listId}/items/{itemId}/archive`` — idempotent."""
        raw = self._request(
            "POST",
            (
                f"/v1/selection-lists/{urllib.parse.quote(list_id, safe='')}/"
                f"items/{urllib.parse.quote(item_id, safe='')}/archive"
            ),
        )
        assert raw is not None
        return _parse_item(raw)

    def delete_item(
        self,
        list_id: str,
        item_id: str,
        *,
        purge: bool = False,
    ) -> Optional[SelectionListItem]:
        """
        ``DELETE /v1/selection-lists/{listId}/items/{itemId}`` — archives by default.

        Returns the archived item, or ``None`` when purged (``204``).
        """
        query = _build_query(purge="true" if purge else None)
        raw = self._request(
            "DELETE",
            (
                f"/v1/selection-lists/{urllib.parse.quote(list_id, safe='')}/"
                f"items/{urllib.parse.quote(item_id, safe='')}"
            ),
            query=query,
            allow_empty=True,
        )
        if raw is None:
            return None
        return _parse_item(raw)

    def reorder_items(self, list_id: str, item_ids: List[str]) -> List[SelectionListItem]:
        """
        ``PUT /v1/selection-lists/{listId}/items/reorder`` — set the whole order.

        ``item_ids`` must be a permutation of exactly the list's non-archived items.
        """
        raw = self._request(
            "PUT",
            f"/v1/selection-lists/{urllib.parse.quote(list_id, safe='')}/items/reorder",
            body={"item_ids": item_ids},
        )
        assert raw is not None
        return [_parse_item(it) for it in raw.get("items", [])]

    # ------------------------------------------------------------------
    # Translations
    # ------------------------------------------------------------------

    def upsert_list_translation(
        self,
        list_id: str,
        locale: str,
        name: str,
        *,
        description: Optional[str] = None,
    ) -> Translation:
        """``PUT /v1/selection-lists/{listId}/translations/{locale}`` — human list text."""
        body: dict = {"name": name}
        if description is not None:
            body["description"] = description
        raw = self._request(
            "PUT",
            (
                f"/v1/selection-lists/{urllib.parse.quote(list_id, safe='')}/"
                f"translations/{urllib.parse.quote(locale, safe='')}"
            ),
            body=body,
        )
        assert raw is not None
        return _parse_translation(raw)

    def upsert_item_translation(
        self,
        list_id: str,
        item_id: str,
        locale: str,
        label: str,
        *,
        description: Optional[str] = None,
    ) -> SelectionListItemTranslation:
        """
        ``PUT /v1/selection-lists/{listId}/items/{itemId}/translations/{locale}``
        — human item text. Always stored with ``is_machine: false``.
        """
        body: dict = {"label": label}
        if description is not None:
            body["description"] = description
        raw = self._request(
            "PUT",
            (
                f"/v1/selection-lists/{urllib.parse.quote(list_id, safe='')}/"
                f"items/{urllib.parse.quote(item_id, safe='')}/"
                f"translations/{urllib.parse.quote(locale, safe='')}"
            ),
            body=body,
        )
        assert raw is not None
        return _parse_item_translation(raw)

    def autofill_translations(
        self,
        list_id: str,
        locale: str,
        *,
        overwrite_machine: bool = False,
        item_ids: Optional[List[str]] = None,
    ) -> AutofillResult:
        """
        ``POST /v1/selection-lists/{listId}/translations/{locale}/autofill``
        — machine-translate everything missing or stale.
        Human translations are never overwritten.
        """
        body: dict = {"overwrite_machine": overwrite_machine}
        if item_ids is not None:
            body["item_ids"] = item_ids
        raw = self._request(
            "POST",
            (
                f"/v1/selection-lists/{urllib.parse.quote(list_id, safe='')}/"
                f"translations/{urllib.parse.quote(locale, safe='')}/autofill"
            ),
            body=body,
        )
        assert raw is not None
        return _parse_autofill_result(raw)

    # ------------------------------------------------------------------
    # Access
    # ------------------------------------------------------------------

    def get_access(
        self,
        list_id: str,
        *,
        limit: Optional[int] = None,
        cursor: Optional[str] = None,
    ) -> PagedResponse[AccessEntry]:
        """``GET /v1/selection-lists/{listId}/access`` — a page of grants."""
        query = _build_query(limit=limit, cursor=cursor)
        raw = self._request(
            "GET",
            f"/v1/selection-lists/{urllib.parse.quote(list_id, safe='')}/access",
            query=query,
        )
        assert raw is not None
        return PagedResponse(
            items=[_parse_access_entry(g) for g in raw.get("items", [])],
            page=_parse_page(raw),
        )

    def set_access(
        self,
        list_id: str,
        user_id: str,
        role: str,
    ) -> AccessEntry:
        """
        ``PUT /v1/selection-lists/{listId}/access/{userId}`` — grant or change a role.
        Demoting the last ``list-owner`` is refused with ``409 CONFLICT``.
        """
        raw = self._request(
            "PUT",
            (
                f"/v1/selection-lists/{urllib.parse.quote(list_id, safe='')}/"
                f"access/{urllib.parse.quote(user_id, safe='')}"
            ),
            body={"role": role},
        )
        assert raw is not None
        return _parse_access_entry(raw)

    def revoke_access(self, list_id: str, user_id: str) -> None:
        """
        ``DELETE /v1/selection-lists/{listId}/access/{userId}`` — idempotent revoke.

        Returns ``None``; revoking a grant that does not exist is not an error.
        """
        self._request(
            "DELETE",
            (
                f"/v1/selection-lists/{urllib.parse.quote(list_id, safe='')}/"
                f"access/{urllib.parse.quote(user_id, safe='')}"
            ),
            allow_empty=True,
        )

    # ------------------------------------------------------------------
    # Quota
    # ------------------------------------------------------------------

    def get_quota(self) -> SelectionListQuotaStatus:
        """
        ``GET /v1/selection-lists/quota`` — usage and ceilings for the caller's org.

        Call it to warn *before* a create fails, rather than surfacing
        ``403 QUOTA_EXCEEDED`` as a surprise.
        """
        raw = self._request("GET", "/v1/selection-lists/quota")
        assert raw is not None
        return _parse_quota_status(raw)

    # ------------------------------------------------------------------
    # Resolve (hot path)
    # ------------------------------------------------------------------

    def resolve_ids(
        self,
        ids: List[str],
        *,
        locale: Optional[str] = None,
    ) -> ResolveResponse:
        """
        ``POST /v1/resolve`` — turn persisted item ids back into labels in one call.

        Read-only and cacheable despite being a POST (the id batch does not fit
        a URL). Archived ids resolve normally with ``status: 'archived'``; only
        purged or never-existent ids come back in ``missing``. Bounded at 500
        ids per call — chunk larger batches yourself.
        """
        body: dict = {"ids": ids}
        resolved_locale = locale or self._default_locale
        if resolved_locale is not None:
            body["locale"] = resolved_locale
        raw = self._request("POST", "/v1/resolve", body=body)
        assert raw is not None
        return _parse_resolve_response(raw)

    # ------------------------------------------------------------------
    # Paginator helper
    # ------------------------------------------------------------------

    def paginate(
        self,
        method: Callable,
        *,
        limit: Optional[int] = None,
        cursor: Optional[str] = None,
        **kwargs: object,
    ) -> Generator:
        """
        Walk every page of a cursor-paginated endpoint, yielding one item at a time.

        Exists so no consumer hand-rolls the cursor loop — the standard's
        guarantee (no gaps, no duplicates under concurrent writes) only holds
        if the cursor is echoed back verbatim and the walk stops on
        ``next_cursor is None``, both of which are easy to get subtly wrong.

        Example::

            for item in client.paginate(client.get_items, list_id, status="active"):
                process(item)
        """
        return _paginate(method, limit=limit, cursor=cursor, **kwargs)


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------


def _build_query(**kwargs: object) -> Dict[str, str]:
    """Build a query dict, omitting ``None`` values and converting to strings."""
    return {k: str(v) for k, v in kwargs.items() if v is not None}


def _omit_none(**kwargs: object) -> dict:
    """Return a dict with ``None`` values removed."""
    return {k: v for k, v in kwargs.items() if v is not None}


def _raise_api_error(status: int, body: Optional[dict]) -> None:
    """Parse a contract error body (if present) and raise ``SelectionListApiError``."""
    if body and isinstance(body.get("code"), str) and isinstance(body.get("message"), str):
        raise SelectionListApiError(
            code=body["code"],
            message=body["message"],
            status=status,
            scope=body.get("scope"),
            limit=body.get("limit"),
            current=body.get("current"),
            details=body.get("details"),
        )
    raise SelectionListApiError(
        code=_code_from_status(status),
        message=f"HTTP {status}",
        status=status,
    )
