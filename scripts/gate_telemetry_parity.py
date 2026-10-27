#!/usr/bin/env python3
"""gate-telemetry-parity — Node<->Python telemetry contract parity.

The telemetry analog of ``gate_identifier.py --registry-parity``. The Node
package ``@izzywdev/fuzefront-telemetry`` (``packages/telemetry``) and the Python
package ``fuzefront-telemetry`` (``packages/telemetry-py``) are two
implementations of ONE observability contract (``governance/observability-
standard.md`` P41). If they drift, a trace or log line from a Python service is
no longer readable alongside one from a Node service — a Loki query can't join
on a field one language renamed, or filter a level one language renumbered, or a
secret redacted in one language leaks from the other.

This gate reads the values straight out of each language's source (it never
imports either package, so it runs with no OpenTelemetry install) and fails CI if
any of these four cross-language facts disagree:

  1. the OTLP export env var names read by both,
  2. the trace-correlation log field keys bound by both (``trace_id``/``span_id``),
  3. the log level names and numbers (the pino scale), and
  4. the shared secret-redaction path list.

Like ``gate_identifier``, the violation message names exactly what disagreed and
why it matters, so the fix is obvious. Run::

    python scripts/gate_telemetry_parity.py .

Exit 0 when the packages are in parity (or neither package is present — a repo
that hasn't adopted telemetry has nothing to check), 1 on any drift.
"""

from __future__ import annotations

import json
import os
import re
import sys

# The pino numeric level scale. The Node family logger IS pino, so its JSON
# lines carry these numbers in `level`; the Python shared logger must emit the
# identical mapping. This is the canonical constant both sides are measured
# against (pino owns it; there is no Node source file to extract it from).
CANONICAL_LOG_LEVELS = {
    "trace": 10,
    "debug": 20,
    "info": 30,
    "warn": 40,
    "error": 50,
    "fatal": 60,
}

# The request-id field is FuzeFront-local and camelCase by family convention
# (the logging skill / Node README). Both languages must bind it under this key.
CANONICAL_REQUEST_ID_FIELD = "reqId"


def _read(path: str) -> str | None:
    if not os.path.isfile(path):
        return None
    with open(path, encoding="utf-8") as f:
        return f.read()


def _strip_ts_comments(src: str) -> str:
    """Remove ``/* ... */`` and ``// ...`` comments so the gate measures CODE,
    not prose. Without this, the parity checks are vacuous: a doc comment that
    still mentions the old field/env name keeps the gate green after the actual
    emitted name was renamed — exactly the "gate that enforces nothing" failure
    FuzeFront's CLAUDE.md calls out. String/template literals are preserved so a
    ``//`` inside a URL string is not mistaken for a comment.
    """
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.DOTALL)
    out: list[str] = []
    for line in src.splitlines():
        quote: str | None = None
        i = 0
        kept: list[str] = []
        while i < len(line):
            c = line[i]
            if quote:
                kept.append(c)
                if c == "\\" and i + 1 < len(line):
                    kept.append(line[i + 1])
                    i += 2
                    continue
                if c == quote:
                    quote = None
                i += 1
                continue
            if c in ("'", '"', "`"):
                quote = c
                kept.append(c)
            elif c == "/" and i + 1 < len(line) and line[i + 1] == "/":
                break  # rest of the line is a comment
            else:
                kept.append(c)
            i += 1
        out.append("".join(kept))
    return "\n".join(out)


def _node_env_vars(node_config_ts: str) -> set[str]:
    # Only env vars actually READ (`env.OTEL_...`) in CODE — comments stripped
    # first, so an env name mentioned only in prose is never counted.
    return set(re.findall(r"env\.(OTEL_[A-Z_]+)", _strip_ts_comments(node_config_ts)))


def _node_trace_fields(node_logging_ts: str) -> set[str] | None:
    """The trace-correlation keys the Node ``withTraceContext`` ACTUALLY emits —
    the object keys of its ``logger.child({ ... })`` binding, with comments
    stripped — NOT every place the names ``trace_id``/``span_id`` appear. A
    whole-file substring search passes even after the real emitted keys are
    renamed, as long as a comment still mentions the old names; parsing the emit
    is what lets the gate catch that cross-language break. Returns ``None`` when
    the emit can't be located (reported as its own violation)."""
    code = _strip_ts_comments(node_logging_ts)
    m = re.search(r"withTraceContext\b.*?\.child\(\s*\{(.*?)\}", code, re.DOTALL)
    if not m:
        return None
    # Object keys (`name:`) inside the child binding — the emitted field names.
    return set(re.findall(r"(\w+)\s*:", m.group(1)))


def _py_tuple_strings(py_text: str, name: str) -> set[str] | None:
    """Strings inside a ``NAME: tuple[...] = ( "a", "b", )`` assignment."""
    block = re.search(rf"{name}[^=]*=\s*\((.*?)\)", py_text, re.DOTALL)
    if not block:
        return None
    return set(re.findall(r'"([^"]+)"', block.group(1)))


def _py_const_string(py_text: str, name: str) -> str | None:
    m = re.search(rf'{name}\s*:\s*str\s*=\s*"([^"]+)"', py_text)
    return m.group(1) if m else None


def _py_log_levels(py_text: str) -> dict[str, int] | None:
    block = re.search(r"LOG_LEVELS[^=]*=\s*MappingProxyType\(\s*\{(.*?)\}\s*\)", py_text, re.DOTALL)
    if not block:
        return None
    pairs = re.findall(r'"(\w+)":\s*(\d+)', block.group(1))
    return {k: int(v) for k, v in pairs}


def check_parity(root: str) -> list[str]:
    node_config = _read(os.path.join(root, "packages/telemetry/src/config.ts"))
    node_logging = _read(os.path.join(root, "packages/telemetry/src/logging.ts"))
    py_contract = _read(os.path.join(root, "packages/telemetry-py/fuzefront_telemetry/contract.py"))

    # Nothing to check if neither package is present.
    if node_config is None and py_contract is None:
        return []
    violations: list[str] = []

    if py_contract is None:
        return [
            (
                "telemetry parity — packages/telemetry-py/fuzefront_telemetry/contract.py "
                "is missing; the Python telemetry package must declare the shared contract"
            )
        ]
    if node_config is None or node_logging is None:
        return [
            (
                "telemetry parity — the Node package (packages/telemetry/src/{config,logging}.ts) "
                "is missing; cannot verify Python is in parity with it"
            )
        ]

    # 1. OTLP env var names ------------------------------------------------
    node_envs = _node_env_vars(node_config)
    py_envs = _py_tuple_strings(py_contract, "OTEL_ENV_VARS")
    if py_envs is None:
        violations.append("telemetry parity — could not locate OTEL_ENV_VARS in contract.py")
    elif node_envs != py_envs:
        for var in sorted(node_envs ^ py_envs):
            where = "Node only" if var in node_envs else "Python only"
            violations.append(
                f"telemetry parity — OTLP env var {var!r} is {where}; a service reading a "
                f"different env set exports to a different place than its peers"
            )

    # 2. Trace-correlation log field keys ---------------------------------
    # The Python TRACE_LOG_FIELDS tuple holds the *names* TRACE_ID_FIELD /
    # SPAN_ID_FIELD, so resolve those constants to their string values.
    node_fields = _node_trace_fields(node_logging)
    py_fields = {
        v
        for v in (
            _py_const_string(py_contract, "TRACE_ID_FIELD"),
            _py_const_string(py_contract, "SPAN_ID_FIELD"),
        )
        if v
    }
    if node_fields is None:
        violations.append(
            "telemetry parity — could not locate the withTraceContext logger.child({...}) "
            "binding in packages/telemetry/src/logging.ts; cannot verify the emitted "
            "trace-correlation field names, so the Node<->Python trace-field parity is unchecked"
        )
    elif node_fields != py_fields:
        for key in sorted(node_fields ^ py_fields):
            where = "Node only" if key in node_fields else "Python only"
            violations.append(
                f"telemetry parity — trace log field {key!r} is {where}; Loki<->Tempo "
                f"correlation joins on this exact key, so a rename breaks it one-way"
            )

    py_req = _py_const_string(py_contract, "REQUEST_ID_FIELD")
    if py_req != CANONICAL_REQUEST_ID_FIELD:
        violations.append(
            f"telemetry parity — REQUEST_ID_FIELD is {py_req!r}, must be "
            f"{CANONICAL_REQUEST_ID_FIELD!r} to match the Node family reqId convention"
        )

    # 3. Log level names + numbers ----------------------------------------
    py_levels = _py_log_levels(py_contract)
    if py_levels is None:
        violations.append("telemetry parity — could not locate LOG_LEVELS in contract.py")
    elif py_levels != CANONICAL_LOG_LEVELS:
        for name in sorted(set(CANONICAL_LOG_LEVELS) | set(py_levels)):
            want, got = CANONICAL_LOG_LEVELS.get(name), py_levels.get(name)
            if want != got:
                violations.append(
                    f"telemetry parity — log level {name!r}: pino={want!r} but Python={got!r}; "
                    f"a Loki query spanning both languages would sort/filter them wrong"
                )

    # 4. Shared secret-redaction list -------------------------------------
    violations += _check_redaction(root)
    return violations


def _load_paths(path: str) -> list[str] | None:
    text = _read(path)
    if text is None:
        return None
    try:
        return list(json.loads(text)["paths"])
    except (ValueError, KeyError, TypeError):
        return None


def _check_redaction(root: str) -> list[str]:
    canonical = os.path.join(root, "governance/observability-redaction-paths.json")
    bundled = os.path.join(root, "packages/telemetry-py/fuzefront_telemetry/redaction_paths.json")
    canonical_paths = _load_paths(canonical)
    bundled_paths = _load_paths(bundled)

    if canonical_paths is None:
        return [
            (
                "telemetry parity — governance/observability-redaction-paths.json is missing or "
                "malformed; it is the single family source of truth for the redaction list"
            )
        ]
    if bundled_paths is None:
        return [
            (
                "telemetry parity — packages/telemetry-py/fuzefront_telemetry/redaction_paths.json is "
                "missing or malformed; the wheel must ship a copy of the shared redaction list"
            )
        ]
    if canonical_paths != bundled_paths:
        return [
            (
                "telemetry parity — the Python package's bundled redaction_paths.json has drifted from "
                "governance/observability-redaction-paths.json (the source of truth). Re-sync it: a "
                "field redacted in one language would then leak from the other. "
                f"canonical={len(canonical_paths)} paths, bundled={len(bundled_paths)} paths"
            )
        ]
    if not canonical_paths:
        return ["telemetry parity — the shared redaction list is empty; it must redact credentials"]
    return []


def main(argv: list[str]) -> int:
    root = argv[1] if len(argv) > 1 and not argv[1].startswith("-") else "."
    violations = check_parity(root)
    if violations:
        print("gate-telemetry-parity: FAIL", file=sys.stderr)
        for v in violations:
            print(f"  - {v}", file=sys.stderr)
        return 1
    print("gate-telemetry-parity: Node<->Python telemetry contract in parity")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
