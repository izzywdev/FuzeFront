#!/usr/bin/env python3
"""Self-tests for gate_openapi_conformance.

Weighted deliberately toward asserting the gate FAILS. A conformance gate that
only proves "passes on a clean tree" proves nothing: `sys.exit(0)` passes on a
clean tree too. Every failure mode this gate claims to detect has a test that
would go green if the detection were removed.
"""

import os
import subprocess
import sys
import tempfile
import textwrap
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
GATE = os.path.join(os.path.dirname(HERE), "gate_openapi_conformance.py")


def build_repo(root, spec_paths, app_src, router_src=None, allowlist=None,
               servers=None, name="demo", spec=True):
    """Materialise a minimal services/<name>/{openapi.yaml,src/} tree."""
    svc = os.path.join(root, "services", name)
    src = os.path.join(svc, "src")
    os.makedirs(src, exist_ok=True)

    if spec:
        lines = ["openapi: 3.0.0", "info:", f"  title: {name}", "  version: 1.0.0"]
        if servers:
            lines += ["servers:"] + [f"  - url: {servers}"]
        lines.append("paths:")
        for path, methods in spec_paths.items():
            lines.append(f"  {path}:")
            for m in methods:
                lines.append(f"    {m}:")
                lines.append("      responses:")
                lines.append("        '200': { description: ok }")
        with open(os.path.join(svc, "openapi.yaml"), "w", encoding="utf-8") as fh:
            fh.write("\n".join(lines) + "\n")

    with open(os.path.join(src, "app.ts"), "w", encoding="utf-8") as fh:
        fh.write(textwrap.dedent(app_src))
    if router_src is not None:
        with open(os.path.join(src, "routes.ts"), "w", encoding="utf-8") as fh:
            fh.write(textwrap.dedent(router_src))
    if allowlist is not None:
        gov = os.path.join(root, "governance")
        os.makedirs(gov, exist_ok=True)
        with open(os.path.join(gov, "openapi-conformance-allowlist.txt"), "w", encoding="utf-8") as fh:
            fh.write(allowlist)


def run(root):
    p = subprocess.run([sys.executable, GATE, "--repo", root],
                       capture_output=True, text=True)
    return p.returncode, p.stdout + p.stderr


CLEAN_APP = """
    import { createThing } from './routes';
    export const createApp = () => {
      const app = express();
      app.use(express.json());
      app.use('/v1', createThing());
      return app;
    };
"""
CLEAN_ROUTES = """
    export function createThing() {
      const router = Router();
      router.get('/things', h);
      router.post('/things', h);
      return router;
    }
"""


class ConformanceTests(unittest.TestCase):
    def test_conformant_tree_passes(self):
        with tempfile.TemporaryDirectory() as root:
            build_repo(root, {"/v1/things": ["get", "post"]}, CLEAN_APP, CLEAN_ROUTES)
            rc, out = run(root)
            self.assertEqual(rc, 0, out)

    def test_missing_endpoint_fails(self):
        """Declared in the contract, not implemented -> a consumer gets a 404."""
        with tempfile.TemporaryDirectory() as root:
            build_repo(root,
                       {"/v1/things": ["get", "post"], "/v1/gone": ["get"]},
                       CLEAN_APP, CLEAN_ROUTES)
            rc, out = run(root)
            self.assertEqual(rc, 1, out)
            self.assertIn("MISSING", out)
            self.assertIn("/v1/gone", out)

    def test_undocumented_endpoint_fails(self):
        """Implemented but absent from the contract — unreviewed surface."""
        with tempfile.TemporaryDirectory() as root:
            build_repo(root, {"/v1/things": ["get"]}, CLEAN_APP, CLEAN_ROUTES)
            rc, out = run(root)
            self.assertEqual(rc, 1, out)
            self.assertIn("UNDOCUMENTED", out)
            self.assertIn("POST", out)

    def test_unresolved_mount_fails_rather_than_being_skipped(self):
        """The routes hardest to parse are the likeliest to be undocumented.

        Skipping them would bias the gate toward passing on exactly the cases it
        exists to catch, so an unresolvable mount is a failure.
        """
        with tempfile.TemporaryDirectory() as root:
            build_repo(root, {"/v1/things": ["get", "post"]},
                       CLEAN_APP + "\napp.use('/v2', mysteryRouter);\n", CLEAN_ROUTES)
            rc, out = run(root)
            self.assertEqual(rc, 1, out)
            self.assertIn("UNRESOLVED", out)

    def test_zero_routes_is_a_failure_not_a_pass(self):
        """The vacuity guard: finding nothing must never read as conformant."""
        with tempfile.TemporaryDirectory() as root:
            build_repo(root, {"/v1/things": ["get"]},
                       "export const createApp = () => express();\n")
            rc, out = run(root)
            self.assertEqual(rc, 1, out)
            self.assertIn("ZERO routes", out)

    def test_no_services_is_a_config_error_not_a_pass(self):
        with tempfile.TemporaryDirectory() as root:
            rc, out = run(root)
            self.assertEqual(rc, 2, out)
            self.assertIn("NOTHING to check", out)

    def test_allowlist_excuses_an_undocumented_route(self):
        with tempfile.TemporaryDirectory() as root:
            build_repo(root, {"/v1/things": ["get"]}, CLEAN_APP, CLEAN_ROUTES,
                       allowlist="POST /v1/things  # deliberately outside the contract\n")
            rc, out = run(root)
            self.assertEqual(rc, 0, out)

    def test_param_naming_difference_is_not_a_violation(self):
        """`:id` vs `{listId}` is a documentation nit, not a contract breach.

        Failing on it would train people to ignore this gate, which costs more
        than it buys.
        """
        with tempfile.TemporaryDirectory() as root:
            build_repo(root, {"/v1/things/{listId}": ["get"]},
                       CLEAN_APP,
                       "export function createThing() {\n"
                       "  const router = Router();\n"
                       "  router.get('/things/:id', h);\n"
                       "  return router;\n}\n")
            rc, out = run(root)
            self.assertEqual(rc, 0, out)

    def test_express_middleware_is_not_mistaken_for_a_router(self):
        """`app.use(express.json())` must not be reported UNRESOLVED."""
        with tempfile.TemporaryDirectory() as root:
            build_repo(root, {"/v1/things": ["get", "post"]},
                       CLEAN_APP + "\napp.use(cors());\napp.use(helmet());\n",
                       CLEAN_ROUTES)
            rc, out = run(root)
            self.assertEqual(rc, 0, out)


class ServerBaseTests(unittest.TestCase):
    """`servers[].url` is the frame the contract's paths are written in.

    Ignoring it reported every billing- and payment-service endpoint as BOTH
    missing and undocumented — 26 findings that were one prefix. That is the
    precise failure that teaches a team to ignore a gate.
    """

    def test_code_mounting_the_public_base_is_conformant(self):
        with tempfile.TemporaryDirectory() as root:
            build_repo(root, {"/things": ["get"]},
                       "const app = express();\napp.use('/api/v1/demo', r);\n",
                       "export function r() {\n  const router = Router();\n"
                       "  router.get('/things', h);\n  return router;\n}\n",
                       servers="/api/v1/demo")
            # app.ts references `r` as a bare identifier; import it so it resolves.
            app = os.path.join(root, "services", "demo", "src", "app.ts")
            with open(app, "w", encoding="utf-8") as fh:
                fh.write("import { r } from './routes';\nconst app = express();\n"
                         "app.use('/api/v1/demo', r());\n")
            rc, out = run(root)
            self.assertEqual(rc, 0, out)
            self.assertIn("rebased off server base /api/v1/demo", out)

    def test_rebasing_does_not_hide_a_partial_mismatch(self):
        """Strip only when EVERY route carries the base — else it is a fudge."""
        with tempfile.TemporaryDirectory() as root:
            build_repo(root, {"/things": ["get"]}, "", servers="/api/v1/demo")
            app = os.path.join(root, "services", "demo", "src", "app.ts")
            with open(app, "w", encoding="utf-8") as fh:
                fh.write("import { r } from './routes';\nconst app = express();\n"
                         "app.use('/api/v1/demo', r());\napp.use('/elsewhere', r());\n")
            with open(os.path.join(root, "services", "demo", "src", "routes.ts"),
                      "w", encoding="utf-8") as fh:
                fh.write("export function r() {\n  const router = Router();\n"
                         "  router.get('/things', h);\n  return router;\n}\n")
            rc, out = run(root)
            self.assertEqual(rc, 1, out)
            self.assertNotIn("rebased", out)


class NoContractTests(unittest.TestCase):
    """A service with NO spec is the maximally undocumented case, not an exemption."""

    def test_service_without_a_spec_fails_on_any_real_route(self):
        """Serving routes with no contract is a finding, not a skip.

        It must fail on its own — NOT only when some sibling service happens to
        have a spec — because a repo whose services are ALL uncontracted is the
        worst case, and the version of this gate that keyed on "has a spec"
        reported that repo as having nothing to check.
        """
        with tempfile.TemporaryDirectory() as root:
            build_repo(root, {}, CLEAN_APP, CLEAN_ROUTES, spec=False)
            rc, out = run(root)
            self.assertEqual(rc, 1, out)
            self.assertIn("NO CONTRACT", out)
            self.assertIn("/v1/things", out)

            build_repo(root, {"/v1/things": ["get", "post"]}, CLEAN_APP, CLEAN_ROUTES,
                       name="contracted")
            rc, out = run(root)
            self.assertEqual(rc, 1, out)
            self.assertIn("NO CONTRACT", out)

    def test_a_stub_serving_only_allowlisted_routes_stays_quiet(self):
        """Otherwise every health-only stub reds CI and the gate gets disabled."""
        with tempfile.TemporaryDirectory() as root:
            build_repo(root, {"/v1/things": ["get", "post"]}, CLEAN_APP, CLEAN_ROUTES,
                       allowlist="GET /health\n")
            build_repo(root, {}, "const app = express();\napp.get('/health', h);\n",
                       name="stub", spec=False)
            rc, out = run(root)
            self.assertEqual(rc, 0, out)
            self.assertIn("all allowlisted", out)


class MiddlewareDeclarationTests(unittest.TestCase):
    def test_external_middleware_is_unresolved_until_declared(self):
        """`app.use(base, graphCreate({...}))` — imported from a package we cannot walk.

        The gate must not guess "probably middleware": guessing is how it stops
        catching a router it genuinely cannot see. The operator asserts it in a
        file that shows up in the diff, or it stays a finding.
        """
        app = ("import { graphCreate } from '@izzywdev/fuzefront-identity';\n"
               "import { createThing } from './routes';\n"
               "const app = express();\n"
               "app.use('/v1', graphCreate({ aggregate: new Set(['x']) }));\n"
               "app.use('/v1', createThing());\n")
        with tempfile.TemporaryDirectory() as root:
            build_repo(root, {"/v1/things": ["get", "post"]}, app, CLEAN_ROUTES)
            rc, out = run(root)
            self.assertEqual(rc, 1, out)
            self.assertIn("UNRESOLVED", out)
            self.assertIn("graphCreate", out)
        with tempfile.TemporaryDirectory() as root:
            build_repo(root, {"/v1/things": ["get", "post"]}, app, CLEAN_ROUTES,
                       allowlist="middleware graphCreate\n")
            rc, out = run(root)
            self.assertEqual(rc, 0, out)


class ExtractorTests(unittest.TestCase):
    def test_default_export_router_resolves_through_the_import(self):
        """The fleet's dominant idiom, and the one a name-keyed table cannot see.

        A global export-name table resolved ZERO routes in four of six real
        services for exactly this reason: `export default router` has no name.
        """
        with tempfile.TemporaryDirectory() as root:
            build_repo(root, {"/v1/things": ["get"]},
                       "import listsRouter from './routes';\n"
                       "const app = express();\napp.use('/v1', listsRouter);\n",
                       "const router = Router();\nrouter.get('/things', h);\n"
                       "export default router;\n")
            rc, out = run(root)
            self.assertEqual(rc, 0, out)

    def test_a_router_after_middleware_args_is_still_found(self):
        """`app.use(BASE, guard, createXRouter(deps))`, often across five lines."""
        with tempfile.TemporaryDirectory() as root:
            build_repo(root, {"/v1/things": ["get"]},
                       "import { createThing } from './routes';\n"
                       "const API_BASE = '/v1';\nconst app = express();\n"
                       "app.use(\n  API_BASE,\n  guard,\n"
                       "  createThing({ a: 1, b: [2, 3] }),\n);\n",
                       "export function createThing() {\n  const router = Router();\n"
                       "  router.get('/things', h);\n  return router;\n}\n")
            rc, out = run(root)
            self.assertEqual(rc, 0, out)

    def test_a_non_router_client_call_is_not_mistaken_for_a_route(self):
        """`axios.get('/upstream')` is an outbound call, not served surface."""
        with tempfile.TemporaryDirectory() as root:
            build_repo(root, {"/v1/things": ["get", "post"]}, CLEAN_APP,
                       CLEAN_ROUTES + "\nasync function f() {\n"
                       "  await axios.get('/upstream/thing');\n"
                       "  await http.get('/other');\n}\n")
            rc, out = run(root)
            self.assertEqual(rc, 0, out)


if __name__ == "__main__":
    unittest.main(verbosity=2)
