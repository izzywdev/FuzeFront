"""
Error type for the config-client.

Every non-2xx response from the config-service raises a
``ConfigApiError``. It carries the contract's machine-readable ``code``
alongside the HTTP status, because the two answer different questions: the
status says how a cache or proxy should treat the response, the ``code``
says what the caller should do about it. Callers branch on ``code``;
``message`` is human-facing and may change without a contract version bump.

Mirrors ``config-client/src/errors.ts`` (the Node client) field-for-field.
"""

from __future__ import annotations

from typing import List, Optional

from .types import ConfigErrorDetail, Scope, error_detail_from_wire, scope_from_wire


class ConfigApiError(Exception):
    """
    Raised on any non-2xx response from the config-service.

    ``code`` is ``"UNKNOWN"`` when the response is not a contract response
    at all -- an ingress ``502``, a proxy timeout, an HTML error page.
    Mapping that onto a real contract code would send the caller down the
    wrong recovery path, so it gets its own value rather than a guess.
    """

    def __init__(self, status: int, code: str, message: str, body: Optional[dict] = None) -> None:
        super().__init__(message)
        self.status: int = status
        """HTTP status of the response."""
        self.code: str = code
        """Machine-readable code from the contract's error envelope, or ``UNKNOWN``."""
        self.body: Optional[dict] = body
        """The raw parsed body, for anything this class does not model."""
        self.locked_by: Optional[Scope] = scope_from_wire(body.get("lockedBy")) if body else None
        """
        The scope holding the lock. Present only on ``LOCKED_BY_ANCESTOR``.

        This is what lets a caller say *which* ancestor refused the write
        instead of showing a generic denial -- the reason the contract
        specifies 409 with a body rather than a bare 403.
        """
        self.current_version: Optional[str] = body.get("currentVersion") if body else None
        """
        The resolved view's actual version. Present only on
        ``VERSION_CONFLICT``. Re-read at this version and merge; do NOT
        blind-retry the original write, which would overwrite whatever the
        concurrent editor just saved.
        """
        raw_details = body.get("details") if body else None
        self.details: Optional[List[ConfigErrorDetail]] = (
            [error_detail_from_wire(d) for d in raw_details] if raw_details else None
        )
        """Per-key or per-field problems. Present on validation failures."""

    @property
    def is_locked_by_ancestor(self) -> bool:
        """
        True when the write was refused because an ancestor scope locked
        the key. Distinct from a plain authorization failure: the caller
        may well be allowed to write at this scope in general, and
        ``locked_by`` names who overrode that. Retrying will not help.
        """
        return self.code == "LOCKED_BY_ANCESTOR"

    @property
    def is_version_conflict(self) -> bool:
        """True when the resolved view moved since the version the caller read."""
        return self.code == "VERSION_CONFLICT"

    def __repr__(self) -> str:
        return f"ConfigApiError(code={self.code!r}, status={self.status}, message={str(self)!r})"


def is_config_api_error(error: object) -> bool:
    """Narrowing type guard for :class:`ConfigApiError`."""
    return isinstance(error, ConfigApiError)
