"""Portal binding -- the Python peer of the portal check in ``backend/src/middleware/auth.ts``.

When the multi-tenant-portals feature is on, FuzeFront mints session tokens with a
``portalId`` claim and the host rejects a token presented on a different portal's
host. A Python service reachable through several portal hosts must do the same, or a
token minted for portal A authenticates on portal B.

The service supplies a resolver ``(request) -> ResolvedPortal | None`` describing the
portal the request arrived on (``None`` = no portal context). Rules, all fail closed:

* A token WITH a ``portalId`` is accepted only if the resolver returns a portal with the
  same id. Without a resolver there is nothing to verify the claim against, so the token
  is rejected -- a claimed binding with no context to check it against must never fall
  through to acceptance.
* A token WITHOUT a ``portalId`` (a pre-portal / flag-off token) carries no verifiable
  binding. It is valid ONLY on the root portal: when the resolver reports a non-root
  portal it is rejected, exactly as the host does, rather than silently bound to
  whatever host it happened to arrive on. With no portal context (or no resolver) it is
  accepted -- the service is not portal-aware, or portals are off.
* If the resolver raises, or returns something that is not a ``ResolvedPortal``/``None``,
  the answer is a retryable 503, never a 401: a transient lookup failure must not read as
  "your session is invalid" and log users out.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from .types import AuthError, Identity


@dataclass(frozen=True)
class ResolvedPortal:
    """The portal a request arrived on."""

    id: str
    is_root: bool = False


# (request) -> the portal the request resolved to, or None when it has no portal context.
PortalResolver = Callable[[Any], "ResolvedPortal | None"]


def enforce_portal(identity: Identity, request: Any, resolver: PortalResolver | None) -> None:
    if resolver is None:
        if identity.portal_id is not None:
            raise AuthError("INVALID_AUDIENCE", "portal-bound token cannot be verified by this service")
        return
    try:
        resolved = resolver(request)
    except Exception:  # noqa: BLE001 - a transient lookup failure is not an invalid token
        raise AuthError("VERIFIER_UNAVAILABLE", "portal context is temporarily unavailable", 503) from None
    if resolved is not None and not isinstance(resolved, ResolvedPortal):
        # A resolver returning the wrong type is a wiring bug; never guess at its meaning.
        raise AuthError("VERIFIER_UNAVAILABLE", "portal context is temporarily unavailable", 503)

    if identity.portal_id is not None:
        if resolved is None or resolved.id != identity.portal_id:
            raise AuthError("INVALID_AUDIENCE", "token was issued for a different portal")
        return
    if resolved is not None and not resolved.is_root:
        raise AuthError("INVALID_AUDIENCE", "token has no portal binding and is valid only on the root portal")
