"""
Seed-request helpers -- build a validated ``selection-lists.seed.requested``
payload (and its envelope) for another service to publish to Kafka.

Pure functions, stdlib only, no Kafka client: the caller publishes the result
with whatever producer it already has.

The rules here MIRROR the frozen Zod schema in
``shared/src/kafka/schemas/selection-lists.seed.requested.ts``; the schema is
the source of truth. This module, the TypeScript helper in
``selection-list-client/src/seed.ts`` and the schema are pinned to the same
golden fixtures (``shared/tests/fixtures/selection-lists/``).

Payload keys are the camelCase WIRE names (``sourceLocale``, ``organizationId``)
-- this module builds a wire message, so it does not translate casing.

Guide: docs/guides/SELECTION_LIST_EVENTS.md.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any

from .types import LOCALES

SEED_REQUESTED_TOPIC = "selection-lists.seed.requested"
SEED_COMPLETED_TOPIC = "selection-lists.seed.completed"
SEED_FAILED_TOPIC = "selection-lists.seed.failed"
SEED_REQUESTED_SCHEMA_VERSION = "1.0"

SEED_LIMITS: dict[str, int] = {
    "NAME_MAX": 200,
    "DESCRIPTION_MAX": 2000,
    "MAX_LISTS_PER_SEED": 20,
    "MAX_ITEMS_PER_LIST": 500,
    "MAX_ITEMS_PER_SEED": 2000,
    "MAX_SEED_REQUEST_BYTES": 900_000,
    "MAX_ATTESTATION_TOKEN_LENGTH": 4096,
}

SEED_TRIGGERS = ("org-created", "app-installed", "app-upgraded", "backfill", "manual")

_KEY_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$")
_CODE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$")
_REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_ORG_RE = re.compile(r"^org_[0-9a-z]+$")
_USR_RE = re.compile(r"^usr_[0-9a-z]+$")
_PLATFORM = "platform"

_LIST_FIELDS = frozenset(
    {"key", "sourceLocale", "name", "description", "translations", "items"}
)
_ITEM_FIELDS = frozenset({"code", "label", "description", "translations"})
_LIST_TR_FIELDS = frozenset({"locale", "name", "description"})
_ITEM_TR_FIELDS = frozenset({"locale", "label", "description"})


class SeedRequestValidationError(ValueError):
    """The input cannot produce a contract-valid seed request.

    ``issues`` lists EVERY problem found as ``{"path": ..., "message": ...}``.
    """

    def __init__(self, issues: list[dict[str, str]]) -> None:
        self.issues = issues
        summary = "; ".join(f"{i['path'] or '<root>'}: {i['message']}" for i in issues)
        super().__init__(f"invalid seed request: {summary}")


def build_seed_request(
    *,
    request_id: str,
    organization_id: str,
    app: str,
    service: str,
    pack_key: str,
    pack_version: int,
    service_token: str,
    lists: list[dict[str, Any]],
    scope: str = "org",
    user_id: str | None = None,
    trigger: str = "app-installed",
    key_prefix: str | None = None,
) -> dict[str, Any]:
    """Build and validate a ``selection-lists.seed.requested`` payload.

    ``organization_id`` must be the ``org_`` TypeID (convert a bare UUID from
    ``identity.org.created`` with ``fuzefront_identity``). ``service_token`` is a
    short-lived token with scope ``selection-lists:seed`` -- mint a dedicated one.
    ``key_prefix`` defaults to ``f"{app}-"``; pass ``""`` only when the allowlist
    grants your app another namespace. ``lists`` use wire keys; ``sourceLocale``
    defaults to ``"en"``. Raises :class:`SeedRequestValidationError`.
    """
    issues: list[dict[str, str]] = []

    def add(path: str, message: str) -> None:
        issues.append({"path": path, "message": message})

    prefix = f"{app}-" if key_prefix is None else key_prefix

    _check_pattern(request_id, _REQUEST_ID_RE, "requestId", add)
    _check_pattern(organization_id, _ORG_RE, "organizationId", add, 255)
    _check_pattern(app, _KEY_RE, "source.app", add, 64)
    if app == _PLATFORM:
        add("source.app", f'"{_PLATFORM}" is reserved for the service\'s own packs')
    if not isinstance(service, str) or not 1 <= len(service) <= 128:
        add("source.service", "must be 1-128 characters")
    _check_pattern(pack_key, _KEY_RE, "pack.key", add, 64)
    if (
        not isinstance(pack_version, int)
        or isinstance(pack_version, bool)
        or pack_version < 1
    ):
        add("pack.version", "must be a positive integer")
    max_tok = SEED_LIMITS["MAX_ATTESTATION_TOKEN_LENGTH"]
    if not isinstance(service_token, str) or not 1 <= len(service_token) <= max_tok:
        add("attestation.token", f"must be 1-{max_tok} characters")
    if scope not in ("org", "user"):
        add("scope", 'must be "org" or "user"')
    if scope == "user":
        if user_id is None:
            add("userId", 'is required when scope is "user"')
        else:
            _check_pattern(user_id, _USR_RE, "userId", add, 255)
    elif user_id is not None:
        add("userId", 'must be omitted when scope is "org"')
    if trigger not in SEED_TRIGGERS:
        add("trigger", "is not a supported trigger")

    raw_lists = lists if isinstance(lists, list) else []
    if not isinstance(lists, list):
        add("lists", "must be an array")
    if len(raw_lists) < 1:
        add("lists", "must contain at least one list")
    if len(raw_lists) > SEED_LIMITS["MAX_LISTS_PER_SEED"]:
        add("lists", f"at most {SEED_LIMITS['MAX_LISTS_PER_SEED']} lists per request")

    seen_keys: set[str] = set()
    total_items = 0
    out_lists: list[dict[str, Any]] = []
    for li, raw in enumerate(raw_lists):
        p = f"lists.{li}"
        if not isinstance(raw, dict):
            add(p, "must be an object")
            continue
        _check_unknown(raw, _LIST_FIELDS, p, add)
        source_locale = raw.get("sourceLocale", "en")
        if source_locale not in LOCALES:
            add(f"{p}.sourceLocale", f'unsupported locale "{source_locale}"')
        key = raw.get("key")
        _check_pattern(key, _KEY_RE, f"{p}.key", add, 64)
        if isinstance(key, str) and prefix and not key.startswith(prefix):
            add(f"{p}.key", f'must start with the namespace prefix "{prefix}"')
        if key in seen_keys:
            add(f"{p}.key", f'duplicate list key "{key}"')
        if isinstance(key, str):
            seen_keys.add(key)
        _check_text(raw.get("name"), f"{p}.name", add)
        _check_description(
            raw.get("description"), "description" in raw, f"{p}.description", add
        )
        _check_translations(
            raw.get("translations"),
            "name",
            _LIST_TR_FIELDS,
            source_locale,
            f"{p}.translations",
            add,
        )

        raw_items = raw.get("items")
        if not isinstance(raw_items, list):
            add(f"{p}.items", "must be an array")
            raw_items = []
        if len(raw_items) > SEED_LIMITS["MAX_ITEMS_PER_LIST"]:
            add(
                f"{p}.items",
                f"at most {SEED_LIMITS['MAX_ITEMS_PER_LIST']} items per list",
            )
        total_items += len(raw_items)
        seen_codes: set[str] = set()
        out_items: list[dict[str, Any]] = []
        for ii, item in enumerate(raw_items):
            ip = f"{p}.items.{ii}"
            if not isinstance(item, dict):
                add(ip, "must be an object")
                continue
            _check_unknown(item, _ITEM_FIELDS, ip, add)
            code = item.get("code")
            _check_pattern(code, _CODE_RE, f"{ip}.code", add, 63)
            if code in seen_codes:
                add(f"{ip}.code", f'duplicate item code "{code}" in list "{key}"')
            if isinstance(code, str):
                seen_codes.add(code)
            _check_text(item.get("label"), f"{ip}.label", add)
            _check_description(
                item.get("description"), "description" in item, f"{ip}.description", add
            )
            _check_translations(
                item.get("translations"),
                "label",
                _ITEM_TR_FIELDS,
                source_locale,
                f"{ip}.translations",
                add,
            )
            out_items.append(
                _compact(
                    {
                        "code": code,
                        "label": item.get("label"),
                        "description": item.get("description"),
                        "translations": _copy_list(item.get("translations")),
                    }
                )
            )
        out_lists.append(
            _compact(
                {
                    "key": key,
                    "sourceLocale": source_locale,
                    "name": raw.get("name"),
                    "description": raw.get("description"),
                    "translations": _copy_list(raw.get("translations")),
                    "items": out_items,
                }
            )
        )

    if total_items > SEED_LIMITS["MAX_ITEMS_PER_SEED"]:
        add(
            "lists",
            f"at most {SEED_LIMITS['MAX_ITEMS_PER_SEED']} items in total per request (got {total_items})",
        )

    payload: dict[str, Any] = {
        "requestId": request_id,
        "organizationId": organization_id,
        "scope": scope,
        "source": {"app": app, "service": service},
        "pack": {"key": pack_key, "version": pack_version},
        "trigger": trigger,
        "attestation": {"kind": "service-token", "token": service_token},
        "lists": out_lists,
    }
    if scope == "user" and user_id is not None:
        payload["userId"] = user_id

    size = len(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    )
    if size > SEED_LIMITS["MAX_SEED_REQUEST_BYTES"]:
        add(
            "",
            f"serialized request is {size} bytes; the limit is {SEED_LIMITS['MAX_SEED_REQUEST_BYTES']} -- split the pack",
        )

    if issues:
        raise SeedRequestValidationError(issues)
    return payload


def build_seed_request_envelope(
    payload: dict[str, Any], *, correlation_id: str, occurred_at: str | None = None
) -> dict[str, Any]:
    """Wrap a payload in the family event envelope (``FuzeEvent``)."""
    return {
        "version": SEED_REQUESTED_SCHEMA_VERSION,
        "topic": SEED_REQUESTED_TOPIC,
        "correlationId": correlation_id,
        "occurredAt": occurred_at
        or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "payload": payload,
    }


def seed_request_kafka_key(payload: dict[str, Any]) -> str:
    """Kafka message key for a seed request -- the org, so one org's requests stay ordered."""
    return str(payload["organizationId"])


# ---------------------------------------------------------------------------


def _check_pattern(
    value: Any,
    pattern: re.Pattern[str],
    path: str,
    add: Any,
    max_length: int | None = None,
) -> None:
    if (
        not isinstance(value, str)
        or not pattern.match(value)
        or (max_length is not None and len(value) > max_length)
    ):
        add(path, f"must match {pattern.pattern}")


def _check_text(value: Any, path: str, add: Any) -> None:
    if not isinstance(value, str) or not 1 <= len(value) <= SEED_LIMITS["NAME_MAX"]:
        add(path, f"must be 1-{SEED_LIMITS['NAME_MAX']} characters")


def _check_description(value: Any, present: bool, path: str, add: Any) -> None:
    if not present:
        return
    if not isinstance(value, str) or len(value) > SEED_LIMITS["DESCRIPTION_MAX"]:
        add(
            path,
            f"must be a string of at most {SEED_LIMITS['DESCRIPTION_MAX']} characters",
        )


def _check_unknown(
    value: dict[str, Any], allowed: frozenset[str], path: str, add: Any
) -> None:
    for k in value:
        if k not in allowed:
            add(
                f"{path}.{k}",
                "ids are minted by the service; do not send one"
                if k == "id"
                else "unknown field",
            )


def _check_translations(
    value: Any,
    text_field: str,
    allowed: frozenset[str],
    source_locale: str,
    path: str,
    add: Any,
) -> None:
    if value is None:
        return
    if not isinstance(value, list):
        add(path, "must be an array")
        return
    if len(value) > len(LOCALES) - 1:
        add(path, f"at most {len(LOCALES) - 1} translations")
    seen: set[str] = set()
    for i, t in enumerate(value):
        tp = f"{path}.{i}"
        if not isinstance(t, dict):
            add(tp, "must be an object")
            continue
        _check_unknown(t, allowed, tp, add)
        locale = t.get("locale")
        if locale not in LOCALES:
            add(f"{tp}.locale", f'unsupported locale "{locale}"')
        if locale == source_locale:
            add(
                f"{tp}.locale",
                f'"{locale}" is the source locale; put that text in {text_field}',
            )
        if locale in seen:
            add(f"{tp}.locale", f'duplicate locale "{locale}"')
        if isinstance(locale, str):
            seen.add(locale)
        _check_text(t.get(text_field), f"{tp}.{text_field}", add)
        _check_description(
            t.get("description"), "description" in t, f"{tp}.description", add
        )


def _copy_list(value: Any) -> list[dict[str, Any]] | None:
    if not isinstance(value, list):
        return None
    return [_compact(dict(v)) for v in value if isinstance(v, dict)]


def _compact(obj: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in obj.items() if v is not None}
