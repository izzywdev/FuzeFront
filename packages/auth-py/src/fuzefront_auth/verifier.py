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

import threading
import time
import urllib.error
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Protocol

import jwt
from jwt import PyJWK

from ._http import fetch_json, is_loopback_http
from .types import AuthError, AuthMode, Identity

# Asymmetric algorithms ONLY for federated mode: permitting HS* would let anyone
# who knows the (public) key use it as an HMAC secret and forge tokens.
_FEDERATED_ALGORITHMS = ["RS256", "RS384", "RS512", "ES256", "ES384"]
_KEY_TYPE_FOR_ALG_PREFIX = {"RS": "RSA", "ES": "EC"}
# JOSE binds each ES algorithm to exactly one curve (RFC 7518 §3.4).
_CURVE_FOR_ALG = {"ES256": "P-256", "ES384": "P-384"}
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

# (user_id, session_id, claims) -> True while the session is still active. The token
# alone cannot say whether the user has since logged out or had the device revoked;
# only the session store can. The host supplies this (e.g. a call to FuzeFront).
SessionValidator = Callable[[str, "str | None", dict[str, Any]], bool]


@dataclass(frozen=True)
class LegacyHs256Config:
    secret: str
    subject_claim: str = "userId"
    resolver: Resolver | None = None
    session_validator: SessionValidator | None = None
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


def _bound_claim(payload: dict[str, Any], name: str) -> str | None:
    """A binding claim (`portalId`, `sessionId`): absent => None, a non-empty string =>
    itself, and PRESENT-but-malformed (number, list, empty string, ...) => rejected.
    Normalising a malformed binding to "no binding" would widen it."""
    if name not in payload:
        return None
    value = payload[name]
    if isinstance(value, str) and value:
        return value
    raise AuthError("MALFORMED", f"token has a malformed `{name}` claim")


def _require_exact_issuer(payload: dict[str, Any], expected: str) -> None:
    """Exact `iss` match, independent of the JWT library. PyJWT 2.10.0 accepted an issuer that
    was merely a substring of the configured one; never rely on a single layer for this."""
    if payload.get("iss") != expected:
        raise AuthError("INVALID_ISSUER", "unexpected token issuer")


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
        # `iat` is informational (the contract's not-before boundary is `nbf`);
        # PyJWT's default would reject tokens from an issuer whose clock runs ahead.
        "verify_iat": False,
        "verify_iss": has_issuer,
        "verify_aud": has_audience,
    }


def _normalize_resolved(extra: Any) -> tuple[str | None, tuple[str, ...], str | None]:
    """Validate what a host resolver returned. Anything malformed raises, and the
    caller turns that into a 500 `VERIFIER_UNAVAILABLE` rather than guessing."""
    if extra is None:
        return None, (), None
    if not isinstance(extra, dict):
        raise TypeError("resolver must return a dict")
    tenant_id, roles, email = extra.get("tenant_id"), extra.get("roles"), extra.get("email")
    if tenant_id is not None and not isinstance(tenant_id, str):
        raise TypeError("tenant_id must be a string")
    if email is not None and not isinstance(email, str):
        raise TypeError("email must be a string")
    if roles is None:
        roles = ()
    if isinstance(roles, str) or not isinstance(roles, (list, tuple)) or not all(isinstance(r, str) for r in roles):
        raise TypeError("roles must be a list of strings")
    return tenant_id or None, tuple(roles), email or None


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
        if cfg.issuer is not None:
            _require_exact_issuer(payload, cfg.issuer)

        # Only a PLAIN platform session authenticates here. A token carrying a
        # `kind` (`fuze-org-session`, `fuze-workload`, `fuze-delegation`) is a
        # narrowed/machine credential for a different audience that merely shares
        # the secret; hydrating it with the user's full roles would widen it.
        # Same rule as backend/src/middleware/auth.ts.
        if "kind" in payload:
            raise AuthError("INVALID_AUDIENCE", "token is not a platform session token")
        portal_id = _bound_claim(payload, "portalId")

        user_id = _claim_string(payload, cfg.subject_claim) or _claim_string(payload, "sub")
        if not user_id:
            raise AuthError("MISSING_CLAIM", f"token has no `{cfg.subject_claim}` (or `sub`) claim")

        session_id = _bound_claim(payload, "sessionId")
        if cfg.session_validator is not None:
            # Revocation: a signed token stays valid until `exp`, but the session it
            # names may have been ended. Only `True` keeps it alive; anything else is a
            # denial. A validator that cannot answer is a retryable 503, not a 401.
            try:
                active = cfg.session_validator(user_id, session_id, dict(payload))
            except Exception:  # noqa: BLE001
                raise AuthError("VERIFIER_UNAVAILABLE", "session validation is unavailable", 503) from None
            if active is not True:
                raise AuthError("EXPIRED", "session is no longer active")

        # Today's token carries neither tenant nor roles. Without a resolver the
        # identity is deliberately UNPRIVILEGED rather than guessed.
        tenant_id: str | None = None
        roles: tuple[str, ...] = ()
        email = _claim_string(payload, "email")
        if cfg.resolver is not None:
            try:
                tenant_id, roles, resolved_email = _normalize_resolved(cfg.resolver(user_id))
            except Exception:  # noqa: BLE001
                # A valid token whose hydration failed (or returned malformed data)
                # must not read as "authorized for nothing": that would mask an
                # outage as an authz decision. Deny loudly, and never surface the
                # resolver's message.
                raise AuthError("VERIFIER_UNAVAILABLE", "identity resolver failed", 500) from None
            email = resolved_email or email

        return Identity(
            user_id=user_id,
            tenant_id=tenant_id,
            roles=roles,
            email=email,
            auth_mode="legacy-hs256",
            issued_at=_claim_number(payload, "iat"),
            expires_at=_claim_number(payload, "exp"),
            issuer=_claim_string(payload, "iss"),
            portal_id=portal_id,
            session_id=session_id,
            claims=dict(payload),
        )


def _now() -> float:
    return time.monotonic()


def _fetch_json(url: str, timeout: float, allow_loopback_http: bool = False) -> Any:
    return fetch_json(url, timeout, allow_loopback_http)


@dataclass(frozen=True)
class _Candidate:
    """A published key together with the restrictions the issuer declared on it."""

    jwk: PyJWK
    alg: str | None  # declared `alg`, if any (PyJWK would otherwise infer one from `kty`)
    use: str | None
    key_ops: tuple[str, ...] | None
    crv: str | None = None  # EC curve

    @property
    def kid(self) -> str | None:
        return self.jwk.key_id or None

    def can_verify(self, token_alg: str) -> bool:
        """True only if this key may verify a token signed with ``token_alg``:
        right key type (and, for ES*, the curve JOSE binds to that algorithm), a signing key (not `use: enc`), allowed for `verify`, and
        any algorithm the issuer pinned on it equals the token's."""
        expected = _KEY_TYPE_FOR_ALG_PREFIX.get(token_alg[:2])
        if expected is not None and getattr(self.jwk, "key_type", None) != expected:
            return False
        required_curve = _CURVE_FOR_ALG.get(token_alg)
        if required_curve is not None and self.crv != required_curve:
            return False
        if self.use not in (None, "sig"):
            return False
        if self.key_ops is not None and "verify" not in self.key_ops:
            return False
        return self.alg is None or self.alg == token_alg


def _load_jwk(raw: Any) -> _Candidate | None:
    """An unusable key (unsupported type, malformed) is skipped; the rest still load."""
    if not isinstance(raw, dict):
        return None
    try:
        jwk = PyJWK(raw)
    except Exception:  # noqa: BLE001
        return None
    # A restriction that is PRESENT but malformed must never be read as "unrestricted":
    # skip the key rather than let bad issuer data broaden what it may do.
    for name in ("alg", "use", "crv"):
        if name in raw and not isinstance(raw[name], str):
            return None
    key_ops = raw.get("key_ops")
    if "key_ops" in raw and not (isinstance(key_ops, list) and all(isinstance(o, str) for o in key_ops)):
        return None
    return _Candidate(
        jwk=jwk,
        alg=raw.get("alg"),
        use=raw.get("use"),
        key_ops=tuple(key_ops) if "key_ops" in raw else None,
        crv=raw.get("crv"),
    )


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
        # Plain http to loopback is a local-development exception that must come from the
        # CONFIGURED issuer / JWKS URI, never from anything a remote server returns
        # (a discovered jwks_uri or a redirect Location).
        self._dev_http = is_loopback_http(config.issuer) or is_loopback_http(config.jwks_uri)
        self._lock = threading.Lock()
        self._keys: dict[str, list[_Candidate]] = {}
        self._keyless: list[_Candidate] = []
        self._fetched_at: float | None = None
        self._last_attempt: float | None = None

    def _resolve_jwks_uri(self) -> str:
        # An explicitly configured URI is pinned. A DISCOVERED one is re-discovered on every
        # key-set refresh (already rate-limited), so an issuer that moves its JWKS endpoint
        # and removes the old one recovers without a restart.
        if self._config.jwks_uri:
            return self._config.jwks_uri
        discovery = f"{self._config.issuer.rstrip('/')}/.well-known/openid-configuration"
        try:
            doc = _fetch_json(discovery, _DISCOVERY_TIMEOUT_SEC, self._dev_http)
        except (urllib.error.URLError, OSError, ValueError):
            raise AuthError("JWKS_UNAVAILABLE", "OIDC discovery failed", 503) from None
        uri = doc.get("jwks_uri") if isinstance(doc, dict) else None
        if not isinstance(uri, str) or not uri:
            raise AuthError("JWKS_UNAVAILABLE", "discovery document has no `jwks_uri`", 503)
        # OIDC Discovery 4.3: the document's `issuer` MUST be identical to the issuer URL
        # the discovery URL was built from. Without this, metadata served for a different
        # tenant/authority would make us trust ITS signing keys for our issuer.
        if doc.get("issuer") != self._config.issuer:
            raise AuthError("JWKS_UNAVAILABLE", "discovery document is for a different issuer", 503)
        return uri

    def _refresh(self) -> None:
        """Fetch the key set. Caller holds the lock and has checked the cooldown."""
        self._last_attempt = _now()
        try:
            doc = _fetch_json(self._resolve_jwks_uri(), _JWKS_TIMEOUT_SEC, self._dev_http)
            raw_keys = doc.get("keys") if isinstance(doc, dict) else None
            if not isinstance(raw_keys, list):
                raise TypeError("no keys")
            loaded = [jwk for jwk in (_load_jwk(raw) for raw in raw_keys) if jwk is not None]
            keys: dict[str, list[_Candidate]] = {}
            for cand in loaded:
                if cand.kid:
                    # RFC 7517 allows several keys to share a kid (e.g. different kty).
                    keys.setdefault(cand.kid, []).append(cand)
            keyless = [cand for cand in loaded if not cand.kid]
        except AuthError:
            raise
        except (urllib.error.URLError, OSError, ValueError, TypeError):
            raise AuthError("JWKS_UNAVAILABLE", "could not fetch signing keys", 503) from None
        self._keys = keys
        self._keyless = keyless
        self._fetched_at = _now()

    def _expired(self) -> bool:
        return self._fetched_at is None or _now() - self._fetched_at >= _JWKS_LIFESPAN_SEC

    def _may_attempt(self) -> bool:
        return self._last_attempt is None or _now() - self._last_attempt >= _JWKS_MIN_REFETCH_SEC

    def _lookup(self, kid: str | None, alg: str) -> list[_Candidate]:
        if kid is not None:
            candidates = list(self._keys.get(kid, []))
        else:
            # No `kid`: only unambiguous when the issuer publishes exactly one key in
            # total. Several keys without ids (or a mix) must not be resolved by order.
            everything = [*(k for ks in self._keys.values() for k in ks), *self._keyless]
            candidates = everything if len(everything) == 1 else []
        # Only keys the issuer actually allows for this token's algorithm and for
        # signature verification may be used.
        return [c for c in candidates if c.can_verify(alg)]

    def get_keys(self, token: str, after_signature_failure: bool = False) -> list[Any]:
        """Candidate verification keys for ``token`` (never empty; raises otherwise).

        With ``after_signature_failure`` the cached keys just failed to verify the token, so a
        fresh key set is fetched (at most once per cooldown) and the result may be EMPTY,
        meaning there is nothing newer to try."""
        header = jwt.get_unverified_header(token)
        kid = header.get("kid")
        alg = header.get("alg")
        if (kid is not None and not isinstance(kid, str)) or not isinstance(alg, str):
            raise AuthError("MALFORMED", "token is not a parseable JWT")
        if alg not in _FEDERATED_ALGORITHMS:
            # Refuse before any key lookup: HS*/none can never be valid here, and an
            # unusable token must not be able to trigger a JWKS refresh.
            raise AuthError("INVALID_SIGNATURE", "token algorithm is not permitted")
        if after_signature_failure:
            with self._lock:
                if not self._may_attempt():
                    return []
                self._refresh()
                return [cand.jwk.key for cand in self._lookup(kid, alg)]
        with self._lock:
            if self._expired():
                self._keys, self._keyless = {}, []  # an expired set is never served, even if the refetch fails
                if not self._may_attempt():
                    raise AuthError("JWKS_UNAVAILABLE", "signing keys are unavailable", 503)
                self._refresh()
            found = self._lookup(kid, alg)
            if not found and self._may_attempt():
                self._refresh()  # the issuer may have rotated in a new key
                found = self._lookup(kid, alg)
        if not found:
            raise AuthError("JWKS_UNAVAILABLE", "could not resolve signing key")
        return [cand.jwk.key for cand in found]


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

    def _decode_with_any(self, token: str, keys: list[Any]) -> dict[str, Any]:
        """Try each candidate key. Only a signature mismatch moves on to the next
        key; every other failure (expired, wrong issuer, ...) is final. A token is
        accepted only if some candidate key genuinely verifies it."""
        cfg = self._config
        last: Exception | None = None
        for key in keys:
            try:
                payload = jwt.decode(
                    token,
                    key,
                    algorithms=_FEDERATED_ALGORITHMS,
                    issuer=cfg.issuer,
                    audience=cfg.audience,
                    leeway=cfg.clock_tolerance_sec,
                    options=_decode_options(True, True),
                )
            except jwt.InvalidSignatureError as err:
                last = err
                continue
            _require_exact_issuer(payload, cfg.issuer)
            return payload
        raise last if last is not None else AuthError("JWKS_UNAVAILABLE", "could not resolve signing key")

    def _verified_payload(self, token: str) -> dict[str, Any]:
        resolver = self._resolver()
        try:
            return self._decode_with_any(token, resolver.get_keys(token))
        except jwt.InvalidSignatureError:
            # The cached key(s) may be stale: an issuer can rotate key MATERIAL under the same
            # kid. Re-fetch once (cooldown-controlled, so bad tokens cannot drive refreshes) and
            # retry; if there is nothing newer to try, the signature really is bad.
            try:
                fresh = resolver.get_keys(token, after_signature_failure=True)
            except AuthError:
                fresh = []  # could not refresh: the original answer (bad signature) stands
            if not fresh:
                raise
            return self._decode_with_any(token, fresh)

    def verify(self, token: str) -> Identity:
        if not token:
            raise AuthError("NO_TOKEN", "no bearer token presented")
        cfg = self._config
        try:
            payload = self._verified_payload(token)
        except Exception as err:  # noqa: BLE001 - every failure is a denial
            raise _to_auth_error(err) from None

        user_id = _claim_string(payload, cfg.subject_claim)
        if not user_id:
            raise AuthError("MISSING_CLAIM", f"token has no `{cfg.subject_claim}` claim")
        portal_id = _bound_claim(payload, "portalId")

        return Identity(
            user_id=user_id,
            tenant_id=_claim_string(payload, cfg.tenant_claim),
            roles=_claim_roles(payload, cfg.roles_claim),
            email=_claim_string(payload, "email"),
            auth_mode="federated-jwks",
            issued_at=_claim_number(payload, "iat"),
            expires_at=_claim_number(payload, "exp"),
            issuer=_claim_string(payload, "iss"),
            portal_id=portal_id,
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
