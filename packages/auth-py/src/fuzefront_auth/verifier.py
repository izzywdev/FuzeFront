"""fuzefront_auth -- token verification runtime.

Python peer of `@fuzefront/auth`'s `verifyToken.ts`. Same two modes, same
fail-closed discipline, one dependency -- PyJWT (with its `crypto` extra)
covers HS256 and RS256/ES256, so consumers do not pull a second crypto
library.

NEVER LOG TOKEN CONTENTS. Every exception raised from this module is a
fixed, human-readable `AuthError` message -- never the raw token, the
signing secret, or JWKS key material. Every `except` clause below re-raises
via `raise ... from None`, which deliberately severs the exception chain:
a consumer that prints `traceback.format_exc()` on an `AuthError` will never
see the underlying PyJWT exception (which, in principle, a future PyJWT
version could embed token fragments into) attached to it. This is the one
module in the package that touches raw token bytes, so it carries the
whole burden of that guarantee.
"""

from __future__ import annotations

import json
import threading
import urllib.error
import urllib.request
from typing import Any, Mapping, Optional

import jwt
from jwt import PyJWKClient
from jwt.exceptions import (
    DecodeError,
    ExpiredSignatureError,
    ImmatureSignatureError,
    InvalidAlgorithmError,
    InvalidAudienceError,
    InvalidIssuerError,
    InvalidSignatureError,
    InvalidTokenError,
    MissingRequiredClaimError,
    PyJWKClientError,
)

from .types import (
    AuthError,
    FederatedJwksConfig,
    Identity,
    LegacyHs256Config,
    Verifier,
    VerifierConfig,
)

# Algorithms are PINNED, per mode. Without this, a token claiming `alg: none`
# -- or an algorithm from the other mode's family -- could sidestep the
# intended verification path entirely (the classic JWT algorithm-confusion
# attack). `jwt.decode(..., algorithms=[...])` rejects anything outside this
# list before it ever reaches signature verification.
_LEGACY_ALGORITHMS = ["HS256"]
_FEDERATED_ALGORITHMS = ["RS256", "RS384", "RS512", "ES256", "ES384"]

_DISCOVERY_TIMEOUT_SEC = 5.0


def _to_auth_error(err: Exception) -> AuthError:
    """Translate a PyJWT (or other) failure into the contract's error
    taxonomy. PyJWT's own exception messages are fixed, descriptive strings
    that never embed the raw token -- `str(err)` is safe to surface.

    Order matters: check the most specific exception types before the
    broader `DecodeError`/`InvalidTokenError` fallback.
    """
    if isinstance(err, AuthError):
        return err
    msg = str(err) or "verification failed"

    if isinstance(err, ExpiredSignatureError):
        return AuthError("EXPIRED", "token has expired")
    if isinstance(err, ImmatureSignatureError):
        return AuthError("NOT_ACTIVE", "token is not yet valid")
    if isinstance(err, InvalidAudienceError):
        return AuthError("INVALID_AUDIENCE", "unexpected token audience")
    if isinstance(err, InvalidIssuerError):
        return AuthError("INVALID_ISSUER", "unexpected token issuer")
    if isinstance(err, MissingRequiredClaimError):
        return AuthError("MISSING_CLAIM", msg)
    if isinstance(err, InvalidSignatureError):
        return AuthError("INVALID_SIGNATURE", "signature verification failed")
    if isinstance(err, InvalidAlgorithmError):
        return AuthError("MALFORMED", "token uses an algorithm this verifier does not accept")
    if isinstance(err, (DecodeError, InvalidTokenError)):
        return AuthError("MALFORMED", "token is not a parseable JWT")
    if isinstance(err, PyJWKClientError):
        return AuthError("JWKS_UNAVAILABLE", "could not resolve signing key")
    return AuthError("UNKNOWN", msg)


def _claim_str(payload: Mapping[str, Any], name: str) -> Optional[str]:
    """Read a claim as a non-empty string, else None."""
    v = payload.get(name)
    return v if isinstance(v, str) and v else None


def _claim_roles(payload: Mapping[str, Any], name: str) -> list:
    """Read a claim as list[str]; tolerate a single string. Never None."""
    v = payload.get(name)
    if isinstance(v, list):
        return [r for r in v if isinstance(r, str)]
    if isinstance(v, str) and v:
        return [v]
    return []


# ── legacy-hs256 ─────────────────────────────────────────────────────────


class _LegacyVerifier:
    mode: str = "legacy-hs256"

    def __init__(self, config: LegacyHs256Config) -> None:
        if not config.secret:
            # Misconfiguration fails at construction, not silently at
            # verify-time -- a middleware built without a secret that only
            # threw on first request would ship a route silently ungated
            # until traffic hit it.
            raise AuthError("VERIFIER_UNAVAILABLE", "legacy-hs256 requires `secret`", status=500)
        self._config = config

    def verify(self, token: str) -> Identity:
        if not token:
            raise AuthError("NO_TOKEN", "no bearer token presented")

        cfg = self._config
        required: list = ["exp"]
        decode_kwargs: dict = {
            "algorithms": _LEGACY_ALGORITHMS,
            "leeway": cfg.clock_tolerance_sec,
        }
        # `iss`/`aud` are OPTIONAL in legacy mode -- today's FuzeFront token
        # emits neither. They become REQUIRED-and-enforced only once a host
        # explicitly configures an expected value (see FederatedJwksConfig
        # for the mode where both are always required).
        if cfg.issuer:
            decode_kwargs["issuer"] = cfg.issuer
            required.append("iss")
        if cfg.audience:
            decode_kwargs["audience"] = cfg.audience
            required.append("aud")
        decode_kwargs["options"] = {"require": required}

        try:
            payload = jwt.decode(token, cfg.secret, **decode_kwargs)
        except Exception as err:  # noqa: BLE001 - every failure funnels to one taxonomy
            raise _to_auth_error(err) from None

        subject_claim = cfg.subject_claim or "userId"
        user_id = _claim_str(payload, subject_claim) or _claim_str(payload, "sub")
        if not user_id:
            raise AuthError("MISSING_CLAIM", f"token has no `{subject_claim}` (or `sub`) claim")

        # Today's token carries neither tenant nor roles. Without a resolver
        # the identity is deliberately UNPRIVILEGED (tenant_id None, roles
        # []) rather than guessed -- an authz decision must never rest on an
        # assumption.
        tenant_id: Optional[str] = None
        roles: list = []
        email = _claim_str(payload, "email")

        if cfg.resolver is not None:
            try:
                extra = cfg.resolver.resolve(user_id) or {}
            except Exception as err:
                # The token is valid but hydration failed. Returning it with
                # empty roles would read as "authenticated but authorized
                # for nothing" -- indistinguishable from a genuine
                # permission denial, masking an outage as an authz
                # decision. Deny loudly instead.
                raise AuthError(
                    "VERIFIER_UNAVAILABLE",
                    f"identity resolver failed: {err}",
                    status=500,
                ) from None
            tenant_id = extra.get("tenant_id") or None
            roles = list(extra.get("roles") or [])
            email = extra.get("email") or email

        return Identity(
            user_id=user_id,
            tenant_id=tenant_id,
            roles=roles,
            email=email,
            auth_mode="legacy-hs256",
            issued_at=payload.get("iat"),
            expires_at=payload.get("exp"),
            issuer=payload.get("iss"),
            claims=dict(payload),
        )


# ── federated-jwks ──────────────────────────────────────────────────────────

# One PyJWKClient per issuer, mirroring the TS package's `jwksCache`:
# re-creating it per request would hammer the issuer and defeat key-rotation
# caching. PyJWKClient owns both the JWKS-document cache (`cache_jwk_set`)
# and the per-`kid` key cache (`cache_keys`).
_jwks_clients: dict = {}
_jwks_clients_lock = threading.Lock()


def _resolve_jwks_uri(config: FederatedJwksConfig) -> str:
    if config.jwks_uri:
        return config.jwks_uri
    discovery_url = config.issuer.rstrip("/") + "/.well-known/openid-configuration"
    try:
        with urllib.request.urlopen(discovery_url, timeout=_DISCOVERY_TIMEOUT_SEC) as resp:
            status = getattr(resp, "status", 200)
            if status != 200:
                raise AuthError("JWKS_UNAVAILABLE", f"discovery returned {status}")
            doc = json.loads(resp.read().decode("utf-8"))
    except AuthError:
        raise
    except (urllib.error.URLError, ValueError, OSError) as err:
        raise AuthError("JWKS_UNAVAILABLE", "discovery fetch failed") from None
    jwks_uri = doc.get("jwks_uri") if isinstance(doc, dict) else None
    if not jwks_uri:
        raise AuthError("JWKS_UNAVAILABLE", "discovery document has no `jwks_uri`")
    return jwks_uri


def _get_jwks_client(config: FederatedJwksConfig) -> PyJWKClient:
    cached = _jwks_clients.get(config.issuer)
    if cached is not None:
        return cached
    with _jwks_clients_lock:
        cached = _jwks_clients.get(config.issuer)
        if cached is not None:
            return cached
        uri = _resolve_jwks_uri(config)
        client = PyJWKClient(uri, cache_keys=True, lifespan=config.jwks_cache_ttl_sec)
        _jwks_clients[config.issuer] = client
        return client


class _FederatedVerifier:
    mode: str = "federated-jwks"

    def __init__(self, config: FederatedJwksConfig) -> None:
        if not config.issuer:
            raise AuthError("VERIFIER_UNAVAILABLE", "federated-jwks requires `issuer`", status=500)
        if not config.audience:
            raise AuthError("VERIFIER_UNAVAILABLE", "federated-jwks requires `audience`", status=500)
        self._config = config

    def verify(self, token: str) -> Identity:
        if not token:
            raise AuthError("NO_TOKEN", "no bearer token presented")

        cfg = self._config
        try:
            client = _get_jwks_client(cfg)
            signing_key = client.get_signing_key_from_jwt(token)
            # Asymmetric algorithms ONLY. Permitting HS* here would let
            # anyone who knows the (public) verification material use it as
            # an HMAC secret and forge tokens. `iss`/`aud`/`exp` are all
            # REQUIRED in this mode -- unlike legacy-hs256, a federated token
            # always carries them.
            payload = jwt.decode(
                token,
                signing_key.key,
                algorithms=_FEDERATED_ALGORITHMS,
                issuer=cfg.issuer,
                audience=cfg.audience,
                leeway=cfg.clock_tolerance_sec,
                options={"require": ["exp", "iss", "aud"]},
            )
        except Exception as err:  # noqa: BLE001 - every failure funnels to one taxonomy
            raise _to_auth_error(err) from None

        subject_claim = cfg.subject_claim or "sub"
        user_id = _claim_str(payload, subject_claim)
        if not user_id:
            raise AuthError("MISSING_CLAIM", f"token has no `{subject_claim}` claim")

        return Identity(
            user_id=user_id,
            tenant_id=_claim_str(payload, cfg.tenant_claim or "tenantId"),
            roles=_claim_roles(payload, cfg.roles_claim or "roles"),
            email=_claim_str(payload, "email"),
            auth_mode="federated-jwks",
            issued_at=payload.get("iat"),
            expires_at=payload.get("exp"),
            issuer=payload.get("iss"),
            claims=dict(payload),
        )


# ── public API (frozen signatures) ──────────────────────────────────────────


def create_verifier(config: VerifierConfig) -> Verifier:
    """Build a `Verifier` for the given config's mode. The returned verifier
    is FAIL-CLOSED.

    Example:
        v = create_verifier(LegacyHs256Config(secret=os.environ["FUZEFRONT_JWT_SECRET"]))
        identity = v.verify(raw_token)
    """
    if isinstance(config, LegacyHs256Config):
        return _LegacyVerifier(config)
    if isinstance(config, FederatedJwksConfig):
        return _FederatedVerifier(config)
    # Exhaustiveness guard: a future config type must be handled explicitly,
    # never defaulted into something permissive.
    raise AuthError(
        "VERIFIER_UNAVAILABLE",
        f"unknown verifier config type: {type(config).__name__}",
        status=500,
    )


def verify_token(token: str, verifier: Verifier) -> Identity:
    """Verify a raw bearer token (already stripped of the `Bearer ` prefix)
    and return the normalized `Identity`. Raises `AuthError` on any failure
    (fail-closed). Convenience over `verifier.verify()` when a single
    verifier is used process-wide.
    """
    return verifier.verify(token)
