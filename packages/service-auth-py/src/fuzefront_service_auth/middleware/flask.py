"""Flask decorator that verifies a FuzeFront M2M bearer token.

Requires the `flask` extra: `pip install "fuzefront-service-auth[flask]"`.
"""

from __future__ import annotations

import functools
from typing import Optional

try:
    from flask import g, jsonify, request
except ImportError as error:  # pragma: no cover - exercised only when extra is missing
    raise ImportError(
        "fuzefront_service_auth.middleware.flask requires the 'flask' extra: "
        "pip install \"fuzefront-service-auth[flask]\""
    ) from error

from ..authz import AuthorizationHook
from ..exceptions import AuthorizationError, TokenVerificationError
from ..verifier import MachineTokenVerifier

_BEARER_PREFIX = "Bearer "


def require_machine_identity(
    verifier: MachineTokenVerifier,
    *,
    authorize: Optional[AuthorizationHook] = None,
):
    """Build a Flask route decorator that authenticates the caller as a machine identity.

    Attaches the verified `MachineIdentity` to `flask.g.machine_identity` for
    the view function to read.

    Example:
        verifier = MachineTokenVerifier(base_url="http://fuzefront-security-service:3000")
        require_identity = require_machine_identity(verifier)

        @app.route("/internal/reports")
        @require_identity
        def reports():
            return {"caller": g.machine_identity.subject}
    """

    def decorator(view_function):
        @functools.wraps(view_function)
        def wrapper(*args, **kwargs):
            auth_header = request.headers.get("Authorization", "")
            if not auth_header.startswith(_BEARER_PREFIX):
                return jsonify({"error": "missing bearer token"}), 401
            token = auth_header[len(_BEARER_PREFIX):].strip()
            if not token:
                return jsonify({"error": "missing bearer token"}), 401

            try:
                identity = verifier.verify_machine_token(token)
            except TokenVerificationError:
                return jsonify({"error": "invalid or inactive token"}), 401

            if authorize is not None:
                try:
                    authorize(identity)
                except AuthorizationError as error:
                    return jsonify({"error": str(error)}), 403

            g.machine_identity = identity
            return view_function(*args, **kwargs)

        return wrapper

    return decorator
