#!/usr/bin/env python3
"""Gate the CODE against the FROZEN OpenAPI contract, in both directions.

THE DIRECTION IS THE WHOLE POINT. The contract is authored first and frozen; the
implementation is measured against it. This gate NEVER regenerates the spec from
code. A spec that can be regenerated from the code it governs is not a contract,
it is a mirror — it agrees with the implementation by construction and therefore
cannot detect that the implementation drifted. Every "spec-from-code" pipeline
silently converts a contract into documentation.

So both directions are failures, and they are different failures:

  MISSING      declared in the contract, not implemented. A consumer generated a
               client from the spec, called the endpoint, and got a 404.
  UNDOCUMENTED implemented, not in the contract. Surface nobody agreed to,
               nobody reviewed, and no consumer knows about — the shape most
               likely to be missing authz, because it was never designed.

AND A THIRD, which is the one that keeps this honest:

  UNRESOLVED   a mount or route the extractor could not statically resolve.

UNRESOLVED FAILS. It is tempting to skip what cannot be parsed and report on the
rest — that is exactly how a gate becomes vacuous: the routes hardest to parse
(dynamically composed, conditionally mounted) are precisely the ones most likely
to be undocumented, so skipping them biases the gate toward passing on the cases
it exists to catch. If this gate cannot see a route, it says so and fails, rather
than reporting a clean bill of health for a subset it never names.

Likewise ZERO routes discovered is a FAILURE, never a pass. A parser that finds
nothing would otherwise report "no undocumented endpoints" — technically true,
entirely worthless, and indistinguishable in CI from a service that is genuinely
conformant.

    gate_openapi_conformance.py [--repo .] [--service NAME] [--list] [--verbose]

Exit codes: 0 conformant · 1 findings · 2 usage/config error.
"""

from __future__ import annotations

import argparse
import os
import re
import sys

try:
    import yaml  # type: ignore
except ImportError:  # pragma: no cover - matches the house convention
    print("::error title=gate-openapi-conformance::PyYAML is required. `pip install pyyaml`.",
          file=sys.stderr)
    sys.exit(2)

HTTP_METHODS = ("get", "post", "put", "patch", "delete", "head", "options")

# --- static extraction -------------------------------------------------------
#
# Resolution is per-FILE and follows IMPORTS, not a global name table. An
# earlier cut mapped every exported name to a file and looked mounts up in that
# one table; it resolved nothing in four of six real services, because the
# dominant idiom here is `import listsRouter from './routes/lists'` against an
# `export default router` — a default export has no name to key on. It was also
# unsound: two files exporting the same identifier silently aliased.

_IMPORT = re.compile(
    r"""import\s+(?P<clause>[^;'"]*?)\s+from\s+['"](?P<spec>[^'"]+)['"]""", re.S)
_REQUIRE = re.compile(
    r"""(?:const|let|var)\s+(?P<clause>\{[^}]*\}|[A-Za-z_$][\w$]*)\s*="""
    r"""\s*require\s*\(\s*['"](?P<spec>[^'"]+)['"]\s*\)""")
_STR_CONST = re.compile(
    r"""(?:const|let|var)\s+(?P<name>[A-Za-z_$][\w$]*)\s*(?::[^=]+?)?=\s*['"](?P<val>[^'"]*)['"]""")
# A variable that actually holds a router/app. Restricting route extraction to
# these is what keeps `axios.get('/x')`, `http.get(...)` and `stripe.charges.get`
# out of the endpoint set — an unrestricted `<ident>.get('<path>'` matches those.
_ROUTER_VAR = re.compile(
    r"""(?:const|let|var)\s+(?P<name>[A-Za-z_$][\w$]*)\s*(?::[^=]+?)?=\s*"""
    r"""(?:express\s*\.\s*)?(?:Router|express)\s*\(""")
_ROUTE = re.compile(
    r"""(?P<obj>[A-Za-z_$][\w$]*)\s*\.\s*(?P<method>%s)\s*\(\s*['"](?P<path>[^'"]*)['"]"""
    % "|".join(HTTP_METHODS))
_USE = re.compile(r"""(?P<obj>[A-Za-z_$][\w$]*)\s*\.\s*use\s*\(""")
_DEFINED_HERE = re.compile(
    r"""(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var)"""
    r"""\s+(?P<name>[A-Za-z_$][\w$]*)""")
_IDENT = re.compile(r"""^[A-Za-z_$][\w$]*$""")
_CALL = re.compile(r"""^(?P<name>[A-Za-z_$][\w$]*)\s*\(""")

# `.use(express.json())`, `.use(cors())` and friends are middleware, not route
# mounts. Without this they read as unresolvable routers and fail for no reason.
_NOT_A_ROUTER = {
    "express", "cors", "helmet", "morgan", "compression", "cookieParser",
    "bodyParser", "rateLimit", "slowDown", "session", "passport", "csurf",
    "serveStatic", "favicon", "responseTime", "timeout", "multer", "pinoHttp",
    "swaggerUi", "requestId", "errorHandler", "notFoundHandler",
}


def _split_args(text: str, open_paren: int) -> tuple[list[str], int]:
    """Split a call's arguments at the top level, honouring nesting and strings.

    A regex cannot do this. `app.use(API_BASE, guard, createInvoicesRouter({ s }))`
    is real code in billing-service, and so is a `.use(` spanning five lines.
    Returns ([], -1) for an unterminated call.
    """
    depth, i, n = 0, open_paren, len(text)
    args: list[str] = []
    start, quote = open_paren + 1, None
    while i < n:
        c = text[i]
        if quote:
            if c == "\\":
                i += 2
                continue
            if c == quote:
                quote = None
        elif c in "'\"`":
            quote = c
        elif c in "([{":
            depth += 1
        elif c in ")]}":
            depth -= 1
            if depth == 0:
                args.append(text[start:i])
                return [a.strip() for a in args if a.strip()], i
        elif c == "," and depth == 1:
            args.append(text[start:i])
            start = i + 1
        i += 1
    return [], -1


def _clause_names(clause: str) -> list[tuple[str, bool]]:
    """(local_name, is_default) for an import clause. `a as b` binds b."""
    out: list[tuple[str, bool]] = []
    clause = clause.strip()
    brace = clause.find("{")
    default_part = clause[:brace] if brace >= 0 else clause
    named_part = clause[brace + 1:clause.rfind("}")] if brace >= 0 else ""
    for piece in default_part.split(","):
        piece = piece.strip().rstrip(",").strip()
        if piece and not piece.startswith("*") and _IDENT.match(piece):
            out.append((piece, True))
    for piece in named_part.split(","):
        piece = piece.strip()
        if not piece:
            continue
        if " as " in piece:
            piece = piece.split(" as ")[-1].strip()
        if _IDENT.match(piece):
            out.append((piece, False))
    return out


class Extractor:
    """Resolve an Express app's mounted route table from source, statically."""

    def __init__(self, src_root: str, middleware: set[str] | None = None):
        self.root = src_root
        self.middleware = _NOT_A_ROUTER | (middleware or set())
        self.text: dict[str, str] = {}
        for f in _source_files(src_root):
            with open(f, encoding="utf-8", errors="replace") as fh:
                self.text[f] = fh.read()
        self.unresolved: list[str] = []
        self._memo: dict[tuple[str, str | None], set[tuple[str, str]]] = {}

    # -- per-file indices ----------------------------------------------------
    def _imports(self, f: str) -> dict[str, str | None]:
        """local name -> resolved file, or None when the module is external."""
        out: dict[str, str | None] = {}
        body = self.text[f]
        for m in list(_IMPORT.finditer(body)) + list(_REQUIRE.finditer(body)):
            spec = m.group("spec")
            target = self._resolve_spec(f, spec)
            for name, _is_default in _clause_names(m.group("clause")):
                out[name] = target
        return out

    def _resolve_spec(self, f: str, spec: str) -> str | None:
        if not spec.startswith("."):
            return None  # external package; not ours to walk into
        base = os.path.normpath(os.path.join(os.path.dirname(f), spec))
        for cand in (base + ".ts", base + ".js", base + ".mjs",
                     os.path.join(base, "index.ts"), os.path.join(base, "index.js")):
            if cand in self.text:
                return cand
        return None

    def _router_vars(self, f: str) -> set[str]:
        names = {m.group("name") for m in _ROUTER_VAR.finditer(self.text[f])}
        # `app`/`router` are so conventional that a factory taking one as a
        # parameter (`function mount(router: Router)`) is still recognisable.
        for conventional in ("app", "router"):
            if re.search(r"\b%s\s*\.\s*(?:use|%s)\s*\(" % (conventional, "|".join(HTTP_METHODS)),
                         self.text[f]):
                names.add(conventional)
        return names

    def _string_of(self, f: str, name: str, depth: int = 0) -> str | None:
        """Resolve an identifier to a string literal, following named imports."""
        if depth > 4:
            return None
        for m in _STR_CONST.finditer(self.text[f]):
            if m.group("name") == name:
                return m.group("val")
        target = self._imports(f).get(name)
        if target:
            return self._string_of(target, name, depth + 1)
        return None

    # -- the walk ------------------------------------------------------------
    def routes(self, f: str, var: str | None = None,
               seen: frozenset | None = None) -> set[tuple[str, str]]:
        """Routes reachable from file `f` (optionally only via router `var`).

        `var=None` means "every router this file defines". That is a deliberate
        over-approximation for factory modules: we do not track which router a
        `createXRouter()` returns, so a file defining two factories contributes
        both. Over-approximating is the safe direction — it can produce a
        spurious UNDOCUMENTED, which a human then reads; under-approximating
        would hide a real one, which nobody ever sees.
        """
        key = (f, var)
        seen = seen or frozenset()
        if key in seen:
            return set()          # import cycle; the other frame covers it
        if key in self._memo:
            return self._memo[key]
        seen = seen | {key}

        body = self.text[f]
        router_vars = self._router_vars(f)
        targets = {var} if var else router_vars
        out: set[tuple[str, str]] = set()

        for m in _ROUTE.finditer(body):
            if m.group("obj") in targets:
                out.add((m.group("method").upper(), m.group("path")))

        for m in _USE.finditer(body):
            if m.group("obj") not in targets:
                continue
            args, _end = _split_args(body, m.end() - 1)
            if not args:
                continue
            out |= self._mount(f, args, seen)

        self._memo[key] = out
        return out

    def _mount(self, f: str, args: list[str], seen: frozenset) -> set[tuple[str, str]]:
        prefix = ""
        rest = args
        head = args[0]
        if head[:1] in ("'", '"') and len(head) >= 2:
            prefix, rest = head[1:-1], args[1:]
        elif _IDENT.match(head):
            resolved = self._string_of(f, head)
            if resolved is not None and resolved.startswith("/"):
                prefix, rest = resolved, args[1:]
            elif resolved is not None:
                return set()  # a string, but not a path — not a mount
        elif head.startswith("`"):
            # A template-literal prefix: the mount point is not statically known,
            # so every path under it would be wrong. Say so instead of guessing.
            self.unresolved.append(
                f"{self._rel(f)}: mount prefix `{head[:40]}` is a template literal "
                f"and cannot be resolved statically")
            return set()

        # Express convention mounts the router last; everything before it is
        # middleware (`app.use(API_BASE, guard, createPlansRouter(deps))`).
        ref = None
        for arg in reversed(rest):
            call = _CALL.match(arg)
            if call:
                ref = call.group("name")
                break
            if _IDENT.match(arg):
                ref = arg
                break
            if arg.startswith(("express.", "swaggerUi.")) or "=>" in arg:
                continue
        if ref is None or ref in self.middleware:
            return set()

        sub = self._resolve_ref(f, ref, seen)
        if sub is None:
            self.unresolved.append(
                f"{self._rel(f)}: mount '{prefix or '/'}' -> '{ref}' could not be "
                f"resolved to a router definition")
            return set()
        return {(method, _join(prefix, path)) for method, path in sub}

    def _resolve_ref(self, f: str, ref: str, seen: frozenset):
        if ref in self._router_vars(f):
            return self.routes(f, ref, seen)
        imports = self._imports(f)
        if ref in imports:
            target = imports[ref]
            if target is None:
                return None       # comes from an external package: unknowable
            return self.routes(target, None, seen)
        if any(m.group("name") == ref for m in _DEFINED_HERE.finditer(self.text[f])):
            return self.routes(f, None, seen)
        return None

    def _rel(self, f: str) -> str:
        return os.path.relpath(f, self.root)

    def entrypoints(self) -> list[str]:
        """Files that construct the Express app. Everything hangs off these."""
        # `const app = express()` and `() => express()` are both entrypoints;
        # `express.Router()` is not, hence the guard on the preceding character.
        return sorted(f for f, body in self.text.items()
                      if re.search(r"(?<![.\w])express\s*\(\s*\)", body))


def _join(prefix: str, path: str) -> str:
    return normalise((prefix.rstrip("/") + "/" + path.lstrip("/")))


def normalise(path: str) -> str:
    """`/v1/x/:id` and `/v1/x/{id}` are the same endpoint. Compare shapes, not names.

    Parameter NAMES deliberately do not participate: the spec calling it
    `{listId}` while the code calls it `:id` is a documentation nit, not a
    contract violation, and failing on it would train people to ignore this gate.
    """
    path = re.sub(r":([A-Za-z_][\w]*)", "{}", path)
    path = re.sub(r"\{[^}]*\}", "{}", path)
    path = re.sub(r"/+", "/", path)
    if len(path) > 1:
        path = path.rstrip("/")
    return path or "/"


def spec_base(doc: dict) -> str:
    """The path component of `servers[0].url`, with `{vars}` expanded.

    OpenAPI `paths` are relative to the server URL, so this is the frame the
    contract is written in. Ignoring it made the gate report every billing and
    payment endpoint as BOTH missing and undocumented — 26 findings that were
    one prefix, and the exact shape of a gate people learn to ignore.
    """
    servers = doc.get("servers") or []
    if not servers or not isinstance(servers[0], dict):
        return ""
    url = str(servers[0].get("url") or "")
    for var, spec in (servers[0].get("variables") or {}).items():
        if isinstance(spec, dict) and "default" in spec:
            url = url.replace("{%s}" % var, str(spec["default"]))
    url = re.sub(r"^[a-zA-Z][\w+.-]*://[^/]*", "", url)   # drop scheme + authority
    url = re.sub(r"\{[^}]*\}", "", url)                   # any var left is unknowable
    url = "/" + url.strip("/")
    return "" if url == "/" else url


def rebase(code: set[tuple[str, str]], base: str) -> tuple[set[tuple[str, str]], bool]:
    """Strip the server base from the code side, but ONLY if every route has it.

    Both mounting styles are live here and both are conformant with the same
    contract: billing-service mounts its own public base (`API_BASE =
    '/api/v1/billing'`), while config-service mounts bare paths and lets the
    ingress rewrite `/api/config`. What the contract fixes is the path RELATIVE
    to the server base — which is precisely what `paths` means — so normalising
    to that frame is reading OpenAPI correctly, not papering over a difference.

    The `all()` is what stops it becoming a fudge: strip only when the base is
    uniformly present. A service where only SOME routes carry it has a genuine
    mismatch, and it stays visible as findings.
    """
    if not base or not code:
        return code, False
    if not all(p == base or p.startswith(base + "/") for _m, p in code):
        return code, False
    return {(m, normalise(p[len(base):] or "/")) for m, p in code}, True


def spec_endpoints(spec_path: str) -> set[tuple[str, str]]:
    with open(spec_path, encoding="utf-8") as fh:
        doc = yaml.safe_load(fh) or {}
    out: set[tuple[str, str]] = set()
    for raw, ops in (doc.get("paths") or {}).items():
        if not isinstance(ops, dict):
            continue
        for method in ops:
            if method.lower() in HTTP_METHODS:
                out.add((method.upper(), normalise(raw)))
    return out


def _source_files(root: str) -> list[str]:
    found = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames
                       if d not in ("node_modules", "dist", "build", "__tests__",
                                    "coverage", "migrations")]
        for name in filenames:
            if name.endswith((".ts", ".js", ".mjs")) and not name.endswith(
                    (".d.ts", ".test.ts", ".spec.ts", ".test.js", ".spec.js")):
                found.append(os.path.join(dirpath, name))
    return sorted(found)


def code_endpoints(src_root: str,
                   middleware: set[str] | None = None) -> tuple[set[tuple[str, str]], list[str]]:
    """Return (endpoints, unresolved). `unresolved` is never silently dropped."""
    ex = Extractor(src_root, middleware or set())
    entries = ex.entrypoints()
    if not entries:
        return set(), ["no file constructs an Express app (`= express()`); "
                       "the route table has no root to walk from"]
    endpoints: set[tuple[str, str]] = set()
    for entry in entries:
        endpoints |= {(m, normalise(p)) for m, p in ex.routes(entry, None)}
    return endpoints, sorted(set(ex.unresolved))


def load_allowlist(repo: str) -> tuple[set[tuple[str, str]], set[str]]:
    """Deliberate exceptions. Returns (endpoints, middleware-names).

      METHOD /path      an endpoint deliberately outside the contract
      middleware NAME   an identifier that is middleware, not a router

    The second form exists because `app.use(API_BASE, graphCreate({...}))` mounts
    middleware imported from an external package, which no static reader can
    distinguish from a router it simply cannot see. Rather than guess — guessing
    "probably middleware" is how a gate stops catching the thing it exists for —
    the operator ASSERTS it, in a file that shows up in the diff.
    """
    out: set[tuple[str, str]] = set()
    middleware: set[str] = set()
    for candidate in ("governance/openapi-conformance-allowlist.txt",
                      ".fuze/openapi-conformance-allowlist.txt"):
        p = os.path.join(repo, candidate)
        if not os.path.isfile(p):
            continue
        with open(p, encoding="utf-8") as fh:
            for line in fh:
                line = line.split("#", 1)[0].strip()
                if not line:
                    continue
                parts = line.split(None, 1)
                if len(parts) != 2:
                    continue
                if parts[0].lower() == "middleware":
                    middleware.add(parts[1].strip())
                else:
                    out.add((parts[0].upper(), normalise(parts[1])))
    return out, middleware


def discover(repo: str) -> tuple[list[tuple[str, str, str]], list[tuple[str, str]]]:
    """((name, spec, src) with a contract, (name, src) with sources but none).

    The second list is the hole an earlier cut left open: `discover` returned
    only services that HAD a spec, so a service with no contract at all — the
    maximally undocumented case — was not a finding, it was invisible. A gate
    that checks only the things already being checked is the vacuity pattern
    this whole file is written against.
    """
    contracted: list[tuple[str, str, str]] = []
    uncontracted: list[tuple[str, str]] = []
    base = os.path.join(repo, "services")
    if os.path.isdir(base):
        for name in sorted(os.listdir(base)):
            src = os.path.join(base, name, "src")
            if not os.path.isdir(src):
                continue
            for spec_name in ("openapi.yaml", "openapi.yml",
                              os.path.join("contracts", "openapi.yaml")):
                spec = os.path.join(base, name, spec_name)
                if os.path.isfile(spec):
                    contracted.append((name, spec, src))
                    break
            else:
                uncontracted.append((name, src))
    return contracted, uncontracted


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default=".")
    ap.add_argument("--service", help="check only this service")
    ap.add_argument("--list", action="store_true", help="list discovered services and exit")
    ap.add_argument("--verbose", action="store_true", help="print the extracted route table")
    args = ap.parse_args()
    repo = os.path.abspath(args.repo)

    services, uncontracted = discover(repo)
    if args.service:
        services = [s for s in services if s[0] == args.service]
        uncontracted = [u for u in uncontracted if u[0] == args.service]
    if args.list:
        for name, spec, src in services:
            print(f"{name}\t{os.path.relpath(spec, repo)}\t{os.path.relpath(src, repo)}")
        for name, src in uncontracted:
            print(f"{name}\t(no contract)\t{os.path.relpath(src, repo)}")
        return 0

    if not services and not uncontracted:
        print("::error title=gate-openapi-conformance::No service pairs a spec with sources. "
              "This gate found NOTHING to check, which is a configuration failure, not a pass.",
              file=sys.stderr)
        return 2

    allow, middleware = load_allowlist(repo)
    failures = 0

    for name, spec, src in services:
        with open(spec, encoding="utf-8") as fh:
            base = spec_base(yaml.safe_load(fh) or {})
        want = spec_endpoints(spec)
        raw, unresolved = code_endpoints(src, middleware)

        # Allowlisted routes are removed BEFORE the rebase decision. They are
        # precisely the ones that sit outside the server base — `GET /health` is
        # a kubelet probe, not a contract endpoint — so leaving them in made the
        # uniformity test fail and suppressed rebasing for every service that
        # has one, which is all of them. Subtracting again afterwards lets an
        # entry be written in either frame.
        have = raw - allow
        have, rebased = rebase(have, base)
        have -= allow

        if args.verbose:
            for method, path in sorted(have):
                print(f"  [{name}] code: {method} {path}")

        if not raw and not unresolved:
            print(f"::error title={name}::extracted ZERO routes from {os.path.relpath(src, repo)}. "
                  f"A gate that finds no routes cannot report 'no undocumented endpoints' — "
                  f"treating this as a failure rather than a pass.", file=sys.stderr)
            failures += 1
            continue

        missing = sorted(want - have - allow)
        undocumented = sorted(have - want - allow)

        for method, path in missing:
            print(f"::error title={name} MISSING::{method} {path} is declared in "
                  f"{os.path.relpath(spec, repo)} but no route implements it. A client generated "
                  f"from this contract would get a 404.", file=sys.stderr)
        for method, path in undocumented:
            print(f"::error title={name} UNDOCUMENTED::{method} {path} is implemented but absent "
                  f"from {os.path.relpath(spec, repo)}. Surface that was never designed or "
                  f"reviewed — add it to the contract, or to the allowlist if it is deliberately "
                  f"outside it.", file=sys.stderr)
        for note in unresolved:
            print(f"::error title={name} UNRESOLVED::{note}. Coverage here is UNKNOWN, so this "
                  f"fails rather than reporting on the subset it could parse.", file=sys.stderr)

        n = len(missing) + len(undocumented) + len(unresolved)
        failures += n
        status = "OK" if n == 0 else f"{n} finding(s)"
        frame = f" (rebased off server base {base})" if rebased else ""
        print(f"{name}: spec={len(want)} code={len(have)}{frame} -> {status}")

    # A service with no spec is not exempt — it is the extreme case. It fails the
    # moment it exposes anything beyond the allowlist, so a stub serving only
    # `GET /health` stays quiet while the first real endpoint added without a
    # contract reds CI. That is the point at which a contract is cheap to write.
    for name, src in uncontracted:
        raw, unresolved = code_endpoints(src, middleware)
        exposed = sorted(raw - allow)
        for method, path in exposed:
            print(f"::error title={name} NO CONTRACT::{method} {path} is served by a service with "
                  f"no openapi.yaml at all. There is nothing for it to conform TO — write the "
                  f"contract first, then implement against it.", file=sys.stderr)
        for note in unresolved:
            print(f"::error title={name} UNRESOLVED::{note}, and the service has no contract "
                  f"either, so nothing bounds what it serves.", file=sys.stderr)
        n = len(exposed) + len(unresolved)
        failures += n
        print(f"{name}: NO CONTRACT, {len(raw)} route(s) extracted -> "
              f"{'OK (all allowlisted)' if n == 0 else f'{n} finding(s)'}")

    if failures:
        print(f"::error title=gate-openapi-conformance::{failures} conformance finding(s). "
              f"The contract is frozen: fix the CODE to match it, or change the contract "
              f"deliberately — never regenerate the spec from the code.", file=sys.stderr)
        return 1

    print(f"gate-openapi-conformance: {len(services)} contracted service(s) conformant, "
          f"{len(uncontracted)} uncontracted service(s) exposing nothing beyond the allowlist.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
