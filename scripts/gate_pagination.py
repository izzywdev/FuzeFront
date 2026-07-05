#!/usr/bin/env python3
"""gate-pagination — enforce the canonical pagination standard (CLAUDE.baseline.md §4.1).

Inspects OpenAPI/Swagger contract(s) in the repo and FAILS when a collection GET
(an unbounded LIST endpoint) lacks pagination, unless it is annotated exempt.

A collection GET must declare:
  - request params: `limit` AND (`cursor` OR `offset`)
  - a paginated response envelope: a 2xx JSON schema with an `items` array and a `page` object
Exemption: the operation carries `x-pagination: exempt`, OR the route is listed in the
allowlist (governance/pagination-allowlist.txt or .fuze/pagination-allowlist.txt),
one `METHOD /path` per line.

Heuristic for "collection GET": method == get, path does NOT end in a path param
(`/{id}`), AND the operationId/path/summary look list-like (plural noun, "list",
"search", "/items", etc.) OR the 2xx response is an array. Singletons / scalars /
bounded lookups are treated as non-collection and skipped (and may also be marked
exempt explicitly to silence a false positive).

Usage: gate_pagination.py [root]      (default root = .)
Exit 0 = pass / no contracts found (report-only-friendly); exit 1 = hard violation.
Requires PyYAML (pip install pyyaml). JSON specs work with no extra deps.
"""
from __future__ import annotations
import json
import os
import re
import sys

try:
    import yaml  # type: ignore
except Exception:  # pragma: no cover
    yaml = None

SPEC_NAME_RE = re.compile(r"(openapi|swagger).*\.(ya?ml|json)$", re.I)
ALLOWLIST_PATHS = [
    "governance/pagination-allowlist.txt",
    ".fuze/pagination-allowlist.txt",
]
LIST_HINT_RE = re.compile(r"(list|search|index|all|feed|collection|query)", re.I)
# plural-ish: path segment ends with 's' and is not a {param}
PLURAL_SEG_RE = re.compile(r"/[a-z0-9_-]+s(/|$)", re.I)
PATH_PARAM_TAIL_RE = re.compile(r"\{[^}]+\}/?$")


PRUNE_DIRS = {
    ".git", "node_modules", "dist", "build", ".venv", "venv", "vendor", "__pycache__",
    "coverage", ".next", ".terraform", ".turbo", ".cache", "out", "target",
    "storybook-static", "playwright-report", "test-results",
}


def _candidate_files(root: str) -> list[str]:
    """Enumerate yaml/yml/json candidates. Prefer `git ls-files` (tracked files only — fast,
    skips all build/untracked noise in a large monorepo); fall back to a pruned os.walk."""
    import subprocess
    try:
        res = subprocess.run(
            ["git", "-C", root, "ls-files", "--",
             "*.yaml", "*.yml", "*.json", "**/*.yaml", "**/*.yml", "**/*.json"],
            capture_output=True, text=True, timeout=60,
        )
        if res.returncode == 0 and res.stdout.strip():
            files = [os.path.join(root, p) for p in res.stdout.splitlines() if p.strip()]
            # still drop anything under a prune dir (e.g. tracked dist/)
            return [
                f for f in files
                if not any(seg in PRUNE_DIRS for seg in f.replace("\\", "/").split("/"))
            ]
    except Exception:
        pass
    out = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [
            d for d in dirnames
            if d not in PRUNE_DIRS
            and not d.startswith(("playwright-report", "test-results", ".terraform"))
        ]
        for fn in filenames:
            if fn.endswith((".yaml", ".yml", ".json")):
                out.append(os.path.join(dirpath, fn))
    return out


def find_specs(root: str) -> list[str]:
    out = []
    for p in _candidate_files(root):
        fn = os.path.basename(p)
        if SPEC_NAME_RE.search(fn) or fn in ("openapi.yaml", "openapi.yml", "openapi.json"):
            out.append(p)
            continue
        try:
            with open(p, "r", encoding="utf-8", errors="ignore") as f:
                head = f.read(400)
            if re.search(r'["\']?(openapi|swagger)["\']?\s*:', head):
                out.append(p)
        except OSError:
            pass
    return sorted(set(out))


def load_spec(path: str):
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        text = f.read()
    if path.endswith(".json"):
        return json.loads(text)
    if yaml is None:
        # last-resort: try json (some .yaml are actually json)
        return json.loads(text)
    return yaml.safe_load(text)


def load_allowlist(root: str) -> set[str]:
    allow = set()
    for rel in ALLOWLIST_PATHS:
        p = os.path.join(root, rel)
        if os.path.isfile(p):
            with open(p, "r", encoding="utf-8", errors="ignore") as f:
                for line in f:
                    line = line.split("#", 1)[0].strip()
                    if line:
                        allow.add(line.lower())
    return allow


def _schema_is_array(schema: dict) -> bool:
    if not isinstance(schema, dict):
        return False
    if schema.get("type") == "array":
        return True
    # allOf/oneOf/anyOf
    for k in ("allOf", "oneOf", "anyOf"):
        for sub in schema.get(k, []) or []:
            if isinstance(sub, dict) and sub.get("type") == "array":
                return True
    return False


def _resp_2xx_schema(op: dict) -> dict | None:
    resps = op.get("responses", {}) or {}
    for code, body in resps.items():
        if str(code).startswith("2"):
            content = (body or {}).get("content", {}) or {}
            for _, media in content.items():
                if isinstance(media, dict) and "schema" in media:
                    return media["schema"]
    return None


def _has_envelope(schema: dict) -> bool:
    """A {items:[], page:{}} envelope (resolved or inline)."""
    if not isinstance(schema, dict):
        return False
    props = schema.get("properties", {}) or {}
    has_items = "items" in props and _schema_is_array(props.get("items", {}))
    has_page = "page" in props
    if has_items and has_page:
        return True
    # composed envelope
    for k in ("allOf", "oneOf", "anyOf"):
        for sub in schema.get(k, []) or []:
            if _has_envelope(sub):
                return True
    return False


def _param_names(op: dict, path_item: dict) -> set[str]:
    names = set()
    for p in (path_item.get("parameters", []) or []) + (op.get("parameters", []) or []):
        if isinstance(p, dict) and p.get("in") in (None, "query"):
            n = p.get("name")
            if n:
                names.add(n)
    return {n.lower() for n in names}


def is_collection_get(path: str, op: dict, resp_schema: dict | None) -> bool:
    if PATH_PARAM_TAIL_RE.search(path):
        return False  # /x/{id} singleton
    opid = (op.get("operationId") or "").lower()
    summary = (op.get("summary") or "").lower()
    if _schema_is_array(resp_schema or {}):
        return True
    if _has_envelope(resp_schema or {}):
        return True
    if LIST_HINT_RE.search(opid) or LIST_HINT_RE.search(summary):
        return True
    if PLURAL_SEG_RE.search(path):
        return True
    return False


def check_spec(path: str, allow: set[str]) -> list[str]:
    violations = []
    try:
        spec = load_spec(path)
    except Exception as e:  # malformed yaml/json — report-only skip, don't crash the gate
        print(f"::warning title=gate-pagination::could not parse {path}: {e}")
        return []
    if not isinstance(spec, dict):
        return []
    paths = spec.get("paths", {}) or {}
    for route, path_item in paths.items():
        if not isinstance(path_item, dict):
            continue
        op = path_item.get("get")
        if not isinstance(op, dict):
            continue
        # explicit exemption
        if str(op.get("x-pagination", "")).lower() == "exempt":
            continue
        if f"get {route}".lower() in allow:
            continue
        resp_schema = _resp_2xx_schema(op)
        if not is_collection_get(route, op, resp_schema):
            continue
        params = _param_names(op, path_item)
        has_limit = "limit" in params
        has_walk = "cursor" in params or "offset" in params
        has_env = _has_envelope(resp_schema or {})
        missing = []
        if not has_limit:
            missing.append("`limit`")
        if not has_walk:
            missing.append("`cursor` or `offset`")
        if not has_env:
            missing.append("`{items, page}` response envelope")
        if missing:
            violations.append(
                f"{os.path.relpath(path)} :: GET {route} — unbounded collection missing "
                f"{', '.join(missing)} (add them per pagination standard, or annotate "
                f"`x-pagination: exempt` if bounded/singleton)"
            )
    return violations


def main() -> int:
    root = sys.argv[1] if len(sys.argv) > 1 else "."
    specs = find_specs(root)
    if not specs:
        print("gate-pagination: no OpenAPI/Swagger contract found — nothing to check (pass)")
        return 0
    allow = load_allowlist(root)
    all_v: list[str] = []
    for s in specs:
        all_v.extend(check_spec(s, allow))
    if all_v:
        print("::error title=gate-pagination::unbounded collection endpoint(s) lack pagination")
        for v in all_v:
            print(f"  - {v}")
        print(
            f"\ngate-pagination FAILED: {len(all_v)} endpoint(s) violate the pagination standard "
            "(CLAUDE.baseline.md §4.1)."
        )
        return 1
    print(f"gate-pagination: checked {len(specs)} spec(s) — all collection GETs paginate or are exempt. OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
