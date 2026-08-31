"""Exception hierarchy for fuzefront_service_auth.

Every failure mode in this package -- a network error, a timeout, a
malformed response body, a token that introspects as inactive -- surfaces as
one of these. Callers that only catch `ServiceAuthError` get fail-closed
behaviour "for free": nothing in this package raises a bare `Exception`.
"""


class ServiceAuthError(Exception):
    """Base class for every error raised by this package."""


class TokenRequestError(ServiceAuthError):
    """Raised when acquiring an M2M access token fails.

    Covers connection errors, timeouts, non-200 responses, and malformed
    response bodies from `POST /api/v1/security/tokens`. Callers must treat
    this as "no token available" -- never fall back to an unauthenticated
    call.
    """


class TokenVerificationError(ServiceAuthError):
    """Raised when a presented bearer token cannot be verified as active.

    Covers connection errors, timeouts, malformed bodies, a missing/non-bool
    `active` field, and the token simply being inactive/expired/revoked. All
    of these collapse to the SAME exception type on purpose: a caller must
    not be able to distinguish "the introspection call failed" from "the
    token is invalid" and choose to let the request through anyway. That
    distinction is exactly the fail-OPEN bug this package exists to prevent.
    """


class AuthorizationError(ServiceAuthError):
    """Raised by an authorization hook to deny an authenticated caller.

    Distinct from `TokenVerificationError`: the token is valid (the caller's
    *identity* is established) but the pluggable authorization hook decided
    this identity may not perform the requested action. Middleware maps this
    to HTTP 403, whereas verification failures map to HTTP 401.
    """
