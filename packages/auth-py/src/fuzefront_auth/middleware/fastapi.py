"""FastAPI dependencies -- the Python peer of ``requireAuth``/``requireRoles``/``requireTenant``.

Requires the ``fastapi`` extra: ``pip install "fuzefront-auth[fastapi]"``.

Dependencies are plain ``def`` (not ``async def``) on purpose: verification does
blocking I/O (JWKS fetch, resolver), and FastAPI runs sync dependencies in its
threadpool instead of stalling the event loop.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Literal

try:
    from fastapi import Depends, HTTPException, Request
    from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
except ImportError as error:  # pragma: no cover - only when the extra is missing
    raise ImportError(
        "fuzefront_auth.middleware.fastapi requires the 'fastapi' extra: pip install \"fuzefront-auth[fastapi]\""
    ) from error

from ..portal import PortalResolver, enforce_portal
from ..types import AuthError, Identity
from ..verifier import Verifier

_bearer_scheme = HTTPBearer(auto_error=False)


def _deny(err: AuthError) -> HTTPException:
    return HTTPException(status_code=err.status, detail=err.to_body())


def auth_dependency(
    verifier: Verifier, *, optional: bool = False, portal: PortalResolver | None = None
) -> Callable[..., Identity | None]:
    """Build a dependency that authenticates the caller and returns the ``Identity``
    (also stored on ``request.state.identity``).

    ``optional=True`` returns ``None`` for a missing/invalid token instead of 401.

    ``portal`` resolves the request's portal id (it receives the FastAPI ``Request``).
    A portal-bound token is rejected unless it matches; see ``fuzefront_auth.portal``.
    """
    if verifier is None:
        raise AuthError("VERIFIER_UNAVAILABLE", "auth_dependency requires a `verifier`", 500)

    def dependency(
        request: Request,
        credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),  # noqa: B008 - FastAPI DI
    ) -> Identity | None:
        if credentials is None or not credentials.credentials:
            if optional:
                request.state.identity = None
                return None
            raise _deny(AuthError("NO_TOKEN", "no bearer token presented"))
        try:
            identity = verifier.verify(credentials.credentials)
            enforce_portal(identity, request, portal)
        except AuthError as err:
            # `optional` degrades CLIENT authentication failures (4xx) to anonymous.
            # A server-side failure (5xx: JWKS/validator/resolver/portal outage) must
            # surface, or an authenticated caller silently gets the anonymous flow.
            if optional and err.status < 500:
                request.state.identity = None
                return None
            raise _deny(err) from None
        except Exception:  # noqa: BLE001 - an unknown failure is still a denial
            raise _deny(AuthError("UNKNOWN", "authentication failed")) from None
        request.state.identity = identity
        return identity

    return dependency


def require_roles(
    auth: Callable[..., Identity | None], roles: list[str], mode: Literal["all", "any"] = "all"
) -> Callable[..., Identity]:
    """Dependency that 403s unless the authenticated identity holds all/any of ``roles``."""

    def dependency(identity: Identity | None = Depends(auth)) -> Identity:  # noqa: B008
        if identity is None:
            raise _deny(AuthError("NO_TOKEN", "no bearer token presented"))
        if not identity.has_roles(roles, mode):
            raise HTTPException(
                status_code=403,
                detail={
                    "error": f"requires {'any of' if mode == 'any' else 'all of'}: {', '.join(roles)}",
                    "code": "FORBIDDEN",
                },
            )
        return identity

    return dependency


def require_tenant(auth: Callable[..., Identity | None], tenant_id: str) -> Callable[..., Identity]:
    """Dependency that 403s unless the identity is scoped to ``tenant_id``.
    An unresolved (``None``) tenant is a denial, never a wildcard."""

    def dependency(identity: Identity | None = Depends(auth)) -> Identity:  # noqa: B008
        if identity is None:
            raise _deny(AuthError("NO_TOKEN", "no bearer token presented"))
        if identity.tenant_id is None:
            raise HTTPException(
                status_code=403,
                detail={
                    "error": "tenant scope is unresolved for this identity; wire a resolver",
                    "code": "MISSING_CLAIM",
                },
            )
        if identity.tenant_id != tenant_id:
            raise HTTPException(
                status_code=403,
                detail={"error": "identity is not scoped to this tenant", "code": "FORBIDDEN"},
            )
        return identity

    return dependency
