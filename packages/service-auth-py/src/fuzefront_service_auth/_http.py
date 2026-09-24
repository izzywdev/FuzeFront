"""Minimal stdlib HTTP POST helper shared by the client and verifier.

Deliberately not using `requests`/`httpx` at runtime so this package installs
into any Python microservice with zero third-party dependencies (mirrors
`fuzefront-config-client` and `fuzefront-identity`). Both `ServiceAuthClient`
and `MachineTokenVerifier` accept an `http_post` override for tests (and for
callers who want connection pooling via their own HTTP stack) -- see the
`http_post` constructor parameter on each.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

HttpPost = Any  # Callable[[str, dict, float], Tuple[int, str]]

# urllib speaks file://, ftp:// and data:// as well as HTTP, so an unchecked
# URL is an arbitrary-file read (and an SSRF) waiting to happen. `base_url` on
# ServiceAuthClient/MachineTokenVerifier is deployment configuration -- and
# configuration arrives from env vars, Helm values and ConfigMaps, i.e. from
# things other than the person reading this. The scheme is therefore enforced
# at the one place every real network call funnels through, rather than trusted
# at the point it was configured.
_ALLOWED_SCHEMES = frozenset(("http", "https"))


def default_http_post(url: str, payload: dict, timeout: float) -> tuple[int, str]:
    """POST JSON `payload` to `url`; return (status_code, raw_body_text).

    Returns the HTTP status even for 4xx/5xx (via `urllib.error.HTTPError`)
    rather than raising, so callers can branch on status. Raises for genuine
    transport failures (`URLError`: connection refused, DNS failure, TLS
    error, timeout) -- those have no status code and are the caller's cue to
    fail closed.

    Raises `ValueError` before any I/O if `url` is not http/https: both
    callers fail closed on it, so a misconfigured base_url is a hard error
    rather than a `file://` read.
    """
    scheme = urllib.parse.urlsplit(url).scheme.lower()
    if scheme not in _ALLOWED_SCHEMES:
        raise ValueError(
            f"fuzefront-service-auth: refusing to request {scheme or '(no)'} URL "
            f"{url!r} -- only http and https are allowed. Check the `base_url` "
            "the client/verifier was constructed with."
        )

    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    try:
        # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected.dynamic-urllib-use-detected -- the `file://` read this rule names is unreachable: the scheme of `url` is checked against _ALLOWED_SCHEMES immediately above and anything else raises before a Request is ever built. `url` itself is a configured base_url plus a code-literal path (`/api/v1/security/tokens[/introspect]`) built by the two callers in client.py/verifier.py -- never caller-supplied.
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read().decode("utf-8")
    except urllib.error.HTTPError as error:
        # A non-2xx response. Still a completed HTTP exchange -- return it so
        # the caller can inspect the body (e.g. an ErrorBody `{error, code}`).
        raw = error.read().decode("utf-8") if error.fp is not None else ""
        return error.code, raw
