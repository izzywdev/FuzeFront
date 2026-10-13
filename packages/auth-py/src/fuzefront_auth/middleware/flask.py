"""Flask decorator that verifies a FuzeFront platform bearer token.

Requires the `flask` extra: `pip install "fuzefront-auth[flask]"`.

Produces the SAME `Identity` the FastAPI dependency (`middleware.fastapi`)
and the TypeScript `requireAuth()` (`packages/auth/src/middleware.ts`)
produce -- one contract, three mounting points.
"""

from __future__ import annotations

import functools
from typing import Callable, Optional

try:
    from flask import g, jsonify, request
except ImportError as error:  # pragma: no cover - exercised only when extra is missing
    raise ImportError(
        "fuzefront_auth.middleware.flask requires the 'flask' extra: "
        'pip install "fuzefront-auth[flask]"'
    ) from error

from ..types import AuthError, Verifier

_BEARER_PREFIX = "bearer "


def _deny_response(error: AuthError):
    """Build the Flask response for an `AuthError`, matching the `{error,
    code}` JSON body shape of the TypeScript sibling's `AuthErrorBody`
    (`packages/auth/src/middleware.ts`).

    `str(error)` is always the fixed message passed to the constructor --
    never the token. See `verifier.py`'s module docstring.
    """
    return jsonify({"error": str(error), "code": error.code}), error.status


def _read_bearer(header_value: str) -> Optional[str]:
    """Scheme match is case-insensitive per RFC 6750; anything else yields
    `None` and is treated as "no token".
    """
    if not header_value:
        return None
    parts = header_value.split(" ", 1)
    if len(parts) != 2:
        return None
    scheme, token = parts
    if scheme.lower() != "bearer" or not token:
        return None
    return token


def require_auth(verifier: Verifier, *, optional: bool = False) -> Callable:
    """Build a Flask route decorator that authenticates the caller.

    Attaches the normalized `Identity` to `flask.g.identity` for the view
    function to read (`None` on an `optional` route with no/invalid token).
    On failure it responds `401` (or the `AuthError`'s `status`) with a
    stable error body -- it NEVER calls the view with an unauthenticated
    request unless `optional=True`.

    Example:
        verifier = create_verifier(LegacyHs256Config(secret=os.environ["FUZEFRONT_JWT_SECRET"]))
        require_identity = require_auth(verifier)

        @app.route("/private")
        @require_identity
        def private():
            return {"userId": g.identity.user_id}
    """
    if verifier is None:
        # Fail at wiring time, not silently at first request.
        raise AuthError("VERIFIER_UNAVAILABLE", "require_auth requires a `verifier`", status=500)

    def decorator(view_function: Callable) -> Callable:
        @functools.wraps(view_function)
        def wrapper(*args, **kwargs):
            token = _read_bearer(request.headers.get("Authorization", ""))

            if not token:
                if optional:
                    g.identity = None
                    return view_function(*args, **kwargs)
                return _deny_response(AuthError("NO_TOKEN", "no bearer token presented"))

            try:
                identity = verifier.verify(token)
            except AuthError as error:
                if optional:
                    g.identity = None
                    return view_function(*args, **kwargs)
                return _deny_response(error)
            except Exception:  # noqa: BLE001 - an unexpected failure is still a failure
                if optional:
                    g.identity = None
                    return view_function(*args, **kwargs)
                return _deny_response(AuthError("UNKNOWN", "authentication failed"))

            g.identity = identity
            return view_function(*args, **kwargs)

        return wrapper

    return decorator
