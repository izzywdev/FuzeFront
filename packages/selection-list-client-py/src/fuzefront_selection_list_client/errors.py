"""
Error types for the SelectionList client.

Every non-2xx response from the selection-list-service raises a
``SelectionListApiError``. It carries the contract's machine-readable ``code``
alongside the HTTP status.

Callers branch on ``code``; ``message`` is human-facing and may change without
a contract version bump.
"""

from __future__ import annotations

from typing import Optional


class SelectionListApiError(Exception):
    """
    Raised on any non-2xx response from the selection-list-service.

    ``UNKNOWN`` is client-only: emitted when a response body is not a contract
    response at all (e.g. an ingress 502 or an HTML error page from a proxy).
    """

    def __init__(
        self,
        code: str,
        message: str,
        status: int,
        **extra: object,
    ) -> None:
        super().__init__(message)
        self.code: str = code
        self.status: int = status
        self.scope: Optional[str] = extra.get("scope")  # type: ignore[assignment]
        self.limit: Optional[int] = extra.get("limit")  # type: ignore[assignment]
        self.current: Optional[int] = extra.get("current")  # type: ignore[assignment]
        self.details: Optional[list] = extra.get("details")  # type: ignore[assignment]

    @property
    def is_quota_exceeded(self) -> bool:
        """True when the caller hit a quota ceiling rather than a permission wall."""
        return self.code == "QUOTA_EXCEEDED"

    @property
    def is_not_found(self) -> bool:
        """True when the resource is absent or invisible to this caller."""
        return self.code == "NOT_FOUND"

    @property
    def is_conflict(self) -> bool:
        """True for a duplicate ``key``/``code``, or a last-owner removal."""
        return self.code == "CONFLICT"

    def __repr__(self) -> str:
        return (
            f"SelectionListApiError(code={self.code!r}, status={self.status}, "
            f"message={str(self)!r})"
        )


def _code_from_status(status: int) -> str:
    """
    Best-effort code when a response carries no parseable contract body.
    Anything not in the map is ``UNKNOWN``.
    """
    mapping = {
        400: "VALIDATION_ERROR",
        401: "UNAUTHENTICATED",
        403: "FORBIDDEN",
        404: "NOT_FOUND",
        409: "CONFLICT",
    }
    return mapping.get(status, "UNKNOWN")
