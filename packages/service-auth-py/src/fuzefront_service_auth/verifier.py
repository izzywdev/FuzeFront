"""Callee-side verification of FuzeFront M2M bearer tokens.

Contract: `POST /api/v1/security/tokens/introspect` in
`packages/security/openapi.yaml` (`TokenIntrospectRequest` ->
`TokenIntrospection`). The server implementation
(`backend/security/src/routes/security.ts`) ALWAYS answers this endpoint
with HTTP 200 -- fail-closed introspection is expressed entirely in the
response BODY's `active: boolean` field, never in the status code:

    router.post('/tokens/introspect', async (req, res) => {
      try {
        ...
        res.status(200).json(r)
      } catch (err) {
        // Fail-closed: introspection never throws to the caller.
        res.status(200).json({ active: false })
      }
    })

This is the single most important behaviour in this package. Branching on
HTTP status ("2xx means good") fails OPEN the moment a caller does not read
the body -- see `test_verifier.py::test_inactive_token_with_http_200_is_rejected`
for the regression test this package exists to guarantee.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

from ._cache import DEFAULT_MAX_SIZE, DEFAULT_MAX_TTL_SECONDS, PositiveCache
from ._http import HttpPost, default_http_post
from .exceptions import TokenVerificationError

DEFAULT_TIMEOUT_SECONDS = 10.0


@dataclass(frozen=True)
class MachineIdentity:
    """A verified machine caller, projected from `TokenIntrospection`."""

    subject: str
    scope: Optional[str] = None
    tenant_id: Optional[str] = None
    expires_at: Optional[int] = None
    raw: Dict[str, Any] = field(default_factory=dict)


class MachineTokenVerifier:
    """Verifies a bearer token against FuzeFront's `/tokens/introspect` endpoint.

    Fail-closed on EVERY ambiguity -- a connection error, a timeout, a
    malformed body, a body with `active` missing or non-boolean, or
    `active: false` -- all raise `TokenVerificationError`. There is no code
    path in this class that treats an error as "allow".

    Positive results (only) are cached in memory, bounded by size and by the
    token's own `exp` claim, so a hot path does not re-introspect on every
    request while still respecting revocation within one cache TTL window.

    Example:
        verifier = MachineTokenVerifier(base_url="http://fuzefront-security-service:3000")
        identity = verifier.verify_machine_token(bearer_token)  # raises on any failure
    """

    def __init__(
        self,
        base_url: str,
        *,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
        http_post: Optional[HttpPost] = None,
        cache_max_size: int = DEFAULT_MAX_SIZE,
        cache_max_ttl_seconds: float = DEFAULT_MAX_TTL_SECONDS,
        clock=time.time,
    ) -> None:
        if not base_url:
            raise ValueError("base_url is required")
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        self._http_post = http_post or default_http_post
        self._clock = clock
        self._cache: PositiveCache[MachineIdentity] = PositiveCache(
            max_size=cache_max_size, max_ttl_seconds=cache_max_ttl_seconds
        )

    def verify_machine_token(self, token: str) -> MachineIdentity:
        """Return the caller's `MachineIdentity`, or raise `TokenVerificationError`.

        Fail-closed: any ambiguity (network failure, timeout, malformed
        body, missing/non-bool `active`, or `active: false`) raises. Never
        returns a value for a token that is not affirmatively active.
        """
        if not token or not isinstance(token, str):
            raise TokenVerificationError("no bearer token presented")

        now = self._clock()
        cached = self._cache.get(token, now)
        if cached is not None:
            return cached

        try:
            status, body = self._http_post(
                f"{self._base_url}/api/v1/security/tokens/introspect",
                {"token": token},
                self._timeout,
            )
        except Exception as error:  # noqa: BLE001 - fail closed on ANY transport error
            raise TokenVerificationError(
                f"introspection request failed (failing closed): {error}"
            ) from error

        # The contract guarantees HTTP 200 always. We still fail closed if a
        # proxy/misconfiguration ever produces a non-200 -- we do NOT treat
        # "not 200" as "must therefore be inactive and safe to say so
        # positively"; we simply refuse to authenticate the caller.
        if status != 200:
            raise TokenVerificationError(
                f"introspection endpoint returned unexpected HTTP {status} (failing closed)"
            )

        try:
            data = json.loads(body)
        except (TypeError, ValueError) as error:
            raise TokenVerificationError(
                f"malformed introspection response body (failing closed): {error}"
            ) from error

        if not isinstance(data, dict):
            raise TokenVerificationError("introspection response was not a JSON object (failing closed)")

        active = data.get("active")
        if not isinstance(active, bool):
            raise TokenVerificationError(
                "introspection response missing boolean 'active' (failing closed)"
            )

        # THE branch this package exists for: HTTP 200 tells us nothing.
        # Only `active is True` authenticates the caller.
        if active is not True:
            raise TokenVerificationError("token is not active")

        subject = data.get("subject")
        if not isinstance(subject, str) or not subject:
            raise TokenVerificationError(
                "introspection response marked active but is missing 'subject' (failing closed)"
            )

        identity = MachineIdentity(
            subject=subject,
            scope=data.get("scope"),
            tenant_id=data.get("tenantId"),
            expires_at=data.get("expiresAt"),
            raw=data,
        )
        self._cache.put(token, identity, now, expires_at=data.get("expiresAt"))
        return identity
