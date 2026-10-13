"""fuzefront_auth -- legacy-hs256 verifier tests (#1267).

Bias: these test the DENIAL paths hardest, mirroring
`packages/auth/tests/verifier.test.ts`. This package is the gate consuming
Python services mount, so a false "allow" is a family-wide breach, while a
false "deny" is merely an outage.
"""

from __future__ import annotations

import base64
import json
import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from fuzefront_auth import AuthError, LegacyHs256Config, create_verifier, verify_token

SECRET = "test-secret-not-for-prod"


def hs256(claims: dict, exp_in: int = 3600, secret: str = SECRET, **extra_claims) -> str:
    payload = {**claims, **extra_claims}
    if exp_in is not None:
        payload["exp"] = int(time.time()) + exp_in
    return jwt.encode(payload, secret, algorithm="HS256")


def test_verifies_a_valid_token_and_normalizes_the_identity():
    verifier = create_verifier(LegacyHs256Config(secret=SECRET))
    token = hs256({"userId": "u-1", "email": "a@b.dev"})
    identity = verifier.verify(token)
    assert identity.user_id == "u-1"
    assert identity.email == "a@b.dev"
    assert identity.auth_mode == "legacy-hs256"
    # No resolver => deliberately unprivileged, NOT a guess.
    assert identity.tenant_id is None
    assert identity.roles == []


def test_real_fuzefront_token_shape_userid_sessionid_no_sub_or_aud():
    """The actual shape `backend/src/routes/auth.ts` mints today: `userId` +
    `sessionId`, no `sub`, no `iss`/`aud`. Must validate under the default
    (no issuer/audience configured) legacy-hs256 verifier -- this is the
    exact regression #1267 exists to prevent.
    """
    verifier = create_verifier(LegacyHs256Config(secret=SECRET))
    token = hs256({"userId": "u-real", "sessionId": "sess-123"})
    identity = verifier.verify(token)
    assert identity.user_id == "u-real"
    assert identity.tenant_id is None
    assert identity.roles == []
    # sessionId is not a named field, but it IS still reachable via the
    # escape-hatch claims, same as the TypeScript Identity.
    assert identity.claims.get("sessionId") == "sess-123"


def test_falls_back_to_sub_when_userid_is_absent():
    verifier = create_verifier(LegacyHs256Config(secret=SECRET))
    token = hs256({"sub": "u-oidc", "email": "oidc@b.dev"})
    identity = verifier.verify(token)
    assert identity.user_id == "u-oidc"


def test_rejects_a_token_signed_with_the_wrong_secret():
    verifier = create_verifier(LegacyHs256Config(secret=SECRET))
    forged = hs256({"userId": "u-1"}, secret="a-different-secret")
    with pytest.raises(AuthError) as exc_info:
        verifier.verify(forged)
    assert exc_info.value.code == "INVALID_SIGNATURE"


def test_rejects_an_expired_token():
    verifier = create_verifier(LegacyHs256Config(secret=SECRET))
    token = hs256({"userId": "u-1"}, exp_in=-60)
    with pytest.raises(AuthError) as exc_info:
        verifier.verify(token)
    assert exc_info.value.code == "EXPIRED"


def test_rejects_algorithm_confusion_rs256_signed_token_against_hs256_verifier():
    """The attack this guards: if `algorithms` were unpinned, a token could
    name an algorithm the verifier did not intend and bypass the shared
    secret entirely.
    """
    verifier = create_verifier(LegacyHs256Config(secret=SECRET))
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    token = jwt.encode(
        {"userId": "attacker", "exp": int(time.time()) + 3600}, private_key, algorithm="RS256"
    )
    with pytest.raises(AuthError):
        verifier.verify(token)


def test_rejects_alg_none():
    """A hand-crafted token with `alg: none` and an empty signature segment
    must never be accepted -- `algorithms=["HS256"]` never includes `none`.
    """
    verifier = create_verifier(LegacyHs256Config(secret=SECRET))
    header = base64.urlsafe_b64encode(json.dumps({"alg": "none", "typ": "JWT"}).encode()).rstrip(b"=")
    payload = base64.urlsafe_b64encode(
        json.dumps({"userId": "u-1", "exp": int(time.time()) + 3600}).encode()
    ).rstrip(b"=")
    none_token = header.decode() + "." + payload.decode() + "."
    with pytest.raises(AuthError):
        verifier.verify(none_token)


def test_rejects_a_token_with_no_subject_claim():
    verifier = create_verifier(LegacyHs256Config(secret=SECRET))
    token = hs256({"notASubject": "x"})
    with pytest.raises(AuthError) as exc_info:
        verifier.verify(token)
    assert exc_info.value.code == "MISSING_CLAIM"


def test_rejects_a_token_with_no_exp_claim():
    """`exp` is REQUIRED in legacy-hs256 mode (#1267 acceptance criterion),
    unlike PyJWT's own default (which only validates `exp` if present).
    """
    verifier = create_verifier(LegacyHs256Config(secret=SECRET))
    token = jwt.encode({"userId": "u-1"}, SECRET, algorithm="HS256")
    with pytest.raises(AuthError) as exc_info:
        verifier.verify(token)
    assert exc_info.value.code == "MISSING_CLAIM"


def test_rejects_garbage():
    verifier = create_verifier(LegacyHs256Config(secret=SECRET))
    with pytest.raises(AuthError) as exc_info:
        verifier.verify("not-a-jwt")
    assert exc_info.value.code == "MALFORMED"


def test_rejects_an_empty_token():
    verifier = create_verifier(LegacyHs256Config(secret=SECRET))
    with pytest.raises(AuthError) as exc_info:
        verifier.verify("")
    assert exc_info.value.code == "NO_TOKEN"


def test_hydrates_tenant_and_roles_via_the_out_of_band_resolver():
    class Resolver:
        def resolve(self, user_id: str):
            assert user_id == "u-1"
            return {"tenant_id": "org-9", "roles": ["admin"], "email": "r@b.dev"}

    verifier = create_verifier(LegacyHs256Config(secret=SECRET, resolver=Resolver()))
    identity = verifier.verify(hs256({"userId": "u-1"}))
    assert identity.tenant_id == "org-9"
    assert identity.roles == ["admin"]
    assert identity.email == "r@b.dev"


def test_denies_when_the_resolver_fails_rather_than_returning_an_unprivileged_identity():
    """A resolver outage returning roles=[] would be indistinguishable from
    a real permission denial -- masking an outage as an authz decision. It
    must raise.
    """

    class FailingResolver:
        def resolve(self, user_id: str):
            raise RuntimeError("db down")

    verifier = create_verifier(LegacyHs256Config(secret=SECRET, resolver=FailingResolver()))
    with pytest.raises(AuthError) as exc_info:
        verifier.verify(hs256({"userId": "u-1"}))
    assert exc_info.value.code == "VERIFIER_UNAVAILABLE"


def test_refuses_to_construct_without_a_secret():
    with pytest.raises(AuthError):
        create_verifier(LegacyHs256Config(secret=""))


def test_verify_token_delegates_to_the_verifier():
    verifier = create_verifier(LegacyHs256Config(secret=SECRET))
    identity = verify_token(hs256({"userId": "u-2"}), verifier)
    assert identity.user_id == "u-2"


def test_optional_issuer_and_audience_are_not_enforced_when_unconfigured():
    """Backward compatibility (#1267): a token with no `iss`/`aud` must keep
    validating under the DEFAULT legacy-hs256 config even after this
    package's federated-jwks mode exists -- the default config never
    requires fields today's token does not emit.
    """
    verifier = create_verifier(LegacyHs256Config(secret=SECRET))
    token = hs256({"userId": "u-1"})  # no iss/aud
    identity = verifier.verify(token)
    assert identity.issuer is None


def test_optional_issuer_is_enforced_once_configured():
    verifier = create_verifier(LegacyHs256Config(secret=SECRET, issuer="https://fuzefront.example"))
    good = hs256({"userId": "u-1"}, iss="https://fuzefront.example")
    identity = verifier.verify(good)
    assert identity.issuer == "https://fuzefront.example"

    bad = hs256({"userId": "u-1"}, iss="https://evil.example")
    with pytest.raises(AuthError) as exc_info:
        verifier.verify(bad)
    assert exc_info.value.code == "INVALID_ISSUER"

    # And a token that carries NO iss at all must now also be rejected --
    # the claim is REQUIRED once an expected issuer is configured.
    with pytest.raises(AuthError) as exc_info:
        verifier.verify(hs256({"userId": "u-1"}))
    assert exc_info.value.code == "MISSING_CLAIM"


def test_optional_audience_is_enforced_once_configured():
    verifier = create_verifier(LegacyHs256Config(secret=SECRET, audience="fuzefront-api"))
    good = hs256({"userId": "u-1"}, aud="fuzefront-api")
    identity = verifier.verify(good)
    assert identity.user_id == "u-1"

    bad = hs256({"userId": "u-1"}, aud="some-other-app")
    with pytest.raises(AuthError) as exc_info:
        verifier.verify(bad)
    assert exc_info.value.code == "INVALID_AUDIENCE"


def test_never_includes_the_token_in_an_auth_error_message():
    """#1267 explicit requirement: never log token contents, including
    error paths. Assert the raw token substring never appears in any
    AuthError's message across the main denial paths.
    """
    verifier = create_verifier(LegacyHs256Config(secret=SECRET))
    cases = [
        hs256({"userId": "u-1"}, secret="wrong-secret"),
        hs256({"userId": "u-1"}, exp_in=-60),
        hs256({"notASubject": "x"}),
        "not-a-jwt",
    ]
    for token in cases:
        with pytest.raises(AuthError) as exc_info:
            verifier.verify(token)
        assert token not in str(exc_info.value)
        assert token not in repr(exc_info.value)
