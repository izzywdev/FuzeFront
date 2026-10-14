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
from urllib.parse import urlparse, urlsplit

MAX_RESPONSE_BYTES = 1_048_576  # 1 MiB: far above any real JWKS / discovery document
_LOOPBACK_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})
_MAX_REDIRECTS = 3
_MAX_INFLIGHT_FETCHES = 8
_WORKER_SLOTS = threading.BoundedSemaphore(_MAX_INFLIGHT_FETCHES)
_CHUNK = 8192


def is_loopback_http(url: Any) -> bool:
    """True for an ``http://`` URL to a loopback host (the local-development exception)."""
    if not isinstance(url, str):
        return False
    parsed = urlparse(url)
    return parsed.scheme == "http" and parsed.hostname in _LOOPBACK_HOSTS


def _non_public_literal(host: str) -> bool:
    host = host.lower().rstrip(".")
    if host == "localhost" or host.endswith(".localhost"):
        return True
    try:
        ip: ipaddress.IPv4Address | ipaddress.IPv6Address = ipaddress.ip_address(host)
    except ValueError:
        # Not a canonical literal. The platform resolver still reads legacy IPv4 spellings
        # ("2130706433", "127.1", "0x7f.1", octal) as addresses, so decode them the same way
        # before deciding it is a DNS name.
        try:
            ip = ipaddress.IPv4Address(socket.inet_aton(host))
        except OSError:
            return False  # a DNS name: see the module docstring
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped  # ::ffff:127.0.0.1 is the loopback address
    return not ip.is_global


def _check_url(url: Any, allow_loopback_http: bool) -> None:
    if not isinstance(url, str):
        raise TypeError("url must be a string")
    parsed = urlparse(url)
    host = parsed.hostname
    if not host:
        raise ValueError("url has no host")
    if "%" in host:
        raise ValueError("percent-encoded hosts are not permitted")
    # Judge the host exactly as the connector will see it. urllib's Request decodes escapes
    # and applies its own host parsing, so a URL whose host reads one way here and another
    # there (``https://%31%32%37.0.0.1/``) must not slip past the address policy.
    try:
        connect_host = urlsplit("//" + urllib.request.Request(url).host).hostname
    except ValueError:
        raise ValueError("unparseable url") from None
    if connect_host is None or connect_host.lower() != host.lower():
        raise ValueError("ambiguous host")
    if parsed.scheme == "https":
        if _non_public_literal(host):
            raise ValueError("url points at a non-public address")
        return
    if parsed.scheme == "http" and allow_loopback_http and host in _LOOPBACK_HOSTS:
        return
    raise ValueError("only https URLs are permitted")


MAX_REDIRECT_BODY_BYTES = 65_536


class CappedBody:
    """Wraps a redirect response so the base handler's drain ``read()`` is bounded."""

    def __init__(self, fp: Any) -> None:
        self._fp = fp

    def read(self, amt: int | None = None) -> bytes:
        return self._fp.read(MAX_REDIRECT_BODY_BYTES)

    def close(self) -> None:
        self._fp.close()


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
    def tracked(create):
        # Register the raw socket the moment it exists, i.e. BEFORE any proxy CONNECT or TLS
        # handshake, so a stall in those phases can be cut off at the deadline too.
        def wrapper(*args, **kwargs):
            sock = create(*args, **kwargs)
            socks.add(sock)
            return sock

        return wrapper

    class HTTPConn(http.client.HTTPConnection):
        def __init__(self, *args, **kwargs) -> None:
            super().__init__(*args, **kwargs)
            self._create_connection = tracked(self._create_connection)

    class HTTPSConn(http.client.HTTPSConnection):
        def __init__(self, *args, **kwargs) -> None:
            super().__init__(*args, **kwargs)
            self._create_connection = tracked(self._create_connection)

    class Http(urllib.request.HTTPHandler):
        def http_open(self, req):
            return self.do_open(HTTPConn, req)

    class Https(urllib.request.HTTPSHandler):
        def https_open(self, req):
            return self.do_open(HTTPSConn, req, context=self._context)

    class CheckedRedirect(urllib.request.HTTPRedirectHandler):
        """Validate each redirect target before the redirected request is made, and never
        read more than a small, fixed amount of a redirect response's body."""

        max_redirections = _MAX_REDIRECTS

        def redirect_request(self, req, fp, code, msg, headers, newurl):
            _check_url(newurl, allow_loopback_http)
            return super().redirect_request(req, fp, code, msg, headers, newurl)

        # The base class drains the whole redirect body with an unbounded fp.read() before it
        # follows the Location; hand it a bounded reader instead.
        def http_error_302(self, req, fp, code, msg, headers):
            return super().http_error_302(req, CappedBody(fp), code, msg, headers)

        http_error_301 = http_error_303 = http_error_307 = http_error_308 = http_error_302

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
    # A worker blocked in DNS resolution (getaddrinfo) has no socket yet, so nothing can be
    # cut off and it cannot be cancelled. Keep every attempt registered until its thread has
    # really exited, and refuse new ones past a small bound: repeated stalls then cost a
    # bounded number of threads instead of accumulating without limit.
    if not _WORKER_SLOTS.acquire(blocking=False):
        raise OSError("too many in-flight fetches; the resolver or network is stalling")
    deadline = time.monotonic() + timeout
    socks = _Sockets()
    outcome: dict[str, Any] = {}

    def run() -> None:
        try:
            outcome["value"] = _fetch(url, timeout, deadline, allow_loopback_http, socks)
        except http.client.HTTPException:
            # BadStatusLine, LineTooLong, IncompleteRead, ...: a malformed response is a fetch
            # failure (an outage as far as callers are concerned), not an invalid credential.
            outcome["error"] = OSError("malformed HTTP response")
        except BaseException as err:  # noqa: BLE001 - handed back to the caller's thread
            outcome["error"] = err
        finally:
            _WORKER_SLOTS.release()

    worker = threading.Thread(target=run, name="fuzefront-auth-fetch", daemon=True)
    try:
        worker.start()
    except BaseException:
        _WORKER_SLOTS.release()
        raise
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
