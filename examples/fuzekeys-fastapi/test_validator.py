"""End-to-end worked example: FuzeKeys validates a family token.

Mints Authentik-shaped RS256 tokens with an ephemeral keypair (no live Authentik
needed) and asserts the §2 checks. Mirrors the TS package's test suite.

    pip install -r requirements.txt && pytest
"""
from __future__ import annotations

import datetime

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from fuze_authn import FamilyAuthValidator, FamilyTokenError

ISSUER = "https://auth.fuzefront.dev/application/o/fuzekeys/"
AUDIENCE = "fuzekeys-client"

_private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_public_key = _private_key.public_key()


class _FakeSigningKey:
    def __init__(self, key):
        self.key = key


class _FakeJWKClient:
    """Stands in for PyJWKClient so the test needs no network."""

    def __init__(self, key):
        self._key = key

    def get_signing_key_from_jwt(self, token):  # noqa: ARG002
        return _FakeSigningKey(self._key)


def mint(**o):
    now = datetime.datetime.now(datetime.timezone.utc)
    claims = {
        "iss": o.get("iss", ISSUER),
        "aud": o.get("aud", AUDIENCE),
        "email": "user@fuzefront.dev",
        "email_verified": True,
        "name": "Test User",
        "preferred_username": "tuser",
        "groups": ["family-users"],
        "iat": now,
        "exp": now + datetime.timedelta(seconds=o.get("ttl", 3600)),
    }
    if not o.get("omit_sub"):
        claims["sub"] = o.get("sub", "authentik-uuid-123")
    if o.get("omit_iat"):
        claims.pop("iat")
    return jwt.encode(claims, o.get("sign_key", _private_key), algorithm=o.get("alg", "RS256"))


def make_validator(**extra):
    return FamilyAuthValidator(
        issuer=ISSUER,
        audience=AUDIENCE,
        jwks_uri="https://unused.example/jwks",
        _jwks_client=_FakeJWKClient(_public_key),
        **extra,
    )


def test_validates_well_formed_token():
    principal = make_validator().validate(mint())
    assert principal.sub == "authentik-uuid-123"
    assert principal.email == "user@fuzefront.dev"
    assert principal.groups == ["family-users"]
    assert principal.issuer == ISSUER


def test_rejects_other_app_audience():
    with pytest.raises(FamilyTokenError):
        make_validator().validate(mint(aud="fuzefront-client"))


def test_rejects_other_issuer():
    with pytest.raises(FamilyTokenError):
        make_validator().validate(mint(iss="https://evil.example/application/o/fuzekeys/"))


def test_rejects_expired():
    with pytest.raises(FamilyTokenError):
        make_validator().validate(mint(ttl=-3600))


def test_rejects_missing_sub():
    with pytest.raises(FamilyTokenError):
        make_validator().validate(mint(omit_sub=True))


def test_rejects_missing_iat():
    with pytest.raises(FamilyTokenError):
        make_validator().validate(mint(omit_iat=True))


def test_config_rejects_symmetric_alg():
    with pytest.raises(FamilyTokenError):
        make_validator(algorithms=["HS256"])


def test_config_rejects_none_alg():
    with pytest.raises(FamilyTokenError):
        make_validator(algorithms=["none"])


def test_rejects_empty_token():
    with pytest.raises(FamilyTokenError):
        make_validator().validate("")
