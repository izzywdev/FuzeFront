"""FastAPI dependency that verifies a FuzeFront M2M bearer token.

Requires the `fastapi` extra: `pip install "fuzefront-service-auth[fastapi]"`.
"""

from __future__ import annotations

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


def _deny(error: ServiceAuthError) -> HTTPException:
    """Build the HTTPException for a `ServiceAuthError`, matching the
    `{error, code}` JSON body shape of the TypeScript sibling's
    `MachineAuthErrorBody` (`packages/service-auth/src/middleware.ts`).
    """
    return HTTPException(status_code=error.status, detail={"error": str(error), "code": error.code})


def machine_identity_dependency(
    verifier: MachineTokenVerifier,
    *,
    authorize: AuthorizationHook | None = None,
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
        credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),  # noqa: B008 - FastAPI DI: the call in the default IS the mechanism
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
            except Exception as error:
                raise _deny(
                    AuthorizationError(f"authorization decision unavailable; denying: {error}")
                ) from error
            if allowed is False:
                raise _deny(AuthorizationError("not permitted"))

        request.state.machine_identity = identity
        return identity

    return dependency


def delegated_identity_dependency(
    verifier: MachineTokenVerifier,
    *,
    audience: str,
    required_scopes: list[str] | None = None,
    delegation_header: str = "x-fuze-delegation",
):
    """Require an immediate service token plus signed delegated-user context.

    The delegation's audience must equal this service and its signed actor must
    equal the immediate machine caller. Plain user-id headers are never trusted.
    """
    required = set(required_scopes or [])

    async def dependency(
        request: Request,
        credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),  # noqa: B008
    ) -> MachineIdentity:
        if credentials is None or not credentials.credentials:
            raise _deny(ServiceAuthError("no service bearer token presented", code="NO_TOKEN", status=401))
        raw_delegation = request.headers.get(delegation_header)
        if not raw_delegation or not raw_delegation.lower().startswith("bearer "):
            raise _deny(ServiceAuthError("no delegation bearer token presented", code="NO_TOKEN", status=401))
        try:
            machine = verifier.verify_machine_token(credentials.credentials)
            delegated = verifier.verify_machine_token(raw_delegation.split(" ", 1)[1])
        except ServiceAuthError as error:
            raise _deny(error)
        if (
            delegated.token_kind != "fuze-delegation"
            or delegated.audience != audience
            or not delegated.actor
            or delegated.actor.get("sub") != machine.subject
            or not required.issubset(set(delegated.scopes))
        ):
            raise _deny(AuthorizationError("delegation does not authorize this caller or operation"))
        request.state.machine_identity = machine
        request.state.delegated_identity = delegated
        return delegated

    return dependency
