"""Build a verifier from environment variables.

Fail-closed: when the mode is unset or its required variables are missing this
raises ``AuthError`` (500 ``VERIFIER_UNAVAILABLE``) at wiring time, so a service
is never silently left ungated.

``FUZEFRONT_AUTH_MODE`` = ``legacy-hs256`` | ``federated-jwks``

legacy-hs256:   FUZEFRONT_JWT_SECRET (required), FUZEFRONT_JWT_ISSUER,
                FUZEFRONT_JWT_AUDIENCE (both optional; enforced when set)
federated-jwks: FUZEFRONT_AUTH_ISSUER (required), FUZEFRONT_AUTH_AUDIENCE
                (required), FUZEFRONT_AUTH_JWKS_URI (optional; else OIDC discovery)
"""

from __future__ import annotations

import os
from typing import Mapping

from .types import AuthError
from .verifier import FederatedJwksConfig, LegacyHs256Config, Resolver, Verifier, create_verifier


def verifier_from_env(env: Mapping[str, str] | None = None, *, resolver: Resolver | None = None) -> Verifier:
    e = os.environ if env is None else env
    mode = (e.get("FUZEFRONT_AUTH_MODE") or "").strip()
    if mode == "legacy-hs256":
        return create_verifier(
            LegacyHs256Config(
                secret=e.get("FUZEFRONT_JWT_SECRET", ""),
                issuer=e.get("FUZEFRONT_JWT_ISSUER") or None,
                audience=e.get("FUZEFRONT_JWT_AUDIENCE") or None,
                resolver=resolver,
            )
        )
    if mode == "federated-jwks":
        return create_verifier(
            FederatedJwksConfig(
                issuer=e.get("FUZEFRONT_AUTH_ISSUER", ""),
                audience=e.get("FUZEFRONT_AUTH_AUDIENCE", ""),
                jwks_uri=e.get("FUZEFRONT_AUTH_JWKS_URI") or None,
            )
        )
    raise AuthError(
        "VERIFIER_UNAVAILABLE",
        "FUZEFRONT_AUTH_MODE must be `legacy-hs256` or `federated-jwks`",
        500,
    )
