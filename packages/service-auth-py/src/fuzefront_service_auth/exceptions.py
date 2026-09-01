"""Exception hierarchy for fuzefront_service_auth.

Every failure mode in this package -- a network error, a timeout, a
malformed response body, a token that introspects as inactive -- surfaces as
one of these. Callers that only catch `ServiceAuthError` get fail-closed
behaviour "for free": nothing in this package raises a bare `Exception`.

Each error also carries a `code` and a suggested HTTP `status`, using the
SAME code vocabulary as the TypeScript sibling
(`packages/service-auth/src/types.ts` `ServiceAuthErrorCode`:
`MISCONFIGURED` / `TOKEN_REQUEST_FAILED` / `MALFORMED_RESPONSE` /
`NO_TOKEN` / `MALFORMED_HEADER` / `INTROSPECTION_UNAVAILABLE` /
`TOKEN_INACTIVE` / `FORBIDDEN` / `UNKNOWN`), so the JSON error body a
FastAPI/Flask route returns and the JSON error body an Express route
returns read as the same product, not two dialects.
"""

from __future__ import annotations

from typing import Optional


class ServiceAuthError(Exception):
    """Base class for every error raised by this package.

    `code` is a stable string from the shared `ServiceAuthErrorCode`
    vocabulary; `status` is the suggested HTTP status for a resource server
    translating this into a response.
    """

    code: str = "UNKNOWN"
    status: int = 401

    def __init__(self, message: str, *, code: Optional[str] = None, status: Optional[int] = None) -> None:
        super().__init__(message)
        if code is not None:
            self.code = code
        if status is not None:
            self.status = status


class TokenRequestError(ServiceAuthError):
    """Raised when acquiring an M2M access token fails.

    Covers connection errors, timeouts, non-200 responses, and malformed
    response bodies from `POST /api/v1/security/tokens`. Callers must treat
    this as "no token available" -- never fall back to an unauthenticated
    call.
    """

    code = "TOKEN_REQUEST_FAILED"
    status = 502


class TokenVerificationError(ServiceAuthError):
    """Raised when a presented bearer token cannot be verified as active.

    Covers connection errors, timeouts, malformed bodies, a missing/non-bool
    `active` field, and the token simply being inactive/expired/revoked. All
    of these collapse to the SAME exception type on purpose: a caller must
    not be able to distinguish "the introspection call failed" from "the
    token is invalid" and choose to let the request through anyway. That
    distinction is exactly the fail-OPEN bug this package exists to prevent.
    """

    code = "INTROSPECTION_UNAVAILABLE"
    status = 401


class AuthorizationError(ServiceAuthError):
    """Raised by an authorization hook to deny an authenticated caller.

    Distinct from `TokenVerificationError`: the token is valid (the caller's
    *identity* is established) but the pluggable authorization hook decided
    this identity may not perform the requested action. Middleware maps this
    to HTTP 403, whereas verification failures map to HTTP 401.
    """

    code = "FORBIDDEN"
    status = 403
