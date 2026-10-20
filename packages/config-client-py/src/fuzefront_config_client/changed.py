"""
``config.changed`` -- cache invalidation (FF-EPIC-18-S4 / FFRNT-262).

config-service publishes ONE ``config.changed`` event per committed write to a
``(namespace, scope)``, listing the changed key NAMES. It never carries values
(so secrets cannot leak through the bus): treat it purely as "re-resolve".

This package is stdlib-only and transport-agnostic -- it does not ship a Kafka
consumer. Subscribe with whatever your service already uses (the
``fuzefront-events`` Kafka bindings, ``confluent-kafka``, ...) and hand each
decoded message to :meth:`ConfigCache.handle_event`::

    cache = ConfigCache(client)
    # in your consumer loop, for messages on CONFIG_CHANGED_TOPIC:
    cache.handle_event(json.loads(message.value()))
    cfg = cache.get("fuzefront.chat", Scope(ScopeType.ORG, org_id))

Events are best-effort, so :class:`ConfigCache` ALSO revalidates by version:
once an entry is older than ``max_age_seconds`` it is re-read with
``If-None-Match`` (a cheap 304 when unchanged), so a missed event costs at most
``max_age_seconds`` of staleness. Handle BOTH the event and the version poll.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from .client import ConfigClient, is_not_modified
from .types import EffectiveConfig, Scope, ScopeType

CONFIG_CHANGED_TOPIC = "config.changed"
"""Kafka topic config-service publishes on (``TOPICS.CONFIG_CHANGED`` in ``@fuzefront/shared/kafka``)."""


@dataclass
class ConfigChangedPayload:
    """Payload of a ``config.changed`` event: key names + scope, never values."""

    namespace: str
    scope: Scope
    changed_keys: list[str]


def parse_config_changed_event(raw: Any) -> ConfigChangedPayload | None:
    """
    Validate and extract a payload from a decoded message (full envelope or a
    bare payload). Returns ``None`` for anything malformed.
    """
    if not isinstance(raw, dict):
        return None
    p = raw.get("payload") if isinstance(raw.get("payload"), dict) else raw
    namespace = p.get("namespace")
    scope = p.get("scope")
    keys = p.get("changedKeys")
    if not isinstance(namespace, str) or not namespace:
        return None
    if not isinstance(scope, dict):
        return None
    try:
        scope_type = ScopeType(scope.get("scopeType"))
    except ValueError:
        return None
    scope_id = scope.get("scopeId")
    if scope_id is not None and not isinstance(scope_id, str):
        return None
    if not isinstance(keys, list) or not all(isinstance(k, str) for k in keys):
        return None
    return ConfigChangedPayload(namespace, Scope(scope_type, scope_id), list(keys))


@dataclass
class _Entry:
    config: EffectiveConfig
    fetched_at: float
    stale: bool = False


def _key(namespace: str, scope: Scope) -> tuple[str, str, str]:
    st = scope.scope_type.value if isinstance(scope.scope_type, ScopeType) else str(scope.scope_type)
    return (namespace, st, scope.scope_id or "")


class ConfigCache:
    """A thread-safe caching reader over :class:`ConfigClient` that honours ``config.changed``."""

    def __init__(
        self,
        client: ConfigClient,
        *,
        max_age_seconds: float = 60.0,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._client = client
        self._max_age = max_age_seconds
        self._clock = clock
        self._entries: dict[tuple[str, str, str], _Entry] = {}
        self._lock = threading.Lock()

    def get(self, namespace: str, scope: Scope) -> EffectiveConfig:
        """Resolved config: cache hit, 304 revalidation, or a fresh read."""
        key = _key(namespace, scope)
        with self._lock:
            entry = self._entries.get(key)
            if entry and not entry.stale and self._clock() - entry.fetched_at < self._max_age:
                return entry.config
            # Event-invalidated: unconditional re-resolve. Merely aged out:
            # conditional read so an unchanged view is a bodyless 304.
            etag = entry.config.version if entry and not entry.stale else None

        result = self._client.get_effective_config(namespace, scope, if_none_match=etag)

        with self._lock:
            if is_not_modified(result):
                # Only reachable when we sent If-None-Match, so `entry` exists.
                entry.fetched_at = self._clock()  # type: ignore[union-attr]
                return entry.config  # type: ignore[union-attr]
            self._entries[key] = _Entry(result, self._clock())
            return result

    def handle_event(self, event: Any) -> bool:
        """
        React to a decoded ``config.changed`` message. Returns True when a
        cached namespace was invalidated. Malformed messages are ignored (the
        version poll still covers them).

        Every cached scope in the namespace is invalidated, not just the
        event's own: a portal-scope change alters the resolved view of every
        org and user beneath it.
        """
        payload = parse_config_changed_event(event)
        if payload is None:
            return False
        return self.invalidate_namespace(payload.namespace)

    def invalidate_namespace(self, namespace: str) -> bool:
        hit = False
        with self._lock:
            for (ns, _st, _sid), entry in self._entries.items():
                if ns == namespace:
                    entry.stale = True
                    hit = True
        return hit

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()
