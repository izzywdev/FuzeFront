#!/usr/bin/env python3
"""gate-api-version — enforce the URL versioning standard (CLAUDE.baseline.md §4.3).

Every HTTP route a family service exposes lives under `/api/v{N}/`. This gate
FAILS when a declared route does not, and when client code hardcodes an
un-versioned `/api/...` path.

Two checks, because either alone leaves a hole:

  contracts (default)  Every path in every OpenAPI/Swagger spec in the repo must
                       match /api/v{N}/... . This is the declared surface.
  --callers            Source files must not hardcode an un-versioned `/api/...`
                       string. A server can be perfectly versioned while the UI
                       calls last year's path and 404s in production -- which is
                       exactly how this standard came to be written. Test
                       sources are excluded: asserting that an un-versioned path
                       is ABSENT is the correct regression test for this
                       standard, and flagging it would punish the fix.

Operational endpoints are exempt by nature and never counted: `/`, `/health`,
`/healthz`, `/ready`, `/readyz`, `/live`, `/livez`, `/metrics`, `/openapi.json`,
`/docs`, `/redoc`, `/favicon.ico`, and anything under `/.well-known/`. These are
infrastructure contracts (probes, scrapers, spec discovery) addressed by fixed
convention, not product API surface, and versioning them breaks the tools that
consume them.

Recorded exceptions go in an allowlist -- `governance/api-version-allowlist.txt`
or `.fuze/api-version-allowlist.txt` -- one path per line, `#` starts a comment.
An allowlist entry is debt to burn down, not approval: it keeps a repo that
predates the standard from being bricked while still failing anything NEW.

FAIL-CLOSED. Every undecidable state is a failure, never a pass:
  - PyYAML missing                     -> exit 1 (cannot read specs => cannot clear them)
  - a spec that will not parse         -> exit 1
  - a spec with no `paths` mapping     -> exit 1
  - an allowlist that will not read    -> exit 1
A repo with genuinely no HTTP surface (no specs, no `/api/` literals) has nothing
to enforce and passes.

Usage:
    gate_api_version.py [root]              # contracts  (default root = .)
    gate_api_version.py [root] --callers    # client-side hardcoded paths
Exit 0 = pass; exit 1 = violation or undecidable.
"""
from __future__ import annotations

import argparse
import ast
import json
import os
import re
import subprocess
import sys

try:
    import yaml  # type: ignore
except Exception:  # pragma: no cover - exercised via the missing-yaml path
    yaml = None

SPEC_NAME_RE = re.compile(r"(openapi|swagger).*\.(ya?ml|json)$", re.I)

# The rule. `/api/v1`, `/api/v2/...` pass; `/api/accounts`, `/apiv1/x` do not.
#
# A TEMPLATED version segment also passes: `/api/v${API_VERSION}/x`, `/api/v{N}/`.
# A caller that interpolates the version is versioned -- that is the correct way to
# write it once a service serves more than one -- and flagging it would push people
# to hardcode `v1` to get green, which is the opposite of what the standard wants.
# The template must still occupy the version segment: `/api/{resource}` does not
# match, because there the placeholder is the resource, not the version.
VERSIONED_RE = re.compile(r"^/api/v(?:[1-9][0-9]*|\$?\{[^}]+\})(/|$)")

# Anything addressed by fixed convention rather than by product contract.
#
# THE `/api/`-PREFIXED HEALTH PATHS ARE HERE ON PURPOSE, and the reason is structural
# rather than a concession. An operational probe reached from OUTSIDE the cluster has to
# go through the ingress, and the family's ingresses route `/api/*` to the backend — a
# bare `/health` is frequently not publicly reachable at all. So the black-box pollers
# use `/api/health`:
#
#   .github/workflows/prod-smoke.yml       polls <base>/api/health until 200
#   .github/workflows/prod-post-deploy.yml "waits for the Argo rollout, then black-box
#                                           polls /api/health" (360s budget)
#   frontend/src/services/api.ts           connectivity probe on module load
#   frontend/e2e/post-prod/live-smoke.spec.ts
#
# Without these entries the gate says "version it", the template obeys, and every repo
# adopting BOTH the backend starter and the family's post-deploy workflow gets a gate
# polling a path its own backend does not serve — a 360-second wait and then a failure,
# for a service that is perfectly healthy. That is a dead-trigger bug of the same shape
# as a workflow stamped `branches: [main]` into a `master` repo.
#
# This is NOT an allowlist entry. governance/api-version-allowlist.txt is explicitly
# "debt to burn down, never grow", and this debt would never be burned: health is
# operational surface, not API surface, whatever prefix the ingress forces it behind.
# Recording it as debt would be filing a permanent fact under "temporary".
EXEMPT_EXACT = {
    "/",
    "/health",
    "/healthz",
    "/ready",
    "/readyz",
    "/live",
    "/livez",
    "/metrics",
    "/openapi.json",
    "/docs",
    "/redoc",
    "/favicon.ico",
    # Reached through an `/api/*` ingress — see the note above. Operational, not API.
    "/api/health",
    "/api/healthz",
    "/api/ready",
    "/api/readyz",
    "/api/live",
    "/api/livez",
    "/api/metrics",
}
EXEMPT_PREFIXES = ("/.well-known/",)

ALLOWLIST_PATHS = [
    "governance/api-version-allowlist.txt",
    ".fuze/api-version-allowlist.txt",
]

PRUNE_DIRS = {
    ".git", "node_modules", "dist", "build", ".venv", "venv", "vendor", "__pycache__",
    "coverage", ".next", ".terraform", ".turbo", ".cache", "out", "target",
    "storybook-static", "playwright-report", "test-results",
}

CALLER_EXTS = (".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".java", ".kt", ".rb", ".cs", ".swift")

# An `/api/...` literal inside quotes or a template string. Anchored on the quote so
# that prose mentioning a path does not trip it.
# The path may open the literal (`'/api/x'`) or follow a template interpolation
# (`` `${base}/api/x` ``). The interpolated form is not a corner case: it is how
# half of the bug that motivated this standard was written, and anchoring only on
# the quote silently missed it.
CALLER_PATH_RE = re.compile(r"""(?:["'`]|\})(/api/[A-Za-z0-9_\-./{}$:]*)""")

# Whole-line comment markers across the languages scanned. A quoted path inside a
# comment is documentation -- very often a note recording the path that was just
# FIXED -- and flagging it would punish the commit that fixed the violation. This
# only skips lines that are entirely a comment; a trailing comment after code is
# still scanned, which is the safe direction to be imprecise in.
COMMENT_LINE_RE = re.compile(r"^\s*(//|#|\*|/\*|<!--|--)")

# `/api` or `/api/` with nothing after it. Not a route -- there is no resource in
# it -- so it is always either a base-URL constant or a prefix-stripping table:
#
#     for prefix in ("/api/v1/", "/api/"):     # export-openapi.py, strips prefixes
#         if slug.startswith(prefix): ...
#
# Reporting it produces a finding the author CANNOT act on. There is no way to
# make `/api/` versioned, so the only route to green is an allowlist entry for
# `/api/` -- and because the allowlist matches by path, that would then blanket-
# excuse every bare `/api/` in the repo forever, including a real one. The
# unactionable finding buys a permanent blind spot.
#
# The coverage given up is narrow and already largely covered: string
# concatenation is something this scanner cannot follow in any case, and the form
# it CAN see -- `${base}/api/accounts` -- is still caught, because that match has
# a route segment.
BARE_PREFIX_RE = re.compile(r"^/api/?$")


def python_docstring_lines(src: str, text: str) -> set:
    """Line numbers occupied by docstrings in a Python source file.

    A docstring is documentation, exactly like the `#` comments the scanner
    already skips -- and the paths that show up in one are almost always the
    standard being EXPLAINED. This gate's own module docstring is the proof: it
    says routes live under `/api/v{N}/` and warns about hardcoded `/api/...`,
    and scanning it made the gate fail its own repository. A rule that cannot
    be written down without violating itself is not enforceable.

    Skipping is line-based and covers module, class and function docstrings.
    Only the docstring's own line range is skipped -- code on the same lines is
    impossible, since a docstring is a whole statement.

    Fails OPEN to scanning: a file that will not parse is scanned in full rather
    than silently exempted. A syntax error must not become a way to hide a path.
    """
    try:
        tree = ast.parse(text)
    except SyntaxError:
        return set()

    skip = set()
    for node in ast.walk(tree):
        if not isinstance(
            node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)
        ):
            continue
        body = getattr(node, "body", None)
        if not body:
            continue
        first = body[0]
        if not isinstance(first, ast.Expr) or not isinstance(first.value, ast.Constant):
            continue
        if not isinstance(first.value.value, str):
            continue
        end = getattr(first, "end_lineno", first.lineno) or first.lineno
        skip.update(range(first.lineno, end + 1))
    return skip

# Test sources are NOT scanned by the caller check.
#
# This is not leniency, it is correctness. The single most valuable thing a test
# can say about this standard is that an un-versioned path is ABSENT -- e.g.
# `assert (await client.get("/api/accounts")).status_code == 404`, guarding the
# exact production bug that motivated the gate. Scanning tests turns that
# regression test into a gate failure, and the only ways to get green are to
# delete the assertion or to allowlist `/api/accounts` -- which would then
# silence the gate for the real callers too. Both outcomes are strictly worse
# than not scanning.
#
# The scope given up is small and deliberate: a test file is not a shipped
# client, so an un-versioned literal in one cannot 404 a user. Production
# callers -- including any helper a test imports from outside a test path --
# are still scanned. The contract check is untouched: a route declared in a spec
# is a violation no matter which file declares it.
TEST_PATH_PARTS = {"tests", "test", "__tests__", "spec", "specs", "e2e", "testdata"}

TEST_FILE_RE = re.compile(
    r"""(?xi)
    ^(?:
        test_.*\.py            # pytest / unittest   test_accounts.py
      | .*_test\.(?:py|go)     # go, and the other pytest spelling
      | .*\.(?:test|spec)\.(?:ts|tsx|js|jsx|mjs|cjs)  # jest / vitest
      | .*_spec\.rb           # rspec
      | .*Test\.(?:java|kt|cs)     # junit / kotlin / nunit
      | .*Tests\.(?:java|kt|cs)
    )$
    """
)


def is_test_source(rel: str) -> bool:
    """True when `rel` (a repo-relative path) is test code rather than a client.

    Matches on either the file name or any directory component, because the two
    conventions are not interchangeable: Go puts `foo_test.go` next to `foo.go`,
    while a JS repo puts `Foo.tsx` and `__tests__/Foo.tsx` side by side under
    names that are otherwise identical.
    """
    parts = rel.replace(os.sep, "/").split("/")
    if any(part in TEST_PATH_PARTS for part in parts[:-1]):
        return True
    return bool(TEST_FILE_RE.match(parts[-1]))


class GateError(Exception):
    """An undecidable state. Fail closed."""


def _tracked_files(root: str, patterns: list[str]) -> list[str]:
    """Tracked files only -- fast, and skips build output in a large monorepo."""
    try:
        res = subprocess.run(
            ["git", "-C", root, "ls-files", "--"] + patterns,
            capture_output=True, text=True, timeout=60,
        )
        if res.returncode == 0 and res.stdout.strip():
            files = [os.path.join(root, p) for p in res.stdout.splitlines() if p.strip()]
            return [
                f for f in files
                if not any(seg in PRUNE_DIRS for seg in f.replace("\\", "/").split("/"))
            ]
    except Exception:
        pass
    out: list[str] = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in PRUNE_DIRS]
        for fn in filenames:
            out.append(os.path.join(dirpath, fn))
    return out


def load_allowlist(root: str) -> set[str]:
    allowed: set[str] = set()
    for rel in ALLOWLIST_PATHS:
        path = os.path.join(root, rel)
        if not os.path.isfile(path):
            continue
        try:
            with open(path, "r", encoding="utf-8") as fh:
                for line in fh:
                    line = line.split("#", 1)[0].strip()
                    if line:
                        allowed.add(line)
        except OSError as exc:
            raise GateError(f"allowlist {rel} could not be read: {exc}")
    return allowed


def is_exempt(path: str) -> bool:
    return path in EXEMPT_EXACT or path.startswith(EXEMPT_PREFIXES)


def find_specs(root: str) -> list[str]:
    cands = _tracked_files(root, ["*.yaml", "*.yml", "*.json", "**/*.yaml", "**/*.yml", "**/*.json"])
    return sorted(f for f in cands if SPEC_NAME_RE.search(os.path.basename(f)))


def _load_spec(path: str) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as fh:
            text = fh.read()
    except OSError as exc:
        raise GateError(f"{path}: could not be read: {exc}")

    if path.lower().endswith(".json"):
        try:
            return json.loads(text)
        except Exception as exc:
            raise GateError(f"{path}: is not parseable JSON: {exc}")

    if yaml is None:
        raise GateError(
            "PyYAML is not installed, so YAML specs cannot be read. Failing closed "
            "rather than reporting a clean repo. Install with: pip install pyyaml"
        )
    try:
        return yaml.safe_load(text)
    except Exception as exc:
        raise GateError(f"{path}: is not parseable YAML: {exc}")


def check_contracts(root: str, allowed: set[str]) -> list[str]:
    violations: list[str] = []
    for spec_path in find_specs(root):
        doc = _load_spec(spec_path)
        if not isinstance(doc, dict):
            continue  # a yaml file merely named like a spec; not an API document
        if "openapi" not in doc and "swagger" not in doc:
            continue  # e.g. a config file called `swagger-ui.yml`
        paths = doc.get("paths")
        if paths is None:
            raise GateError(
                f"{spec_path}: declares itself an OpenAPI/Swagger document but has no "
                f"`paths` mapping. Cannot determine the exposed surface, so failing closed."
            )
        if not isinstance(paths, dict):
            raise GateError(f"{spec_path}: `paths` is not a mapping.")
        rel = os.path.relpath(spec_path, root)
        for route in sorted(paths):
            if not isinstance(route, str) or not route.startswith("/"):
                continue
            if is_exempt(route) or route in allowed:
                continue
            if not VERSIONED_RE.match(route):
                violations.append(f"{rel}: {route}")
    return violations


def check_callers(root: str, allowed: set[str]) -> list[str]:
    violations: list[str] = []
    patterns = [f"*{ext}" for ext in CALLER_EXTS] + [f"**/*{ext}" for ext in CALLER_EXTS]
    for src in sorted(_tracked_files(root, patterns)):
        if not src.endswith(CALLER_EXTS):
            continue
        try:
            with open(src, "r", encoding="utf-8", errors="replace") as fh:
                lines = fh.readlines()
        except OSError as exc:
            raise GateError(f"{src}: could not be read: {exc}")
        rel = os.path.relpath(src, root)
        if is_test_source(rel):
            continue
        docstrings = (
            python_docstring_lines(src, "".join(lines))
            if src.endswith(".py")
            else set()
        )
        for lineno, line in enumerate(lines, 1):
            if COMMENT_LINE_RE.match(line) or lineno in docstrings:
                continue
            for match in CALLER_PATH_RE.finditer(line):
                route = match.group(1)
                if is_exempt(route) or route in allowed:
                    continue
                if BARE_PREFIX_RE.match(route):
                    continue
                if not VERSIONED_RE.match(route):
                    violations.append(f"{rel}:{lineno}: {route}")
    return violations


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", nargs="?", default=".")
    parser.add_argument(
        "--callers", action="store_true",
        help="check client source for hardcoded un-versioned /api/... paths",
    )
    args = parser.parse_args(argv[1:])
    root = args.root

    try:
        allowed = load_allowlist(root)
        violations = check_callers(root, allowed) if args.callers else check_contracts(root, allowed)
    except GateError as exc:
        print(f"::error title=gate-api-version::{exc}")
        return 1

    what = "caller" if args.callers else "contract"
    if not violations:
        print(f"gate-api-version: OK ({what} check) — every route is under /api/v{{N}}/")
        return 0

    print(
        f"::error title=gate-api-version::{len(violations)} {what} path(s) are not under /api/v{{N}}/"
    )
    print()
    for v in violations:
        print(f"  {v}")
    print()
    print("Every HTTP route the family exposes lives under /api/v{N}/ "
          "(CLAUDE.baseline.md §4.3, governance/api-versioning.md).")
    print("A path that is genuinely fixed by external convention is exempt by name in the")
    print("gate. Anything else: move the route, or -- if it predates the standard and cannot")
    print("move yet -- record it in governance/api-version-allowlist.txt, one path per line,")
    print("in its own reviewed commit. The allowlist is debt to burn down, not approval.")
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
