"""FastAPI dependency that verifies a FuzeFront M2M bearer token.

Requires the `fastapi` extra: `pip install "fuzefront-service-auth[fastapi]"`.
"""

from __future__ import annotations

from typing import Optional

try:
    from fastapi import Depends, HTTPException, Request
    from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
except ImportError as error:  # pragma: no cover - exercised only when extra is missing
    raise ImportError(
        "fuzefront_service_auth.middleware.fastapi requires the 'fastapi' extra: "
        "pip install \"fuzefront-service-auth[fastapi]\""
    ) from error

from ..authz import AuthorizationHook
from ..exceptions import AuthorizationError, ServiceAuthError
from ..verifier import MachineIdentity, MachineTokenVerifier

_bearer_scheme = HTTPBearer(auto_error=False)


def _deny(error: ServiceAuthError) -> "HTTPException":
    """Build the HTTPException for a `ServiceAuthError`, matching the
    `{error, code}` JSON body shape of the TypeScript sibling's
    `MachineAuthErrorBody` (`packages/service-auth/src/middleware.ts`).
    """
    return HTTPException(status_code=error.status, detail={"error": str(error), "code": error.code})


def machine_identity_dependency(
    verifier: MachineTokenVerifier,
    *,
    authorize: Optional[AuthorizationHook] = None,
):
    """Build a FastAPI dependency that authenticates the caller as a machine identity.

    Attaches the verified `MachineIdentity` to `request.state.machine_identity`
    and returns it, so it can also be consumed directly as the dependency's
    return value.

    Example:
        verifier = MachineTokenVerifier(base_url="http://fuzefront-security-service:3000")
        require_machine_identity = machine_identity_dependency(verifier)

        @app.get("/internal/reports")
        async def reports(identity: MachineIdentity = Depends(require_machine_identity)):
            return {"caller": identity.subject}
    """

    async def dependency(
        request: Request,
        credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer_scheme),
    ) -> MachineIdentity:
        if credentials is None or not credentials.credentials:
            raise _deny(ServiceAuthError("no bearer token presented", code="NO_TOKEN", status=401))

        try:
            identity = verifier.verify_machine_token(credentials.credentials)
        except ServiceAuthError as error:
            raise _deny(error)

        if authorize is not None:
            try:
                allowed = authorize(identity)
            except AuthorizationError as error:
                raise _deny(error)
            except Exception as error:  # noqa: BLE001 - an authz hook that throws is a denial, never a pass
                raise _deny(
                    AuthorizationError(f"authorization decision unavailable; denying: {error}")
                ) from error
            if allowed is False:
                raise _deny(AuthorizationError("not permitted"))

        request.state.machine_identity = identity
        return identity

    return dependency
