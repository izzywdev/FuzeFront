"""Minimal, locked-down JSON fetch for OIDC discovery and JWKS.

The URLs come from configuration, but a ``jwks_uri`` read out of a discovery document is
remote data. ``urllib.request.urlopen`` opens ``file://``, ``ftp://`` and ``data:`` URLs
too, so a hostile or compromised discovery endpoint could point us at a local file. This
module therefore:

* only accepts ``https://`` (and ``http://`` for loopback, for local development/tests),
  checked before the request AND on every redirect target BEFORE the redirected request is
  sent (so a compromised endpoint cannot bounce us to e.g. a cloud metadata address);
* uses an opener built from the HTTP(S) handlers only -- there is no ``file``/``ftp``/
  ``data`` handler to be tricked into using, even via a redirect;
* caps the response size, so a hostile endpoint cannot make us buffer unbounded data;
* enforces a TOTAL deadline. urllib's timeout bounds each socket operation, not the whole
  request, so a server dribbling one byte just inside it could hold the call (and the
  caller's lock) almost indefinitely. The fetch runs on a daemon worker thread and the
  caller gives up at the deadline, whatever phase the server is stalling in.
"""

from __future__ import annotations

import json
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


class _CheckedRedirect(urllib.request.HTTPRedirectHandler):
    """Validate each redirect target before the redirected request is made."""

    max_redirections = _MAX_REDIRECTS

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        _check_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _opener() -> urllib.request.OpenerDirector:
    opener = urllib.request.OpenerDirector()
    for handler in (
        urllib.request.ProxyHandler(),  # honour HTTPS_PROXY etc., as urlopen would
        urllib.request.HTTPHandler(),
        urllib.request.HTTPSHandler(),
        _CheckedRedirect(),
        urllib.request.HTTPDefaultErrorHandler(),
        urllib.request.HTTPErrorProcessor(),
    ):
        opener.add_handler(handler)
    return opener


def _check_url(url: Any) -> None:
    if not isinstance(url, str):
        raise TypeError("url must be a string")
    parsed = urlparse(url)
    if parsed.scheme == "https" and parsed.hostname:
        return
    if parsed.scheme == "http" and parsed.hostname in _LOOPBACK_HOSTS:
        return
    raise ValueError("only https (or loopback http) URLs are permitted")


def _fetch(url: str, timeout: float, deadline: float) -> Any:
    with _opener().open(url, timeout=timeout) as res:
        _check_url(res.geturl())  # belt and braces: the final URL must be allowed too
        body = bytearray()
        while True:
            if time.monotonic() > deadline:
                raise TimeoutError("response deadline exceeded")
            chunk = res.read(min(_CHUNK, MAX_RESPONSE_BYTES + 1 - len(body)))
            if not chunk:
                break
            body += chunk
            if len(body) > MAX_RESPONSE_BYTES:
                raise ValueError("response too large")
    return json.loads(bytes(body))


def fetch_json(url: str, timeout: float) -> Any:
    """GET ``url`` and parse the body as JSON.

    Raises ``ValueError``/``TypeError`` for a disallowed URL or bad body and
    ``OSError``/``URLError``/``TimeoutError`` for network failure or an exceeded
    ``timeout`` (a TOTAL deadline for the whole fetch, not per socket operation).
    """
    _check_url(url)
    deadline = time.monotonic() + timeout
    outcome: dict[str, Any] = {}

    def run() -> None:
        try:
            outcome["value"] = _fetch(url, timeout, deadline)
        except BaseException as err:  # noqa: BLE001 - handed back to the caller's thread
            outcome["error"] = err

    worker = threading.Thread(target=run, name="fuzefront-auth-fetch", daemon=True)
    worker.start()
    worker.join(timeout)
    if worker.is_alive():
        # The server is stalling (e.g. trickling bytes). Give up; the daemon thread ends
        # on its own when its current socket operation times out or the deadline passes.
        raise TimeoutError("fetch deadline exceeded")
    if "error" in outcome:
        raise outcome["error"]
    return outcome["value"]
