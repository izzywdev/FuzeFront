"""Pluggable per-caller authorization seam.

Verifying a token proves WHO is calling (`MachineIdentity`); it says nothing
about WHAT that caller may do. This module defines the seam the middleware
calls after successful verification, so per-caller authorization can be
wired in once FuzeFront's `/authz/*` routes (`packages/security/openapi.yaml`,
`authz` tag: `check` / `bulk-check` / `permissions`) are live -- landing in a
parallel PR to this one.

This package does NOT call `/authz/*` itself: that would hard-code a
specific policy shape (a single resource/action check? a bulk check? which
claim maps to which permission subject?) that is this package's caller's
decision, not this library's. Instead, both middleware modules
(`middleware/fastapi.py`, `middleware/flask.py`) accept an optional
`authorize` hook of type `AuthorizationHook` and call it with the verified
`MachineIdentity` after authentication succeeds. Two ways to deny, mirroring
the TypeScript sibling's `MachineAuthorizeHook`
(`packages/service-auth/src/middleware.ts`, which returns
`Promise<boolean> | boolean`): raise `AuthorizationError` (or let any other
exception propagate -- an authz hook that throws is ALWAYS treated as a
denial, never a pass), or return exactly `False`. Returning `None`, `True`,
or anything else allows the request through.

Example (once `/authz/*` is live -- illustrative, not implemented here):

    from fuzefront_service_auth import AuthorizationError, MachineIdentity

    def check_authz(identity: MachineIdentity) -> None:
        # e.g. call POST /api/v1/security/authz/check with
        # {"subject": identity.subject, "resource": ..., "action": ...}
        # using your own frozen `@fuzefront/security-client`-equivalent
        # authz call, however your service wants to shape that request.
        if not authz_client.check(identity.subject, resource="orders", action="read"):
            raise AuthorizationError(f"{identity.subject} may not read orders")

    require_identity = machine_identity_dependency(verifier, authorize=check_authz)
"""

from __future__ import annotations

from typing import Callable, Optional

from .verifier import MachineIdentity

# Raise `fuzefront_service_auth.AuthorizationError` (or anything -- a thrown
# hook is always a denial) to deny, or return `False` to deny. Return `None`
# or `True` to allow. Never called before verification succeeds.
AuthorizationHook = Callable[[MachineIdentity], Optional[bool]]
