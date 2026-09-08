"""Tests for gate-platform-auth.

The governing principle, borrowed from test_gate_identifier: these assert the
gate FAILS on a violation, not merely that it passes on a clean tree. Passing is
not evidence. Every gate this family has shipped that only proved the happy path
turned out to be vacuous — gate-secret-scan with zero rules loaded,
gate-ds-conformance with no script present, gate-authz ending in `|| true`.

`FuzeFinanceRegression` is the acceptance test. It reconstructs the shape of the
code that actually shipped an unauthenticated finance service to production
(FuzeFinance#28) and asserts this gate flags it. If that test ever passes
without the gate reporting, the gate has stopped doing the one job it was
written for.
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest

REPO = os.path.dirname(os.path.dirname(os.path.abspath(os.path.dirname(__file__))))
GATE = os.path.join(REPO, "scripts", "gate_platform_auth.py")


def make_repo(files, manifest=None):
    """A git repo on disk — the gate uses `git ls-files`, so it must be real."""
    d = tempfile.mkdtemp()
    for rel, body in files.items():
        p = os.path.join(d, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w", encoding="utf-8") as fh:
            fh.write(body)
    if manifest is not None:
        os.makedirs(os.path.join(d, ".fuze"), exist_ok=True)
        with open(os.path.join(d, ".fuze", "manifest.json"), "w") as fh:
            json.dump(manifest, fh)
    for cmd in (["git", "init", "-q", "."],
                ["git", "config", "user.email", "t@t"],
                ["git", "config", "user.name", "t"],
                ["git", "add", "-A"],
                ["git", "commit", "-qm", "x"]):
        subprocess.run(cmd, cwd=d, check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return d


def run(repo, *flags):
    r = subprocess.run([sys.executable, GATE, repo, *flags],
                       capture_output=True, text=True)
    return r.returncode, r.stdout + r.stderr


CLEAN_SERVER = """
import { createVerifier, requireAuth, createAuthzClient, requirePermission } from '@fuzefront/auth';
import rateLimit from 'express-rate-limit';

const verifier = createVerifier({
  mode: process.env.AUTH_MODE,
  jwksUri: process.env.JWKS_URI,
  algorithms: ['RS256'],
});
const client = createAuthzClient({ baseUrl: process.env.AUTHZ_BASE_URL });

app.get('/health', (req, res) => res.json({ ok: true }));
app.use('/api', rateLimit({ windowMs: 60000, max: 100 }));
app.use(requireAuth({ verifier }));
app.post('/api/v1/items', requirePermission({ client, resource: 'item', action: 'create' }), h);
"""

CLEAN_PKG = json.dumps({"dependencies": {"@fuzefront/auth": "^1.0.0"}})

# CLEAN_SERVER mounts `/health` ahead of the auth middleware, deliberately — the
# canonical order puts liveness before the guard. Under the route family that is
# an unguarded route like any other, so the clean fixture declares it. This is
# not a workaround for the gate: it is the intended usage, and having the
# reference "correct repo" demonstrate it is the point.
CLEAN_PUBLIC = "GET /health  # liveness probe, mounted pre-auth by design\n"


class CleanRepoPasses(unittest.TestCase):
    def test_clean_repo_reports_ok(self):
        d = make_repo({"src/server.ts": CLEAN_SERVER, "package.json": CLEAN_PKG,
                       "governance/public-routes.txt": CLEAN_PUBLIC})
        code, out = run(d)
        self.assertEqual(code, 0, out)
        self.assertIn("gate-platform-auth: OK", out)

    def test_library_with_no_routes_is_out_of_scope(self):
        """A package with no HTTP surface must not be dragged into this."""
        d = make_repo({"src/index.ts": "export const add = (a, b) => a + b;\n",
                       "package.json": json.dumps({"name": "lib"})})
        code, out = run(d)
        self.assertEqual(code, 0, out)
        self.assertIn("OK", out)


class FuzeFinanceRegression(unittest.TestCase):
    """The acceptance test. This is the shape that shipped."""

    SERVER = """
let requireAuth, requireRoles;
try {
  const auth = require('@fuzefront/auth');
  requireAuth = auth.requireAuth;
  requireRoles = auth.requireRoles;
} catch (err) {
  console.warn("auth not resolved. Using fallbacks/mock middleware.");
  requireAuth = () => (req, res, next) => {
    req.identity = {
      userId: 'user_dev_id',
      roles: ['admin', 'finance_officer'],
    };
    next();
  };
  requireRoles = () => (req, res, next) => next();
}

app.post('/api/v1/invoices', requireAuth(), requireRoles('admin'), handler);
"""
    # The load-bearing detail: no @fuzefront/auth anywhere in here.
    PKG = json.dumps({"dependencies": {"express": "^4.0.0"}})

    def setUp(self):
        self.d = make_repo({"backend/src/server.js": self.SERVER,
                            "backend/package.json": self.PKG})

    def test_gate_flags_it(self):
        code, out = run(self.d)
        self.assertIn("finding", out.lower(), out)

    def test_f1_catches_the_permissive_fallback(self):
        _, out = run(self.d, "--fail-open")
        self.assertIn("F1", out)

    def test_d1_catches_the_undeclared_import(self):
        """The detail that turned a fallback into the ONLY path."""
        _, out = run(self.d, "--declared")
        self.assertIn("D1", out)

    def test_z1_catches_the_missing_authorization(self):
        _, out = run(self.d, "--authz")
        self.assertIn("Z1", out)

    def test_enforcing_manifest_makes_it_exit_nonzero(self):
        d = make_repo({"backend/src/server.js": self.SERVER,
                       "backend/package.json": self.PKG},
                      manifest={"platformAuth": {"enforce": True}})
        code, out = run(d)
        self.assertEqual(code, 1, out)
        self.assertIn("::error::", out)


class AdoptionIsNotVacuous(unittest.TestCase):
    """A1 — the check that fires when there is nothing else to find fault with."""

    NO_AUTH = """
app.get('/api/v1/things', (req, res) => res.json([]));
app.post('/api/v1/things', (req, res) => res.status(201).json({}));
"""

    def test_service_with_no_auth_at_all_is_flagged(self):
        d = make_repo({"src/server.js": self.NO_AUTH,
                       "package.json": json.dumps({"dependencies": {}})})
        code, out = run(d, "--adoption")
        self.assertIn("A1", out)

    def test_every_other_family_is_silent_on_it(self):
        """The point of A1: without it this repo passes the whole gate. If this
        ever starts failing, some other family gained coverage and A1's rationale
        should be re-read rather than the test relaxed."""
        d = make_repo({"src/server.js": self.NO_AUTH,
                       "package.json": json.dumps({"dependencies": {}})})
        for flag in ("--fail-open", "--declared", "--secrets"):
            _, out = run(d, flag)
            self.assertIn("OK", out, f"{flag} unexpectedly reported on a no-auth repo")


class SecretHandling(unittest.TestCase):
    def test_literal_secret_is_flagged(self):
        d = make_repo({"src/a.ts": "const v = createVerifier({ secret: 'shared-dev-secret', algorithms: ['HS256'] });\n",
                       "package.json": CLEAN_PKG})
        _, out = run(d, "--secrets")
        self.assertIn("S1", out)

    def test_env_sourced_secret_is_not_flagged(self):
        d = make_repo({"src/a.ts": "const v = createVerifier({ secret: process.env.JWT_SECRET, algorithms: ['HS256'] });\n",
                       "package.json": CLEAN_PKG})
        _, out = run(d, "--secrets")
        self.assertNotIn("S1", out)

    def test_unpinned_algorithms_are_flagged(self):
        d = make_repo({"src/a.ts": "const v = createVerifier({ jwksUri: process.env.J });\n",
                       "package.json": CLEAN_PKG})
        _, out = run(d, "--secrets")
        self.assertIn("S3", out)


class AuthzRules(unittest.TestCase):
    def test_direct_permit_call_is_flagged(self):
        d = make_repo({"src/a.ts": "import { Permit } from 'permitio';\nconst ok = await permit.check(u, a, r);\n",
                       "package.json": CLEAN_PKG})
        _, out = run(d, "--authz")
        self.assertIn("Z3", out)

    def test_fail_open_on_decision_unavailable_is_flagged(self):
        d = make_repo({"src/a.ts": CLEAN_SERVER + """
if (result.reason === 'DECISION_UNAVAILABLE') {
  return next();
}
""", "package.json": CLEAN_PKG})
        _, out = run(d, "--authz")
        self.assertIn("Z2", out)

    def test_fail_closed_on_decision_unavailable_is_not_flagged(self):
        d = make_repo({"src/a.ts": CLEAN_SERVER + """
if (result.reason === 'DECISION_UNAVAILABLE') {
  return res.status(403).json({ error: 'denied' });
}
""", "package.json": CLEAN_PKG})
        _, out = run(d, "--authz")
        self.assertNotIn("Z2", out)


class RateLimiting(unittest.TestCase):
    def test_api_without_a_limiter_is_flagged(self):
        d = make_repo({"src/a.ts": "app.get('/api/v1/x', h);\n", "package.json": CLEAN_PKG})
        _, out = run(d, "--rate-limit")
        self.assertIn("R1", out)

    def test_limiter_present_is_not_flagged(self):
        d = make_repo({"src/a.ts": CLEAN_SERVER, "package.json": CLEAN_PKG})
        _, out = run(d, "--rate-limit")
        self.assertNotIn("R1", out)


class InertDeclaration(unittest.TestCase):
    def test_declared_but_never_imported_is_flagged(self):
        """Thirteen repos declared the identity package and none imported it.
        A dependency line is not adoption."""
        d = make_repo({"src/a.ts": "app.get('/api/v1/x', h);\n", "package.json": CLEAN_PKG})
        _, out = run(d, "--declared")
        self.assertIn("D2", out)


class RatchetDefault(unittest.TestCase):
    """The ratchet is OPT-OUT. These pin that, and pin the cost of opting out.

    The gate originally enforced only where a repo opted in, to avoid redding
    the fleet on pre-existing violations. That is how `gate-identifier` reached
    zero adoption across 21 repos — a check nobody enabled is indistinguishable
    from a check that does not exist. What prevents a `|| true` is visibility,
    not coldness, so the default inverted and the escape hatch was made legible.
    """

    FAILING = {"src/server.js": AdoptionIsNotVacuous.NO_AUTH,
               "package.json": json.dumps({"dependencies": {}})}

    def test_enforcing_by_default(self):
        """THE test for this behaviour. No manifest at all still enforces —
        a repo must not be able to escape by simply not declaring anything."""
        d = make_repo(dict(self.FAILING))
        code, out = run(d)
        self.assertEqual(code, 1, out)
        self.assertIn("::error::", out)
        self.assertIn("enforcing by default", out)

    def test_block_present_but_flag_absent_still_enforces(self):
        d = make_repo(dict(self.FAILING),
                      manifest={"platformAuth": {"mode": "federated-jwks"}})
        code, out = run(d)
        self.assertEqual(code, 1, out)

    def test_opt_out_with_a_reason_is_report_only(self):
        """The hatch must genuinely work — a repo mid-migration has to be able
        to land work, or the gate gets removed instead of satisfied."""
        d = make_repo(dict(self.FAILING),
                      manifest={"platformAuth": {"enforce": False,
                                                 "reason": "migrating off HS256, "
                                                           "owner @izzywdev, tracked in #99"}})
        code, out = run(d)
        self.assertEqual(code, 0, out)
        self.assertIn("report-only", out)
        self.assertIn("::warning::", out)
        self.assertIn("migrating off HS256", out)

    def test_opt_out_without_a_reason_does_not_count(self):
        """An undocumented opt-out is indistinguishable from an oversight, so
        it is not honoured. This is the entire cost of the escape hatch."""
        d = make_repo(dict(self.FAILING),
                      manifest={"platformAuth": {"enforce": False}})
        code, out = run(d)
        self.assertEqual(code, 1, out)
        self.assertIn("reason", out)

    def test_blank_reason_does_not_count_either(self):
        d = make_repo(dict(self.FAILING),
                      manifest={"platformAuth": {"enforce": False, "reason": "   "}})
        code, out = run(d)
        self.assertEqual(code, 1, out)

    def test_a_clean_repo_passes_while_enforcing(self):
        """Enforcing by default must not mean failing by default."""
        d = make_repo({"src/server.js": CLEAN_SERVER, "package.json": CLEAN_PKG,
                       "governance/public-routes.txt": CLEAN_PUBLIC})
        code, out = run(d)
        self.assertEqual(code, 0, out)

    def test_tests_directory_is_not_scanned(self):
        """A test SHOULD be able to build a permissive stub. Flagging that would
        train people to silence the gate."""
        d = make_repo({"src/server.ts": CLEAN_SERVER,
                       "governance/public-routes.txt": CLEAN_PUBLIC,
                       "test/auth.test.ts": FuzeFinanceRegression.SERVER,
                       "package.json": CLEAN_PKG})
        code, out = run(d)
        self.assertEqual(code, 0, out)
        self.assertIn("OK", out)


if __name__ == "__main__":
    unittest.main()


class ThePlatformIsNotAProduct(unittest.TestCase):
    """Found only by running the gate against FuzeFront, and only once the ratchet
    became enforce-by-default — where it produced 56 findings, 55 of them wrong.

    FuzeFront publishes @fuzefront/auth AND serves /api/v1/security/authz/check. The
    consumer rules invert there: the library that provides requirePermission is not a
    product failing to call it, and the service that answers the authz endpoint is the
    one place in the family that must talk to Permit. A gate that reds the reference
    implementation for being the reference implementation teaches people the gate is
    wrong, and it would have done so on the platform repo's every PR.

    Both roles are DERIVED from the repo's own files — a published package name, a
    served route — never from a list of exempt repositories.
    """

    IMPL_PKG = json.dumps({"name": "@fuzefront/auth", "version": "1.0.0"})

    FALLBACK_IN_THE_LIBRARY = """
import { verify } from '@fuzefront/auth';
try {
  mod = require('@fuzefront/auth');
} catch (err) {
  handler = (req, res, next) => next();
}
"""

    def test_the_published_client_is_exempt_from_the_consumer_rules(self):
        d = make_repo({"packages/auth/package.json": self.IMPL_PKG,
                       "packages/auth/src/middleware.ts": self.FALLBACK_IN_THE_LIBRARY,
                       "package.json": CLEAN_PKG})
        _, out = run(d, "--fail-open")
        self.assertNotIn("F1", out, out)

    def test_the_same_code_outside_that_package_is_still_flagged(self):
        """The negative control. Exempting the implementation must not exempt a
        consumer that happens to sit in the same repo."""
        d = make_repo({"packages/auth/package.json": self.IMPL_PKG,
                       "backend/src/server.ts": self.FALLBACK_IN_THE_LIBRARY,
                       "package.json": CLEAN_PKG})
        _, out = run(d, "--fail-open")
        self.assertIn("F1", out, out)

    def test_the_authz_service_may_call_permit(self):
        d = make_repo({"backend/security/src/routes/authz.ts":
                       "router.post('/api/v1/security/authz/check', h);\n",
                       "backend/security/src/config/permit.ts":
                       "import { Permit } from 'permitio';\n",
                       "package.json": CLEAN_PKG})
        _, out = run(d, "--authz")
        self.assertNotIn("Z3", out, out)

    def test_a_product_that_does_not_serve_it_still_may_not(self):
        d = make_repo({"src/permit.ts": "import { Permit } from 'permitio';\n",
                       "package.json": CLEAN_PKG})
        _, out = run(d, "--authz")
        self.assertIn("Z3", out, out)

    def test_an_enum_member_named_secret_is_not_a_signing_secret(self):
        """`SECRET = "secret"` in a field-type enum. Fires in any repo with such an
        enum, and FuzeFront ships one. A constant assigned its own lowercased name is
        a label, not key material."""
        d = make_repo({"src/types.py": 'class Kind(str, enum.Enum):\n'
                                       '    URL = "url"\n'
                                       '    SECRET = "secret"\n',
                       "package.json": CLEAN_PKG})
        _, out = run(d, "--secrets")
        self.assertNotIn("S1", out, out)

    def test_a_real_hardcoded_secret_is_still_flagged(self):
        d = make_repo({"src/a.ts": 'const jwtSecret = "s3cr3t-shared-dev-value";\n',
                       "package.json": CLEAN_PKG})
        _, out = run(d, "--secrets")
        self.assertIn("S1", out, out)


class FalsePositivesFoundAgainstRealRepos(unittest.TestCase):
    """Both of these passed the unit tests and failed against production code.

    A gate that reds correct code is the most corrosive kind of wrong — people
    learn to route around it, and then it catches nothing at all. These pin the
    two shapes that actually broke.
    """

    def test_package_named_only_in_a_comment_is_not_an_import(self):
        """FuzeService documents in a COMMENT that @fuzefront/auth 'is dropped in
        behind this same interface when published'. That is an accurate note about
        future work, not an undeclared import."""
        d = make_repo({
            "src/identity.ts": (
                "/**\n"
                " * AuthN is delegated to FuzeFront. When `@fuzefront/auth` is\n"
                " * published its verifier drops in behind this same interface.\n"
                " */\n"
                "export interface TokenVerifier { verify(t: string): Promise<Claims>; }\n"
            ),
            "package.json": json.dumps({"dependencies": {}}),
        })
        _, out = run(d, "--declared")
        self.assertNotIn("D1", out,
                         "a package name inside a comment must not read as an import")

    def test_guard_that_denies_further_down_is_not_flagged(self):
        """FuzeHub's requireUser calls next() on success and res.status(401) on
        failure — the 401 sits ~10 lines below the signature. An earlier windowed
        version of F2 flagged it."""
        d = make_repo({
            "src/requireUser.ts": (
                "export async function requireUser(req, res, next) {\n"
                "  try {\n"
                "    const session = await resolve(req);\n"
                "    const user = await upsert(session);\n"
                "    req.userId = user.id;\n"
                "    req.userEmail = session.email;\n"
                "    req.identity = session.identity;\n"
                "    req.securityToken = session.token;\n"
                "    next();\n"
                "  } catch (err) {\n"
                '    res.status(401).json({ error: "Unauthorized" });\n'
                "  }\n"
                "}\n"
            ),
            "package.json": CLEAN_PKG,
        })
        _, out = run(d, "--fail-open")
        self.assertNotIn("F2", out,
                         "a guard that denies anywhere in the file is not a stub")

    def test_a_guard_that_truly_cannot_deny_is_still_flagged(self):
        """The negative control for the fix above — F2 must not become inert."""
        d = make_repo({
            "src/requireUser.ts": (
                "export function requireUser(req, res, next) {\n"
                "  req.identity = { userId: 'dev' };\n"
                "  next();\n"
                "}\n"
            ),
            "package.json": CLEAN_PKG,
        })
        _, out = run(d, "--fail-open")
        self.assertIn("F2", out, "F2 was relaxed into uselessness")


# ===========================================================================
# E — route-level coverage (the "a route lost its auth dependency" class)
# ===========================================================================
#
# Every family above reasons about the REPO. All of them are green on a repo
# whose auth is real but whose individual route lost its guard — the FuzeAgent
# shape, where main.py authenticates and simple_main.py published the same
# domain with none. These tests exist to prove the E family answers the
# per-route question, and — the part that matters — that it FIRES when a guard
# is REMOVED. A gate only ever exercised on clean input is the thing this whole
# file is a reaction to.

GUARDED_PY = """
from fastapi import Depends, FastAPI
from auth import require_auth

app = FastAPI()

@app.get("/items")
async def items(_auth=Depends(require_auth)):
    return []
"""

# Byte-for-byte GUARDED_PY with the dependency removed — nothing else differs.
UNGUARDED_PY = GUARDED_PY.replace("(_auth=Depends(require_auth))", "()")

GLOBAL_DEP_PY = """
from fastapi import Depends, FastAPI
from auth import get_current_user

app = FastAPI(dependencies=[Depends(get_current_user)])

@app.get("/items")
async def items():
    return []
"""

PUBLIC_DECL = "GET /items  # deliberately open, returns no tenant data\n"


class RouteGuardRemovalIsDetected(unittest.TestCase):
    """The mutation test. Same file, one dependency deleted."""

    def test_guarded_route_produces_no_finding(self):
        d = make_repo({"src/api.py": GUARDED_PY, "package.json": CLEAN_PKG})
        _, out = run(d, "--routes")
        self.assertNotIn("E1", out, "a properly guarded route was flagged")

    def test_removing_the_guard_makes_the_gate_fail(self):
        d = make_repo({"src/api.py": UNGUARDED_PY, "package.json": CLEAN_PKG})
        code, out = run(d, "--routes")
        self.assertEqual(code, 1, out)
        self.assertIn("E1", out)
        self.assertIn("GET /items", out)

    def test_app_level_dependency_counts_as_a_guard(self):
        d = make_repo({"src/api.py": GLOBAL_DEP_PY, "package.json": CLEAN_PKG})
        _, out = run(d, "--routes")
        self.assertNotIn("E1", out, "an app-level auth dependency was not honoured")

    def test_removing_the_app_level_dependency_makes_the_gate_fail(self):
        # The simple_main.py shape exactly: the global dependency disappears and
        # every route on that app silently becomes public.
        stripped = GLOBAL_DEP_PY.replace(
            "FastAPI(dependencies=[Depends(get_current_user)])", "FastAPI()")
        d = make_repo({"src/api.py": stripped, "package.json": CLEAN_PKG})
        code, out = run(d, "--routes")
        self.assertEqual(code, 1, out)
        self.assertIn("E1", out)


class PublicRoutesAreDeclaredNotInferred(unittest.TestCase):
    def test_a_declared_public_route_is_accepted(self):
        d = make_repo({"src/api.py": UNGUARDED_PY, "package.json": CLEAN_PKG,
                       "governance/public-routes.txt": PUBLIC_DECL})
        code, out = run(d, "--routes")
        self.assertEqual(code, 0, out)

    def test_a_declaration_without_a_reason_does_not_count(self):
        d = make_repo({"src/api.py": UNGUARDED_PY, "package.json": CLEAN_PKG,
                       "governance/public-routes.txt": "GET /items\n"})
        code, out = run(d, "--routes")
        self.assertEqual(code, 1, out)
        self.assertIn("E4", out, "an unreasoned exemption was honoured")
        self.assertIn("E1", out, "the route was exempted by a rejected entry")

    def test_a_declaration_does_not_cover_a_different_route(self):
        # The property that makes this a closed set rather than a denylist:
        # exempting GET /items must not exempt POST /items.
        body = UNGUARDED_PY.replace('@app.get("/items")', '@app.post("/items")')
        d = make_repo({"src/api.py": body, "package.json": CLEAN_PKG,
                       "governance/public-routes.txt": PUBLIC_DECL})
        code, out = run(d, "--routes")
        self.assertEqual(code, 1, out)
        self.assertIn("POST /items", out)

    def test_a_stale_exemption_is_reported(self):
        d = make_repo({"src/api.py": GUARDED_PY, "package.json": CLEAN_PKG,
                       "governance/public-routes.txt": PUBLIC_DECL})
        code, out = run(d, "--routes")
        self.assertIn("E3", out, "an exemption for a now-guarded route survived")


class LocallyNamedGuardsAreDeclarable(unittest.TestCase):
    LOCAL = """
const app = express();
app.get('/api/things', mayReadCatalog, (req, res) => res.json([]));
"""

    def test_an_unknown_guard_name_is_a_finding_by_default(self):
        d = make_repo({"src/api.ts": self.LOCAL, "package.json": CLEAN_PKG})
        code, out = run(d, "--routes")
        self.assertEqual(code, 1, out)

    def test_declaring_the_guard_name_resolves_it(self):
        d = make_repo({
            "src/api.ts": self.LOCAL, "package.json": CLEAN_PKG,
            "governance/auth-guards.txt":
                "mayReadCatalog  # repo-local Permit wrapper, see src/authz.ts\n"})
        code, out = run(d, "--routes")
        self.assertEqual(code, 0, out)

    def test_guard_declaration_does_not_exempt_an_unguarded_route(self):
        # auth-guards extends DETECTION; it must never act as an exemption.
        body = self.LOCAL + "app.get('/api/other', (req, res) => res.json([]));\n"
        d = make_repo({
            "src/api.ts": body, "package.json": CLEAN_PKG,
            "governance/auth-guards.txt": "mayReadCatalog  # wrapper\n"})
        code, out = run(d, "--routes")
        self.assertEqual(code, 1, out)
        self.assertIn("/api/other", out)


class ExpressMountOrderIsRespected(unittest.TestCase):
    ORDERED = """
const app = express();
app.get('/health', (req, res) => res.json({ ok: true }));
app.use(requireAuth({ verifier }));
app.get('/api/items', (req, res) => res.json([]));
"""

    def test_a_route_before_the_guard_is_not_treated_as_guarded(self):
        d = make_repo({"src/api.ts": self.ORDERED, "package.json": CLEAN_PKG})
        code, out = run(d, "--routes")
        self.assertEqual(code, 1, out)
        self.assertIn("GET /health", out)

    def test_a_route_after_the_guard_is_treated_as_guarded(self):
        d = make_repo({"src/api.ts": self.ORDERED, "package.json": CLEAN_PKG})
        _, out = run(d, "--routes")
        self.assertNotIn("/api/items", out)


class RouteFamilyIsNotVacuous(unittest.TestCase):
    def test_the_census_prints_even_when_everything_passes(self):
        # "OK" alone cannot be told apart from "examined nothing".
        d = make_repo({"src/api.py": GUARDED_PY, "package.json": CLEAN_PKG})
        _, out = run(d, "--routes")
        self.assertIn("1 route(s)", out)
        self.assertIn("1 guarded", out)

    def test_route_shaped_source_the_scanner_cannot_read_is_a_finding(self):
        # An unparsable file must never be silently skipped: unreadable is not
        # the same as clean. This is E2, the anti-vacuity check.
        d = make_repo({"src/api.py": "@app.get('/x')\ndef  ((( broken\n",
                       "package.json": CLEAN_PKG})
        code, out = run(d, "--routes")
        self.assertIn("E2", out)
        self.assertEqual(code, 1, out)


class RatchetDefersBacklogButNeverANewHole(unittest.TestCase):
    def test_changed_only_still_fails_on_a_route_the_diff_touched(self):
        d = make_repo({"src/api.py": GUARDED_PY, "package.json": CLEAN_PKG})
        subprocess.run(["git", "checkout", "-qb", "feat"], cwd=d, check=True)
        with open(os.path.join(d, "src", "api.py"), "w") as fh:
            fh.write(UNGUARDED_PY)
        for cmd in (["git", "add", "-A"], ["git", "commit", "-qm", "drop guard"]):
            subprocess.run(cmd, cwd=d, check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        code, out = run(d, "--routes", "--changed-only", "--base", "master")
        self.assertEqual(code, 1, out)
        self.assertIn("E1", out)

    def test_changed_only_defers_a_route_the_diff_did_not_touch(self):
        d = make_repo({"src/api.py": UNGUARDED_PY, "src/other.py": "x = 1\n",
                       "package.json": CLEAN_PKG})
        subprocess.run(["git", "checkout", "-qb", "feat"], cwd=d, check=True)
        with open(os.path.join(d, "src", "other.py"), "w") as fh:
            fh.write("x = 2\n")
        for cmd in (["git", "add", "-A"], ["git", "commit", "-qm", "unrelated"]):
            subprocess.run(cmd, cwd=d, check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        code, out = run(d, "--routes", "--changed-only", "--base", "master")
        self.assertEqual(code, 0, out)
        self.assertIn("deferred by the ratchet", out)

    def test_an_uncomputable_diff_checks_everything_rather_than_exempting_it(self):
        # The ratchet failing open would exempt every route in the repo and
        # print OK — a gate passing because it looked at nothing.
        d = make_repo({"src/api.py": UNGUARDED_PY, "package.json": CLEAN_PKG})
        code, out = run(d, "--routes", "--changed-only", "--base", "no/such/ref")
        self.assertEqual(code, 1, out)
        self.assertIn("could not diff", out)


# ---------------------------------------------------------------------------
# Regression: the gate must never be a finding against the tooling it ships.
#
# `scripts/gate_platform_auth.py` is a tracked .py under `scripts/` -- a
# directory SKIP_DIR does not cover -- so the gate SCANNED ITSELF and matched
# its own detector strings:
#
#     Z3  scripts/gate_platform_auth.py:475   <- the Z3 detector regex
#     Z2  scripts/gate_platform_auth.py:489   <- the Z2 finding message
#     F1  scripts/gate_platform_auth.py:1055  <- its own `return True`
#
# Measured 2026-09-03, that produced an identical fatal set on the DEFAULT
# BRANCH of FuzeDeploy, FuzeKeys, FuzeMarket, FuzePlan and MendysRobotics --
# a red gate that no change to those repos could ever clear, which is how a
# security gate gets trained into background noise.
#
# The skip is scoped to governance-managed files, so the paired assertion
# below matters as much as the first: identical offending code in the repo's
# OWN source is still reported. A skip that silenced both would be vacuous.
# ---------------------------------------------------------------------------

DIRECT_SDK = """import permitio
from permitio import Permit

permit = Permit(token="x")


def can(user, action, resource):
    return permit.check(user, action, resource)
"""

MANAGED_MANIFEST = json.dumps({
    "schemaVersion": 1,
    "files": {"scripts/gate_platform_auth.py": {"mode": "managed"}},
})


class GovernanceManagedFilesAreNotScanned(unittest.TestCase):
    def test_managed_gate_script_is_not_reported(self):
        repo = make_repo({
            "scripts/gate_platform_auth.py": DIRECT_SDK,
            ".fuze/installed.json": MANAGED_MANIFEST,
        })
        _, out = run(repo)
        self.assertNotIn(
            "scripts/gate_platform_auth.py", out,
            "the governance-managed gate script must not be scanned: it is "
            "FuzeSDLC tooling shipped into the repo, overwritten by "
            "governance-sync, so a finding against it is never actionable")

    def test_the_same_code_in_repo_source_IS_still_reported(self):
        """The paired half. If this ever passes, the skip has gone vacuous."""
        repo = make_repo({
            "scripts/gate_platform_auth.py": DIRECT_SDK,
            "src/svc.py": DIRECT_SDK,
            ".fuze/installed.json": MANAGED_MANIFEST,
        })
        rc, out = run(repo)
        self.assertIn("src/svc.py", out,
                      "identical code in the repo's OWN source must still be "
                      "flagged -- the skip is scoped, not a blanket silence")
        self.assertNotEqual(rc, 0, "a real finding must still fail the gate")

    def test_unmanaged_entry_is_still_scanned(self):
        """Being listed is not enough; only mode == managed is skipped."""
        repo = make_repo({
            "src/svc.py": DIRECT_SDK,
            ".fuze/installed.json": json.dumps({
                "schemaVersion": 1,
                "files": {"src/svc.py": {"mode": "unmanaged"}},
            }),
        })
        _, out = run(repo)
        self.assertIn("src/svc.py", out)

    def test_missing_or_broken_manifest_degrades_to_scanning_everything(self):
        """A gate that crashes on a malformed manifest is worse than a noisy
        one, and silently skipping everything would be worse still."""
        for manifest in (None, "{not json", '{"files": []}'):
            files = {"src/svc.py": DIRECT_SDK}
            if manifest is not None:
                files[".fuze/installed.json"] = manifest
            repo = make_repo(files)
            rc, out = run(repo)
            self.assertIn("src/svc.py", out,
                          "manifest=%r must not suppress real findings" % manifest)


# ---------------------------------------------------------------------------
# Regression: `<anything>.get("x")` is not an HTTP route.
#
# JS_ROUTE's `owner` is any identifier on purpose -- real routers are named all
# sorts of things (`r`, `v1`, `apiRouter`) -- so the first-argument check was
# the only thing between that breadth and a reported route. It accepted any
# string literal, so every map/cache/header/URLSearchParams read became an
# unguarded HTTP route.
#
# Measured on FuzeMarket 2026-09-03: ALL EIGHT of its E1 findings were this,
# and it had zero real detected routes. Requiring the leading "/" costs nothing
# real -- an Express path is matched against req.path, which always starts with
# "/", so `app.get("users")` can never match a request.
# ---------------------------------------------------------------------------

SEARCH_PARAMS = """
export function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const u = url.searchParams.get("url");
  const days = Number(url.searchParams.get("days")) || 28;
  const ct = res.headers.get("content-type");
  const cached = cache.get("some-key");
  return { u, days, ct, cached };
}
"""

REAL_ROUTE = """
app.get('/api/v1/items', (req, res) => res.json([]));
"""


class NonRouteGetCallsAreNotRoutes(unittest.TestCase):
    def test_searchparams_and_map_gets_are_not_reported_as_routes(self):
        repo = make_repo({"src/handler.js": SEARCH_PARAMS,
                          "package.json": CLEAN_PKG})
        rc, out = run(repo)
        for phantom in ("GET /url", "GET /days", "GET /content-type",
                        "GET /some-key"):
            self.assertNotIn(
                phantom, out,
                "%r came from a non-route .get() call and must not be "
                "reported as an HTTP route" % phantom)

    def test_a_real_route_is_STILL_detected(self):
        """The paired half: narrowing must not blind the gate to real routes."""
        repo = make_repo({"src/server.js": REAL_ROUTE,
                          "package.json": CLEAN_PKG})
        rc, out = run(repo)
        self.assertIn("/api/v1/items", out,
                      "a genuine leading-slash route must still be found")
        self.assertNotEqual(rc, 0,
                            "an unguarded real route must still fail the gate")

    def test_mixed_file_reports_only_the_real_route(self):
        repo = make_repo({"src/mixed.js": REAL_ROUTE + SEARCH_PARAMS,
                          "package.json": CLEAN_PKG})
        _, out = run(repo)
        self.assertIn("/api/v1/items", out)
        self.assertNotIn("GET /url", out)
        self.assertNotIn("GET /days", out)
