"""Public contract types for ``fuzefront-auth`` -- the Python peer of
``@fuzefront/auth`` (``packages/auth/src/types.ts``).

``Identity`` is the single synchronisation point: its shape does not change
when the token format migrates from today's HS256 shared-secret token to the
federated RS256/JWKS token. Consumers depend on ``Identity``, never on raw
JWT claims.

Nothing in this package mints tokens. It only verifies and normalises.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

AUTH_CONTRACT_VERSION = "0.2.0"
"""Contract version shared with ``@fuzefront/auth`` (``AUTH_CONTRACT_VERSION``)."""

AuthMode = Literal["legacy-hs256", "federated-jwks"]

# Stable error codes, identical to the TypeScript ``AuthErrorCode`` union so a
# client sees the same ``code`` regardless of which language the service is in.
AUTH_ERROR_CODES = frozenset(
    {
        "NO_TOKEN",
        "MALFORMED",
        "INVALID_SIGNATURE",
        "EXPIRED",
        "NOT_ACTIVE",
        "INVALID_ISSUER",
        "INVALID_AUDIENCE",
        "MISSING_CLAIM",
        "JWKS_UNAVAILABLE",
        "VERIFIER_UNAVAILABLE",
        "UNKNOWN",
    }
)


class AuthError(Exception):
    """Raised on ANY verification failure. The package is fail-closed: there is
    no permissive fallback identity.

    ``status`` is the HTTP status a middleware should surface (401 for authn,
    403 for authz, 500 for a misconfigured verifier). Messages never contain the
    token or any part of it.
    """

    def __init__(self, code: str, message: str, status: int = 401) -> None:
        super().__init__(message)
        self.code = code
        self.status = status

    def to_body(self) -> dict[str, str]:
        """The ``{error, code}`` JSON body, identical to ``AuthErrorBody`` in TS."""
        return {"error": str(self), "code": self.code}


@dataclass(frozen=True)
class Identity:
    """The stable, normalised identity every consumer receives.

    - ``user_id``   -- ALWAYS present.
    - ``tenant_id`` -- ``None`` when unresolved (``legacy-hs256`` without a
      resolver). Consumers fail closed on tenant-scoped decisions when ``None``.
    - ``roles``     -- ALWAYS a tuple (possibly empty). Empty means "no roles
      known", which a fail-closed consumer treats as unprivileged.
    """

    user_id: str
    tenant_id: str | None
    roles: tuple[str, ...]
    auth_mode: AuthMode
    email: str | None = None
    issued_at: int | float | None = None
    expires_at: int | float | None = None
    issuer: str | None = None
    # The portal this session token was minted for (`portalId` claim), or None for a
    # token with no portal binding. A bound identity must be checked against the
    # request's portal (see `portal.py`); the adapters do this.
    portal_id: str | None = None
    # The session this token names (`sessionId`, legacy-hs256), when present.
    session_id: str | None = None
    # Verifier-specific extras for migration only; NOT part of the stable contract.
    claims: dict[str, Any] = field(default_factory=dict, repr=False, compare=False)

    def has_roles(self, roles: list[str] | tuple[str, ...], mode: Literal["all", "any"] = "all") -> bool:
        held = set(self.roles)
        return any(r in held for r in roles) if mode == "any" else all(r in held for r in roles)
