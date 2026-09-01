#!/usr/bin/env python3
"""gate-openapi-conformance — the routes a service SERVES must match the spec it PUBLISHES.

Nothing in this family checked this. What existed was adjacent and weaker, and
the gap between the two is the whole point:

  FuzeService contract-lint.yml  spec <-> GENERATED CLIENT. Regenerating the
                                 client from the spec proves the codegen works,
                                 not that any handler exists. It is also
                                 report-only, and its Spectral step ends in a
                                 literal `exit 0`.
  FuzeFront check-mcp-spec-drift spec <-> CHART COPY. Proves two files are
                                 identical. Says nothing about the code.

Both compare a document to another document. Neither ever looks at a route.
So an endpoint can be deleted, renamed, or added with no signal anywhere: the
spec keeps describing a surface that is gone, consumers generate clients for
operations that 404, and the MCP tool surface — which is PROJECTED from the
spec — advertises tools whose upstream does not exist. That last one is why
this gate must run BEFORE the MCP gates rather than beside them.

WHAT IT COMPARES

Full paths on both sides, so the comparison is real rather than a suffix match:

  spec side  servers[0].url contributes a base path. `{baseUrl}/api/v1/app-registry`
             means every path in that document hangs off /api/v1/app-registry.
  code side  `app.use('/api/v1/app-registry', appRegistryRoutes)` mounts a router
             file at that prefix; a `router.get('/apps')` inside it is really
             GET /api/v1/app-registry/apps. Mount prefixes compose transitively
             through nested routers, and FastAPI's include_router(prefix=...)
             and APIRouter(prefix=...) are resolved the same way.

A spec is paired with the routes whose resolved path falls under ITS base path,
so a repo with several services and several specs does not cross-contaminate.

FOUR OUTCOMES, AND UNRESOLVED IS NOT A MISMATCH

  matched      an operation and a route agree
  O1           a route serves a path the spec does not document
  O2           the spec documents an operation nothing implements
  UNRESOLVED   a route whose mount prefix could not be determined

That fourth bucket is load-bearing. A route the resolver could not place is the
GATE failing to see, not the repo drifting, and reporting it as O1 would bury a
real finding under noise until someone silenced the whole check. It is counted
and named separately, never mixed in.

RATCHETED, for the reason every gate here is: run hot against a fleet that has
never had this check, the backlog would red every PR and earn a `|| true`. With
--changed-only, an operation or route this diff touches must agree; inherited
disagreement is counted and printed, never blocking. Deleting a handler EDITS
its route, and renaming a spec path EDITS the spec, so both stay in scope.

  gate_openapi_conformance.py [repo] [--changed-only] [--base REF]
"""
import argparse
import json
import os
import re
import sys
from urllib.parse import urlsplit

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    from gate_platform_auth import (  # noqa: E402
        Finding, JS_PATH, JS_ROUTE, _balanced, _norm_path, _parse_decls,
        _py_routes, _js_routes, _resolve_import, changed_lines, read,
        source_files, tracked_files,
    )
except ImportError as exc:  # pragma: no cover - a bare traceback here is unreadable
    # This gate reuses gate_platform_auth's route scanner rather than growing a
    # second one that would drift from it. The two are installed together by the
    # `openapi` capability for exactly that reason; if one arrived without the
    # other, say so in one line instead of emitting a stack trace that reads
    # like the gate itself is broken.
    sys.stderr.write(
        "::error title=gate-openapi-conformance::cannot import the shared route "
        f"scanner from scripts/gate_platform_auth.py ({exc}). These two scripts "
        "are installed as a pair — this gate reuses that scanner instead of "
        "keeping a second copy that would drift. Re-run sdlc-bootstrap, or "
        "install scripts/gate_platform_auth.py alongside this file.\n")
    sys.exit(2)

# PyYAML is not guaranteed on every runner (gate_identifier.py:61 sets the house
# convention). A JSON spec still works without it; a YAML one cannot be read, and
# that MUST be said out loud rather than counted as "no specs found" — a gate
# that reports success because it could not parse its input is the exact defect
# this family exists to remove.
try:
    import yaml
except ImportError:  # pragma: no cover - exercised by the degraded-mode test
    yaml = None

EXEMPT_FILES = ("governance/openapi-exempt.txt", ".fuze/openapi-exempt.txt")

SPEC_NAME = re.compile(r"(^|/)(openapi|swagger)\.(ya?ml|json)$", re.I)
# The Helm-mounted duplicate is a COPY of a spec, not a second contract.
# Counting it would double every operation and invent O2s for the copy.
# check-mcp-spec-drift.sh is what proves the copy matches; this gate reads the
# source of truth only.
SPEC_SKIP = re.compile(r"(^|/)(deploy|charts?|helm)/.*/files/|(^|/)node_modules/|"
                       r"(^|/)(dist|build|vendor|coverage)/")

HTTP_METHODS = ("get", "post", "put", "patch", "delete", "head", "options")


def load_spec(repo, rel):
    raw = read(repo, rel)
    if not raw.strip():
        return None, "empty file"
    if rel.lower().endswith(".json"):
        try:
            return json.loads(raw), None
        except json.JSONDecodeError as e:
            return None, f"invalid JSON: {e}"
    if yaml is None:
        return None, "PyYAML is not installed on this runner, so this YAML spec could not be read"
    try:
        doc = yaml.safe_load(raw)
    except yaml.YAMLError as e:
        return None, f"invalid YAML: {e}"
    return (doc, None) if isinstance(doc, dict) else (None, "not a mapping")


def spec_base_path(doc):
    """Literal path prefix every path in this document hangs off.

    `servers[0].url` is commonly templated — `{baseUrl}/api/v1/app-registry`.
    Stripping `{...}` first and then taking the URL path yields the literal
    portion, which is the only part that can be matched against a mount prefix.
    """
    servers = doc.get("servers") or []
    if not servers or not isinstance(servers[0], dict):
        return ""
    url = str(servers[0].get("url") or "")
    url = re.sub(r"\{[^}]*\}", "", url)
    path = urlsplit(url).path if "//" in url else url
    return "/" + path.strip("/") if path.strip("/") else ""


def spec_operations(repo, rel):
    """{(METHOD, full path): line-ish} for one document, plus any read failure."""
    doc, err = load_spec(repo, rel)
    if err:
        return {}, err
    base = spec_base_path(doc)
    paths = doc.get("paths")
    if not isinstance(paths, dict):
        return {}, "no `paths` object"
    ops = {}
    for p, item in paths.items():
        if not isinstance(item, dict):
            continue
        full = _norm_path(f"{base}/{str(p).lstrip('/')}")
        for method in item:
            if str(method).lower() in HTTP_METHODS:
                ops[(str(method).upper(), full)] = p
    return ops, None


PY_INCLUDE = re.compile(r"include_router\s*\(", re.I)
PY_PREFIX = re.compile(r"""prefix\s*=\s*['"]([^'"]*)['"]""")


def mount_prefixes(repo, files):
    """{rel: set(URL prefixes at which this file's router is mounted)}.

    Composed transitively: a sub-router mounted at '/tokens' inside a router
    file itself mounted at '/api/organizations' resolves to
    '/api/organizations/tokens'. Without this, every nested router's routes
    would land in UNRESOLVED and the gate would see almost nothing.
    """
    edges = []  # (parent_rel, child_rel, prefix)
    for rel in files:
        body = read(repo, rel)
        imports = {}
        # Map EVERY identifier in an import clause to its module, rather than
        # matching one shape of clause. The narrow form
        # `import X from '...'` missed `import billingRoutes, { webhookRouter }
        # from './routes/billing'` — a default-plus-named import — so
        # backend/src/routes/billing.ts read as unmounted and all twelve billing
        # operations were reported as documented-but-unimplemented. Manufacturing
        # false drift is how a gate loses the reader; being over-broad here is
        # harmless, because an identifier is only ever used if it also appears in
        # an actual mount call.
        for m in re.finditer(r"""import\s+([^'"]+?)\s+from\s+['"]([^'"]+)['"]""", body):
            for ident in re.findall(r"[A-Za-z_$][\w$]*", m.group(1)):
                if ident not in ("as", "type", "default"):
                    imports.setdefault(ident, m.group(2))
        for m in re.finditer(
                r"""(?:const|let|var)\s+(\{[^}]*\}|[A-Za-z_$][\w$]*)\s*=\s*require\(\s*['"]([^'"]+)['"]""",
                body):
            for ident in re.findall(r"[A-Za-z_$][\w$]*", m.group(1)):
                imports.setdefault(ident, m.group(2))
        for m in re.finditer(
                r"""from\s+([\w.]+)\s+import\s+([A-Za-z_][\w]*)""", body):  # python
            imports[m.group(2)] = "./" + m.group(1).replace(".", "/")

        # Express: app.use('<prefix>', ..., routerIdent)
        for m in JS_ROUTE.finditer(body):
            if m.group("method") != "use":
                continue
            call = _balanced(body, m.end() - 1)
            pm = JS_PATH.match(call)
            if not pm:
                continue
            prefix = pm.group("path")
            for ident in set(re.findall(r"[A-Za-z_$][\w$]*", call[pm.end():])) & set(imports):
                tgt = _resolve_import(repo, rel, imports[ident])
                if tgt:
                    edges.append((rel, tgt, prefix))

        # FastAPI: app.include_router(router, prefix="/x")
        for m in PY_INCLUDE.finditer(body):
            call = _balanced(body, m.end() - 1)
            pm = PY_PREFIX.search(call)
            prefix = pm.group(1) if pm else ""
            for ident in set(re.findall(r"[A-Za-z_][\w]*", call)) & set(imports):
                tgt = _resolve_import(repo, rel, imports[ident])
                if tgt:
                    edges.append((rel, tgt, prefix))

    # A file that mounts routers but is mounted by nobody is an entrypoint, and
    # its own routes sit at the root.
    mounted = {c for _, c, _ in edges}
    out = {rel: {""} for rel in files if rel not in mounted}

    # Fixpoint. Bounded: a mount chain deeper than this is a cycle or a shape
    # nobody in this family has, and looping forever would be worse than
    # reporting the leftovers as UNRESOLVED.
    for _ in range(8):
        changed = False
        for parent, child, prefix in edges:
            for base in out.get(parent, ()):
                full = "/" + "/".join(x for x in (base.strip("/"), prefix.strip("/")) if x)
                if full not in out.setdefault(child, set()):
                    out[child].add(full)
                    changed = True
        if not changed:
            break
    return out


def implemented_routes(repo):
    """Every route with its resolved full path, plus the ones we could not place."""
    files = [r for r in source_files(repo)
             if r.endswith((".ts", ".tsx", ".js", ".mjs", ".cjs", ".py"))]
    prefixes = mount_prefixes(repo, files)

    placed, unresolved = [], []
    for rel in files:
        got = (_py_routes(repo, rel, set()) if rel.endswith(".py")
               else _js_routes(repo, rel, set(), {}))
        if not got:
            continue
        bases = prefixes.get(rel)
        if not bases:
            unresolved.extend(got)
            continue
        for r in got:
            for base in bases:
                full = _norm_path(f"{base}/{r.path.lstrip('/')}")
                placed.append((r, full))
    return placed, unresolved


def check(repo, ratchet=None):
    findings = []
    exempt_rel, exempt, ef = _parse_decls(repo, EXEMPT_FILES, "openapi-exempt")
    # _parse_decls is shared with gate-platform-auth and stamps its E4 code.
    # Re-label into this gate's namespace so a reader is never sent looking for
    # an "E4" that belongs to a different gate.
    for f in ef:
        f.code = "O4"
    findings.extend(ef)

    specs = [r for r in tracked_files(repo)
             if SPEC_NAME.search(r) and not SPEC_SKIP.search(r)]
    if not specs:
        print("gate-openapi-conformance: no OpenAPI document in this repo — nothing to compare")
        return findings

    ops, unreadable = {}, []
    for rel in specs:
        got, err = spec_operations(repo, rel)
        if err:
            unreadable.append((rel, err))
            continue
        for key, orig in got.items():
            ops[key] = (rel, orig)

    # A SECOND accepted spelling for every operation: the spec's raw path, with
    # no server base applied.
    #
    # A standalone service behind a gateway has both, and they differ. The
    # billing service's own code mounts its router at ITS root, so the handler
    # for `/invoices` really is at `/invoices` inside that process — while the
    # spec's servers[0].url says `{baseUrl}/api/v1/billing`, because that is
    # where callers reach it once the gateway has forwarded. Neither is wrong;
    # the mapping between them lives in the gateway's proxy config, which this
    # gate cannot read. Insisting on the public spelling reported all twelve
    # billing operations as unimplemented when every one of them exists.
    #
    # So an operation counts as implemented if the code serves EITHER spelling.
    # That is deliberately the permissive direction: a missed disagreement costs
    # one unreported drift, a manufactured one costs the gate its credibility
    # and then its enforcement.
    raw_alias = {}
    for rel in specs:
        doc, err = load_spec(repo, rel)
        if err or not doc:
            continue
        base = spec_base_path(doc)
        if not base:
            continue
        for p_, item in (doc.get("paths") or {}).items():
            if not isinstance(item, dict):
                continue
            for method in item:
                if str(method).lower() in HTTP_METHODS:
                    full = _norm_path(f"{base}/{str(p_).lstrip('/')}")
                    raw_alias[(str(method).upper(), _norm_path(str(p_)))] = (
                        str(method).upper(), full)

    for rel, err in unreadable:
        findings.append(Finding(
            "O3", rel, None,
            f"could not be read ({err}), so the operations it declares were NOT "
            "compared against the code. Unreadable is not the same as conformant — "
            "this is the gate being unable to see, reported rather than skipped."))

    if not ops:
        if unreadable:
            return findings
        findings.append(Finding(
            "O3", specs[0], None,
            f"{len(specs)} OpenAPI document(s) found but ZERO operations parsed out "
            "of them. A spec with no operations cannot disagree with anything, so "
            "this check would report success having compared nothing."))
        return findings

    placed, unresolved = implemented_routes(repo)

    # Pair each spec base path with the routes underneath it. A route outside every
    # base path belongs to no spec in this repo and is not this gate's business.
    bases = sorted({_norm_path(spec_base_path(load_spec(repo, r)[0] or {}))
                    for r in specs if load_spec(repo, r)[0]}, key=len, reverse=True)

    def under_a_spec(full):
        return any(b in ("", "/") or full == b or full.startswith(b.rstrip("/") + "/")
                   for b in bases)

    impl = {}
    outside = 0
    for r, full in placed:
        key = (r.method, full)
        # Resolve the raw/public spelling FIRST. A gatewayed service serves
        # `/items` while its spec calls that `/api/v1/things/items`; testing the
        # base path before folding would drop the route as "outside any spec"
        # and then report the operation as unimplemented — the exact false
        # finding this alias exists to prevent.
        key = raw_alias.get(key, key)
        if under_a_spec(key[1]):
            impl.setdefault(key, []).append(r)
        else:
            outside += 1

    matched = set(impl) & set(ops)
    only_code = sorted(set(impl) - set(ops))
    only_spec = sorted(set(ops) - set(impl))

    print(f"gate-openapi-conformance: {len(ops)} documented operation(s) across "
          f"{len(specs)} spec(s) vs {len(impl)} resolved route(s) — "
          f"{len(matched)} matched, {len(only_code)} undocumented, "
          f"{len(only_spec)} unimplemented, {len(unresolved)} unresolved, "
          f"{outside} outside any spec's base path")
    if unresolved:
        print(f"gate-openapi-conformance: {len(unresolved)} route(s) could not be "
              "placed at a URL prefix and were NOT compared. That is this gate "
              "failing to see, not the repo drifting — listed below, never counted "
              "as drift.")
        for r in unresolved[:20]:
            print(f"    unresolved  {r.method} {r.path}  {r.rel}:{r.line}")

    deferred = 0
    for key in only_code:
        method, full = key
        if f"{method} {full}" in exempt:
            continue
        r = impl[key][0]
        if ratchet is not None and not (r.span & set(ratchet.get(r.rel, ()))):
            deferred += 1
            continue
        findings.append(Finding(
            "O1", r.rel, r.line,
            f"`{method} {full}` is served but no OpenAPI document declares it. An "
            "undocumented endpoint is invisible to every consumer generated from "
            "the spec, and to the MCP tool surface projected from it. Add it to "
            f"the spec, or declare it in {exempt_rel or EXEMPT_FILES[0]} as "
            f"`{method} {full}  # why`."))

    # Which source files contribute routes under each spec's base path. An O2 is
    # caused by CODE disappearing at least as often as by a spec gaining a path,
    # so scoping it to "the spec file changed" — which the first version did —
    # made the ratchet blind to the more common half: deleting a handler leaves
    # the spec untouched, so the operation it orphans was deferred as
    # pre-existing debt on the very PR that created it.
    contributors = {}
    for k, routes in impl.items():
        for b in bases:
            if b in ("", "/") or k[1] == b or k[1].startswith(b.rstrip("/") + "/"):
                contributors.setdefault(b, set()).update(r.rel for r in routes)

    for key in only_spec:
        method, full = key
        if f"{method} {full}" in exempt:
            continue
        rel, orig = ops[key]
        if ratchet is not None:
            base = next((b for b in bases
                         if b in ("", "/") or full == b
                         or full.startswith(b.rstrip("/") + "/")), "")
            touched = rel in ratchet or bool(
                contributors.get(base, set()) & set(ratchet))
            if not touched:
                deferred += 1
                continue
        findings.append(Finding(
            "O2", rel, None,
            f"`{method} {full}` (spec path `{orig}`) is documented but nothing "
            "implements it. Consumers will generate a client for an operation that "
            "404s, and any MCP tool projected from it advertises an upstream that "
            "does not exist."))

    if ratchet is not None and deferred:
        print(f"gate-openapi-conformance: {deferred} pre-existing disagreement(s) "
              "are NOT failing this PR. They are debt, not clearance — run without "
              "--changed-only to list them.")
    return findings


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("repo", nargs="?", default=".")
    ap.add_argument("--changed-only", action="store_true")
    ap.add_argument("--base", default=os.environ.get("GATE_BASE_REF", "origin/master"))
    args = ap.parse_args(argv)

    repo = os.path.abspath(args.repo)
    ratchet = None
    if args.changed_only:
        ratchet = changed_lines(repo, args.base)
        if ratchet is None:
            print(f"::warning::gate-openapi-conformance: --changed-only could not "
                  f"diff against '{args.base}'; checking everything rather than "
                  "silently exempting it all.")

    print(f"gate-openapi-conformance: repo={os.path.basename(repo)} "
          f"yaml={'available' if yaml else 'MISSING (YAML specs unreadable)'}")
    findings = check(repo, ratchet)
    if not findings:
        print("gate-openapi-conformance: OK")
        return 0
    for f in sorted(findings, key=lambda x: (x.code, x.path, x.line or 0)):
        print(f"::error::gate-openapi-conformance {f.code}")
        print(f)
    print(f"\ngate-openapi-conformance: {len(findings)} finding(s)")
    return 1


if __name__ == "__main__":
    sys.exit(main())
