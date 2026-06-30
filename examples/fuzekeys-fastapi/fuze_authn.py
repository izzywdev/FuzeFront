"""Reference Python validator for the Fuze family AuthN federation contract (v1.0.0).

See ``docs/auth/federation-authn-contract.md`` for the normative spec. This is the
Python/FastAPI equivalent of the ``@fuzefront/authn`` TS package: a sibling app
(e.g. FuzeKeys) validates Authentik-issued RS256 tokens via the shared JWKS,
scoped to its own ``aud`` — no ``JWT_SECRET`` sharing.

Depends only on ``pyjwt[crypto]`` (see requirements.txt).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable

import jwt
from jwt import PyJWKClient

_FORBIDDEN_ALG_PREFIXES = ("HS",)
_FORBIDDEN_ALGS = {"none"}


class FamilyTokenError(Exception):
    """Raised when a token fails validation. ``code`` is a stable string."""

    def __init__(self, message: str, code: str = "invalid_token") -> None:
        super().__init__(message)
        self.code = code


@dataclass
class FamilyPrincipal:
    """The validated, normalized identity extracted from a family token."""

    sub: str
    issuer: str
    email: str | None = None
    email_verified: bool | None = None
    name: str | None = None
    preferred_username: str | None = None
    groups: list[str] = field(default_factory=list)
    audience: Any = None
    expires_at: int | None = None
    raw: dict[str, Any] = field(default_factory=dict)


class FamilyAuthValidator:
    """Contract-compliant validator. Construct once and reuse (it caches the JWKS).

    Args:
        issuer: Exact ``iss`` claim value (trailing slash included), e.g.
            ``https://auth.fuzefront.dev/application/o/fuzekeys/``.
        audience: This app's own audience (its Authentik client id).
        jwks_uri: The ``jwks_uri`` from the issuer's
            ``.well-known/openid-configuration``.
        algorithms: Allowed signing algorithms; defaults to ``("RS256",)``.
            ``HS*`` and ``none`` are rejected at construction (alg-confusion guard).
        clock_tolerance: Leeway in seconds on time-based claims (default 60).
    """

    def __init__(
        self,
        issuer: str,
        audience: str | Iterable[str],
        jwks_uri: str,
        algorithms: Iterable[str] = ("RS256",),
        clock_tolerance: int = 60,
        _jwks_client: PyJWKClient | None = None,
    ) -> None:
        algs = list(algorithms)
        for alg in algs:
            if alg in _FORBIDDEN_ALGS or any(alg.upper().startswith(p) for p in _FORBIDDEN_ALG_PREFIXES):
                raise FamilyTokenError(
                    "Symmetric (HS*) and `none` algorithms are forbidden for family tokens",
                    code="config_invalid",
                )
        self.issuer = issuer
        self.audience = audience
        self.algorithms = algs
        self.clock_tolerance = clock_tolerance
        # PyJWKClient caches keys and refreshes on kid miss.
        self._jwks_client = _jwks_client or PyJWKClient(jwks_uri)

    def validate(self, token: str) -> FamilyPrincipal:
        if not token:
            raise FamilyTokenError("No token provided", code="missing_bearer_token")
        try:
            signing_key = self._jwks_client.get_signing_key_from_jwt(token)
            payload = jwt.decode(
                token,
                signing_key.key,
                algorithms=self.algorithms,
                audience=self.audience,
                issuer=self.issuer,
                leeway=self.clock_tolerance,
                options={"require": ["exp", "iat", "sub", "aud", "iss"]},
            )
        except FamilyTokenError:
            raise
        except Exception as exc:  # noqa: BLE001 - normalize all jwt errors
            raise FamilyTokenError(f"Token validation failed: {exc}") from exc

        groups = payload.get("groups")
        return FamilyPrincipal(
            sub=str(payload["sub"]),
            issuer=str(payload["iss"]),
            email=payload.get("email"),
            email_verified=payload.get("email_verified"),
            name=payload.get("name"),
            preferred_username=payload.get("preferred_username"),
            groups=[g for g in groups if isinstance(g, str)] if isinstance(groups, list) else [],
            audience=payload.get("aud"),
            expires_at=payload.get("exp"),
            raw=payload,
        )
