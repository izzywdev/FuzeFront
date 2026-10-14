"""Portal binding -- the Python peer of the portal check in ``backend/src/middleware/auth.ts``.

When the multi-tenant-portals feature is on, FuzeFront mints session tokens with a
``portalId`` claim and the host rejects a token presented on a different portal's
host. A Python service reachable through several portal hosts must do the same, or a
token minted for portal A authenticates on portal B.

Rules (all fail closed):

* A token with NO ``portalId`` is not portal-bound; it is accepted here. (The host
  shell's policy for such legacy tokens on non-root portals is enforced at the
  host/gateway, not by this package.)
* A token WITH a ``portalId`` is accepted only if the service supplied a portal
  resolver AND it returns the same id for this request. Without a resolver there is
  nothing to verify the claim against, so the token is rejected -- a claimed binding
  with no context to check it against must never fall through to acceptance.
* If the resolver raises, the answer is a retryable 503, never a 401: a transient
  lookup failure must not read as "your session is invalid" and log users out.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from .types import AuthError, Identity

# (request) -> the portal id the request resolved to, or None when it has no portal.
PortalResolver = Callable[[Any], "str | None"]


def enforce_portal(identity: Identity, request: Any, resolver: PortalResolver | None) -> None:
    if identity.portal_id is None:
        return
    if resolver is None:
        raise AuthError("INVALID_AUDIENCE", "portal-bound token cannot be verified by this service")
    try:
        resolved = resolver(request)
    except Exception:  # noqa: BLE001 - a transient lookup failure is not an invalid token
        raise AuthError("VERIFIER_UNAVAILABLE", "portal context is temporarily unavailable", 503) from None
    if resolved != identity.portal_id:
        raise AuthError("INVALID_AUDIENCE", "token was issued for a different portal")
