"""Tests for gate-openapi-conformance.

Same governing principle as test_gate_identifier and test_gate_platform_auth:
these assert the gate FIRES on a divergence, not merely that it passes on a
matching pair. Passing is not evidence.

The two mutations that matter are the two ways a contract goes false, and they
fail in opposite directions:

  delete a handler   the spec keeps promising an operation that now 404s
  add a handler      the service grows a surface no consumer can discover

A gate that catches only one of those is half a gate, so both are pinned here.

`ResolverDoesNotManufactureDrift` exists because the first working version DID.
It missed `import x, { y } from '...'` and reported twelve live billing
operations as unimplemented. A false finding is not a cosmetic problem in a
gate: it is how the gate loses the reader, and then its enforcement.
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest

REPO = os.path.dirname(os.path.dirname(os.path.abspath(os.path.dirname(__file__))))
GATE = os.path.join(REPO, "scripts", "gate_openapi_conformance.py")


def make_repo(files):
    d = tempfile.mkdtemp()
    for rel, body in files.items():
        p = os.path.join(d, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w", encoding="utf-8") as fh:
            fh.write(body)
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


SPEC = json.dumps({
    "openapi": "3.1.0",
    "servers": [{"url": "{baseUrl}/api/v1/things"}],
    "paths": {
        "/items": {"get": {}, "post": {}},
        "/items/{id}": {"get": {}},
    },
})

INDEX = """
import express from 'express';
import itemRoutes from './routes/items';
const app = express();
app.use('/api/v1/things', itemRoutes);
"""

ROUTES = """
const router = express.Router();
router.get('/items', h);
router.post('/items', h);
router.get('/items/:id', h);
export default router;
"""

BASE = {"openapi.json": SPEC, "src/index.ts": INDEX, "src/routes/items.ts": ROUTES}


class MatchingPairPasses(unittest.TestCase):
    def test_spec_and_code_that_agree_report_ok(self):
        code, out = run(make_repo(BASE))
        self.assertEqual(code, 0, out)
        self.assertIn("3 matched", out)

    def test_the_census_prints_even_on_success(self):
        # "OK" alone cannot be distinguished from "compared nothing".
        _, out = run(make_repo(BASE))
        self.assertIn("documented operation(s)", out)


class BothDirectionsOfDriftAreCaught(unittest.TestCase):
    def test_deleting_a_handler_is_reported(self):
        files = dict(BASE)
        files["src/routes/items.ts"] = ROUTES.replace("router.get('/items/:id', h);\n", "")
        code, out = run(make_repo(files))
        self.assertEqual(code, 1, out)
        self.assertIn("O2", out)
        self.assertIn("/api/v1/things/items/{}", out)

    def test_adding_an_undocumented_handler_is_reported(self):
        files = dict(BASE)
        files["src/routes/items.ts"] = ROUTES + "router.delete('/items/:id', h);\n"
        code, out = run(make_repo(files))
        self.assertEqual(code, 1, out)
        self.assertIn("O1", out)

    def test_a_method_the_spec_does_not_declare_is_not_covered_by_a_sibling(self):
        # GET /items being documented must not excuse DELETE /items.
        files = dict(BASE)
        files["src/routes/items.ts"] = ROUTES + "router.delete('/items', h);\n"
        code, out = run(make_repo(files))
        self.assertEqual(code, 1, out)
        self.assertIn("DELETE", out)


class ResolverDoesNotManufactureDrift(unittest.TestCase):
    """The regression that motivated this class: a default+named import.

    `import billingRoutes, { billingWebhookRouter } from './routes/billing'`
    did not match the original import pattern, so the router read as unmounted
    and every operation it serves was reported as unimplemented.
    """

    def test_default_plus_named_import_still_resolves_the_mount(self):
        files = dict(BASE)
        files["src/index.ts"] = INDEX.replace(
            "import itemRoutes from './routes/items';",
            "import itemRoutes, { extra } from './routes/items';")
        code, out = run(make_repo(files))
        self.assertEqual(code, 0, out)
        self.assertIn("3 matched", out)

    def test_a_nested_router_composes_its_parents_prefix(self):
        files = dict(BASE)
        files["src/index.ts"] = """
import express from 'express';
import outer from './routes/outer';
const app = express();
app.use('/api/v1/things', outer);
"""
        files["src/routes/outer.ts"] = """
import inner from './inner';
const router = express.Router();
router.use('/', inner);
export default router;
"""
        files["src/routes/inner.ts"] = ROUTES
        del files["src/routes/items.ts"]
        code, out = run(make_repo(files))
        self.assertEqual(code, 0, out)
        self.assertIn("3 matched", out)

    def test_a_route_whose_prefix_cannot_be_resolved_is_unresolved_not_drift(self):
        # An orphan router nobody mounts must be named as the GATE failing to
        # see, never counted as an undocumented endpoint.
        files = dict(BASE)
        files["src/routes/orphan.ts"] = (
            "const r = express.Router();\nr.get('/nowhere', h);\nexport default r;\n")
        _, out = run(make_repo(files))
        self.assertIn("unresolved", out)


class GatewayedServiceMatchesOnItsOwnSpelling(unittest.TestCase):
    """A service behind a gateway mounts at ITS root while its spec describes
    the public path. Both are correct and they differ; reporting that as drift
    was what made the first version unusable on a real repo."""

    def test_service_serving_the_raw_path_counts_as_implemented(self):
        files = {
            "svc/openapi.json": SPEC,
            "svc/src/main.ts": (
                "import express from 'express';\n"
                "import itemRoutes from './routes/items';\n"
                "const app = express();\napp.use('/', itemRoutes);\n"),
            "svc/src/routes/items.ts": ROUTES,
        }
        code, out = run(make_repo(files))
        self.assertEqual(code, 0, out)
        self.assertIn("3 matched", out)


class ExemptionsAreDeclaredAndNarrow(unittest.TestCase):
    def test_an_exemption_with_a_reason_is_honoured(self):
        files = dict(BASE)
        files["src/routes/items.ts"] = ROUTES + "router.delete('/items/:id', h);\n"
        files["governance/openapi-exempt.txt"] = (
            "DELETE /api/v1/things/items/{}  # internal admin purge, never published\n")
        code, out = run(make_repo(files))
        self.assertEqual(code, 0, out)

    def test_an_exemption_without_a_reason_does_not_apply(self):
        files = dict(BASE)
        files["src/routes/items.ts"] = ROUTES + "router.delete('/items/:id', h);\n"
        files["governance/openapi-exempt.txt"] = "DELETE /api/v1/things/items/{}\n"
        code, out = run(make_repo(files))
        self.assertEqual(code, 1, out)
        self.assertIn("O4", out)


class UnreadableIsNotConformant(unittest.TestCase):
    def test_an_unparsable_spec_is_a_finding_not_a_skip(self):
        files = dict(BASE)
        files["openapi.json"] = "{ not json"
        code, out = run(make_repo(files))
        self.assertEqual(code, 1, out)
        self.assertIn("O3", out)

    def test_a_spec_with_zero_operations_is_a_finding(self):
        # Otherwise the gate compares nothing and reports success.
        files = dict(BASE)
        files["openapi.json"] = json.dumps({"openapi": "3.1.0", "paths": {}})
        code, out = run(make_repo(files))
        self.assertEqual(code, 1, out)
        self.assertIn("O3", out)

    def test_a_repo_with_no_spec_is_not_a_failure(self):
        code, out = run(make_repo({"src/index.ts": INDEX, "src/routes/items.ts": ROUTES}))
        self.assertEqual(code, 0, out)
        self.assertIn("no OpenAPI document", out)


class RatchetDefersBacklogButNotNewDrift(unittest.TestCase):
    def _repo_with_history(self, mutate):
        d = make_repo(BASE)
        subprocess.run(["git", "checkout", "-qb", "feat"], cwd=d, check=True)
        mutate(d)
        for cmd in (["git", "add", "-A"], ["git", "commit", "-qm", "m"]):
            subprocess.run(cmd, cwd=d, check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return d

    def test_a_handler_this_diff_deletes_still_fails(self):
        def mutate(d):
            p = os.path.join(d, "src", "routes", "items.ts")
            with open(p, "w") as fh:
                fh.write(ROUTES.replace("router.get('/items/:id', h);\n", ""))
        d = self._repo_with_history(mutate)
        code, out = run(d, "--changed-only", "--base", "master")
        self.assertEqual(code, 1, out)
        self.assertIn("O2", out)

    def test_pre_existing_drift_elsewhere_does_not_fail_the_pr(self):
        d = make_repo({**BASE,
                       "src/routes/items.ts": ROUTES + "router.delete('/items', h);\n",
                       "docs/notes.md": "x\n"})
        subprocess.run(["git", "checkout", "-qb", "feat"], cwd=d, check=True)
        with open(os.path.join(d, "docs", "notes.md"), "w") as fh:
            fh.write("y\n")
        for cmd in (["git", "add", "-A"], ["git", "commit", "-qm", "m"]):
            subprocess.run(cmd, cwd=d, check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        code, out = run(d, "--changed-only", "--base", "master")
        self.assertEqual(code, 0, out)
        self.assertIn("debt, not clearance", out)

    def test_an_uncomputable_diff_checks_everything(self):
        files = dict(BASE)
        files["src/routes/items.ts"] = ROUTES + "router.delete('/items', h);\n"
        code, out = run(make_repo(files), "--changed-only", "--base", "no/such/ref")
        self.assertEqual(code, 1, out)
        self.assertIn("could not diff", out)
