"""Caller-side M2M token acquisition against FuzeFront's Security API.

Contract: `POST /api/v1/security/tokens` in `packages/security/openapi.yaml`
(`TokenIssueRequest` -> `TokenIssueResponse`). This is a client-credentials
style exchange against FuzeFront itself -- never against the underlying
identity provider, which the contract deliberately hides.
"""

from __future__ import annotations

import json
import threading
import time
from dataclasses import dataclass
from typing import Optional

from ._http import HttpPost, default_http_post
from .exceptions import ServiceAuthError, TokenRequestError

# Refresh this many seconds before actual expiry, so a token is never handed
# to a caller with (effectively) zero life left on it -- a request that reads
# `expiresIn` at T-1s and then takes 2s to reach the callee would otherwise
# present an already-expired token.
DEFAULT_REFRESH_MARGIN_SECONDS = 30.0
DEFAULT_TIMEOUT_SECONDS = 10.0


@dataclass(frozen=True)
class CachedToken:
    """An acquired M2M access token plus its absolute (epoch-seconds) expiry."""

    access_token: str
    token_type: str
    expires_at: float
    scope: Optional[str] = None

    @property
    def authorization_header(self) -> str:
        """Ready-to-send `Authorization` header value, e.g. `"Bearer <token>"`."""
        return f"{self.token_type} {self.access_token}"


class _PendingFetch:
    """Single-flight coordination handle for one in-progress token refresh."""

    __slots__ = ("event", "token", "error")

    def __init__(self) -> None:
        self.event = threading.Event()
        self.token: Optional[CachedToken] = None
        self.error: Optional[BaseException] = None


class ServiceAuthClient:
    """Acquires and caches an M2M access token for one `(clientId, clientSecret)` pair.

    - Caches the token in memory and refreshes it BEFORE expiry (with a
      safety margin), so `get_token()` does not perform a network call on
      every invocation.
    - Thread-safe: concurrent callers that land during a refresh share the
      SAME in-flight HTTP request ("single-flight") instead of each firing
      their own request at the identity provider.
    - Talks only to FuzeFront's own `/api/v1/security/tokens` endpoint --
      never to the underlying identity provider, which this contract hides.

    Example:
        client = ServiceAuthClient(
            base_url="http://fuzefront-security-service:3000",
            client_id=os.environ["FUZEFRONT_CLIENT_ID"],
            client_secret=os.environ["FUZEFRONT_CLIENT_SECRET"],
        )
        token = client.get_token()
        response = requests.get(url, headers={"Authorization": token.authorization_header})
    """

    def __init__(
        self,
        base_url: str,
        client_id: str,
        client_secret: str,
        *,
        scope: Optional[str] = None,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
        refresh_margin_seconds: float = DEFAULT_REFRESH_MARGIN_SECONDS,
        http_post: Optional[HttpPost] = None,
        clock=time.time,
    ) -> None:
        if not base_url or not client_id or not client_secret:
            raise ServiceAuthError(
                "ServiceAuthClient requires base_url, client_id, and client_secret",
                code="MISCONFIGURED",
                status=500,
            )
        self._base_url = base_url.rstrip("/")
        self._client_id = client_id
        self._client_secret = client_secret
        self._scope = scope
        self._timeout = timeout
        self._refresh_margin = refresh_margin_seconds
        self._http_post = http_post or default_http_post
        self._clock = clock

        self._state_lock = threading.Lock()
        self._cached: Optional[CachedToken] = None
        self._pending: Optional[_PendingFetch] = None

    def get_token(self) -> CachedToken:
        """Return a valid access token, refreshing it first if needed.

        Never performs a network call per invocation when the cached token
        is still valid past the refresh margin. Concurrent callers during a
        refresh block on the ONE in-flight request rather than each starting
        their own (no stampede on the identity provider).
        """
        now = self._clock()

        with self._state_lock:
            if self._cached is not None and self._cached.expires_at - self._refresh_margin > now:
                return self._cached

            if self._pending is not None:
                pending = self._pending
                is_leader = False
            else:
                pending = _PendingFetch()
                self._pending = pending
                is_leader = True

        if not is_leader:
            # Follower: wait for the leader's in-flight fetch to complete and
            # share its result (success or failure) rather than issuing a
            # second HTTP request.
            if not pending.event.wait(self._timeout + 5.0):
                raise TokenRequestError("timed out waiting for a concurrent token refresh")
            if pending.error is not None:
                if isinstance(pending.error, ServiceAuthError):
                    raise TokenRequestError(
                        f"concurrent token refresh failed: {pending.error}",
                        code=pending.error.code,
                        status=pending.error.status,
                    ) from pending.error
                raise TokenRequestError(
                    f"concurrent token refresh failed: {pending.error}"
                ) from pending.error
            assert pending.token is not None
            return pending.token

        # Leader: perform the actual fetch outside the lock so followers can
        # register against `self._pending` without blocking on network I/O.
        try:
            token = self._fetch_token()
        except BaseException as error:  # noqa: BLE001 - deliberately fail-closed & rethrow
            with self._state_lock:
                self._pending = None
            pending.error = error
            pending.event.set()
            raise

        with self._state_lock:
            self._cached = token
            self._pending = None
        pending.token = token
        pending.event.set()
        return token

    def invalidate(self) -> None:
        """Drop the cached token, forcing the next `get_token()` to fetch a fresh one.

        Useful when a caller independently learns its token was rejected
        downstream (e.g. a 401 from another service) and wants to force a
        refresh rather than waiting out the normal refresh margin.
        """
        with self._state_lock:
            self._cached = None

    def _fetch_token(self) -> CachedToken:
        payload = {"clientId": self._client_id, "clientSecret": self._client_secret}
        if self._scope:
            payload["scope"] = self._scope

        request_time = self._clock()
        try:
            status, body = self._http_post(
                f"{self._base_url}/api/v1/security/tokens", payload, self._timeout
            )
        except Exception as error:  # noqa: BLE001 - normalize every transport failure
            raise TokenRequestError(
                f"failed to reach the token endpoint: {error}", status=502
            ) from error

        if status != 200:
            raise TokenRequestError(
                f"token endpoint returned HTTP {status}: {body!r}",
                status=status if status in (400, 401) else 502,
            )

        try:
            data = json.loads(body)
        except (TypeError, ValueError) as error:
            raise TokenRequestError(
                f"malformed token response body: {error}", code="MALFORMED_RESPONSE", status=502
            ) from error

        if not isinstance(data, dict):
            raise TokenRequestError(
                "token response body was not a JSON object", code="MALFORMED_RESPONSE", status=502
            )

        access_token = data.get("accessToken")
        expires_in = data.get("expiresIn")
        if not isinstance(access_token, str) or not access_token:
            raise TokenRequestError(
                "token response missing 'accessToken'", code="MALFORMED_RESPONSE", status=502
            )
        if not isinstance(expires_in, (int, float)):
            raise TokenRequestError(
                "token response missing numeric 'expiresIn'", code="MALFORMED_RESPONSE", status=502
            )

        return CachedToken(
            access_token=access_token,
            token_type=data.get("tokenType") or "Bearer",
            expires_at=request_time + float(expires_in),
            scope=data.get("scope"),
        )
