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
        # literal non-public addresses are refused even over https
        "https://127.0.0.1/jwks",
        "https://localhost/jwks",
        "https://10.0.0.5/jwks",
        "https://192.168.1.1/jwks",
        "https://169.254.169.254/latest/meta-data",
        "https://[::1]/jwks",
        "https://0.0.0.0/jwks",
        # legacy / non-canonical spellings the platform resolver reads as addresses
        "https://2130706433/jwks",  # 127.0.0.1
        "https://127.1/jwks",
        "https://0x7f000001/jwks",
        "https://017700000001/jwks",
        "https://2852039166/jwks",  # 169.254.169.254
        "https://[::ffff:127.0.0.1]/jwks",
        "https://[::ffff:169.254.169.254]/jwks",
        "https://LOCALHOST/jwks",
        "https://localhost./jwks",
        # loopback http is refused unless the CALLER opts in from configuration
        "http://127.0.0.1/jwks",
        "http://localhost/jwks",
        "",
        None,
        42,
    ],
)
def test_only_https_or_loopback_http_urls_are_fetched(url):
    with pytest.raises((ValueError, TypeError)):
        fetch_json(url, 1)


def test_loopback_http_needs_an_explicit_opt_in_from_the_caller(server):
    server["/doc"] = ("json", {"ok": True})
    with pytest.raises(ValueError):
        fetch_json(f"{server['base']}/doc", 2)  # default: not allowed


def test_loopback_http_is_allowed_for_local_development(server):
    server["/doc"] = ("json", {"ok": True})
    assert fetch_json(f"{server['base']}/doc", 2, allow_loopback_http=True) == {"ok": True}


def test_a_redirect_to_a_file_url_is_never_followed(server):
    # The opener has no file handler, so even a redirect cannot reach the filesystem.
    server["/r"] = ("redirect", "file:///etc/passwd")
    with pytest.raises(OSError):  # URLError: unknown url type
        fetch_json(f"{server['base']}/r", 2, allow_loopback_http=True)


def test_a_redirect_to_a_disallowed_plain_http_host_is_refused(server):
    server["/r"] = ("redirect", "http://example.invalid/jwks")
    with pytest.raises((ValueError, OSError)):
        fetch_json(f"{server['base']}/r", 2, allow_loopback_http=True)


def test_oversized_responses_are_refused(server):
    server["/big"] = ("raw", b"{" + b" " * (MAX_RESPONSE_BYTES + 10) + b"}")
    with pytest.raises(ValueError):
        fetch_json(f"{server['base']}/big", 2, allow_loopback_http=True)


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


def _listener(host, port=0):
    """A recording HTTP server on a given loopback address."""
    seen = []

    class Recorder(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            seen.append(self.path)
            raw = b"{}"
            self.send_response(200)
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

    httpd = HTTPServer((host, port), Recorder)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, seen


def test_a_redirect_to_a_disallowed_host_is_never_requested(server):
    # 127.0.0.2 is loopback but NOT in the allowed set. A recording server there proves the
    # redirected request is not even sent (the old code sent it, then checked the answer).
    try:
        target, seen = _listener("127.0.0.2")
    except OSError:
        pytest.skip("127.0.0.2 is not bindable here")
    try:
        server["/r"] = ("redirect", f"http://127.0.0.2:{target.server_port}/secret")
        with pytest.raises(ValueError):
            fetch_json(f"{server['base']}/r", 2, allow_loopback_http=True)
        assert seen == []
    finally:
        target.shutdown()
        target.server_close()


def test_a_redirect_chain_cannot_bounce_through_a_disallowed_host_back_to_an_allowed_one(server):
    try:
        hop, seen = _listener("127.0.0.2")
    except OSError:
        pytest.skip("127.0.0.2 is not bindable here")
    try:
        server["/ok"] = ("json", {"ok": True})
        server["/r"] = ("redirect", f"http://127.0.0.2:{hop.server_port}/hop")
        with pytest.raises(ValueError):
            fetch_json(f"{server['base']}/r", 2, allow_loopback_http=True)
        assert seen == []
    finally:
        hop.shutdown()
        hop.server_close()


def test_allowed_redirects_are_followed(server):
    server["/ok"] = ("json", {"ok": True})
    server["/r"] = ("redirect", f"{server['base']}/ok")
    assert fetch_json(f"{server['base']}/r", 2, allow_loopback_http=True) == {"ok": True}


def test_redirect_loops_are_bounded(server):
    server["/loop"] = ("redirect", f"{server['base']}/loop")
    with pytest.raises(OSError):  # urllib: too many redirects
        fetch_json(f"{server['base']}/loop", 2, allow_loopback_http=True)


def _dribble_server(prefix: bytes, body_gap: float):
    """Raw TCP server that sends `prefix` one byte at a time, `body_gap` seconds apart."""
    import socket
    import time

    srv = socket.socket()
    srv.bind(("127.0.0.1", 0))
    srv.listen(5)
    stop = threading.Event()

    def serve():
        srv.settimeout(0.2)
        while not stop.is_set():
            try:
                conn, _ = srv.accept()
            except OSError:
                continue
            threading.Thread(target=_drip, args=(conn,), daemon=True).start()

    def _drip(conn):
        try:
            conn.recv(4096)
            for byte in prefix:
                if stop.is_set():
                    return
                conn.sendall(bytes([byte]))
                time.sleep(body_gap)
        except OSError:
            pass
        finally:
            conn.close()

    threading.Thread(target=serve, daemon=True).start()
    return srv, stop


def test_a_server_dribbling_the_body_cannot_exceed_the_total_deadline():
    import time

    # Each byte arrives well inside the per-socket-op timeout; only a TOTAL deadline stops it.
    head = b"HTTP/1.0 200 OK\r\nContent-Type: application/json\r\n\r\n"
    srv, stop = _dribble_server(head + b"[" + b"0," * 2000 + b"0]", 0.05)
    try:
        t0 = time.monotonic()
        with pytest.raises(OSError):  # TimeoutError
            fetch_json(f"http://127.0.0.1:{srv.getsockname()[1]}/", 0.5, allow_loopback_http=True)
        assert time.monotonic() - t0 < 2.0
    finally:
        stop.set()
        srv.close()


def test_a_server_dribbling_the_status_line_cannot_exceed_the_total_deadline():
    import time

    srv, stop = _dribble_server(b"HTTP/1.0 200 OK\r\n" + b"X-Pad: " + b"a" * 4000, 0.05)
    try:
        t0 = time.monotonic()
        with pytest.raises(OSError):
            fetch_json(f"http://127.0.0.1:{srv.getsockname()[1]}/", 0.5, allow_loopback_http=True)
        assert time.monotonic() - t0 < 2.0
    finally:
        stop.set()
        srv.close()



def _fetch_threads():
    return [t for t in threading.enumerate() if t.name == "fuzefront-auth-fetch"]


def _wait_until_gone(timeout=3.0):
    import time

    end = time.monotonic() + timeout
    while _fetch_threads() and time.monotonic() < end:
        time.sleep(0.05)
    return not _fetch_threads()


def test_a_timed_out_fetch_releases_its_worker_thread_and_socket_body_dribble():
    import time

    # Large Content-Length and one byte per 0.2s: a plain read(8192) would sit inside one call
    # for ~27 minutes. The caller must give up AND free the worker.
    srv = _dribble_with_length(b"{" + b" " * 100_000 + b"}", 0.2)
    try:
        t0 = time.monotonic()
        with pytest.raises(OSError):
            fetch_json(f"http://127.0.0.1:{srv[0].getsockname()[1]}/", 0.5, allow_loopback_http=True)
        assert time.monotonic() - t0 < 3.0
        assert _wait_until_gone(), "worker thread was abandoned"
    finally:
        srv[1].set()
        srv[0].close()


def test_a_timed_out_fetch_releases_its_worker_thread_and_socket_header_dribble():
    srv, stop = _dribble_server(b"HTTP/1.0 200 OK\r\nX-Pad: " + b"a" * 20_000, 0.2)
    try:
        with pytest.raises(OSError):
            fetch_json(f"http://127.0.0.1:{srv.getsockname()[1]}/", 0.5, allow_loopback_http=True)
        assert _wait_until_gone(), "worker thread was abandoned"
    finally:
        stop.set()
        srv.close()


def _dribble_with_length(body: bytes, gap: float):
    import socket
    import time

    srv = socket.socket()
    srv.bind(("127.0.0.1", 0))
    srv.listen(5)
    stop = threading.Event()

    def serve():
        srv.settimeout(0.2)
        while not stop.is_set():
            try:
                conn, _ = srv.accept()
            except OSError:
                continue
            threading.Thread(target=drip, args=(conn,), daemon=True).start()

    def drip(conn):
        try:
            conn.recv(4096)
            conn.sendall(
                b"HTTP/1.0 200 OK\r\nContent-Type: application/json\r\nContent-Length: "
                + str(len(body)).encode()
                + b"\r\n\r\n"
            )
            for byte in body:
                if stop.is_set():
                    return
                conn.sendall(bytes([byte]))
                time.sleep(gap)
        except OSError:
            pass
        finally:
            conn.close()

    threading.Thread(target=serve, daemon=True).start()
    return srv, stop



def test_public_dns_names_and_global_addresses_are_not_blocked_by_the_literal_policy():
    from fuzefront_auth._http import _non_public_literal

    for host in ("example.com", "issuer.example.co.uk", "8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"):
        assert _non_public_literal(host) is False, host


def test_a_stalled_proxy_connect_is_cut_off_and_its_socket_released(monkeypatch):
    import time

    # HTTPS goes through a configured proxy that dribbles its CONNECT response. The socket
    # must be tracked before the CONNECT/TLS phase or the deadline cannot reach it.
    srv, stop = _dribble_server(b"HTTP/1.1 200 Connection established\r\nX-Pad: " + b"a" * 20_000, 0.2)
    try:
        for var in ("no_proxy", "NO_PROXY"):
            monkeypatch.setenv(var, "")
        monkeypatch.setenv("https_proxy", f"http://127.0.0.1:{srv.getsockname()[1]}")
        monkeypatch.setenv("HTTPS_PROXY", f"http://127.0.0.1:{srv.getsockname()[1]}")
        t0 = time.monotonic()
        with pytest.raises(OSError):
            fetch_json("https://issuer.example.com/jwks", 0.5)
        assert time.monotonic() - t0 < 3.0
        assert _wait_until_gone(), "worker thread was abandoned during proxy CONNECT"
    finally:
        stop.set()
        srv.close()


def test_redirect_bodies_are_read_through_a_bounded_reader(monkeypatch):
    import io
    import urllib.request

    from fuzefront_auth._http import MAX_REDIRECT_BODY_BYTES, CappedBody

    reads = []

    class Spy(io.BytesIO):
        def read(self, n=-1):
            data = super().read(n)
            reads.append(len(data))
            return data

    body = CappedBody(Spy(b"x" * (5 * 1024 * 1024)))
    assert len(body.read()) == MAX_REDIRECT_BODY_BYTES
    assert len(body.read(None)) == MAX_REDIRECT_BODY_BYTES  # never unbounded, whatever is asked

    # and the redirect handler really hands the base class the bounded wrapper
    seen = {}

    def fake_302(self, req, fp, code, msg, headers):
        seen["fp"] = fp
        return "followed"

    monkeypatch.setattr(urllib.request.HTTPRedirectHandler, "http_error_302", fake_302)
    from fuzefront_auth import _http

    opener = _http._opener(True, _http._Sockets())
    handler = next(h for h in opener.handlers if h.__class__.__name__ == "CheckedRedirect")
    for code in ("301", "302", "303", "307", "308"):
        seen.clear()
        assert getattr(handler, f"http_error_{code}")(None, io.BytesIO(b"x"), int(code), "m", {}) == "followed"
        assert isinstance(seen["fp"], CappedBody)


def test_a_redirect_with_a_large_body_is_still_followed(server):
    server["/ok"] = ("json", {"ok": True})

    class Big(BaseHTTPRequestHandler):
        pass

    # server fixture sends redirects with no body; build one with a 3 MiB body on its own port
    import socket
    import threading as th

    srv = socket.socket()
    srv.bind(("127.0.0.1", 0))
    srv.listen(5)
    stop = th.Event()
    target = f"{server['base']}/ok"

    def serve():
        srv.settimeout(0.2)
        while not stop.is_set():
            try:
                conn, _ = srv.accept()
            except OSError:
                continue
            try:
                conn.recv(4096)
                body = b"x" * (3 * 1024 * 1024)
                conn.sendall(
                    f"HTTP/1.1 302 Found\r\nLocation: {target}\r\nContent-Length: {len(body)}\r\n\r\n".encode()
                )
                try:
                    conn.sendall(body)
                except OSError:
                    pass  # the client stopped reading, which is the point
            finally:
                conn.close()

    th.Thread(target=serve, daemon=True).start()
    try:
        assert fetch_json(f"http://127.0.0.1:{srv.getsockname()[1]}/r", 3, allow_loopback_http=True) == {"ok": True}
    finally:
        stop.set()
        srv.close()


@pytest.mark.parametrize(
    "url",
    [
        "https://%31%32%37%2e0%2e0%2e1/jwks",  # percent-encoded 127.0.0.1
        "https://%6c%6f%63%61%6c%68%6f%73%74/jwks",  # percent-encoded localhost
        "https://127.0.0.1%2f@example.com/jwks",
        "https://example.com%2f.evil/jwks",
    ],
)
def test_percent_encoded_hosts_cannot_smuggle_a_private_address(url):
    with pytest.raises(ValueError):
        fetch_json(url, 1)


def test_the_host_the_policy_judges_is_the_host_the_connector_uses():
    from urllib.parse import urlsplit
    from urllib.request import Request

    from fuzefront_auth._http import _check_url

    for url in ("https://example.com/x", "https://example.com:8443/x", "https://user@example.com/x"):
        _check_url(url, False)  # accepted, and the connector's view is the same host
        assert urlsplit("//" + Request(url).host).hostname == "example.com"


def test_a_malformed_http_response_is_a_fetch_failure_not_a_crash():
    import socket

    srv = socket.socket()
    srv.bind(("127.0.0.1", 0))
    srv.listen(5)
    stop = threading.Event()

    def serve():
        srv.settimeout(0.2)
        while not stop.is_set():
            try:
                conn, _ = srv.accept()
            except OSError:
                continue
            conn.recv(4096)
            conn.sendall(b"NOT-HTTP garbage\r\n\r\n")
            conn.close()

    threading.Thread(target=serve, daemon=True).start()
    try:
        with pytest.raises(OSError):
            fetch_json(f"http://127.0.0.1:{srv.getsockname()[1]}/", 2, allow_loopback_http=True)
    finally:
        stop.set()
        srv.close()


def test_a_malformed_response_from_the_issuer_is_a_503_not_a_401():
    import socket

    from fuzefront_auth import AuthError, FederatedJwksConfig, create_verifier

    srv = socket.socket()
    srv.bind(("127.0.0.1", 0))
    srv.listen(5)
    stop = threading.Event()

    def serve():
        srv.settimeout(0.2)
        while not stop.is_set():
            try:
                conn, _ = srv.accept()
            except OSError:
                continue
            conn.recv(4096)
            conn.sendall(b"HTTP/1.1 200\x00 OK garbage\r\n\r\n")
            conn.close()

    threading.Thread(target=serve, daemon=True).start()
    try:
        base = f"http://127.0.0.1:{srv.getsockname()[1]}"
        v = create_verifier(FederatedJwksConfig(issuer=base, audience="a", jwks_uri=f"{base}/jwks"))
        from conftest import make_token
        from cryptography.hazmat.primitives.asymmetric import rsa

        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        token = make_token(key, alg="RS256", kid="k", claims={"sub": "u", "iss": base, "aud": "a"})
        with pytest.raises(AuthError) as info:
            v.verify(token)
        assert (info.value.code, info.value.status) == ("JWKS_UNAVAILABLE", 503)
    finally:
        stop.set()
        srv.close()


def test_stalled_workers_are_bounded_and_slots_recover(monkeypatch):
    import time

    import fuzefront_auth._http as http_mod

    release = threading.Event()
    started = []

    def stuck(url, timeout, deadline, allow, socks):
        started.append(1)
        release.wait(10)  # a worker stuck where nothing can cancel it (e.g. getaddrinfo)
        return {"ok": True}

    monkeypatch.setattr(http_mod, "_fetch", stuck)
    cap = http_mod._MAX_INFLIGHT_FETCHES
    try:
        for _ in range(cap):
            with pytest.raises(TimeoutError):
                fetch_json("https://issuer.example.com/jwks", 0.05)
        before = len(_fetch_threads())
        assert before == cap
        # The cap is reached: a new fetch is refused immediately and spawns NO thread.
        t0 = time.monotonic()
        with pytest.raises(OSError, match="too many in-flight"):
            fetch_json("https://issuer.example.com/jwks", 0.05)
        assert time.monotonic() - t0 < 0.5
        assert len(_fetch_threads()) == before
    finally:
        release.set()
    assert _wait_until_gone(), "slots/threads did not recover once the stall cleared"
    monkeypatch.setattr(http_mod, "_fetch", lambda *a: {"ok": True})
    assert fetch_json("https://issuer.example.com/jwks", 1) == {"ok": True}
