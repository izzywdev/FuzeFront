"""FastAPI dependency that verifies a FuzeFront platform bearer token.

Requires the `fastapi` extra: `pip install "fuzefront-auth[fastapi]"`.

Produces the SAME `Identity` the Flask decorator (`middleware.flask`) and
the TypeScript `requireAuth()` (`packages/auth/src/middleware.ts`) produce --
one contract, three mounting points.
"""

from __future__ import annotations

from typing import Optional

try:
    from fastapi import Depends, HTTPException, Request
    from fastapi.concurrency import run_in_threadpool
    from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
except ImportError as error:  # pragma: no cover - exercised only when extra is missing
    raise ImportError(
        "fuzefront_auth.middleware.fastapi requires the 'fastapi' extra: "
        'pip install "fuzefront-auth[fastapi]"'
    ) from error

from ..types import AuthError, Identity, Verifier

_bearer_scheme = HTTPBearer(auto_error=False)


def _deny(error: AuthError) -> HTTPException:
    """Build the HTTPException for an `AuthError`, matching the `{error,
    code}` JSON body shape of the TypeScript sibling's `AuthErrorBody`
    (`packages/auth/src/middleware.ts`).

    `str(error)` is always the fixed message passed to the constructor --
    never the token. See `verifier.py`'s module docstring.
    """
    return HTTPException(status_code=error.status, detail={"error": str(error), "code": error.code})


def require_auth(verifier: Verifier, *, optional: bool = False):
    """Build a FastAPI dependency that authenticates the caller.

    Attaches the normalized `Identity` to `request.state.identity` and
    returns it, so it can also be consumed directly as the dependency's
    return value (`None` on an `optional` route with no/invalid token).

    Verification runs in FastAPI's threadpool (`run_in_threadpool`) rather
    than inline on the event loop: the first call against a `federated-jwks`
    verifier may perform a blocking JWKS fetch, and PyJWT's own decode path
    is synchronous CPU-bound work either way.

    Example:
        verifier = create_verifier(LegacyHs256Config(secret=os.environ["FUZEFRONT_JWT_SECRET"]))
        require_identity = require_auth(verifier)

        @app.get("/private")
        async def private(identity: Identity = Depends(require_identity)):
            return {"userId": identity.user_id}
    """
    if verifier is None:
        raise AuthError("VERIFIER_UNAVAILABLE", "require_auth requires a `verifier`", status=500)

    async def dependency(
        request: Request,
        credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer_scheme),  # noqa: B008 - FastAPI DI
    ) -> Optional[Identity]:
        if credentials is None or not credentials.credentials:
            if optional:
                request.state.identity = None
                return None
            raise _deny(AuthError("NO_TOKEN", "no bearer token presented"))

        try:
            identity = await run_in_threadpool(verifier.verify, credentials.credentials)
        except AuthError as error:
            if optional:
                request.state.identity = None
                return None
            raise _deny(error) from None
        except Exception:  # noqa: BLE001 - an unexpected failure is still a failure
            if optional:
                request.state.identity = None
                return None
            raise _deny(AuthError("UNKNOWN", "authentication failed")) from None

        request.state.identity = identity
        return identity

    return dependency
