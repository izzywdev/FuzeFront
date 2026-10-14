"""Token verification runtime -- the Python peer of ``packages/auth/src/verifyToken.ts``.

Two modes, one dependency (PyJWT):

``legacy-hs256``
    Today's FuzeFront session token: HS256 over the shared ``JWT_SECRET``,
    subject in ``userId``. Carries no tenant/roles, so an optional ``resolver``
    hydrates them. ``exp`` is REQUIRED; ``iss``/``aud`` are enforced when
    configured (today's token does not carry them yet).

``federated-jwks``
    RS256/ES256 verified against the issuer's public JWKS. ``iss`` and ``aud``
    are both REQUIRED to be configured and are enforced, as is ``exp``. No shared
    secret, so a consumer can verify without gaining the power to mint.

FAIL-CLOSED: every failure path raises ``AuthError``. Algorithms are pinned per
mode, so ``alg=none`` and algorithm-confusion tokens are rejected before any key
is consulted. Error messages are fixed strings -- never derived from the token.
This module does not log.
"""

from __future__ import annotations

import json
import threading
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Protocol

import jwt
from jwt import PyJWK

from .types import AuthError, AuthMode, Identity

# Asymmetric algorithms ONLY for federated mode: permitting HS* would let anyone
# who knows the (public) key use it as an HMAC secret and forge tokens.
_FEDERATED_ALGORITHMS = ["RS256", "RS384", "RS512", "ES256", "ES384"]
_DISCOVERY_TIMEOUT_SEC = 5
_JWKS_TIMEOUT_SEC = 5
# A fetched key set is trusted for this long, then re-fetched. A key the issuer
# retires therefore stops verifying within this window (no per-key LRU cache).
_JWKS_LIFESPAN_SEC = 300
# Minimum gap between network attempts (forced refresh for an unknown `kid`, or a
# retry after a failed fetch). Without it an unauthenticated caller choosing
# random `kid`s makes one blocking outbound request per request.
_JWKS_MIN_REFETCH_SEC = 30


class Verifier(Protocol):
    mode: AuthMode

    def verify(self, token: str) -> Identity: ...


# (user_id) -> {"tenant_id": ..., "roles": [...], "email": ...}; keys optional.
Resolver = Callable[[str], dict[str, Any]]


@dataclass(frozen=True)
class LegacyHs256Config:
    secret: str
    subject_claim: str = "userId"
    resolver: Resolver | None = None
    clock_tolerance_sec: int = 0
    issuer: str | None = None
    audience: str | list[str] | None = None
    mode: AuthMode = "legacy-hs256"


@dataclass(frozen=True)
class FederatedJwksConfig:
    issuer: str
    audience: str | list[str]
    jwks_uri: str | None = None
    tenant_claim: str = "tenantId"
    roles_claim: str = "roles"
    subject_claim: str = "sub"
    clock_tolerance_sec: int = 60
    mode: AuthMode = "federated-jwks"


VerifierConfig = LegacyHs256Config | FederatedJwksConfig


def _to_auth_error(err: Exception) -> AuthError:
    """Map a PyJWT failure onto the contract's error taxonomy. Anything
    unrecognised becomes UNKNOWN and still denies. Never echoes the exception
    text: PyJWT messages can quote claim values from an attacker-controlled token."""
    if isinstance(err, AuthError):
        return err
    if isinstance(err, jwt.ExpiredSignatureError):
        return AuthError("EXPIRED", "token has expired")
    if isinstance(err, jwt.ImmatureSignatureError):
        return AuthError("NOT_ACTIVE", "token is not yet valid")
    if isinstance(err, jwt.InvalidSignatureError):
        return AuthError("INVALID_SIGNATURE", "signature verification failed")
    if isinstance(err, jwt.InvalidAlgorithmError):
        return AuthError("INVALID_SIGNATURE", "token algorithm is not permitted")
    if isinstance(err, jwt.InvalidIssuerError):
        return AuthError("INVALID_ISSUER", "unexpected token issuer")
    if isinstance(err, (jwt.InvalidAudienceError,)):
        return AuthError("INVALID_AUDIENCE", "unexpected token audience")
    if isinstance(err, jwt.MissingRequiredClaimError):
        return AuthError("MISSING_CLAIM", "token is missing a required claim")
    if isinstance(err, (jwt.DecodeError, jwt.InvalidTokenError)):
        return AuthError("MALFORMED", "token is not a parseable JWT")
    return AuthError("UNKNOWN", "verification failed")


def _claim_string(payload: dict[str, Any], name: str) -> str | None:
    value = payload.get(name)
    return value if isinstance(value, str) and value else None


def _claim_roles(payload: dict[str, Any], name: str) -> tuple[str, ...]:
    value = payload.get(name)
    if isinstance(value, list):
        return tuple(r for r in value if isinstance(r, str))
    if isinstance(value, str) and value:
        return (value,)
    return ()


def _claim_number(payload: dict[str, Any], name: str) -> int | float | None:
    """NumericDate claims may be fractional; keep them (the Node peer does)."""
    value = payload.get(name)
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _decode_options(has_audience: bool, has_issuer: bool) -> dict[str, Any]:
    required = ["exp"]
    if has_issuer:
        required.append("iss")
    if has_audience:
        required.append("aud")
    return {
        "require": required,
        "verify_signature": True,
        "verify_exp": True,
        "verify_nbf": True,
        "verify_iss": has_issuer,
        "verify_aud": has_audience,
    }


class _LegacyVerifier:
    mode: AuthMode = "legacy-hs256"

    def __init__(self, config: LegacyHs256Config) -> None:
        if not config.secret:
            # Misconfiguration fails at construction, not silently at verify-time.
            raise AuthError("VERIFIER_UNAVAILABLE", "legacy-hs256 requires `secret`", 500)
        self._config = config

    def verify(self, token: str) -> Identity:
        if not token:
            raise AuthError("NO_TOKEN", "no bearer token presented")
        cfg = self._config
        try:
            payload = jwt.decode(
                token,
                cfg.secret,
                # PINNED. Without this a token claiming `alg: none`, or an
                # asymmetric alg, could sidestep the shared secret entirely.
                algorithms=["HS256"],
                issuer=cfg.issuer,
                audience=cfg.audience,
                leeway=cfg.clock_tolerance_sec,
                options=_decode_options(cfg.audience is not None, cfg.issuer is not None),
            )
        except Exception as err:  # noqa: BLE001 - every failure is a denial
            raise _to_auth_error(err) from None

        # Only a PLAIN platform session authenticates here. A token carrying a
        # `kind` (`fuze-org-session`, `fuze-workload`, `fuze-delegation`) is a
        # narrowed/machine credential for a different audience that merely shares
        # the secret; hydrating it with the user's full roles would widen it.
        # Same rule as backend/src/middleware/auth.ts.
        if "kind" in payload:
            raise AuthError("INVALID_AUDIENCE", "token is not a platform session token")

        user_id = _claim_string(payload, cfg.subject_claim) or _claim_string(payload, "sub")
        if not user_id:
            raise AuthError("MISSING_CLAIM", f"token has no `{cfg.subject_claim}` (or `sub`) claim")

        # Today's token carries neither tenant nor roles. Without a resolver the
        # identity is deliberately UNPRIVILEGED rather than guessed.
        tenant_id: str | None = None
        roles: tuple[str, ...] = ()
        email = _claim_string(payload, "email")
        if cfg.resolver is not None:
            try:
                extra = cfg.resolver(user_id) or {}
            except Exception:  # noqa: BLE001
                # A valid token whose hydration failed must not read as
                # "authorized for nothing": that would mask an outage as an authz
                # decision. Deny loudly, and never surface the resolver's message.
                raise AuthError("VERIFIER_UNAVAILABLE", "identity resolver failed", 500) from None
            tenant_id = extra.get("tenant_id") or None
            roles = tuple(extra.get("roles") or ())
            email = extra.get("email") or email

        return Identity(
            user_id=user_id,
            tenant_id=tenant_id,
            roles=roles,
            email=email,
            auth_mode="legacy-hs256",
            issued_at=_claim_number(payload, "iat"),
            expires_at=_claim_number(payload, "exp"),
            issuer=_claim_string(payload, "iss"),
            claims=dict(payload),
        )


def _now() -> float:
    return time.monotonic()


def _fetch_json(url: str, timeout: float) -> Any:
    with urllib.request.urlopen(url, timeout=timeout) as res:
        return json.load(res)


def _load_jwk(raw: Any) -> PyJWK | None:
    """An unusable key (unsupported type, malformed) is skipped; the rest still load."""
    try:
        return PyJWK(raw)
    except Exception:  # noqa: BLE001
        return None


class _KeyResolver:
    """Resolves a token's signing key from the issuer's JWKS with a BOUNDED cache.

    - The key set is cached for ``_JWKS_LIFESPAN_SEC`` and then re-fetched, so a
      key the issuer retires stops verifying within that window.
    - Network attempts (a forced refresh for an unknown ``kid``, or a retry after
      a failure) are spaced at least ``_JWKS_MIN_REFETCH_SEC`` apart, so tokens
      with attacker-chosen ``kid`` values cannot drive per-request outbound calls.
    - If the set cannot be fetched or has expired the result is a denial; stale
      keys are never served past their lifespan.
    """

    def __init__(self, config: FederatedJwksConfig) -> None:
        self._config = config
        self._lock = threading.Lock()
        self._jwks_uri: str | None = config.jwks_uri
        self._keys: dict[str | None, PyJWK] = {}
        self._fetched_at: float | None = None
        self._last_attempt: float | None = None

    def _resolve_jwks_uri(self) -> str:
        if self._jwks_uri:
            return self._jwks_uri
        discovery = f"{self._config.issuer.rstrip('/')}/.well-known/openid-configuration"
        try:
            doc = _fetch_json(discovery, _DISCOVERY_TIMEOUT_SEC)
        except (urllib.error.URLError, OSError, ValueError):
            raise AuthError("JWKS_UNAVAILABLE", "OIDC discovery failed") from None
        uri = doc.get("jwks_uri") if isinstance(doc, dict) else None
        if not isinstance(uri, str) or not uri:
            raise AuthError("JWKS_UNAVAILABLE", "discovery document has no `jwks_uri`")
        self._jwks_uri = uri
        return uri

    def _refresh(self) -> None:
        """Fetch the key set. Caller holds the lock and has checked the cooldown."""
        self._last_attempt = _now()
        try:
            doc = _fetch_json(self._resolve_jwks_uri(), _JWKS_TIMEOUT_SEC)
            raw_keys = doc.get("keys") if isinstance(doc, dict) else None
            if not isinstance(raw_keys, list):
                raise TypeError("no keys")
            loaded = (_load_jwk(raw) for raw in raw_keys)
            keys = {jwk.key_id: jwk for jwk in loaded if jwk is not None}
        except AuthError:
            raise
        except (urllib.error.URLError, OSError, ValueError, TypeError):
            raise AuthError("JWKS_UNAVAILABLE", "could not fetch signing keys") from None
        self._keys = keys
        self._fetched_at = _now()

    def _expired(self) -> bool:
        return self._fetched_at is None or _now() - self._fetched_at >= _JWKS_LIFESPAN_SEC

    def _may_attempt(self) -> bool:
        return self._last_attempt is None or _now() - self._last_attempt >= _JWKS_MIN_REFETCH_SEC

    def _lookup(self, kid: str | None) -> PyJWK | None:
        if kid is not None:
            return self._keys.get(kid)
        # No `kid`: only unambiguous when the issuer publishes a single key.
        return next(iter(self._keys.values())) if len(self._keys) == 1 else None

    def get_key(self, token: str) -> Any:
        header = jwt.get_unverified_header(token)
        kid = header.get("kid")
        if kid is not None and not isinstance(kid, str):
            raise AuthError("MALFORMED", "token is not a parseable JWT")
        with self._lock:
            if self._expired():
                self._keys = {}  # an expired set is never served, even if the refetch fails
                if not self._may_attempt():
                    raise AuthError("JWKS_UNAVAILABLE", "signing keys are unavailable")
                self._refresh()
            jwk = self._lookup(kid)
            if jwk is None and self._may_attempt():
                self._refresh()  # the issuer may have rotated in a new key
                jwk = self._lookup(kid)
        if jwk is None:
            raise AuthError("JWKS_UNAVAILABLE", "could not resolve signing key")
        return jwk.key


# One resolver per (issuer, jwks_uri): it owns the fetch + cache, so re-creating it
# per request would hammer the issuer and defeat the cooldown.
_resolvers: dict[tuple[str, str | None], _KeyResolver] = {}
_resolvers_lock = threading.Lock()


class _FederatedVerifier:
    mode: AuthMode = "federated-jwks"

    def __init__(self, config: FederatedJwksConfig) -> None:
        if not config.issuer:
            raise AuthError("VERIFIER_UNAVAILABLE", "federated-jwks requires `issuer`", 500)
        if not config.audience:
            # Unlike the TS package (audience optional), the Python contract
            # requires it: a verifier that accepts any audience will accept a
            # token minted for a different relying party.
            raise AuthError("VERIFIER_UNAVAILABLE", "federated-jwks requires `audience`", 500)
        self._config = config

    def _resolver(self) -> _KeyResolver:
        key = (self._config.issuer, self._config.jwks_uri)
        with _resolvers_lock:
            resolver = _resolvers.get(key)
            if resolver is None:
                resolver = _resolvers[key] = _KeyResolver(self._config)
            return resolver

    def verify(self, token: str) -> Identity:
        if not token:
            raise AuthError("NO_TOKEN", "no bearer token presented")
        cfg = self._config
        try:
            signing_key = self._resolver().get_key(token)
            payload = jwt.decode(
                token,
                signing_key,
                algorithms=_FEDERATED_ALGORITHMS,
                issuer=cfg.issuer,
                audience=cfg.audience,
                leeway=cfg.clock_tolerance_sec,
                options=_decode_options(True, True),
            )
        except Exception as err:  # noqa: BLE001 - every failure is a denial
            raise _to_auth_error(err) from None

        user_id = _claim_string(payload, cfg.subject_claim)
        if not user_id:
            raise AuthError("MISSING_CLAIM", f"token has no `{cfg.subject_claim}` claim")

        return Identity(
            user_id=user_id,
            tenant_id=_claim_string(payload, cfg.tenant_claim),
            roles=_claim_roles(payload, cfg.roles_claim),
            email=_claim_string(payload, "email"),
            auth_mode="federated-jwks",
            issued_at=_claim_number(payload, "iat"),
            expires_at=_claim_number(payload, "exp"),
            issuer=_claim_string(payload, "iss"),
            claims=dict(payload),
        )


def create_verifier(config: VerifierConfig) -> Verifier:
    """Build a ``Verifier`` for the given config. The result is fail-closed."""
    if isinstance(config, LegacyHs256Config):
        return _LegacyVerifier(config)
    if isinstance(config, FederatedJwksConfig):
        return _FederatedVerifier(config)
    # Exhaustiveness guard: a future mode must be handled explicitly.
    raise AuthError("VERIFIER_UNAVAILABLE", "unknown verifier config", 500)


def verify_token(token: str, verifier: Verifier) -> Identity:
    """Verify a raw bearer token (without the ``Bearer `` prefix). Raises ``AuthError``."""
    return verifier.verify(token)
