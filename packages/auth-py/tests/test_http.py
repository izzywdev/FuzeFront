import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest
from conftest import AUDIENCE, make_token
from fuzefront_auth import AuthError, FederatedJwksConfig, create_verifier
from fuzefront_auth._http import MAX_RESPONSE_BYTES, fetch_json


@pytest.fixture
def server():
    routes = {}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            kind, payload = routes.get(self.path, ("json", {}))
            if kind == "redirect":
                self.send_response(302)
                self.send_header("Location", payload)
                self.end_headers()
                return
            raw = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
            self.send_response(200)
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

    httpd = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    routes["base"] = f"http://127.0.0.1:{httpd.server_port}"
    yield routes
    httpd.shutdown()
    httpd.server_close()


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "ftp://example.com/jwks.json",
        "data:application/json,{}",
        "http://example.com/jwks.json",  # plain http to a non-loopback host
        "http://169.254.169.254/latest/meta-data",
        "https:///no-host",
        "//example.com/jwks.json",
        "",
        None,
        42,
    ],
)
def test_only_https_or_loopback_http_urls_are_fetched(url):
    with pytest.raises((ValueError, TypeError)):
        fetch_json(url, 1)


def test_loopback_http_is_allowed_for_local_development(server):
    server["/doc"] = ("json", {"ok": True})
    assert fetch_json(f"{server['base']}/doc", 2) == {"ok": True}


def test_a_redirect_to_a_file_url_is_never_followed(server):
    # The opener has no file handler, so even a redirect cannot reach the filesystem.
    server["/r"] = ("redirect", "file:///etc/passwd")
    with pytest.raises(OSError):  # URLError: unknown url type
        fetch_json(f"{server['base']}/r", 2)


def test_a_redirect_to_a_disallowed_plain_http_host_is_refused(server):
    server["/r"] = ("redirect", "http://example.invalid/jwks")
    with pytest.raises((ValueError, OSError)):
        fetch_json(f"{server['base']}/r", 2)


def test_oversized_responses_are_refused(server):
    server["/big"] = ("raw", b"{" + b" " * (MAX_RESPONSE_BYTES + 10) + b"}")
    with pytest.raises(ValueError):
        fetch_json(f"{server['base']}/big", 2)


def test_a_discovery_document_pointing_jwks_at_a_file_is_a_503_not_a_file_read(server, rsa_key):
    # A compromised discovery endpoint advertises a file:// jwks_uri.
    server["/.well-known/openid-configuration"] = (
        "json",
        {"issuer": server["base"], "jwks_uri": "file:///etc/passwd"},
    )
    v = create_verifier(FederatedJwksConfig(issuer=server["base"], audience=AUDIENCE))
    token = make_token(
        rsa_key,
        alg="RS256",
        kid="k",
        claims={"sub": "u", "iss": server["base"], "aud": AUDIENCE},
    )
    with pytest.raises(AuthError) as info:
        v.verify(token)
    assert (info.value.code, info.value.status) == ("JWKS_UNAVAILABLE", 503)
