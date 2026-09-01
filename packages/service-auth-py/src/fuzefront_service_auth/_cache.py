"""Bounded, POSITIVE-ONLY cache for verified machine identities.

Only successful (`active: true`) introspection results are ever stored here.
A negative/failed result is never cached at any TTL -- caching it, even
briefly, would mean a just-revoked token continues to authenticate for the
cache's lifetime, defeating revocation. `MachineTokenVerifier` never calls
`put()` on a failure path; that invariant lives there, not here, but this
cache's API accepts no "cache a failure" call at all so there is nothing to
misuse.

Entries expire at `min(now + max_ttl, token_exp)` so a cached entry never
outlives the token's own `exp` claim, and bounded by `max_size` (simple
LRU eviction) so a flood of distinct tokens cannot grow this without limit.
"""

from __future__ import annotations

import threading
from collections import OrderedDict
from typing import Generic, Optional, Tuple, TypeVar

V = TypeVar("V")

DEFAULT_MAX_SIZE = 4096
DEFAULT_MAX_TTL_SECONDS = 300.0


class PositiveCache(Generic[V]):
    def __init__(self, max_size: int = DEFAULT_MAX_SIZE, max_ttl_seconds: float = DEFAULT_MAX_TTL_SECONDS) -> None:
        self._max_size = max_size
        self._max_ttl = max_ttl_seconds
        self._lock = threading.Lock()
        self._store: "OrderedDict[str, Tuple[V, float]]" = OrderedDict()

    def get(self, key: str, now: float) -> Optional[V]:
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            value, expires_at = entry
            if expires_at <= now:
                del self._store[key]
                return None
            self._store.move_to_end(key)
            return value

    def put(self, key: str, value: V, now: float, expires_at: Optional[float] = None) -> None:
        cache_until = now + self._max_ttl
        if expires_at is not None:
            cache_until = min(cache_until, expires_at)
        if cache_until <= now:
            return  # Already expired (or expiring immediately) -- do not cache.
        with self._lock:
            self._store[key] = (value, cache_until)
            self._store.move_to_end(key)
            while len(self._store) > self._max_size:
                self._store.popitem(last=False)

    def __len__(self) -> int:
        with self._lock:
            return len(self._store)
