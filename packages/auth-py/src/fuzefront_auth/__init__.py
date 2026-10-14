"""fuzefront-auth -- consumable authN for Python FuzeFront-family services.

Python peer of ``@fuzefront/auth``. See README.md and
``packages/auth/docs/TOKEN_CONTRACT.md`` for the contract.
"""

from .config import verifier_from_env
from .types import (
    AUTH_CONTRACT_VERSION,
    AUTH_ERROR_CODES,
    AuthError,
    AuthMode,
    Identity,
)
from .verifier import (
    FederatedJwksConfig,
    LegacyHs256Config,
    Resolver,
    Verifier,
    VerifierConfig,
    create_verifier,
    verify_token,
)

__all__ = [
    "AUTH_CONTRACT_VERSION",
    "AUTH_ERROR_CODES",
    "AuthError",
    "AuthMode",
    "FederatedJwksConfig",
    "Identity",
    "LegacyHs256Config",
    "Resolver",
    "Verifier",
    "VerifierConfig",
    "create_verifier",
    "verifier_from_env",
    "verify_token",
]
