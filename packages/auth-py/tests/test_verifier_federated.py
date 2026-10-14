import time

import pytest
from conftest import AUDIENCE, ISSUER, make_token
from fuzefront_auth import AuthError, FederatedJwksConfig, create_verifier

GOOD = {"sub": "u-9", "iss": ISSUER, "aud": AUDIENCE, "tenantId": "t-7", "roles": ["editor"], "email": "e@x.y"}


def verifier(jwks_server, **kw):
    cfg = {"issuer": ISSUER, "audience": AUDIENCE, "jwks_uri": f"{jwks_server['base']}/jwks", **kw}
    return create_verifier(FederatedJwksConfig(**cfg))


def code_of(v, token):
    with pytest.raises(AuthError) as info:
        v.verify(token)
    return info.value.code


def test_rs256_valid(jwks_server, rsa_key):
    ident = verifier(jwks_server).verify(make_token(rsa_key, alg="RS256", kid="rsa-1", claims=GOOD))
    assert (ident.user_id, ident.tenant_id, ident.roles, ident.email) == ("u-9", "t-7", ("editor",), "e@x.y")
    assert ident.auth_mode == "federated-jwks" and ident.issuer == ISSUER


def test_es256_valid(jwks_server, ec_key):
    assert verifier(jwks_server).verify(make_token(ec_key, alg="ES256", kid="ec-1", claims=GOOD)).user_id == "u-9"


def test_discovery_used_when_no_jwks_uri(jwks_server, rsa_key):
    v = create_verifier(FederatedJwksConfig(issuer=jwks_server["base"], audience=AUDIENCE))
    token = make_token(rsa_key, alg="RS256", kid="rsa-1", claims={**GOOD, "iss": jwks_server["base"]})
    assert v.verify(token).user_id == "u-9"


def test_expired_rejected(jwks_server, rsa_key):
    now = int(time.time())
    token = make_token(rsa_key, alg="RS256", kid="rsa-1", claims={**GOOD, "iat": now - 9000, "exp": now - 8000})
    assert code_of(verifier(jwks_server), token) == "EXPIRED"


def test_bad_signature_rejected(jwks_server, other_rsa_key):
    # Right kid, signed by a different private key.
    assert code_of(verifier(jwks_server), make_token(other_rsa_key, alg="RS256", kid="rsa-1", claims=GOOD)) == "INVALID_SIGNATURE"


def test_hs256_confusion_rejected(jwks_server, rsa_key):
    # Classic algorithm confusion: an HS256 token MAC'd with the issuer's public
    # key bytes. PyJWT refuses to sign this itself, so it is forged by hand --
    # which is exactly what an attacker would do. Federated mode permits
    # asymmetric algorithms only.
    import base64
    import hashlib
    import hmac
    import json

    from cryptography.hazmat.primitives import serialization

    def b64(raw: bytes) -> str:
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()

    public_der = rsa_key.public_key().public_bytes(
        serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    signing_input = (
        b64(json.dumps({"alg": "HS256", "typ": "JWT", "kid": "rsa-1"}).encode())
        + "."
        + b64(json.dumps({**GOOD, "exp": int(time.time()) + 3600}).encode())
    )
    mac = hmac.new(public_der, signing_input.encode(), hashlib.sha256).digest()
    forged = f"{signing_input}.{b64(mac)}"
    assert code_of(verifier(jwks_server), forged) == "INVALID_SIGNATURE"


def test_alg_none_rejected(jwks_server):
    import base64
    import json

    def b64(d):
        return base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()

    forged = f"{b64({'alg': 'none', 'typ': 'JWT', 'kid': 'rsa-1'})}.{b64({**GOOD, 'exp': int(time.time()) + 3600})}."
    assert code_of(verifier(jwks_server), forged) in {"INVALID_SIGNATURE", "MALFORMED", "JWKS_UNAVAILABLE"}


def test_wrong_issuer_and_audience_rejected(jwks_server, rsa_key):
    v = verifier(jwks_server)
    assert code_of(v, make_token(rsa_key, alg="RS256", kid="rsa-1", claims={**GOOD, "iss": "https://evil.invalid"})) == "INVALID_ISSUER"
    assert code_of(v, make_token(rsa_key, alg="RS256", kid="rsa-1", claims={**GOOD, "aud": "other"})) == "INVALID_AUDIENCE"


def test_missing_iss_or_aud_rejected(jwks_server, rsa_key):
    v = verifier(jwks_server)
    assert code_of(v, make_token(rsa_key, alg="RS256", kid="rsa-1", claims=GOOD, drop=("iss",))) == "MISSING_CLAIM"
    assert code_of(v, make_token(rsa_key, alg="RS256", kid="rsa-1", claims=GOOD, drop=("aud",))) == "MISSING_CLAIM"


def test_missing_exp_rejected(jwks_server, rsa_key):
    assert code_of(verifier(jwks_server), make_token(rsa_key, alg="RS256", kid="rsa-1", claims=GOOD, drop=("exp",))) == "MISSING_CLAIM"


def test_missing_subject_rejected(jwks_server, rsa_key):
    assert code_of(verifier(jwks_server), make_token(rsa_key, alg="RS256", kid="rsa-1", claims=GOOD, drop=("sub",))) == "MISSING_CLAIM"


def test_unknown_kid_is_jwks_unavailable(jwks_server, rsa_key):
    assert code_of(verifier(jwks_server), make_token(rsa_key, alg="RS256", kid="nope", claims=GOOD)) == "JWKS_UNAVAILABLE"


def test_jwks_outage_fails_closed(jwks_server, rsa_key):
    jwks_server["fail"] = True
    assert code_of(verifier(jwks_server), make_token(rsa_key, alg="RS256", kid="rsa-1", claims=GOOD)) == "JWKS_UNAVAILABLE"


def test_jwks_is_cached_across_requests(jwks_server, rsa_key):
    v = verifier(jwks_server)
    for _ in range(3):
        v.verify(make_token(rsa_key, alg="RS256", kid="rsa-1", claims=GOOD))
    assert jwks_server["jwks_hits"] == 1


def test_audience_and_issuer_required_at_construction():
    with pytest.raises(AuthError):
        create_verifier(FederatedJwksConfig(issuer="", audience=AUDIENCE))
    with pytest.raises(AuthError):
        create_verifier(FederatedJwksConfig(issuer=ISSUER, audience=""))
