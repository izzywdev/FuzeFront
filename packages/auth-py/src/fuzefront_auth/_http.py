"""Minimal, locked-down JSON fetch for OIDC discovery and JWKS.

The URLs come from configuration, but a ``jwks_uri`` read out of a discovery document is
remote data, and a redirect ``Location`` is remote data too. ``urllib.request.urlopen``
opens ``file://``, ``ftp://`` and ``data:`` URLs, and nothing stops a hostile or
compromised endpoint pointing us at an internal address. This module therefore:

* only accepts ``https://`` URLs whose host is not a literal non-public IP (loopback,
  private, link-local, ...) or ``localhost``. This applies to the first URL, to every
  redirect target BEFORE the redirected request is sent, and to a discovered ``jwks_uri``;
* allows ``http://`` to loopback ONLY when the caller says the *configured* issuer/JWKS URI
  is itself loopback (local development, tests: ``allow_loopback_http=True``). That
  exception is deliberately not derived from anything a remote server can influence;
* uses an opener built from the HTTP(S)/proxy handlers only, so there is no ``file``/
  ``ftp``/``data`` handler to be tricked into using, even via a redirect;
* caps the response size and the number of redirects;
* enforces a TOTAL deadline. urllib's timeout bounds each socket operation, not the whole
  request, so a server dribbling bytes just inside it could hold the call (and the caller's
  lock) almost indefinitely. The fetch runs on a worker thread; at the deadline the caller
  gives up AND shuts down the worker's sockets, so the worker, its thread and its file
  descriptors are released instead of being abandoned.

Hostname-based checks (a DNS name that resolves to a private address) are out of scope:
they need resolution-time pinning. Run the service with egress policy for that.
"""

from __future__ import annotations

import http.client
import ipaddress
import json
import socket
import threading
import time
import urllib.error
import urllib.request
from typing import Any
from urllib.parse import urlparse

MAX_RESPONSE_BYTES = 1_048_576  # 1 MiB: far above any real JWKS / discovery document
_LOOPBACK_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})
_MAX_REDIRECTS = 3
_CHUNK = 8192


def is_loopback_http(url: Any) -> bool:
    """True for an ``http://`` URL to a loopback host (the local-development exception)."""
    if not isinstance(url, str):
        return False
    parsed = urlparse(url)
    return parsed.scheme == "http" and parsed.hostname in _LOOPBACK_HOSTS


def _non_public_literal(host: str) -> bool:
    if host == "localhost" or host.endswith(".localhost"):
        return True
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False  # a DNS name: see the module docstring
    return not ip.is_global


def _check_url(url: Any, allow_loopback_http: bool) -> None:
    if not isinstance(url, str):
        raise TypeError("url must be a string")
    parsed = urlparse(url)
    host = parsed.hostname
    if not host:
        raise ValueError("url has no host")
    if parsed.scheme == "https":
        if _non_public_literal(host):
            raise ValueError("url points at a non-public address")
        return
    if parsed.scheme == "http" and allow_loopback_http and host in _LOOPBACK_HOSTS:
        return
    raise ValueError("only https URLs are permitted")


class _Sockets:
    """Sockets opened by one fetch, so the caller can cut them off at the deadline."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._socks: list[socket.socket] = []
        self._aborted = False

    def add(self, sock: socket.socket) -> None:
        with self._lock:
            self._socks.append(sock)
            aborted = self._aborted
        if aborted:  # the deadline passed while we were still connecting
            self._kill(sock)

    def abort(self) -> None:
        with self._lock:
            self._aborted = True
            socks = list(self._socks)
        for sock in socks:
            self._kill(sock)

    @staticmethod
    def _kill(sock: socket.socket) -> None:
        # shutdown() is what wakes a thread blocked in recv(); close() alone may not.
        for action in (lambda: sock.shutdown(socket.SHUT_RDWR), sock.close):
            try:
                action()
            except OSError:
                pass


def _opener(allow_loopback_http: bool, socks: _Sockets) -> urllib.request.OpenerDirector:
    class HTTPConn(http.client.HTTPConnection):
        def connect(self) -> None:
            super().connect()
            socks.add(self.sock)

    class HTTPSConn(http.client.HTTPSConnection):
        def connect(self) -> None:
            super().connect()
            socks.add(self.sock)

    class Http(urllib.request.HTTPHandler):
        def http_open(self, req):
            return self.do_open(HTTPConn, req)

    class Https(urllib.request.HTTPSHandler):
        def https_open(self, req):
            return self.do_open(HTTPSConn, req, context=self._context)

    class CheckedRedirect(urllib.request.HTTPRedirectHandler):
        """Validate each redirect target before the redirected request is made."""

        max_redirections = _MAX_REDIRECTS

        def redirect_request(self, req, fp, code, msg, headers, newurl):
            _check_url(newurl, allow_loopback_http)
            return super().redirect_request(req, fp, code, msg, headers, newurl)

    opener = urllib.request.OpenerDirector()
    for handler in (
        urllib.request.ProxyHandler(),  # honour HTTPS_PROXY etc., as urlopen would
        Http(),
        Https(),
        CheckedRedirect(),
        urllib.request.HTTPDefaultErrorHandler(),
        urllib.request.HTTPErrorProcessor(),
    ):
        opener.add_handler(handler)
    return opener


def _fetch(url: str, timeout: float, deadline: float, allow_loopback_http: bool, socks: _Sockets) -> Any:
    with _opener(allow_loopback_http, socks).open(url, timeout=timeout) as res:
        _check_url(res.geturl(), allow_loopback_http)  # belt and braces: the final URL too
        body = bytearray()
        while True:
            if time.monotonic() > deadline:
                raise TimeoutError("response deadline exceeded")
            # read1() returns after ONE socket receive, so the deadline above is re-checked
            # at least every per-operation timeout; read(n) would sit inside the call until
            # n bytes arrived, however slowly.
            chunk = res.read1(min(_CHUNK, MAX_RESPONSE_BYTES + 1 - len(body)))
            if not chunk:
                break
            body += chunk
            if len(body) > MAX_RESPONSE_BYTES:
                raise ValueError("response too large")
    return json.loads(bytes(body))


def fetch_json(url: str, timeout: float, allow_loopback_http: bool = False) -> Any:
    """GET ``url`` and parse the body as JSON.

    Raises ``ValueError``/``TypeError`` for a disallowed URL or bad body and
    ``OSError``/``URLError``/``TimeoutError`` for network failure or an exceeded
    ``timeout`` (a TOTAL deadline for the whole fetch, not per socket operation).
    """
    _check_url(url, allow_loopback_http)
    deadline = time.monotonic() + timeout
    socks = _Sockets()
    outcome: dict[str, Any] = {}

    def run() -> None:
        try:
            outcome["value"] = _fetch(url, timeout, deadline, allow_loopback_http, socks)
        except BaseException as err:  # noqa: BLE001 - handed back to the caller's thread
            outcome["error"] = err

    worker = threading.Thread(target=run, name="fuzefront-auth-fetch", daemon=True)
    worker.start()
    worker.join(timeout)
    if worker.is_alive():
        # The server is stalling (e.g. trickling bytes). Cut its sockets so the worker's
        # blocked receive fails and the thread and descriptors are released.
        socks.abort()
        worker.join(1.0)
        raise TimeoutError("fetch deadline exceeded")
    if "error" in outcome:
        raise outcome["error"]
    return outcome["value"]
