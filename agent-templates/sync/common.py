"""Minimal REST client for the Claude Managed Agents API.

Uses only the Python standard library so `sync/` needs no third-party runtime
dependency (jsonschema is optional and only used for validation). The official
`anthropic` SDK is a fine alternative; we go raw here so the exact documented
endpoints and beta header are visible and pinnable.
"""
import json
import os
import urllib.error
import urllib.parse
import urllib.request

API_BASE = os.environ.get("ANTHROPIC_BASE_URL", "https://api.anthropic.com").rstrip("/")
ANTHROPIC_VERSION = "2023-06-01"
MANAGED_AGENTS_BETA = "managed-agents-2026-04-01"
# Memory-store endpoints use a DIFFERENT beta header and must NOT also send the
# managed-agents one (sending both is a 400). Session endpoints — including
# attaching a memory store to a session — keep the managed-agents header.
MEMORY_BETA = "agent-memory-2026-07-22"


def state_dir():
    """Where sync scripts read/write id state. Override with FUZE_STATE_DIR so the
    containerized handoff server can mount it as a volume."""
    return os.environ.get("FUZE_STATE_DIR") or os.path.join(os.path.dirname(os.path.abspath(__file__)), ".state")


def _api_key():
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        raise SystemExit("ANTHROPIC_API_KEY is not set")
    return key


def headers(accept="application/json", beta=MANAGED_AGENTS_BETA):
    return {
        "x-api-key": _api_key(),
        "anthropic-version": ANTHROPIC_VERSION,
        "anthropic-beta": beta,
        "content-type": "application/json",
        "accept": accept,
    }


def request(method, path, body=None, query=None, beta=MANAGED_AGENTS_BETA):
    """JSON request/response against the API. Raises SystemExit on HTTP error."""
    url = API_BASE + path
    if query:
        url += "?" + urllib.parse.urlencode(query)
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers(beta=beta), method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read().decode()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")
        raise SystemExit(f"{method} {path} -> HTTP {e.code}: {detail}")


def list_all(path, key="data", beta=MANAGED_AGENTS_BETA):
    """Fetch every page of a list endpoint (cursor pagination)."""
    items, query = [], {}
    while True:
        page = request("GET", path, query=query or None, beta=beta)
        items.extend(page.get(key, []))
        if not page.get("has_more"):
            return items
        cursor = page.get("last_id") or page.get("next_cursor")
        if not cursor:
            return items
        query = {"after_id": cursor}


def expand_env(obj):
    """Recursively expand ${VAR} in string values from the process environment."""
    if isinstance(obj, str):
        return os.path.expandvars(obj)
    if isinstance(obj, list):
        return [expand_env(x) for x in obj]
    if isinstance(obj, dict):
        return {k: expand_env(v) for k, v in obj.items()}
    return obj
