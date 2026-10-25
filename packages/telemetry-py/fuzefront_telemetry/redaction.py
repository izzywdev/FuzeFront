"""fuzefront-telemetry — secret redaction from the family-shared path list.

The redaction path list is NOT hand-copied into Python. It is loaded from the
single family source of truth, ``governance/observability-redaction-paths.json``,
so a field redacted in a Node service is redacted in a Python one too
(observability-standard.md P24). The wheel ships a byte-identical copy
(``redaction_paths.json`` beside this module) so an installed package is
self-contained; ``scripts/gate_telemetry_parity.py`` fails CI if the two drift.

Node applies these paths as pino ``redact.paths``. Python redacts any object key
whose name matches a path's leaf segment (``*.password`` / ``password`` ->
``password``; ``req.headers.authorization`` -> ``authorization``) at any depth —
a superset-safe reading of the same list: the same logical fields never reach a
log line, in either language.
"""

from __future__ import annotations

import json
import os
from functools import lru_cache
from typing import Any

REDACTED = "[Redacted]"

_BUNDLED_COPY = os.path.join(os.path.dirname(__file__), "redaction_paths.json")
_GOVERNANCE_RELATIVE = os.path.join("governance", "observability-redaction-paths.json")


def _find_governance_source() -> str | None:
    """Walk up from this module looking for the in-repo shared source, so that
    in a repo/CI checkout Python reads the very same JSON file Node reads. In an
    installed wheel there is no ``governance/`` tree, so this returns ``None`` and
    the bundled copy is used instead.
    """
    here = os.path.dirname(os.path.abspath(__file__))
    cur = here
    while True:
        candidate = os.path.join(cur, _GOVERNANCE_RELATIVE)
        if os.path.isfile(candidate):
            return candidate
        parent = os.path.dirname(cur)
        if parent == cur:
            return None
        cur = parent


@lru_cache(maxsize=1)
def _load() -> tuple[tuple[str, ...], str]:
    source = _find_governance_source() or _BUNDLED_COPY
    with open(source, encoding="utf-8") as f:
        data = json.load(f)
    paths = tuple(data["paths"])
    return paths, source


def redaction_paths() -> tuple[str, ...]:
    """The shared redaction path list, pino-style, identical to the Node list."""
    return _load()[0]


def redaction_source() -> str:
    """Absolute path of the JSON file the list was actually loaded from."""
    return _load()[1]


@lru_cache(maxsize=1)
def _redacted_keys() -> frozenset[str]:
    """Leaf key names to redact anywhere in a payload, derived from the paths.

    ``*.password`` and ``password`` both reduce to ``password``;
    ``req.headers.authorization`` reduces to ``authorization``;
    ``res.headers["set-cookie"]`` reduces to ``set-cookie``. Matching is
    case-insensitive because header keys arrive in mixed case.
    """
    keys: set[str] = set()
    for path in redaction_paths():
        leaf = path.replace('"', "").replace("]", "")
        for sep in (".", "["):
            if sep in leaf:
                leaf = leaf.rsplit(sep, 1)[-1]
        leaf = leaf.strip()
        if leaf and leaf != "*":
            keys.add(leaf.lower())
    return frozenset(keys)


def redact(value: Any) -> Any:
    """Return a deep copy of ``value`` with every matching key's value replaced
    by ``[Redacted]``. Non-container values pass through unchanged. Never
    mutates the input.
    """
    keys = _redacted_keys()
    return _redact(value, keys)


def _redact(value: Any, keys: frozenset[str]) -> Any:
    if isinstance(value, dict):
        out: dict[Any, Any] = {}
        for k, v in value.items():
            if isinstance(k, str) and k.lower() in keys:
                out[k] = REDACTED
            else:
                out[k] = _redact(v, keys)
        return out
    if isinstance(value, (list, tuple)):
        rebuilt = [_redact(v, keys) for v in value]
        return type(value)(rebuilt) if isinstance(value, tuple) else rebuilt
    return value


__all__ = ["REDACTED", "redact", "redaction_paths", "redaction_source"]
