"""
fuzefront_auth
===============

Python verifier + Flask/FastAPI middleware for the FuzeFront platform auth
contract. The Python peer of the TypeScript `@fuzefront/auth` runtime
(`packages/auth`) -- both are projections of the same `Identity` contract;
if this package disagrees with it, the TypeScript contract wins and this
package is the bug.

Two verifier modes:
    legacy-hs256   -- today's FuzeFront session token (HS256,
                      `FUZEFRONT_JWT_SECRET`).
    federated-jwks -- the target federated mode (RS256/ES256 via JWKS).

Framework middleware (`middleware.flask`, `middleware.fastapi`) is NOT
imported here -- each has its own optional third-party dependency, and this
package's core must stay importable with only PyJWT installed for a
consumer that uses neither framework. Import the specific submodule you
need:

    from fuzefront_auth.middleware.flask import require_auth
    from fuzefront_auth.middleware.fastapi import require_auth

This package NEVER mints tokens, and NEVER logs token contents -- see
`verifier.py`'s module docstring.
"""

from .types import (
    AUTH_CONTRACT_VERSION,
    AuthError,
    AuthErrorCode,
    AuthMode,
    FederatedJwksConfig,
    Identity,
    LegacyHs256Config,
    OutOfBandResolver,
    Verifier,
    VerifierConfig,
)
from .verifier import create_verifier, verify_token

__all__ = [
    "AUTH_CONTRACT_VERSION",
    "AuthError",
    "AuthErrorCode",
    "AuthMode",
    "FederatedJwksConfig",
    "Identity",
    "LegacyHs256Config",
    "OutOfBandResolver",
    "Verifier",
    "VerifierConfig",
    "create_verifier",
    "verify_token",
]

__version__ = "0.1.0"
