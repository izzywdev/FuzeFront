"""Minimal, locked-down JSON fetch for OIDC discovery and JWKS.

The URLs come from configuration, but a ``jwks_uri`` read out of a discovery document is
remote data. ``urllib.request.urlopen`` opens ``file://``, ``ftp://`` and ``data:`` URLs
too, so a hostile or compromised discovery endpoint could point us at a local file. This
module therefore:

* only accepts ``https://`` (and ``http://`` for loopback, for local development/tests),
  checked before the request AND against the final URL after any redirect;
* uses an opener built from the HTTP(S) handlers only -- there is no ``file``/``ftp``/
  ``data`` handler to be tricked into using, even via a redirect;
* caps the response size, so a hostile endpoint cannot make us buffer unbounded data.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any
from urllib.parse import urlparse

MAX_RESPONSE_BYTES = 1_048_576  # 1 MiB: far above any real JWKS / discovery document
_LOOPBACK_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})


def _opener() -> urllib.request.OpenerDirector:
    opener = urllib.request.OpenerDirector()
    for handler in (
        urllib.request.ProxyHandler(),  # honour HTTPS_PROXY etc., as urlopen would
        urllib.request.HTTPHandler(),
        urllib.request.HTTPSHandler(),
        urllib.request.HTTPRedirectHandler(),
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


def fetch_json(url: str, timeout: float) -> Any:
    """GET ``url`` and parse the body as JSON. Raises ``ValueError``/``OSError``/``URLError``."""
    _check_url(url)
    with _opener().open(url, timeout=timeout) as res:
        _check_url(res.geturl())  # a redirect must not leave the allowed set either
        body = res.read(MAX_RESPONSE_BYTES + 1)
    if len(body) > MAX_RESPONSE_BYTES:
        raise ValueError("response too large")
    return json.loads(body)
