"""fuzefront_auth -- public contract types.

Python peer of `@fuzefront/auth`'s `types.ts` (#117 / #1267). The `Identity`
shape below MUST read as the same product as the TypeScript contract --
field-for-field, modulo Python's snake_case convention (`userId` ->
`user_id`, `tenantId` -> `tenant_id`, `authMode` -> `auth_mode`, etc.) that
every other Python package in this repo already uses
(`fuzefront_service_auth.MachineIdentity`, `fuzefront_identity`). Consumers
depend on `Identity`, never on the raw JWT claims -- `claims` is an escape
hatch, not part of the stable contract.

Two verifier modes, matching the TypeScript union:

    legacy-hs256   -- today's FuzeFront session token (`backend/src/routes/
                      auth.ts`): HS256 over the shared `FUZEFRONT_JWT_SECRET`,
                      subject in `userId` (falling back to `sub` for the OIDC
                      callback path, which also sets `sub`). Carries NO
                      `tenantId`/`roles`, and -- as of this package's
                      creation -- no `iss`/`aud` either, so both are OPTIONAL
                      to validate in this mode (configure them only once the
                      minting side emits them; an absent `iss`/`aud` on the
                      token is NOT by itself a rejection reason here).
    federated-jwks -- the target: RS256/ES256 verified against the issuer's
                      JWKS, with `iss`/`aud` REQUIRED.

FAIL-CLOSED, always: every verification problem raises `AuthError`; nothing
in this package returns a permissive identity on ambiguity.

This package NEVER mints tokens. Verification only.

SECRET HANDLING: no code path in this package (or its middleware) ever logs
a raw token, a signing secret, or a JWKS response body. `AuthError` messages
are fixed, human-readable strings describing *why* verification failed --
never the token bytes, the key material, or the full claim set. See
`verifier.py`'s module docstring for how exception chaining is deliberately
suppressed (`raise ... from None`) so a consumer printing a traceback can
never surface anything upstream library exceptions might otherwise carry.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, Mapping, Optional, Protocol, Union, runtime_checkable

# Semantic version of THIS contract. Bump on every interface change.
AUTH_CONTRACT_VERSION = "0.1.0"

AuthMode = Literal["legacy-hs256", "federated-jwks"]

AuthErrorCode = Literal[
    "NO_TOKEN",  # no bearer token presented
    "MALFORMED",  # not a parseable JWT, or an algorithm this verifier does not accept
    "INVALID_SIGNATURE",  # signature check failed
    "EXPIRED",  # token past `exp`
    "NOT_ACTIVE",  # token before `nbf`
    "INVALID_ISSUER",  # `iss` not the expected value
    "INVALID_AUDIENCE",  # `aud` mismatch
    "MISSING_CLAIM",  # required claim (subject, or a configured iss/aud/exp) absent
    "JWKS_UNAVAILABLE",  # could not fetch/resolve signing keys (federated-jwks)
    "VERIFIER_UNAVAILABLE",  # verifier misconfigured, or an out-of-band resolver failed
    "UNKNOWN",
]


class AuthError(Exception):
    """Raised by any verifier/middleware in this package on a failed
    verification. FAIL-CLOSED: there is no code path that swallows this and
    continues as authenticated.

    `status` is the HTTP status a middleware should surface (401 for authn,
    403 for authz-adjacent denials raised by a resolver/hook).

    The message is always a fixed, human-readable description. It never
    contains the token, a signing secret, or raw JWKS material.
    """

    def __init__(self, code: AuthErrorCode, message: str, status: int = 401) -> None:
        super().__init__(message)
        self.code: AuthErrorCode = code
        self.status = status

    def __repr__(self) -> str:  # pragma: no cover - cosmetic
        return f"AuthError(code={self.code!r}, status={self.status}, message={str(self)!r})"


@dataclass(frozen=True)
class Identity:
    """The stable, normalized identity every consumer receives regardless of
    which verifier produced it -- the contract's keystone. Mirrors the
    TypeScript `Identity` field-for-field.

    Field stability guarantees:
    - `user_id`   -- ALWAYS present. Stable subject id for the principal.
    - `tenant_id` -- MAY be `None` in `legacy-hs256` mode when it cannot be
                     resolved out-of-band (today's FuzeFront token carries no
                     tenant claim). Populated from the token claim in
                     `federated-jwks` mode. Consumers MUST handle `None` and
                     fail-closed on tenant-scoped authorization when absent.
    - `roles`     -- ALWAYS a list (never `None`). In `legacy-hs256` mode,
                     roles are resolved out-of-band since the current token
                     carries no roles claim; an empty list means "no roles
                     known", which a fail-closed consumer treats as
                     unprivileged.
    """

    user_id: str
    tenant_id: Optional[str]
    roles: list
    email: Optional[str] = None
    auth_mode: AuthMode = "legacy-hs256"
    issued_at: Optional[int] = None
    expires_at: Optional[int] = None
    issuer: Optional[str] = None
    # Escape hatch for verifier-specific extras (raw claims a consumer may
    # need during migration). NOT part of the stable contract.
    claims: Mapping[str, Any] = field(default_factory=dict)


@runtime_checkable
class Verifier(Protocol):
    """A pluggable token verifier. Implementations validate a raw bearer
    token and return a normalized `Identity`, or raise `AuthError`.
    """

    mode: AuthMode

    def verify(self, token: str) -> Identity: ...


@runtime_checkable
class OutOfBandResolver(Protocol):
    """Optional out-of-band resolver used by `legacy-hs256` mode to hydrate
    fields the current FuzeFront token does NOT carry (`tenant_id`,
    `roles`). The host application supplies this (e.g. a Postgres lookup by
    user id). Without it, legacy-mode identities have `tenant_id=None` and
    `roles=[]`.

    `resolve` returns a mapping with optional keys `tenant_id`, `roles`,
    `email`. A resolver that raises is treated as an OUTAGE, not a denial --
    see `verifier.py` -- and the whole verification fails closed
    (`VERIFIER_UNAVAILABLE`) rather than silently returning an unprivileged
    identity that would read identically to a real permission denial.
    """

    def resolve(self, user_id: str) -> Mapping[str, Any]: ...


@dataclass(frozen=True)
class LegacyHs256Config:
    """Config for the `legacy-hs256` verifier (interop with today's token
    minted by `backend/src/routes/auth.ts`).
    """

    #: Shared secret used to sign today's token (`FUZEFRONT_JWT_SECRET`).
    secret: str
    #: Claim holding the subject id. Default `'userId'` (current token);
    #: falls back to `'sub'` (the OIDC callback path also sets `sub`).
    subject_claim: str = "userId"
    #: Optional out-of-band hydration for tenant_id/roles/email.
    resolver: Optional[OutOfBandResolver] = None
    #: Clock-skew tolerance in seconds. Default 0.
    clock_tolerance_sec: int = 0
    #: Optional expected issuer. When set, `iss` becomes REQUIRED and
    #: validated; when unset (the default -- matching today's token, which
    #: emits no `iss`), `iss` is never checked even if present on the token.
    issuer: Optional[str] = None
    #: Optional expected audience (string or list of strings). Same
    #: optional-but-enforced-when-set semantics as `issuer`.
    audience: Optional[Union[str, list]] = None

    @classmethod
    def from_env(cls, env: Optional[Mapping[str, str]] = None, **overrides: Any) -> "LegacyHs256Config":
        """Build from `FUZEFRONT_JWT_SECRET` / `FUZEFRONT_JWT_ISS` /
        `FUZEFRONT_JWT_AUD`. `iss`/`aud` are optional -- absent env vars mean
        "do not validate", matching today's token shape.
        """
        import os

        e = env if env is not None else os.environ
        secret = overrides.pop("secret", e.get("FUZEFRONT_JWT_SECRET", ""))
        if not secret:
            raise AuthError(
                "VERIFIER_UNAVAILABLE",
                "FUZEFRONT_JWT_SECRET is not set",
                status=500,
            )
        issuer = overrides.pop("issuer", e.get("FUZEFRONT_JWT_ISS") or None)
        audience = overrides.pop("audience", e.get("FUZEFRONT_JWT_AUD") or None)
        return cls(secret=secret, issuer=issuer, audience=audience, **overrides)


@dataclass(frozen=True)
class FederatedJwksConfig:
    """Config for the `federated-jwks` verifier (federated RS256/ES256,
    verified against the issuer's published JWKS).

    `issuer` and `audience` are both REQUIRED here -- unlike `legacy-hs256`,
    a federated token always carries both and this mode is only meaningful
    if they are enforced.
    """

    #: Federation issuer URL. Used for discovery of the JWKS endpoint and for
    #: `iss` validation.
    issuer: str
    #: Expected audience (`aud`). Typically the registered client id.
    audience: Union[str, list]
    #: Explicit JWKS URI. Optional -- if omitted, resolved via OIDC discovery
    #: of `${issuer}/.well-known/openid-configuration`.
    jwks_uri: Optional[str] = None
    #: Claim holding the tenant/organization id. Default `'tenantId'`.
    tenant_claim: str = "tenantId"
    #: Claim holding the roles array. Default `'roles'`.
    roles_claim: str = "roles"
    #: Claim holding the subject id. Default `'sub'`.
    subject_claim: str = "sub"
    #: Clock-skew tolerance in seconds. Default 60.
    clock_tolerance_sec: int = 60
    #: How long (seconds) a fetched JWKS is cached before re-fetching.
    jwks_cache_ttl_sec: int = 300

    @classmethod
    def from_env(cls, env: Optional[Mapping[str, str]] = None, **overrides: Any) -> "FederatedJwksConfig":
        """Build from `FUZEFRONT_JWT_ISSUER` / `FUZEFRONT_JWT_AUDIENCE` /
        `FUZEFRONT_JWKS_URI` (optional -- else OIDC discovery).
        """
        import os

        e = env if env is not None else os.environ
        issuer = overrides.pop("issuer", e.get("FUZEFRONT_JWT_ISSUER", ""))
        audience = overrides.pop("audience", e.get("FUZEFRONT_JWT_AUDIENCE", ""))
        if not issuer or not audience:
            raise AuthError(
                "VERIFIER_UNAVAILABLE",
                "FUZEFRONT_JWT_ISSUER and FUZEFRONT_JWT_AUDIENCE are both required",
                status=500,
            )
        jwks_uri = overrides.pop("jwks_uri", e.get("FUZEFRONT_JWKS_URI") or None)
        return cls(issuer=issuer, audience=audience, jwks_uri=jwks_uri, **overrides)


VerifierConfig = Union[LegacyHs256Config, FederatedJwksConfig]
