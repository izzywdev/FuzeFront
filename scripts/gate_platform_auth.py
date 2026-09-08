#!/usr/bin/env python3
"""gate-platform-auth — enforce that a service's authN/authZ is real.

Written after FuzeFinance shipped a production service with NO authentication
and NO authorization, and every existing gate passed it. That is the design
brief: each check below exists because something that should have caught this
did not.

What actually happened (FuzeFinance#28). `backend/src/server.js` wrapped its
auth setup in try/catch. The catch arm installed a mock identity with
`roles: ['admin','finance_officer']` and a `requireRoles` that called `next()`
unconditionally. `@fuzefront/auth` was never declared in package.json, so the
require ALWAYS threw and the fallback was the only path that ever ran. Every
request was an admin. The single signal was a console.warn at boot.

Why nothing caught it:
  - gate-authz ends in `|| true`, so it cannot fail a PR.
  - helm lint / kubeconform check shape, not behaviour.
  - The readiness probe passed, because the service genuinely WAS healthy —
    just unauthenticated. Health is not a security signal.
  - Nothing asserted that an unauthenticated request gets a 401.

Check families:

  --fail-open   (F, default — the FuzeFinance class)
    F1  an auth import inside try/except|catch whose fallback grants identity,
        roles, or calls next() unconditionally. Auth that degrades to
        permissive is worse than no auth: it looks guarded in review.
    F2  a middleware named like an auth guard whose body only calls next()

  --declared    (D, default)
    D1  source imports @fuzefront/auth but no manifest declares the dependency.
        This is the exact FuzeFinance defect: the import can only ever throw.
    D2  the dependency is declared but never imported anywhere — an inert
        declaration that satisfies a naive "is it installed" check while
        guarding nothing

  --secrets     (S, default)
    S1  a signing secret supplied as a string literal rather than from env
    S2  legacy-hs256 selected with no federated/JWKS path configured at all
    S3  a verifier constructed without pinned algorithms — unpinned invites
        `alg:none` and RS256-verified-as-HMAC confusion

  --authz       (Z, default)
    Z1  a repo with mutating routes and zero requirePermission/createAuthzClient
        call sites. Authentication answers WHO; without this nothing answers
        WHETHER THEY MAY.
    Z2  a DECISION_UNAVAILABLE branch that yields anything other than a denial.
        The client is fail-closed by contract and has no fail-open option;
        re-introducing one locally defeats it.
    Z3  a direct Permit SDK call from a product. Products know exactly one
        thing: the base URL of FuzeFront's Security API.

  --rate-limit  (R, default)
    R1  a repo with an HTTP API and no rate limiter mounted anywhere

  --routes      (E, default — per-route coverage, ratcheted)
    E1  a route registered with no authentication boundary at any level and no
        declaration that it is deliberately public. Every family below reasons
        about the REPO; all of them are green on a repo whose auth is real but
        whose individual route lost its guard.
    E2  route-shaped source the scanner could not read. Unreadable is not clean.
    E3  a public-route exemption for a route that is gone or is now guarded
    E4  a declaration entry with no `# reason`
    Runs as a changed-lines ratchet in CI (--changed-only): a route this diff
    declares or edits must be classified; inherited debt is counted, not blocking.

  --adoption    (A, default — the anti-vacuous check)
    A1  a repo that serves HTTP endpoints has SOME auth boundary. Every other
        family asks "is what is here correct"; all of them pass vacuously on a
        service with no auth at all, which is precisely the state that shipped.

The last one is the important one, and it is deliberately modelled on
gate_identifier's --adoption: a family standard whose gate is satisfied by
non-adoption is not a standard.

RATCHET, AND WHY IT IS OPT-OUT RATHER THAN OPT-IN.

This gate enforces by DEFAULT. A repo silences it by declaring
`platformAuth.enforce: false` in .fuze/manifest.json, and that declaration
must carry a `reason`.

The first cut had it the other way round -- enforce only where a repo opted in
-- on the reasoning that landing it hot would red most of the fleet on
pre-existing violations, which is how gate-authz acquired its `|| true`. That
reasoning is real but it solves the wrong half. Opt-in enforcement is exactly
how `gate-identifier` reached ZERO adoption across 21 repos: the standard
shipped, the gate shipped, nobody ever set the flag, and a check nobody has
enabled is indistinguishable from a check that does not exist. The `|| true`
and the never-set flag are the same failure wearing different clothes.

The difference that matters is not hot vs. cold, it is VISIBLE vs. INVISIBLE.
`|| true` buried in a workflow is unreadable and uncountable. An `enforce:
false` in a manifest is one grep away, it names the repo, and with a mandatory
`reason` it reads as debt someone wrote down rather than as a setting someone
left alone. So the escape hatch stays -- a repo mid-migration must be able to
land work -- but it costs a sentence, and that sentence is the artifact.

Consequently an opt-out with no reason is NOT an opt-out: the gate enforces
anyway and says why. Skipping enforcement is a decision, and an undocumented
decision is indistinguishable from an oversight.

Exit codes: 0 clean or report-only, 1 findings while enforcing, 2 bad usage.
"""
from __future__ import annotations

import argparse
import ast
import json
import os
import re
import subprocess
import sys

CANONICAL_AUTH_PKG = "@fuzefront/auth"
PUBLISHED_AUTH_PKG = "@izzywdev/fuzefront-auth"
AUTH_PKGS = (CANONICAL_AUTH_PKG, PUBLISHED_AUTH_PKG)

# Source files worth reading. Deliberately excludes tests: a test SHOULD be able
# to construct a permissive stub, and flagging that would train people to
# silence the gate.
SRC_EXT = (".ts", ".tsx", ".js", ".mjs", ".cjs", ".py")
SKIP_DIR = re.compile(
    r"(^|/)(node_modules|\.git|dist|build|coverage|vendor|__pycache__|"
    r"\.venv|venv|test|tests|__tests__|e2e|fixtures|mocks?|examples?)(/|$)"
)
SKIP_FILE = re.compile(r"\.(test|spec|d)\.[tj]sx?$|^test_|_test\.py$")

# A route that changes state. Used by Z1 and A1 to decide whether a repo is a
# service at all — a library with no routes is legitimately out of scope.
MUTATING_ROUTE = re.compile(
    r"\b(?:app|router|api|server)\s*\.\s*(post|put|patch|delete)\s*\(", re.I)
ANY_ROUTE = re.compile(
    r"\b(?:app|router|api|server)\s*\.\s*(get|post|put|patch|delete)\s*\(|"
    r"@(?:app|router|bp)\.route\(|@(?:app|router)\.(get|post|put|patch|delete)\(", re.I)

PERMISSIVE = re.compile(
    r"\broles\s*[:=]\s*\[|"          # a fabricated role list
    r"\bnext\s*\(\s*\)|"             # unconditional pass-through
    r"\breq\s*\.\s*identity\s*=|"    # forged identity
    r"\breturn\s+True\b",            # python guard that always allows
    re.I)


class Finding:
    def __init__(self, code, path, line, msg):
        self.code, self.path, self.line, self.msg = code, path, line, msg

    def __str__(self):
        where = f"{self.path}:{self.line}" if self.line else self.path
        return f"{self.code}  {where}\n      {self.msg}"


def tracked_files(repo):
    """git ls-files, not a depth-limited walk — nested package layouts are the
    norm in this family and a `find -maxdepth` miscounted the fleet once already."""
    try:
        out = subprocess.run(["git", "ls-files"], cwd=repo, capture_output=True,
                             text=True, check=True).stdout
    except (subprocess.CalledProcessError, FileNotFoundError):
        return []
    return [p for p in out.splitlines() if p]


def governed_files(repo):
    """Repo-relative paths that FuzeSDLC OWNS in this repo, from
    .fuze/installed.json's `files` map (mode == "managed").

    These are governance tooling shipped INTO the repo -- the gate scripts
    themselves included -- not the repo's product code. governance-sync
    overwrites them from the canonical copy on every run, so they can never
    carry repo-specific logic, and a finding against one is never actionable
    by the repo that receives it.

    Scanning them was not hypothetical. `scripts/gate_platform_auth.py` is
    itself a tracked `.py` under `scripts/`, which SKIP_DIR does not cover, so
    THIS GATE SCANNED ITSELF and matched on its own detector strings:

        Z3  scripts/gate_platform_auth.py:475   <- the Z3 detector regex
        Z2  scripts/gate_platform_auth.py:489   <- the Z2 finding message
        F1  scripts/gate_platform_auth.py:1055  <- its own `return True`

    Measured 2026-09-03, that produced an identical fatal triple on the
    default branch of FuzeDeploy, FuzeKeys, FuzeMarket, FuzePlan and
    MendysRobotics -- red gates that no change to those repos could clear,
    which is exactly the kind of permanently-red check that teaches people to
    ignore a security gate.
    """
    try:
        with open(os.path.join(repo, ".fuze", "installed.json"),
                  encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return frozenset()
    files = data.get("files")
    if not isinstance(files, dict):
        return frozenset()
    return frozenset(
        rel for rel, meta in files.items()
        if isinstance(meta, dict) and meta.get("mode") == "managed"
    )


def source_files(repo):
    governed = governed_files(repo)
    # Belt and braces for the hub, where this file is the SOURCE rather than an
    # installed copy and so is absent from .fuze/installed.json. A gate must
    # never be a finding against itself in any repo.
    try:
        own = os.path.relpath(os.path.abspath(__file__),
                              os.path.abspath(repo)).replace(os.sep, "/")
    except ValueError:          # different drive on Windows
        own = None
    for rel in tracked_files(repo):
        if SKIP_DIR.search(rel) or SKIP_FILE.search(os.path.basename(rel)):
            continue
        if rel in governed or (own is not None and rel == own):
            continue
        if rel.endswith(SRC_EXT):
            yield rel


def read(repo, rel):
    try:
        with open(os.path.join(repo, rel), encoding="utf-8", errors="replace") as fh:
            return fh.read()
    except OSError:
        return ""


def manifests(repo):
    """Every package.json except vendored ones."""
    return [r for r in tracked_files(repo)
            if os.path.basename(r) == "package.json" and not SKIP_DIR.search(r)]


def auth_impl_dirs(repo):
    """Directories of packages this repo PUBLISHES as the platform auth client.

    Derived, never registered: any in-repo package.json whose `name` is the auth
    package means this repo *implements* the contract rather than consuming it.
    Its own source is therefore exempt from the consumer rules — the library that
    provides `requirePermission` is not a product failing to call it, and the
    module that defines a fallback path is defining the contract, not violating it.

    Without this the gate flags FuzeFront, the repo that publishes the package, for
    being the thing every other repo is told to use. A gate that reds the reference
    implementation teaches people the gate is wrong.
    """
    dirs = []
    for rel in manifests(repo):
        try:
            with open(os.path.join(repo, rel), encoding="utf-8") as fh:
                name = (json.load(fh) or {}).get("name")
        except (OSError, json.JSONDecodeError, AttributeError):
            continue
        if name in (CANONICAL_AUTH_PKG, PUBLISHED_AUTH_PKG):
            dirs.append(os.path.dirname(rel))
    return dirs


def serves_authz_api(repo):
    """True when this repo IS FuzeFront's Security API rather than a consumer of it.

    Detected by it serving the very endpoint the rule tells products to call. The
    service that answers /api/v1/security/authz/check is the one place in the family
    that MUST talk to Permit directly — inverting Z3 for exactly one repo, and
    identifying it from its own routes rather than by name.
    """
    for rel in source_files(repo):
        if re.search(r"['\"`]/?(?:api/v1/)?security/authz/(?:bulk-)?check",
                     read(repo, rel)):
            return True
    return False


def _under(rel, dirs):
    return any(rel == d or rel.startswith(d.rstrip("/") + "/") for d in dirs if d)


def declares_auth(repo):
    for rel in manifests(repo):
        try:
            data = json.loads(read(repo, rel) or "{}")
        except json.JSONDecodeError:
            continue
        for field in ("dependencies", "devDependencies",
                      "peerDependencies", "optionalDependencies"):
            for name in (data.get(field) or {}):
                if name in AUTH_PKGS:
                    return rel
                # an npm: alias — "@fuzeone/auth": "npm:@izzywdev/fuzefront-auth@^1"
                spec = (data.get(field) or {}).get(name) or ""
                if isinstance(spec, str) and any(p in spec for p in AUTH_PKGS):
                    return rel
    return None


# A real import, not a mention. FuzeService documents in a COMMENT that
# @fuzefront/auth "is dropped in behind this same interface when published" — an
# accurate note about future work. Matching any occurrence of the package name
# flagged that as an undeclared import, which is both wrong and the most
# corrosive kind of wrong: a gate that cries wolf on correct code is one people
# learn to route around.
IMPORT_FORMS = tuple(
    re.compile(pat % re.escape(pkg))
    for pkg in AUTH_PKGS
    for pat in (
        r"""\bfrom\s+['"]%s['"]""",          # ES: from '@fuzefront/auth'
        r"""\brequire\s*\(\s*['"]%s['"]""",  # CJS: require('@fuzefront/auth')
        r"""\bimport\s*\(\s*['"]%s['"]""",   # dynamic: import('@fuzefront/auth')
        r"""\bimport\s+['"]%s['"]""",        # side-effect: import '@fuzefront/auth'
    )
)


def strip_comments(line):
    """Good enough to keep prose out of the match. Not a parser — it only needs to
    stop a package name inside a comment from reading as an import."""
    return re.sub(r"^\s*(?://|#|\*|/\*).*$", "", line)


def imports_auth(repo):
    hits = []
    for rel in source_files(repo):
        body = read(repo, rel)
        for i, line in enumerate(body.splitlines(), 1):
            code = strip_comments(line)
            if any(rx.search(code) for rx in IMPORT_FORMS):
                hits.append((rel, i))
    return hits


# --------------------------------------------------------------------------- F

def check_fail_open(repo):
    """F1/F2 — the FuzeFinance class.

    A try/catch around an auth import whose handler installs something
    permissive. Scanned line-wise with a small window rather than parsed: this
    must work identically on TS, JS and Python, and a real parser for three
    languages is a much larger surface than the bug it would catch.

    Skips the package this repo publishes as the auth client, if any: a module
    that DEFINES a fallback path is writing the contract, not violating it. See
    auth_impl_dirs().
    """
    out = []
    impl = auth_impl_dirs(repo)
    for rel in source_files(repo):
        if _under(rel, impl):
            continue
        body = read(repo, rel)
        if not any(p in body for p in AUTH_PKGS):
            continue
        lines = body.splitlines()
        in_handler = False
        handler_start = 0
        for i, line in enumerate(lines, 1):
            if re.search(r"^\s*\}?\s*catch\b|^\s*except\b", line):
                in_handler, handler_start = True, i
                continue
            if in_handler:
                # a handler ends at a closing brace/dedent at column 0-ish
                if re.match(r"^\S", line) and not re.match(r"^\s*\}", line):
                    in_handler = False
                    continue
                if PERMISSIVE.search(line):
                    out.append(Finding(
                        "F1", rel, i,
                        "auth import is wrapped in try/catch and the handler installs a "
                        "PERMISSIVE fallback. If the import ever fails this serves every "
                        "request as authorized — and if the dependency is undeclared it "
                        "fails ALWAYS, making this the only path that runs. An auth "
                        "import must be a hard failure: refuse to start instead. "
                        f"(handler opened at line {handler_start})"))
                    in_handler = False
    return out


def check_permissive_guard(repo):
    """F2 — a guard that cannot deny.

    Deliberately conservative. The first version windowed 7 lines from the
    function signature and flagged FuzeHub's `requireUser`, which is a perfectly
    good guard: it calls next() on success and res.status(401) on failure, but
    the 401 sat ~10 lines below the window. That is the worst kind of false
    positive — a gate that reds correct code is one people learn to route around,
    and F1 already catches the defect this family was written for.

    So the bar is now: the FILE names something guard-shaped, passes the request
    through, and contains no denial ANYWHERE in it. A real guard rejects
    somewhere; a stub never does.
    """
    out = []
    guard_def = re.compile(
        r"\b(?:const|let|var|function|def)\s+"
        r"(require\w*|auth\w*|ensure\w*|verify\w*|guard\w*)\b", re.I)
    denial = re.compile(
        r"\b(401|403|throw\b|raise\b|reject\(|abort\(|"
        r"status\s*\(\s*4\d\d|sendStatus\s*\(\s*4\d\d)")
    for rel in source_files(repo):
        body = read(repo, rel)
        if denial.search(body):
            continue  # this file can say no somewhere — not a stub
        lines = body.splitlines()
        for i, line in enumerate(lines, 1):
            m = guard_def.search(line)
            if not m:
                continue
            window = "\n".join(lines[i - 1:i + 8])
            if re.search(r"\bnext\s*\(\s*\)|\breturn\s+True\b", window):
                out.append(Finding(
                    "F2", rel, i,
                    f"`{m.group(1)}` reads as an auth guard, passes the request through, "
                    "and NOTHING in this entire file can deny — no 401, no 403, no throw, "
                    "no rejection. A guard that cannot say no is decoration, and callers "
                    "and reviewers will reasonably assume the routes it wraps are "
                    "protected."))
                break  # one finding per file is enough to make the point
    return out


# --------------------------------------------------------------------------- D

def check_declared(repo):
    out = []
    declared_in = declares_auth(repo)
    used = imports_auth(repo)
    if used and not declared_in:
        rel, line = used[0]
        out.append(Finding(
            "D1", rel, line,
            f"imports {AUTH_PKGS[0]} but NO package.json declares it (checked "
            "dependencies, devDependencies, peerDependencies, optionalDependencies). "
            "The import can only ever throw at runtime. If it is wrapped in a "
            "try/catch, the fallback is not a degraded mode — it is the only mode."))
    if declared_in and not used:
        out.append(Finding(
            "D2", declared_in, None,
            "declares the platform auth package but never imports it anywhere. An "
            "inert dependency satisfies a naive 'is it installed' check while guarding "
            "nothing — measured across this family, thirteen repos declared the "
            "identity package and none imported it."))
    return out


# --------------------------------------------------------------------------- S

def _is_real_secret_literal(line, value):
    """Filter the enum-member shape out of S1.

    `SECRET = "secret"` in a Python field-type enum is not a signing secret, and
    FuzeFront ships exactly that. The discriminator is that a real secret does not
    spell its own identifier: a constant assigned its own lowercased name is a
    label, and a four-character value is not key material either.
    """
    ident = line.split("=")[0].split(":")[0].strip().strip("'\"")
    if value.strip().lower() == ident.strip().lower():
        return False
    if len(value) < 8:
        return False
    return True


def check_secrets(repo):
    out = []
    impl = auth_impl_dirs(repo)
    lit_secret = re.compile(
        r"\b(?:secret|legacySecret|jwtSecret|signingKey)\s*[:=]\s*['\"]([^'\"]{4,})['\"]", re.I)
    saw_legacy = saw_jwks = False
    for rel in source_files(repo):
        if _under(rel, impl):
            continue  # this repo publishes the client; see auth_impl_dirs()
        body = read(repo, rel)
        if "legacy-hs256" in body:
            saw_legacy = True
        if re.search(r"jwks|federated-jwks|oidc-jwks|createRemoteJWKSet", body, re.I):
            saw_jwks = True
        for i, line in enumerate(body.splitlines(), 1):
            m = lit_secret.search(line)
            if m and _is_real_secret_literal(line, m.group(1)) and not re.search(
                    r"process\.env|os\.environ|getenv", line):
                out.append(Finding(
                    "S1", rel, i,
                    "signing secret is a string literal, not read from the environment. "
                    "Anyone with repo read access can mint a valid token for this "
                    "service. Read it from env and fail closed when it is absent."))
        if re.search(r"createVerifier\s*\(", body) and not re.search(
                r"algorithms?\s*[:=]", body):
            out.append(Finding(
                "S3", rel, None,
                "a verifier is constructed without pinned algorithms. Unpinned "
                "verification accepts whatever the TOKEN claims, which is how "
                "`alg:none` and RS256-verified-as-HMAC forgeries work. Pin the "
                "algorithm list per mode."))
    if saw_legacy and not saw_jwks:
        out.append(Finding(
            "S2", ".", None,
            "legacy-hs256 is the only auth mode present — no JWKS/federated path "
            "exists. A shared symmetric secret means any holder can MINT tokens, not "
            "merely verify them, so every consumer is also an issuer."))
    return out


# --------------------------------------------------------------------------- Z

def check_authz(repo):
    out = []
    impl = auth_impl_dirs(repo)
    is_authz_service = serves_authz_api(repo)
    mutating = [(rel, i) for rel in source_files(repo)
                for i, l in enumerate(read(repo, rel).splitlines(), 1)
                if MUTATING_ROUTE.search(l)]
    has_authz = False
    for rel in source_files(repo):
        if _under(rel, impl):
            continue
        body = read(repo, rel)
        if re.search(r"requirePermission|createAuthzClient|require_permission", body):
            has_authz = True
        for i, line in enumerate(body.splitlines(), 1):
            if is_authz_service:
                break  # this repo IS the Security API; see serves_authz_api()
            if re.search(r"permit\.check|permitio|from\s+['\"]permitio", line, re.I):
                out.append(Finding(
                    "Z3", rel, i,
                    "calls the Permit SDK directly. Products must not: they know exactly "
                    "one thing, the base URL of FuzeFront's Security API "
                    "(/api/v1/security/authz/check). A direct call bypasses the "
                    "fail-closed client and couples this repo to the authz vendor."))
        for i, line in enumerate(body.splitlines(), 1):
            if "DECISION_UNAVAILABLE" in line:
                window = "\n".join(body.splitlines()[i - 1:i + 5])
                if re.search(r"\bnext\s*\(\s*\)|allow|true|200", window, re.I) and not \
                        re.search(r"403|deny|reject|throw|raise", window, re.I):
                    out.append(Finding(
                        "Z2", rel, i,
                        "DECISION_UNAVAILABLE appears to be handled by allowing the "
                        "request. The authz client is fail-closed BY CONTRACT and offers "
                        "no fail-open option; re-introducing one here means an authz "
                        "outage silently becomes an authorization bypass."))
    if mutating and not has_authz:
        rel, line = mutating[0]
        out.append(Finding(
            "Z1", rel, line,
            f"{len(mutating)} state-changing route(s) and ZERO requirePermission / "
            "createAuthzClient call sites. Authentication answers who the caller is; "
            "nothing here answers whether they may perform this operation on this "
            "object (OWASP API1:2023 BOLA)."))
    return out


# --------------------------------------------------------------------------- R

def check_rate_limit(repo):
    limiter = re.compile(
        r"rate[-_]?limit|rateLimit|express-rate-limit|slowDown|"
        r"@fastify/rate-limit|flask_limiter|slowapi", re.I)
    routed = any(ANY_ROUTE.search(read(repo, rel)) for rel in source_files(repo))
    if not routed:
        return []
    if any(limiter.search(read(repo, rel)) for rel in source_files(repo)):
        return []
    return [Finding(
        "R1", ".", None,
        "serves HTTP routes with no rate limiter anywhere in the tree. Without one, "
        "credential stuffing and enumeration against these endpoints are unbounded, "
        "and a single client can exhaust the service for everyone.")]


# --------------------------------------------------------------------------- A

def check_adoption(repo):
    """A1 — the check that does NOT pass vacuously.

    Every other family asks "is what is here correct". All of them are silent on
    a service with no auth at all, which is exactly the state that shipped.
    """
    routed = [(rel, i) for rel in source_files(repo)
              for i, l in enumerate(read(repo, rel).splitlines(), 1)
              if ANY_ROUTE.search(l)]
    if not routed:
        return []
    if declares_auth(repo) or imports_auth(repo):
        return []
    rel, line = routed[0]
    return [Finding(
        "A1", rel, line,
        f"serves {len(routed)} HTTP route(s) and has NO platform auth at all — the "
        "package is neither declared nor imported. Every other check in this gate "
        "would pass this repo, because there is nothing here to find fault with. "
        "That is the failure mode this check exists for: a standard satisfied by "
        "non-adoption is not a standard.")]


# --------------------------------------------------------------------------- E

# Route-level coverage. The families above all reason about the REPO: does it
# declare the package, does it import it, does any auth boundary exist at all.
# Every one of them is green on a repo whose auth is real but whose individual
# route lost its guard -- which is the FuzeAgent shape: `main.py` authenticates
# properly and `simple_main.py` published the same domain with none, so A1 saw
# an auth boundary and stopped looking. A per-repo question cannot answer a
# per-route one.
#
# CLOSED SET, NOT A DENYLIST. Every discovered route must end up in exactly one
# of three buckets: guarded (evidence found), public (declared, with a reason),
# or UNGUARDED (fails). There is no fourth "didn't recognise it, carry on"
# bucket -- that bucket is how `/applications` stayed exposed behind a path
# denylist that only knew about `/application`. A route the scanner cannot
# classify is a finding, not a shrug.
#
# TWO DECLARATION FILES, AND THEY ARE NOT INTERCHANGEABLE:
#   governance/auth-guards.txt   extends what COUNTS as a guard, for repos whose
#                                middleware is named locally. Additive evidence.
#   governance/public-routes.txt exempts a specific METHOD + path from needing
#                                one. An exemption, not evidence.
# Conflating them is how an allowlist quietly becomes the hole: "we couldn't
# detect the guard" and "this endpoint is deliberately open" are different
# facts and must not share a file.

GUARD_FILES = ("governance/auth-guards.txt", ".fuze/auth-guards.txt")
PUBLIC_FILES = ("governance/public-routes.txt", ".fuze/public-routes.txt")

# Identifiers that constitute an authentication/authorization boundary. Seeded
# from what the family actually runs (Express middleware, FastAPI dependencies,
# the @fuzefront/auth surface) and extended per repo via auth-guards.txt.
BUILTIN_GUARDS = (
    # Express / @fuzefront/auth
    "authenticateToken", "requireAuth", "requireUser", "requirePermission",
    "requireRoles", "requireOrgAccess", "requireApiKey", "requireInternalToken",
    "ensureAuthenticated", "isAuthenticated", "verifyToken", "authMiddleware",
    "PermissionMiddleware", "tenantContext",
    # FastAPI / Starlette
    "require_auth", "require_user", "require_org_access", "get_current_user",
    "authenticate_websocket", "verify_token", "current_active_user",
)


def _decl_file(repo, candidates):
    for rel in candidates:
        if os.path.exists(os.path.join(repo, rel)):
            return rel
    return None


def _parse_decls(repo, candidates, kind):
    """Read a declaration file into {value: reason} plus its findings.

    A reason is MANDATORY. An entry without one is rejected rather than
    honoured: an undocumented exemption is indistinguishable from an oversight,
    which is the same rule `enforcing()` applies to platformAuth.enforce.
    """
    rel = _decl_file(repo, candidates)
    out, findings = {}, []
    if not rel:
        return rel, out, findings
    for i, raw in enumerate(read(repo, rel).splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        value, sep, reason = line.partition("#")
        value, reason = value.strip(), reason.strip()
        if not value:
            continue
        if not sep or not reason:
            findings.append(Finding(
                "E4", rel, i,
                f"{kind} entry {value!r} carries no `# reason`. Every entry here "
                "weakens a security check, so each one states why it is correct. "
                "An entry with no reason cannot be reviewed and does not apply."))
            continue
        out[value] = reason
    return rel, out, findings


def _norm_path(p):
    """Compare routes by shape, not by parameter spelling: `/users/{id}` and
    `/users/:id` are the same surface, and a rename of the parameter must not
    silently invalidate a public-route declaration (or silently satisfy one)."""
    p = "/" + (p or "").strip().strip("/")
    p = re.sub(r"\{[^}]*\}", "{}", p)
    p = re.sub(r":[A-Za-z_][A-Za-z0-9_]*", "{}", p)
    return p.lower() or "/"


class Route:
    """`line` is where the route is REPORTED; `span` is what the ratchet reads.

    They differ, and the difference is the whole point. A guard usually lives in
    the handler signature or the decorator's `dependencies=[...]`, not on the
    line naming the path — so deleting `Depends(require_auth)` from
    `async def items(_auth=Depends(require_auth))` leaves the `@app.get("/items")`
    line untouched. A ratchet keyed on the reported line would have called that
    diff clean: it would miss precisely the mutation it exists to catch. The span
    covers the decorator through the end of the handler, so any edit to the route
    puts its auth posture back in scope.
    """

    def __init__(self, method, path, rel, line, guarded_by=None, span=None):
        self.method = method.upper()
        self.path = _norm_path(path)
        self.rel, self.line = rel, line
        self.guarded_by = guarded_by
        self.span = set(span) if span else {line}

    @property
    def key(self):
        return f"{self.method} {self.path}"


PY_ROUTE_METHODS = ("get", "post", "put", "patch", "delete", "head",
                    "options", "websocket")


def _py_guard_names(node, guards):
    """Guard identifiers referenced anywhere inside an AST subtree.

    Deliberately name-based rather than resolving `Depends(...)`: the thing that
    matters is whether a recognised guard is wired in, and it appears as a Name
    either way (`Depends(require_auth)`, `Security(require_auth)`, a bare
    annotated dependency alias). Resolving the call form and missing an alias
    would fail open, which is the one direction this gate must never fail.
    """
    found = set()
    for sub in ast.walk(node):
        if isinstance(sub, ast.Name) and sub.id in guards:
            found.add(sub.id)
        elif isinstance(sub, ast.Attribute) and sub.attr in guards:
            found.add(sub.attr)
    return found


def _py_routes(repo, rel, guards):
    """FastAPI/Starlette routes via AST. Python gets a real parse because the
    stdlib provides one; the JS/TS side below is textual and says so."""
    try:
        tree = ast.parse(read(repo, rel))
    except (SyntaxError, ValueError):
        return None  # signals "could not read this file" to the caller

    # App/router objects constructed WITH a global auth dependency guard every
    # route registered on them -- this is how simple_main.py was repaired, and
    # how FuzeFront's security service mounts tenantContext.
    global_guarded = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Assign) or not isinstance(node.value, ast.Call):
            continue
        fn = node.value.func
        ctor = getattr(fn, "id", None) or getattr(fn, "attr", None)
        if ctor not in ("FastAPI", "APIRouter"):
            continue
        for kw in node.value.keywords:
            if kw.arg == "dependencies" and _py_guard_names(kw, guards):
                for tgt in node.targets:
                    if isinstance(tgt, ast.Name):
                        global_guarded.add(tgt.id)

    routes = []
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for dec in node.decorator_list:
            if not isinstance(dec, ast.Call):
                continue
            fn = dec.func
            if not isinstance(fn, ast.Attribute) or fn.attr not in PY_ROUTE_METHODS:
                continue
            owner = getattr(fn.value, "id", None)
            path = ""
            if dec.args and isinstance(dec.args[0], ast.Constant) \
                    and isinstance(dec.args[0].value, str):
                path = dec.args[0].value
            guard = None
            if owner in global_guarded:
                guard = f"app-level dependency on {owner}"
            else:
                # per-route: decorator `dependencies=[...]`, the handler
                # signature, or a guard called in the body (the WebSocket shape,
                # where app-level deps genuinely do not apply).
                hits = (_py_guard_names(dec, guards)
                        | _py_guard_names(node.args, guards)
                        | {n for n in _py_guard_names(node, guards)})
                if hits:
                    guard = "route uses " + ", ".join(sorted(hits))
            start = min([d.lineno for d in node.decorator_list] + [dec.lineno])
            end = getattr(node, "end_lineno", None) or node.lineno
            routes.append(Route(fn.attr, path, rel, dec.lineno, guard,
                                span=range(start, end + 1)))
    return routes


def _balanced(text, open_idx):
    """Text of the call whose '(' is at open_idx, brace-aware so a multi-line
    Express registration is read whole rather than to the first newline."""
    depth, i, n = 0, open_idx, len(text)
    while i < n:
        c = text[i]
        if c in "([{":
            depth += 1
        elif c in ")]}":
            depth -= 1
            if depth == 0:
                return text[open_idx:i + 1]
        i += 1
    return text[open_idx:open_idx + 2000]


JS_ROUTE = re.compile(
    r"\b(?P<owner>[A-Za-z_$][\w$]*)\s*\.\s*"
    r"(?P<method>get|post|put|patch|delete|head|options|all|use)\s*\(")
# The first argument must be a string literal that STARTS WITH "/".
#
# JS_ROUTE's `owner` is deliberately any identifier, because real routers are
# named all sorts of things (`r`, `v1`, `apiRouter`). The cost of that breadth
# is that `<anything>.get("x")` matched, and the first-argument check was the
# only thing standing between that and a reported route -- so ANY map, cache,
# header bag or URLSearchParams read became an unguarded HTTP route.
#
# Measured on FuzeMarket 2026-09-03, ALL EIGHT of its E1 findings were this,
# and it had zero real detected routes:
#
#     const u = url.searchParams.get("url");          -> "GET /url"
#     url.searchParams.get("days")                    -> "GET /days"
#     r.headers.get("content-type")                   -> "GET /content-type"
#
# Requiring the leading slash is the discriminator, and it costs nothing real:
# an Express/Fastify path is matched against req.path, which always begins with
# "/", so `app.get("users")` can never match a request and is dead code. Routes
# registered from a constant (`app.get(PATHS.users, h)`) were already skipped
# here -- they are not string literals -- so this narrows nothing that worked.
JS_PATH = re.compile(r"""^\(\s*['"`](?P<path>/[^'"`]*)['"`]""")


def _js_routes(repo, rel, guards, mount_guarded):
    """Express-style routes, textually.

    Regex rather than a parse because there is no JS parser in the stdlib and
    this gate is stdlib-only by house convention (same reasoning as
    gate_manifest's optional-jsonschema fallback). The report says which engine
    read each file so a weaker analysis is never mistaken for a stronger one.
    """
    body = read(repo, rel)
    routes = []

    # A bare `app.use(guard)` with no path argument guards everything mounted
    # AFTER it in the same file — and only after it. Express middleware order is
    # load-bearing: the canonical mount sequence puts health and openapi ahead of
    # auth precisely so they stay reachable. Treating the guard as covering the
    # whole file would report those pre-auth routes as protected when they are
    # deliberately not, which is a false negative in a gate whose entire value is
    # that it does not produce them.
    file_guard_at = None
    file_guarded = None
    for m in JS_ROUTE.finditer(body):
        if m.group("method") != "use":
            continue
        call = _balanced(body, m.end() - 1)
        if JS_PATH.match(call):
            continue  # path-scoped mount, handled by mount_guarded
        hit = sorted(set(re.findall(r"[A-Za-z_$][\w$]*", call)) & guards)
        if hit:
            file_guard_at = m.start()
            file_guarded = f"{m.group('owner')}.use({hit[0]}) earlier in this file"
            break

    for m in JS_ROUTE.finditer(body):
        method = m.group("method")
        if method in ("use", "all"):
            continue
        call = _balanced(body, m.end() - 1)
        pm = JS_PATH.match(call)
        if not pm:
            continue  # not a route registration (e.g. a promise `.get`)
        line = body.count("\n", 0, m.start()) + 1
        idents = set(re.findall(r"[A-Za-z_$][\w$]*", call[pm.end():]))
        hit = sorted(idents & guards)
        guard = None
        if hit:
            guard = "route uses " + ", ".join(hit)
        elif file_guarded is not None and m.start() > file_guard_at:
            guard = file_guarded
        elif rel in mount_guarded:
            guard = mount_guarded[rel]
        end_line = line + call.count("\n")
        routes.append(Route(method, pm.group("path"), rel, line, guard,
                            span=range(line, end_line + 1)))
    return routes


def _mount_guarded_files(repo, guards):
    """Files whose router is mounted behind a guard at the mount site.

    `app.use('/api', requireAuth, apiRouter)` guards every route in the file
    `apiRouter` was imported from. Without resolving this the gate would red
    every repo that centralises its guard at the mount point -- correct code,
    and a gate that reds correct code is one people learn to route around.
    """
    out = {}
    for rel in source_files(repo):
        if not rel.endswith((".ts", ".tsx", ".js", ".mjs", ".cjs")):
            continue
        body = read(repo, rel)
        imports = {}
        for m in re.finditer(
                r"""import\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+)['"]""", body):
            imports[m.group(1)] = m.group(2)
        for m in re.finditer(
                r"""const\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*['"]([^'"]+)['"]""",
                body):
            imports[m.group(1)] = m.group(2)
        for m in JS_ROUTE.finditer(body):
            if m.group("method") != "use":
                continue
            call = _balanced(body, m.end() - 1)
            if not JS_PATH.match(call):
                continue
            idents = set(re.findall(r"[A-Za-z_$][\w$]*", call))
            if not (idents & guards):
                continue
            for ident in idents & set(imports):
                target = _resolve_import(repo, rel, imports[ident])
                if target:
                    out[target] = f"mounted behind a guard in {rel}"
    return out


def _posix(rel):
    """A repo-relative path in POSIX form, always.

    Every rel in this scanner is a GIT path: it comes from `git ls-files`, is used as a
    dict key against those listings, and is printed in findings. `os.path.normpath` and
    `os.path.join` emit backslashes on Windows, so a rel built that way compares unequal
    to the identical path from git and matches nothing -- silently, because a non-match is
    indistinguishable from "not mounted".
    """
    return rel.replace(os.sep, "/").replace("\\", "/")


def _resolve_import(repo, from_rel, spec):
    if not spec.startswith("."):
        return None
    base = _posix(os.path.normpath(os.path.join(os.path.dirname(from_rel), spec)))
    for cand in (base + ".ts", base + ".tsx", base + ".js",
                 base + "/index.ts", base + "/index.js", base):
        if os.path.exists(os.path.join(repo, cand)):
            return cand
    return None


HUNK_RE = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@")


def changed_lines(repo, base_ref):
    """{relpath: {added/modified line numbers}} from `git diff --unified=0 base...HEAD`.

    None when the diff cannot be computed — and the caller must treat None as
    "ratchet unavailable, check everything" rather than "nothing changed".
    A ratchet that silently empties itself when git is unhappy is a check that
    reports success because it looked at zero lines.
    """
    try:
        res = subprocess.run(
            ["git", "-C", repo, "diff", "--unified=0", f"{base_ref}...HEAD"],
            capture_output=True, text=True, timeout=90)
    except (OSError, subprocess.SubprocessError):
        return None
    if res.returncode != 0:
        return None
    out, cur = {}, None
    for line in res.stdout.splitlines():
        if line.startswith("+++ "):
            p = line[4:].strip()
            cur = None if p == "/dev/null" else (
                p[2:] if p.startswith(("a/", "b/")) else p)
        elif line.startswith("@@") and cur is not None:
            m = HUNK_RE.match(line)
            if m:
                start = int(m.group(1))
                count = int(m.group(2)) if m.group(2) is not None else 1
                out.setdefault(cur, set()).update(range(start, start + count))
    return out


def check_routes(repo, ratchet=None):
    """E — every individual route is guarded, or declared public with a reason.

    `ratchet` is the changed-lines map from `changed_lines()`. When present,
    only routes DECLARED OR MODIFIED by this diff can raise E1; pre-existing
    unguarded routes are counted and reported, never blocking.

    Why a ratchet at all. Run hot on the fleet as it stands, this family
    produces 356 findings in FuzeFront and 298 in FuzeAgent — nearly all of
    them locally-named guards it has not been taught yet, plus health probes
    nobody has declared public. A gate that reds every PR on pre-existing
    debt does not get fixed, it gets `|| true`-d; that is the documented
    history of gate-authz in this very file. The ratchet keeps the property
    that actually matters — a route that LOSES its guard is a changed line,
    and changed lines always fail — while the backlog burns down against a
    visible count instead of a blocked merge queue.
    """
    guard_rel, extra_guards, findings = _parse_decls(
        repo, GUARD_FILES, "auth-guards")
    public_rel, public, pf = _parse_decls(repo, PUBLIC_FILES, "public-routes")
    findings = list(findings) + list(pf)

    guards = set(BUILTIN_GUARDS) | set(extra_guards)
    exempt_dirs = auth_impl_dirs(repo)

    py_files, js_files = [], []
    for rel in source_files(repo):
        if _under(rel, exempt_dirs):
            continue
        (py_files if rel.endswith(".py") else js_files).append(rel)

    mount_guarded = _mount_guarded_files(repo, guards)

    routes, unparsable = [], []
    for rel in py_files:
        got = _py_routes(repo, rel, guards)
        if got is None:
            unparsable.append(rel)
        else:
            routes.extend(got)
    for rel in js_files:
        routes.extend(_js_routes(repo, rel, guards, mount_guarded))

    # E2 -- ANTI-VACUITY. The repo has route-shaped source but the scanner
    # produced nothing. That is a broken scanner reporting a clean bill of
    # health, which is the single failure mode this whole gate exists to stop.
    # It must be louder than a real finding, not quieter.
    textual = [rel for rel in py_files + js_files
               if ANY_ROUTE.search(read(repo, rel))]
    if textual and not routes:
        return findings + [Finding(
            "E2", textual[0], None,
            f"{len(textual)} file(s) contain route registrations that the scanner "
            "could not extract, so this family examined ZERO routes and would "
            "otherwise have reported success. Treat this as the gate being "
            "broken, not the repo being clean.")]

    if not routes:
        return findings  # genuinely no HTTP surface -- a library, legitimately

    seen_public, unguarded, deferred = set(), 0, 0
    for r in sorted(routes, key=lambda x: (x.rel, x.line)):
        if r.guarded_by:
            continue
        if r.key in public:
            seen_public.add(r.key)
            continue
        unguarded += 1
        if ratchet is not None and not (r.span & set(ratchet.get(r.rel, ()))):
            deferred += 1
            continue
        findings.append(Finding(
            "E1", r.rel, r.line,
            f"`{r.key}` is registered with no authentication boundary: no "
            "app-level dependency, no router mount guard, and no recognised "
            "guard on the route itself. If it is deliberately public, declare "
            f"it in {public_rel or PUBLIC_FILES[0]} as `{r.key}  # why`. If it "
            "IS guarded by a locally-named middleware, add that name to "
            f"{guard_rel or GUARD_FILES[0]} — extending detection and exempting "
            "a route are different claims and this gate keeps them apart."))

    # The census prints unconditionally, pass or fail. A family that says only
    # "OK" cannot be distinguished from one that examined nothing, which is the
    # exact ambiguity this gate was written to remove.
    print(f"gate-platform-auth routes: {len(routes)} route(s) — "
          f"{len(routes) - unguarded - len(seen_public)} guarded, "
          f"{len(seen_public)} declared public, {unguarded} unguarded"
          + (f" ({deferred} pre-existing, deferred by the ratchet)"
             if ratchet is not None and deferred else ""))
    if ratchet is not None and deferred:
        print(f"gate-platform-auth routes: {deferred} pre-existing unguarded "
              "route(s) are NOT failing this PR. They are debt, not clearance — "
              "run this gate without --changed-only to list them.")

    # E3 -- a stale exemption. An allowlist that only ever grows is the hole the
    # gate was supposed to close; an entry whose route is gone or is now guarded
    # has to come out while someone still remembers why it went in.
    live = {r.key for r in routes}
    for key in sorted(set(public) - seen_public):
        why = ("no such route exists any more" if key not in live
               else "that route is now guarded, so the exemption is dead weight")
        findings.append(Finding(
            "E3", public_rel, None,
            f"public-routes declares `{key}` but {why}. Remove the line: a "
            "standing exemption for a route nobody can point at is how the next "
            "unguarded route gets waved through."))

    for rel in unparsable:
        findings.append(Finding(
            "E2", rel, None,
            "could not be parsed, so any routes it registers were NOT checked. "
            "Unreadable is not the same as clean."))
    return findings


# --------------------------------------------------------------------------- main

FAMILIES = (
    ("fail_open", "--fail-open", lambda r: check_fail_open(r) + check_permissive_guard(r)),
    ("declared", "--declared", check_declared),
    ("secrets", "--secrets", check_secrets),
    ("authz", "--authz", check_authz),
    ("rate_limit", "--rate-limit", check_rate_limit),
    ("adoption", "--adoption", check_adoption),
    ("routes", "--routes", check_routes),
)


def enforcing(repo):
    """(hard, why) — enforce unless the repo has explicitly and legibly opted out.

    Absent manifest, absent block and absent flag all enforce. Only an explicit
    `enforce: false` carrying a non-empty `reason` downgrades to report-only.
    """
    path = os.path.join(repo, ".fuze", "manifest.json")
    try:
        with open(path, encoding="utf-8") as fh:
            block = json.load(fh).get("platformAuth") or {}
    except (OSError, json.JSONDecodeError):
        return True, "no readable .fuze/manifest.json — enforcing by default"

    if "enforce" not in block:
        return True, "platformAuth.enforce not declared — enforcing by default"
    if block.get("enforce"):
        return True, "platformAuth.enforce: true"

    reason = (block.get("reason") or "").strip()
    if not reason:
        return True, ("platformAuth.enforce is false with no `reason` — an "
                      "undocumented opt-out is indistinguishable from an "
                      "oversight, so it does not count. Add "
                      "platformAuth.reason explaining what blocks adoption "
                      "and who owns it.")
    return False, f"opted out: {reason}"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("repo", nargs="?", default=".")
    for attr, flag, _ in FAMILIES:
        ap.add_argument(flag, dest=attr, action="store_true")
    ap.add_argument("--all", action="store_true", help="every family (the default)")
    ap.add_argument("--changed-only", action="store_true",
                    help="ratchet: only routes this diff declares or modifies can "
                         "raise E1 (see check_routes). Pre-existing findings are "
                         "counted and reported, never blocking.")
    ap.add_argument("--base", default=os.environ.get("GATE_BASE_REF", "origin/master"),
                    help="base ref for --changed-only (env GATE_BASE_REF)")
    args = ap.parse_args(argv)

    repo = os.path.abspath(args.repo)
    selected = [fn for attr, _, fn in FAMILIES if getattr(args, attr)]
    if not selected or args.all:
        selected = [fn for _, _, fn in FAMILIES]

    ratchet = None
    if args.changed_only:
        ratchet = changed_lines(repo, args.base)
        if ratchet is None:
            # Fail LOUD and check everything. The alternative — an empty map —
            # would exempt every route in the repo and print OK, which is the
            # precise shape of a gate that passes because it looked at nothing.
            print(f"::warning::gate-platform-auth: --changed-only could not diff "
                  f"against '{args.base}'; checking every route instead of "
                  "silently exempting them all.")

    findings = []
    for fn in selected:
        findings.extend(fn(repo, ratchet) if fn is check_routes else fn(repo))

    hard, why = enforcing(repo)
    mode = "enforcing" if hard else "report-only"
    print(f"gate-platform-auth: repo={os.path.basename(repo)} mode={mode} "
          f"families={len(selected)} ({why})")

    if not findings:
        print("gate-platform-auth: OK")
        return 0

    for f in sorted(findings, key=lambda x: (x.code, x.path, x.line or 0)):
        print(("::error::" if hard else "::warning::") + f"gate-platform-auth {f.code}")
        print(f)

    print(f"\ngate-platform-auth: {len(findings)} finding(s)")
    if not hard:
        print("gate-platform-auth: report-only because this repo opted out — "
              f"{why}. Remove platformAuth.enforce=false once these are "
              "addressed; the opt-out is debt, not a setting.")
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
