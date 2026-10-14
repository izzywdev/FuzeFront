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


def test_unknown_kids_cannot_force_per_request_refreshes(jwks_server, rsa_key, clock):
    v = verifier(jwks_server)
    v.verify(make_token(rsa_key, alg="RS256", kid="rsa-1", claims=GOOD))
    assert jwks_server["jwks_hits"] == 1
    for i in range(25):
        clock(1)  # still inside the refetch cooldown
        assert code_of(v, make_token(rsa_key, alg="RS256", kid=f"random-{i}", claims=GOOD)) == "JWKS_UNAVAILABLE"
    assert jwks_server["jwks_hits"] == 1  # no extra outbound calls


def test_rotated_in_key_is_picked_up_after_the_cooldown(jwks_server, rsa_key, other_rsa_key, clock):
    from conftest import _jwk

    v = verifier(jwks_server)
    v.verify(make_token(rsa_key, alg="RS256", kid="rsa-1", claims=GOOD))
    jwks_server["keys"].append(_jwk(other_rsa_key.public_key(), "rsa-2", "RS256"))
    token = make_token(other_rsa_key, alg="RS256", kid="rsa-2", claims=GOOD)
    assert code_of(v, token) == "JWKS_UNAVAILABLE"  # inside the cooldown
    clock(31)
    assert v.verify(token).user_id == "u-9"


def test_retired_key_stops_verifying_after_the_jwks_lifespan(jwks_server, rsa_key, clock):
    v = verifier(jwks_server)
    token = make_token(rsa_key, alg="RS256", kid="rsa-1", claims=GOOD)
    assert v.verify(token).user_id == "u-9"
    # The issuer retires the key.
    jwks_server["keys"][:] = [k for k in jwks_server["keys"] if k["kid"] != "rsa-1"]
    clock(301)
    assert code_of(v, token) == "JWKS_UNAVAILABLE"


def test_expired_keys_are_not_served_when_the_issuer_is_down(jwks_server, rsa_key, clock):
    v = verifier(jwks_server)
    token = make_token(rsa_key, alg="RS256", kid="rsa-1", claims=GOOD)
    v.verify(token)
    jwks_server["fail"] = True
    clock(301)
    assert code_of(v, token) == "JWKS_UNAVAILABLE"  # fail closed, no stale key


def test_outage_does_not_hammer_the_issuer(jwks_server, rsa_key, clock):
    jwks_server["fail"] = True
    hits = {"n": 0}
    import fuzefront_auth.verifier as vm

    real = vm._fetch_json

    def counting(url, timeout):
        hits["n"] += 1
        return real(url, timeout)

    vm._fetch_json = counting
    try:
        v = verifier(jwks_server)
        for _ in range(10):
            assert code_of(v, make_token(rsa_key, alg="RS256", kid="rsa-1", claims=GOOD)) == "JWKS_UNAVAILABLE"
        assert hits["n"] == 1
    finally:
        vm._fetch_json = real


def test_fractional_numeric_dates_are_preserved(jwks_server, rsa_key):
    now = time.time()
    token = make_token(rsa_key, alg="RS256", kid="rsa-1", claims={**GOOD, "iat": now - 1.5, "exp": now + 3600.5})
    ident = verifier(jwks_server).verify(token)
    assert ident.expires_at == pytest.approx(now + 3600.5)
    assert ident.issued_at == pytest.approx(now - 1.5)


def test_future_iat_is_not_rejected(jwks_server, rsa_key):
    token = make_token(rsa_key, alg="RS256", kid="rsa-1", claims={**GOOD, "iat": int(time.time()) + 600})
    assert verifier(jwks_server).verify(token).user_id == "u-9"


def test_kidless_token_needs_an_unambiguous_key(jwks_server, rsa_key):
    # The server publishes two keys (rsa-1, ec-1): a token with no kid must not be
    # resolved by position in the set.
    assert code_of(verifier(jwks_server), make_token(rsa_key, alg="RS256", claims=GOOD)) == "JWKS_UNAVAILABLE"


def test_several_keyless_keys_are_not_collapsed(jwks_server, rsa_key, ec_key):
    from conftest import _jwk

    keyless = []
    for key, alg in ((rsa_key, "RS256"), (ec_key, "ES256")):
        entry = _jwk(key.public_key(), "x", alg)
        del entry["kid"]
        keyless.append(entry)
    jwks_server["keys"][:] = keyless
    v = verifier(jwks_server)
    assert code_of(v, make_token(rsa_key, alg="RS256", claims=GOOD)) == "JWKS_UNAVAILABLE"
    assert code_of(v, make_token(ec_key, alg="ES256", claims=GOOD)) == "JWKS_UNAVAILABLE"


def test_single_keyless_key_is_usable(jwks_server, rsa_key):
    from conftest import _jwk

    entry = _jwk(rsa_key.public_key(), "x", "RS256")
    del entry["kid"]
    jwks_server["keys"][:] = [entry]
    assert verifier(jwks_server).verify(make_token(rsa_key, alg="RS256", claims=GOOD)).user_id == "u-9"


def test_keys_sharing_a_kid_are_all_kept_and_selected_by_key_type(jwks_server, rsa_key, ec_key):
    # RFC 7517 allows different key types to share a kid. Neither order of the set
    # may decide which caller authenticates.
    from conftest import _jwk

    for order in ("rsa-first", "ec-first"):
        rsa_entry = _jwk(rsa_key.public_key(), "shared", "RS256")
        ec_entry = _jwk(ec_key.public_key(), "shared", "ES256")
        jwks_server["keys"][:] = [rsa_entry, ec_entry] if order == "rsa-first" else [ec_entry, rsa_entry]
        import fuzefront_auth.verifier as vm

        vm._resolvers.clear()
        v = verifier(jwks_server)
        assert v.verify(make_token(rsa_key, alg="RS256", kid="shared", claims=GOOD)).user_id == "u-9"
        assert v.verify(make_token(ec_key, alg="ES256", kid="shared", claims=GOOD)).user_id == "u-9"


def test_shared_kid_does_not_accept_a_key_that_did_not_sign(jwks_server, rsa_key, other_rsa_key):
    # Two RSA keys under one kid: a token from a third key is still rejected, and
    # a token from either listed key is accepted regardless of order.
    from conftest import _jwk

    jwks_server["keys"][:] = [_jwk(rsa_key.public_key(), "dup", "RS256"), _jwk(other_rsa_key.public_key(), "dup", "RS256")]
    v = verifier(jwks_server)
    assert v.verify(make_token(rsa_key, alg="RS256", kid="dup", claims=GOOD)).user_id == "u-9"
    assert v.verify(make_token(other_rsa_key, alg="RS256", kid="dup", claims=GOOD)).user_id == "u-9"
    from cryptography.hazmat.primitives.asymmetric import rsa

    stranger = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    assert code_of(v, make_token(stranger, alg="RS256", kid="dup", claims=GOOD)) == "INVALID_SIGNATURE"


def test_expired_token_under_a_shared_kid_reports_expiry_not_signature(jwks_server, rsa_key, other_rsa_key):
    from conftest import _jwk

    jwks_server["keys"][:] = [_jwk(other_rsa_key.public_key(), "dup", "RS256"), _jwk(rsa_key.public_key(), "dup", "RS256")]
    now = int(time.time())
    token = make_token(rsa_key, alg="RS256", kid="dup", claims={**GOOD, "iat": now - 9000, "exp": now - 8000})
    assert code_of(verifier(jwks_server), token) == "EXPIRED"


def _only(jwks_server, entry):
    jwks_server["keys"][:] = [entry]


def test_key_restricted_to_another_algorithm_cannot_verify(jwks_server, rsa_key):
    # The issuer pinned this RSA key to RS512; an RS256 token signed by it must not
    # be accepted just because RS256 is in the package-wide allow-list.
    from conftest import _jwk

    _only(jwks_server, _jwk(rsa_key.public_key(), "rsa-1", "RS512"))
    v = verifier(jwks_server)
    assert code_of(v, make_token(rsa_key, alg="RS256", kid="rsa-1", claims=GOOD)) == "JWKS_UNAVAILABLE"
    assert v.verify(make_token(rsa_key, alg="RS512", kid="rsa-1", claims=GOOD)).user_id == "u-9"


@pytest.mark.parametrize("restriction", [{"use": "enc"}, {"key_ops": ["encrypt"]}, {"key_ops": ["sign"]}])
def test_non_signature_keys_cannot_verify(jwks_server, rsa_key, restriction):
    from conftest import _jwk

    entry = _jwk(rsa_key.public_key(), "rsa-1", "RS256")
    entry.pop("use", None)
    _only(jwks_server, {**entry, **restriction})
    assert code_of(verifier(jwks_server), make_token(rsa_key, alg="RS256", kid="rsa-1", claims=GOOD)) == "JWKS_UNAVAILABLE"


def test_signing_key_ops_are_accepted(jwks_server, rsa_key):
    from conftest import _jwk

    entry = _jwk(rsa_key.public_key(), "rsa-1", "RS256")
    _only(jwks_server, {**entry, "key_ops": ["verify"]})
    assert verifier(jwks_server).verify(make_token(rsa_key, alg="RS256", kid="rsa-1", claims=GOOD)).user_id == "u-9"


def test_issuer_outage_is_a_503_not_a_401(jwks_server, rsa_key):
    # An outage must not tell clients their credentials are invalid.
    jwks_server["fail"] = True
    v = verifier(jwks_server)
    token = make_token(rsa_key, alg="RS256", kid="rsa-1", claims=GOOD)
    for _ in range(2):  # first = fetch failure, second = cooldown
        with pytest.raises(AuthError) as info:
            v.verify(token)
        assert (info.value.code, info.value.status) == ("JWKS_UNAVAILABLE", 503)


def test_discovery_outage_is_a_503(jwks_server, rsa_key):
    jwks_server["fail"] = True
    v = create_verifier(FederatedJwksConfig(issuer=jwks_server["base"], audience=AUDIENCE))
    with pytest.raises(AuthError) as info:
        v.verify(make_token(rsa_key, alg="RS256", kid="rsa-1", claims={**GOOD, "iss": jwks_server["base"]}))
    assert info.value.status == 503


def test_unknown_key_stays_a_401(jwks_server, rsa_key):
    with pytest.raises(AuthError) as info:
        verifier(jwks_server).verify(make_token(rsa_key, alg="RS256", kid="nope", claims=GOOD))
    assert (info.value.code, info.value.status) == ("JWKS_UNAVAILABLE", 401)


def test_portal_claim_is_carried_into_identity(jwks_server, rsa_key):
    ident = verifier(jwks_server).verify(make_token(rsa_key, alg="RS256", kid="rsa-1", claims={**GOOD, "portalId": "p-1"}))
    assert ident.portal_id == "p-1"


def _forge_ec_token(key, label_alg, kid, claims):
    """Sign with ``key`` but label the header ``label_alg`` -- including a curve that
    does not match. PyJWT >= 2.10 refuses to do this itself, but older allowed versions
    (and an attacker) will, so the token is built by hand."""
    import base64
    import json

    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

    def b64(raw):
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()

    now = int(time.time())
    header = b64(json.dumps({"alg": label_alg, "typ": "JWT", "kid": kid}).encode())
    body = b64(json.dumps({"iat": now, "exp": now + 3600, **claims}).encode())
    signing_input = f"{header}.{body}".encode()
    digest = {"ES256": hashes.SHA256(), "ES384": hashes.SHA384()}[label_alg]
    r, sig_s = decode_dss_signature(key.sign(signing_input, ec.ECDSA(digest)))
    size = (key.curve.key_size + 7) // 8
    raw = r.to_bytes(size, "big") + sig_s.to_bytes(size, "big")
    return f"{signing_input.decode()}.{b64(raw)}"


@pytest.mark.parametrize(
    ("curve", "token_alg", "ok"),
    [
        ("secp256r1", "ES256", True),
        ("secp384r1", "ES384", True),
        ("secp384r1", "ES256", False),  # cross-curve: a P-384 key labelled ES256
        ("secp256r1", "ES384", False),
        ("secp521r1", "ES256", False),  # P-521 is not an allowed curve at all
    ],
)
def test_es_algorithms_are_bound_to_their_curve(jwks_server, curve, token_alg, ok):
    from conftest import _jwk
    from cryptography.hazmat.primitives.asymmetric import ec

    key = ec.generate_private_key(getattr(ec, curve.upper())())
    entry = _jwk(key.public_key(), "ec-x", token_alg)
    entry.pop("alg")  # the issuer did not pin an algorithm on the key
    _only(jwks_server, entry)
    v = verifier(jwks_server)
    token = _forge_ec_token(key, token_alg, "ec-x", GOOD)
    if ok:
        assert v.verify(token).user_id == "u-9"
    else:
        assert code_of(v, token) == "JWKS_UNAVAILABLE"


def test_discovery_for_a_different_issuer_is_refused(jwks_server, rsa_key):
    # The document says it belongs to another authority: its keys must not be trusted
    # for ours, even though its jwks_uri is reachable and signs "correctly".
    jwks_server["discovery_issuer"] = "https://another-tenant.invalid"
    v = create_verifier(FederatedJwksConfig(issuer=jwks_server["base"], audience=AUDIENCE))
    token = make_token(rsa_key, alg="RS256", kid="rsa-1", claims={**GOOD, "iss": jwks_server["base"]})
    with pytest.raises(AuthError) as info:
        v.verify(token)
    assert (info.value.code, info.value.status) == ("JWKS_UNAVAILABLE", 503)


@pytest.mark.parametrize(
    "malformed",
    [{"key_ops": "verify"}, {"key_ops": [1]}, {"key_ops": {"verify": True}}, {"use": 5}, {"alg": ["RS256"]}],
)
def test_malformed_restriction_metadata_skips_the_key(jwks_server, rsa_key, malformed):
    # A present-but-malformed restriction must not be read as "unrestricted".
    from conftest import _jwk

    entry = _jwk(rsa_key.public_key(), "rsa-1", "RS256")
    entry.pop("use", None)
    entry.pop("alg", None)
    _only(jwks_server, {**entry, **malformed})
    assert code_of(verifier(jwks_server), make_token(rsa_key, alg="RS256", kid="rsa-1", claims=GOOD)) == "JWKS_UNAVAILABLE"
