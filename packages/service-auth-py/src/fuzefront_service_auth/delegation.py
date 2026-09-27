"""Constrained on-behalf-of token exchange against FuzeFront Security."""

from __future__ import annotations

import json
from dataclasses import dataclass

from ._http import HttpPost, default_http_post
from .client import ServiceAuthClient
from .exceptions import TokenRequestError


@dataclass(frozen=True)
class DelegationToken:
    access_token: str
    expires_in: int
    scope: str
    subject: str
    audience: str
    actor: dict

    @property
    def authorization_header(self) -> str:
        return f"Bearer {self.access_token}"


class DelegationClient:
    def __init__(
        self,
        base_url: str,
        service_auth: ServiceAuthClient,
        *,
        timeout: float = 10.0,
        http_post: HttpPost | None = None,
    ) -> None:
        if not base_url or service_auth is None:
            raise TokenRequestError("DelegationClient requires base_url and service_auth", code="MISCONFIGURED", status=500)
        self._base_url = base_url.rstrip("/")
        self._service_auth = service_auth
        self._timeout = timeout
        self._http_post = http_post or default_http_post

    def exchange(self, subject_token: str, audience: str, scopes: list[str]) -> DelegationToken:
        if not subject_token or not audience.startswith("service:") or not scopes:
            raise TokenRequestError("subject_token, service audience and scopes are required", status=400)
        actor = self._service_auth.get_token()
        payload = {
            "subjectToken": subject_token,
            "audience": audience,
            "scope": " ".join(dict.fromkeys(scopes)),
        }
        status, body = self._http_post(
            f"{self._base_url}/api/v1/security/tokens/exchange",
            payload,
            self._timeout,
            headers={"Authorization": actor.authorization_header},
        )
        if status != 200:
            raise TokenRequestError(f"delegation exchange returned HTTP {status}", status=status)
        try:
            data = json.loads(body)
            return DelegationToken(
                access_token=data["accessToken"],
                expires_in=int(data["expiresIn"]),
                scope=data["scope"],
                subject=data["subject"],
                audience=data["audience"],
                actor=data["actor"],
            )
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
            raise TokenRequestError("malformed delegation response", code="MALFORMED_RESPONSE", status=502) from error
