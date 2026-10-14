"""Flask decorators -- the Python peer of ``requireAuth``/``requireRoles``/``requireTenant``.

Requires the ``flask`` extra: ``pip install "fuzefront-auth[flask]"``.

401 means "who are you?" (re-authenticate); 403 means "I know who you are, and
no". They are never collapsed. A decorator never lets an unauthenticated request
reach the view.
"""

from __future__ import annotations

import functools
from collections.abc import Callable
from typing import Literal

try:
    from flask import current_app, g, jsonify, request
except ImportError as error:  # pragma: no cover - only when the extra is missing
    raise ImportError(
        "fuzefront_auth.middleware.flask requires the 'flask' extra: pip install \"fuzefront-auth[flask]\""
    ) from error

from ..portal import PortalResolver, enforce_portal
from ..types import AuthError, Identity
from ..verifier import Verifier


def _call(view, *args, **kwargs):
    """Invoke the wrapped view the way Flask itself would, so ``async def`` views (Flask's
    supported async mode, needs the ``flask[async]`` extra) keep working under the sync
    wrapper instead of returning an un-awaited coroutine."""
    return current_app.ensure_sync(view)(*args, **kwargs)


def _deny(err: AuthError):
    return jsonify(err.to_body()), err.status


def _bearer(header_name: str) -> str | None:
    value = request.headers.get(header_name, "")
    scheme, _, token = value.partition(" ")
    token = token.strip()
    if scheme.lower() != "bearer" or not token:
        return None
    return token


def require_auth(
    verifier: Verifier,
    *,
    optional: bool = False,
    header: str = "Authorization",
    portal: PortalResolver | None = None,
) -> Callable:
    """Verify the bearer token and expose the ``Identity`` as ``flask.g.identity``.

    ``optional=True`` lets a missing/invalid token continue with
    ``g.identity = None`` -- never with a half-built identity.

    ``portal`` resolves the request's portal id (it receives ``flask.request``). A
    portal-bound token is rejected unless it matches; see ``fuzefront_auth.portal``.
    """
    if verifier is None:
        # Fail at wiring time: a decorator built without a verifier that only
        # failed on first request would ship a route silently ungated.
        raise AuthError("VERIFIER_UNAVAILABLE", "require_auth requires a `verifier`", 500)

    def decorator(view):
        @functools.wraps(view)
        def wrapper(*args, **kwargs):
            token = _bearer(header)
            if token is None:
                if optional:
                    g.identity = None
                    return _call(view, *args, **kwargs)
                return _deny(AuthError("NO_TOKEN", "no bearer token presented"))
            try:
                identity = verifier.verify(token)
                enforce_portal(identity, request, portal)
            except AuthError as err:
                # `optional` degrades CLIENT authentication failures (4xx) to anonymous.
                # A server-side failure (5xx: JWKS/validator/resolver/portal outage) must
                # surface, or an authenticated caller silently gets the anonymous flow.
                if optional and err.status < 500:
                    g.identity = None
                    return _call(view, *args, **kwargs)
                return _deny(err)
            except Exception:  # noqa: BLE001 - an unknown failure is still a denial
                return _deny(AuthError("UNKNOWN", "authentication failed"))
            g.identity = identity
            return _call(view, *args, **kwargs)

        return wrapper

    return decorator


def _current_identity() -> Identity | None:
    return getattr(g, "identity", None)


def require_roles(roles: list[str], mode: Literal["all", "any"] = "all") -> Callable:
    """403 unless ``g.identity`` holds all (or any) of ``roles``. Mount under ``require_auth``."""

    def decorator(view):
        @functools.wraps(view)
        def wrapper(*args, **kwargs):
            identity = _current_identity()
            if identity is None:
                return _deny(AuthError("NO_TOKEN", "require_auth() must run before this guard"))
            if not identity.has_roles(roles, mode):
                return (
                    jsonify(
                        {
                            "error": f"requires {'any of' if mode == 'any' else 'all of'}: {', '.join(roles)}",
                            "code": "FORBIDDEN",
                        }
                    ),
                    403,
                )
            return _call(view, *args, **kwargs)

        return wrapper

    return decorator


def require_tenant(tenant_id: str) -> Callable:
    """403 unless ``g.identity`` is scoped to ``tenant_id``. An unresolved
    (``None``) tenant is a denial, never a wildcard."""

    def decorator(view):
        @functools.wraps(view)
        def wrapper(*args, **kwargs):
            identity = _current_identity()
            if identity is None:
                return _deny(AuthError("NO_TOKEN", "require_auth() must run before this guard"))
            if identity.tenant_id is None:
                return (
                    jsonify(
                        {
                            "error": "tenant scope is unresolved for this identity; wire a resolver",
                            "code": "MISSING_CLAIM",
                        }
                    ),
                    403,
                )
            if identity.tenant_id != tenant_id:
                return jsonify({"error": "identity is not scoped to this tenant", "code": "FORBIDDEN"}), 403
            return _call(view, *args, **kwargs)

        return wrapper

    return decorator
