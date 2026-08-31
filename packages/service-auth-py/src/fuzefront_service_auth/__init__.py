"""
fuzefront_service_auth
=======================

Python service-to-service (S2S) auth for the FuzeFront family: a caller-side
client that acquires/caches M2M access tokens, and a callee-side verifier +
framework middleware that validates them against FuzeFront's Security API.

Both halves talk ONLY to FuzeFront's own contract
(`POST /api/v1/security/tokens`, `POST /api/v1/security/tokens/introspect`)
-- never to the underlying identity provider directly. The vendor is hidden
behind that contract by design; this package must not leak it either.

Peer of the TypeScript `packages/service-auth` runtime and the
`@fuzefront/security-client` generated types. All three are projections of
the same frozen contract (`packages/security/openapi.yaml`) -- if this
package disagrees with the spec, the spec wins and this package is the bug.
"""

from .authz import AuthorizationHook
from .client import CachedToken, ServiceAuthClient
from .exceptions import (
    AuthorizationError,
    ServiceAuthError,
    TokenRequestError,
    TokenVerificationError,
)
from .verifier import MachineIdentity, MachineTokenVerifier

__all__ = [
    "CachedToken",
    "ServiceAuthClient",
    "AuthorizationError",
    "AuthorizationHook",
    "ServiceAuthError",
    "TokenRequestError",
    "TokenVerificationError",
    "MachineIdentity",
    "MachineTokenVerifier",
]

__version__ = "1.0.0"
