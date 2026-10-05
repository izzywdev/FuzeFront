"""Aggregate version guard (standard section 4.2) — reference semantics.

An event is applied iff ``aggregateVersion`` is **strictly greater** than the
stored version for that aggregate (absent row = version 0); otherwise it is
ignored. A ``deleted`` event applies like any other, sets ``deleted=True`` /
``data=None`` and **keeps its version as a tombstone**, so a late lower-version
event can never resurrect the entity. Pinned by
``packages/conformance-vectors/events/version-guard.json``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


def should_apply(stored_version: int | None, event_version: int) -> bool:
    """The guard predicate. ``stored_version`` ``None`` means no row (0)."""
    return event_version > (stored_version or 0)


@dataclass
class AggregateState:
    version: int = 0
    deleted: bool = False
    data: Any = None


@dataclass
class ProjectionGuard:
    """In-memory reference projection: one :class:`AggregateState` per aggregate id.

    Real projections store ``aggregate_version`` next to the row and use
    :func:`should_apply` in their handler (or pass ``get_stored_version`` to
    ``create_consumer`` so the runtime skips stale events for them).
    """

    state: dict[str, AggregateState] = field(default_factory=dict)

    def apply(self, aggregate_id: str, version: int, kind: str, data: Any = None) -> str:
        cur = self.state.get(aggregate_id)
        if not should_apply(cur.version if cur else None, version):
            return "ignored"
        if kind == "deleted":
            self.state[aggregate_id] = AggregateState(version, True, None)
        else:
            self.state[aggregate_id] = AggregateState(version, False, data)
        return "applied"
