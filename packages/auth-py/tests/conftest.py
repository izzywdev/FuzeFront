"""Shared fixtures: throwaway signing keys and a local JWKS/discovery server.

No network and no real secrets -- every key is generated per test session.
"""

from __future__ import annotations

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

import fuzefront_auth.verifier as verifier_module
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from jwt.algorithms import ECAlgorithm, RSAAlgorithm

SECRET = "unit-test-shared-secret-0123456789abcdef"  # test-only, not a real credential
ISSUER = "https://issuer.test.invalid"
AUDIENCE = "fuzefront-python-service"


@pytest.fixture(autouse=True)
def _fresh_jwks_clients():
    verifier_module._jwks_clients.clear()
    yield
    verifier_module._jwks_clients.clear()


@pytest.fixture(scope="session")
def rsa_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture(scope="session")
def other_rsa_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture(scope="session")
def ec_key():
    return ec.generate_private_key(ec.SECP256R1())


def _jwk(public_key, kid: str, alg: str) -> dict:
    algo = RSAAlgorithm if alg.startswith("RS") else ECAlgorithm
    data = json.loads(algo.to_jwk(public_key))
    data.update({"kid": kid, "use": "sig", "alg": alg})
    return data


@pytest.fixture
def jwks_server(rsa_key, ec_key):
    """Serves OIDC discovery and a JWKS holding the RSA (kid=rsa-1) and EC (kid=ec-1) keys."""
    state = {"jwks_hits": 0, "fail": False}
    keys = [_jwk(rsa_key.public_key(), "rsa-1", "RS256"), _jwk(ec_key.public_key(), "ec-1", "ES256")]

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):  # keep test output quiet
            pass

        def do_GET(self):
            if state["fail"]:
                self.send_response(503)
                self.end_headers()
                return
            base = f"http://127.0.0.1:{self.server.server_port}"
            if self.path == "/.well-known/openid-configuration":
                body = {"issuer": base, "jwks_uri": f"{base}/jwks"}
            elif self.path == "/jwks":
                state["jwks_hits"] += 1
                body = {"keys": keys}
            else:
                self.send_response(404)
                self.end_headers()
                return
            raw = json.dumps(body).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

    server = HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    state["base"] = f"http://127.0.0.1:{server.server_port}"
    yield state
    server.shutdown()
    server.server_close()


def make_token(
    key,
    *,
    alg: str = "HS256",
    kid: str | None = None,
    claims: dict | None = None,
    drop: tuple[str, ...] = (),
) -> str:
    now = int(time.time())
    payload = {"iat": now, "exp": now + 3600}
    payload.update(claims or {})
    for name in drop:
        payload.pop(name, None)
    headers = {"kid": kid} if kid else None
    return jwt.encode(payload, key, algorithm=alg, headers=headers)
