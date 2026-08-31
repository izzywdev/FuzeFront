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
import urllib.request
from typing import Any, Tuple

HttpPost = Any  # Callable[[str, dict, float], Tuple[int, str]]


def default_http_post(url: str, payload: dict, timeout: float) -> Tuple[int, str]:
    """POST JSON `payload` to `url`; return (status_code, raw_body_text).

    Returns the HTTP status even for 4xx/5xx (via `urllib.error.HTTPError`)
    rather than raising, so callers can branch on status. Raises for genuine
    transport failures (`URLError`: connection refused, DNS failure, TLS
    error, timeout) -- those have no status code and are the caller's cue to
    fail closed.
    """
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read().decode("utf-8")
    except urllib.error.HTTPError as error:
        # A non-2xx response. Still a completed HTTP exchange -- return it so
        # the caller can inspect the body (e.g. an ErrorBody `{error, code}`).
        raw = error.read().decode("utf-8") if error.fp is not None else ""
        return error.code, raw
