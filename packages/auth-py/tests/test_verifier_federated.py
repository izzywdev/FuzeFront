"""fuzefront_auth -- federated-jwks verifier tests (#1267).

Serves a REAL JWKS (+ OIDC discovery document) over loopback HTTP, same
approach as `packages/auth/tests/verifier.test.ts` (which notes that
stubbing the fetch layer does not intercept `jose`'s own JWKS client --
PyJWT's `PyJWKClient` is the same kind of self-contained HTTP client, so
this exercises the real discovery + fetch + cache path rather than around
it).
"""

from __future__ import annotations

import base64
import http.server
import json
import threading
import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from jwt.algorithms import ECAlgorithm, RSAAlgorithm

from fuzefront_auth import AuthError, FederatedJwksConfig, create_verifier

ISSUER_PATH = ""  # overwritten per-test via server base url
AUDIENCE = "fuzefront"
KID = "test-key"


class _JwksHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802 - stdlib method name
        server: "_JwksServer" = self.server  # type: ignore[assignment]
        if self.path.endswith("/.well-known/openid-configuration"):
            body = json.dumps({"jwks_uri": f"{server.base_url}/jwks"}).encode()
        elif self.path.endswith("/jwks"):
            body = json.dumps(server.jwks_doc).encode()
        else:
            self.send_response(404)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):  # silence test output
        pass


class _JwksServer(http.server.HTTPServer):
    jwks_doc: dict
    base_url: str


@pytest.fixture()
def jwks_server():
    """Start a loopback HTTP server serving OIDC discovery + a JWKS with one
    RSA signing key. Yields (base_url, rsa_private_key).
    """
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    jwk = json.loads(RSAAlgorithm(RSAAlgorithm.SHA256).to_jwk(private_key.public_key()))
    jwk.update(kid=KID, alg="RS256", use="sig")

    server = _JwksServer(("127.0.0.1", 0), _JwksHandler)
    server.jwks_doc = {"keys": [jwk]}
    port = server.server_address[1]
    server.base_url = f"http://127.0.0.1:{port}"

    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server.base_url, private_key
    finally:
        server.shutdown()
        thread.join(timeout=5)


def _sign(private_key, claims: dict, *, kid: str = KID, alg: str = "RS256") -> str:
    return jwt.encode(claims, private_key, algorithm=alg, headers={"kid": kid})


def test_refuses_to_construct_without_an_issuer():
    with pytest.raises(AuthError):
        create_verifier(FederatedJwksConfig(issuer="", audience=AUDIENCE))


def test_refuses_to_construct_without_an_audience():
    with pytest.raises(AuthError):
        create_verifier(FederatedJwksConfig(issuer="https://issuer.example", audience=""))


def test_verifies_an_rs256_token_via_oidc_discovery_and_maps_tenant_and_roles_claims(jwks_server):
    base_url, private_key = jwks_server
    verifier = create_verifier(
        FederatedJwksConfig(
            # jwks_uri omitted on purpose: this proves discovery resolves it.
            issuer=base_url,
            audience=AUDIENCE,
            tenant_claim="org",
            roles_claim="perms",
        )
    )
    token = _sign(
        private_key,
        {
            "sub": "u-fed",
            "org": "org-1",
            "perms": ["reader"],
            "iss": base_url,
            "aud": AUDIENCE,
            "exp": int(time.time()) + 3600,
        },
    )
    identity = verifier.verify(token)
    assert identity.user_id == "u-fed"
    assert identity.tenant_id == "org-1"
    assert identity.roles == ["reader"]
    assert identity.auth_mode == "federated-jwks"


def test_rejects_a_token_from_the_wrong_issuer(jwks_server):
    base_url, private_key = jwks_server
    verifier = create_verifier(
        FederatedJwksConfig(issuer=f"{base_url}/expected", audience=AUDIENCE, jwks_uri=f"{base_url}/jwks")
    )
    token = _sign(
        private_key,
        {"sub": "u", "iss": "https://evil.test/other", "aud": AUDIENCE, "exp": int(time.time()) + 3600},
    )
    with pytest.raises(AuthError) as exc_info:
        verifier.verify(token)
    assert exc_info.value.code == "INVALID_ISSUER"


def test_rejects_a_token_whose_audience_does_not_match(jwks_server):
    base_url, private_key = jwks_server
    verifier = create_verifier(
        FederatedJwksConfig(issuer=base_url, audience=AUDIENCE, jwks_uri=f"{base_url}/jwks")
    )
    token = _sign(
        private_key,
        {"sub": "u", "iss": base_url, "aud": "some-other-app", "exp": int(time.time()) + 3600},
    )
    with pytest.raises(AuthError) as exc_info:
        verifier.verify(token)
    assert exc_info.value.code == "INVALID_AUDIENCE"


def test_rejects_an_expired_token(jwks_server):
    base_url, private_key = jwks_server
    verifier = create_verifier(
        FederatedJwksConfig(issuer=base_url, audience=AUDIENCE, jwks_uri=f"{base_url}/jwks")
    )
    token = _sign(
        private_key,
        {"sub": "u", "iss": base_url, "aud": AUDIENCE, "exp": int(time.time()) - 60},
    )
    with pytest.raises(AuthError) as exc_info:
        verifier.verify(token)
    assert exc_info.value.code == "EXPIRED"


def test_rejects_a_token_missing_exp_iss_or_aud(jwks_server):
    base_url, private_key = jwks_server
    verifier = create_verifier(
        FederatedJwksConfig(issuer=base_url, audience=AUDIENCE, jwks_uri=f"{base_url}/jwks")
    )
    # No exp/iss/aud at all -- all three are REQUIRED in federated-jwks mode.
    token = jwt.encode({"sub": "u"}, private_key, algorithm="RS256", headers={"kid": KID})
    with pytest.raises(AuthError) as exc_info:
        verifier.verify(token)
    assert exc_info.value.code == "MISSING_CLAIM"


def test_rejects_algorithm_confusion_an_hs256_token_reusing_a_known_kid(jwks_server):
    """The attack this guards: an attacker signs with a symmetric secret
    (which they do not actually know -- any value works for this test)
    while claiming the `kid` of a REAL asymmetric signing key, hoping a
    verifier that forgot to pin `algorithms` would treat the public key
    material as an HMAC secret.
    """
    base_url, _private_key = jwks_server
    verifier = create_verifier(
        FederatedJwksConfig(issuer=base_url, audience=AUDIENCE, jwks_uri=f"{base_url}/jwks")
    )
    forged = jwt.encode(
        {"sub": "attacker", "iss": base_url, "aud": AUDIENCE, "exp": int(time.time()) + 3600},
        "attacker-controlled-secret",
        algorithm="HS256",
        headers={"kid": KID},
    )
    with pytest.raises(AuthError):
        verifier.verify(forged)


def test_rejects_alg_none(jwks_server):
    base_url, _private_key = jwks_server
    verifier = create_verifier(
        FederatedJwksConfig(issuer=base_url, audience=AUDIENCE, jwks_uri=f"{base_url}/jwks")
    )
    header = base64.urlsafe_b64encode(
        json.dumps({"alg": "none", "typ": "JWT", "kid": KID}).encode()
    ).rstrip(b"=")
    payload = base64.urlsafe_b64encode(
        json.dumps(
            {"sub": "u", "iss": base_url, "aud": AUDIENCE, "exp": int(time.time()) + 3600}
        ).encode()
    ).rstrip(b"=")
    none_token = header.decode() + "." + payload.decode() + "."
    with pytest.raises(AuthError):
        verifier.verify(none_token)


def test_rejects_a_bad_signature(jwks_server):
    base_url, _private_key = jwks_server
    other_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    verifier = create_verifier(
        FederatedJwksConfig(issuer=base_url, audience=AUDIENCE, jwks_uri=f"{base_url}/jwks")
    )
    forged = _sign(
        other_key,
        {"sub": "u", "iss": base_url, "aud": AUDIENCE, "exp": int(time.time()) + 3600},
    )
    with pytest.raises(AuthError) as exc_info:
        verifier.verify(forged)
    assert exc_info.value.code == "INVALID_SIGNATURE"


def test_es256_signing_key_also_verifies(jwks_server):
    """federated-jwks accepts ES256 as well as RS256 -- exercise a second
    JWKS with an EC key to prove the algorithm allowlist is not RSA-only.
    """
    private_key = ec.generate_private_key(ec.SECP256R1())
    jwk = json.loads(ECAlgorithm(ECAlgorithm.SHA256).to_jwk(private_key.public_key()))
    jwk.update(kid="ec-key", alg="ES256", use="sig")

    server = _JwksServer(("127.0.0.1", 0), _JwksHandler)
    server.jwks_doc = {"keys": [jwk]}
    port = server.server_address[1]
    base_url = f"http://127.0.0.1:{port}"
    server.base_url = base_url
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        verifier = create_verifier(
            FederatedJwksConfig(issuer=base_url, audience=AUDIENCE, jwks_uri=f"{base_url}/jwks")
        )
        token = jwt.encode(
            {"sub": "u-ec", "iss": base_url, "aud": AUDIENCE, "exp": int(time.time()) + 3600},
            private_key,
            algorithm="ES256",
            headers={"kid": "ec-key"},
        )
        identity = verifier.verify(token)
        assert identity.user_id == "u-ec"
    finally:
        server.shutdown()
        thread.join(timeout=5)
