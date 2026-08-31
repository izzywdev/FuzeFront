"""Tests for scripts/gate_api_version.py.

These deliberately assert that the gate **FAILS** on a violation, not only that
it passes on a clean tree. Passing is not evidence — this repo has been bitten
by a check that was green solely because it always took an early-exit path.

The fail-closed cases matter as much as the violation cases: a gate that reports
"clean" when it could not actually read the spec is worse than no gate, because
it launders an unknown into an assurance.

Run: python -m unittest discover -s scripts/__tests__ -p 'test_*.py'
"""
from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import textwrap
import unittest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
GATE = os.path.join(REPO_ROOT, "scripts", "gate_api_version.py")


def run_gate(root: str, *flags: str, env: dict | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, GATE, root, *flags],
        capture_output=True, text=True, timeout=180,
        env={**os.environ, **(env or {})},
    )


class SyntheticRepo:
    """A throwaway git repo — the gate walks `git ls-files`, so it needs one."""

    def __init__(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = self._tmp.name
        subprocess.run(["git", "init", "-q", self.root], check=True)

    def write(self, rel: str, content: str) -> None:
        path = os.path.join(self.root, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(textwrap.dedent(content).lstrip("\n"))

    def spec(self, *routes: str, name: str = "contracts/openapi.yaml") -> None:
        body = "\n".join(f"  {r}:\n    get:\n      responses:\n        '200': {{description: ok}}"
                         for r in routes)
        self.write(name, f"openapi: 3.0.0\ninfo:\n  title: t\n  version: '1'\npaths:\n{body}\n")

    def commit(self) -> None:
        subprocess.run(["git", "-C", self.root, "add", "-A"], check=True)
        subprocess.run(
            ["git", "-C", self.root, "-c", "user.email=t@t", "-c", "user.name=t",
             "commit", "-qm", "fixture"], check=True,
        )

    def __enter__(self) -> "SyntheticRepo":
        return self

    def __exit__(self, *exc) -> None:
        self._tmp.cleanup()


class TestContractCheck(unittest.TestCase):

    def test_fails_on_unversioned_route(self):
        with SyntheticRepo() as repo:
            repo.spec("/api/accounts", "/api/v1/identities")
            repo.commit()
            res = run_gate(repo.root)
            self.assertEqual(res.returncode, 1, res.stdout + res.stderr)
            self.assertIn("/api/accounts", res.stdout)
            self.assertNotIn("/api/v1/identities", res.stdout.split("Every HTTP route")[0])

    def test_passes_when_every_route_is_versioned(self):
        with SyntheticRepo() as repo:
            repo.spec("/api/v1/identities", "/api/v1/accounts/{id}", "/api/v2/things")
            repo.commit()
            res = run_gate(repo.root)
            self.assertEqual(res.returncode, 0, res.stdout + res.stderr)

    def test_operational_endpoints_are_exempt(self):
        with SyntheticRepo() as repo:
            repo.spec("/", "/health", "/metrics", "/openapi.json", "/.well-known/jwks.json")
            repo.commit()
            self.assertEqual(run_gate(repo.root).returncode, 0)

    def test_api_prefixed_operational_paths_are_exempt(self):
        """A probe reached from OUTSIDE the cluster must traverse the ingress, and the
        family's ingresses route `/api/*` to the backend — a bare /health is frequently
        not publicly reachable. So the black-box pollers use /api/health:
        prod-smoke.yml polls it until 200, and prod-post-deploy.yml waits for the Argo
        rollout and then polls it on a 360s budget.

        Without this exemption the gate says "version it", the backend starter obeys,
        and every repo adopting both the starter and the family's post-deploy workflow
        gets a gate polling a path its own backend does not serve — 360 seconds of
        waiting, then a failure, for a perfectly healthy service. Same shape as a
        workflow stamped `branches: [main]` into a `master` repo: it does not error, it
        simply never succeeds.
        """
        with SyntheticRepo() as repo:
            repo.spec("/api/health", "/api/healthz", "/api/ready", "/api/metrics")
            repo.commit()
            res = run_gate(repo.root)
            self.assertEqual(res.returncode, 0, res.stdout + res.stderr)

    def test_api_prefixed_exemption_does_not_leak_to_real_resources(self):
        """The negative control. Exempting /api/health must not exempt /api/<anything>,
        or the gate is off for the whole API surface."""
        for bad in ("/api/healthcheck", "/api/health-report", "/api/accounts"):
            with SyntheticRepo() as repo:
                repo.spec(bad)
                repo.commit()
                self.assertEqual(run_gate(repo.root).returncode, 1, bad)

    def test_near_miss_prefixes_do_not_count_as_versioned(self):
        """/apiv1 and /api/version are not /api/v{N}/."""
        for bad in ("/apiv1/things", "/api/version/things", "/api/v0/things", "/v1/things"):
            with SyntheticRepo() as repo:
                repo.spec(bad)
                repo.commit()
                res = run_gate(repo.root)
                self.assertEqual(res.returncode, 1, f"{bad} should fail: {res.stdout}")

    def test_allowlisted_route_is_tolerated(self):
        with SyntheticRepo() as repo:
            repo.spec("/api/legacy-webhook")
            repo.write("governance/api-version-allowlist.txt",
                       "# predates the standard\n/api/legacy-webhook\n")
            repo.commit()
            self.assertEqual(run_gate(repo.root).returncode, 0)

    def test_allowlist_does_not_excuse_a_different_route(self):
        with SyntheticRepo() as repo:
            repo.spec("/api/legacy-webhook", "/api/brand-new")
            repo.write("governance/api-version-allowlist.txt", "/api/legacy-webhook\n")
            repo.commit()
            res = run_gate(repo.root)
            self.assertEqual(res.returncode, 1)
            self.assertIn("/api/brand-new", res.stdout)

    def test_repo_with_no_api_surface_passes(self):
        with SyntheticRepo() as repo:
            repo.write("README.md", "a library, no HTTP surface\n")
            repo.commit()
            self.assertEqual(run_gate(repo.root).returncode, 0)

    def test_non_spec_yaml_named_like_one_is_ignored(self):
        with SyntheticRepo() as repo:
            repo.write("swagger-ui.yml", "theme: dark\n")
            repo.commit()
            self.assertEqual(run_gate(repo.root).returncode, 0)


class TestFailsClosed(unittest.TestCase):
    """Undecidable must never render as clean."""

    def test_unparseable_spec_fails(self):
        with SyntheticRepo() as repo:
            repo.write("contracts/openapi.yaml", "openapi: 3.0.0\npaths:\n  - [unbalanced\n")
            repo.commit()
            res = run_gate(repo.root)
            self.assertEqual(res.returncode, 1, res.stdout)
            self.assertIn("gate-api-version", res.stdout)

    def test_spec_without_paths_fails(self):
        with SyntheticRepo() as repo:
            repo.write("contracts/openapi.yaml", "openapi: 3.0.0\ninfo:\n  title: t\n")
            repo.commit()
            res = run_gate(repo.root)
            self.assertEqual(res.returncode, 1, res.stdout)
            self.assertIn("failing closed", res.stdout)

    def test_unreadable_allowlist_fails(self):
        with SyntheticRepo() as repo:
            repo.spec("/api/v1/ok")
            path = os.path.join(repo.root, "governance", "api-version-allowlist.txt")
            os.makedirs(os.path.dirname(path), exist_ok=True)
            open(path, "w").close()
            repo.commit()
            os.chmod(path, 0o000)
            try:
                res = run_gate(repo.root)
                if os.geteuid() == 0:
                    self.skipTest("running as root; chmod 000 is not enforced")
                self.assertEqual(res.returncode, 1, res.stdout)
            finally:
                os.chmod(path, 0o644)


class TestCallerCheck(unittest.TestCase):
    """The half that would have caught the real bug: server right, client wrong."""

    def test_fails_on_hardcoded_unversioned_path(self):
        with SyntheticRepo() as repo:
            repo.write("src/pages/Accounts.tsx",
                       "const r = await fetch('/api/accounts');\n")
            repo.commit()
            res = run_gate(repo.root, "--callers")
            self.assertEqual(res.returncode, 1, res.stdout)
            self.assertIn("/api/accounts", res.stdout)
            self.assertIn("Accounts.tsx", res.stdout)

    def test_versioned_caller_passes(self):
        with SyntheticRepo() as repo:
            repo.write("src/api.ts", "const base = `${origin}/api/v1`;\n")
            repo.commit()
            self.assertEqual(run_gate(repo.root, "--callers").returncode, 0)

    def test_template_literal_path_is_caught(self):
        with SyntheticRepo() as repo:
            repo.write("src/svc.ts", "fetch(`/api/identities`);\n")
            repo.commit()
            res = run_gate(repo.root, "--callers")
            self.assertEqual(res.returncode, 1, res.stdout)

    def test_path_after_a_template_interpolation_is_caught(self):
        """`${base}/api/identities` -- how half the motivating bug was written."""
        with SyntheticRepo() as repo:
            repo.write("src/svc.ts",
                       "const r = await fetch(`${this.baseUrl}/api/identities`);\n")
            repo.commit()
            res = run_gate(repo.root, "--callers")
            self.assertEqual(res.returncode, 1, res.stdout)
            self.assertIn("/api/identities", res.stdout)

    def test_versioned_path_after_interpolation_passes(self):
        with SyntheticRepo() as repo:
            repo.write("src/svc.ts", "fetch(`${origin}/api/v1/sites`);\n")
            repo.commit()
            self.assertEqual(run_gate(repo.root, "--callers").returncode, 0)

    def test_path_inside_a_comment_is_not_a_violation(self):
        """A note recording the path that was just fixed must not fail the commit
        that fixed it. Found the hard way: the gate flagged its own fix's comments."""
        with SyntheticRepo() as repo:
            repo.write("src/fixed.ts",
                       "// Was fetch('/api/accounts') -- un-versioned, now corrected.\n"
                       "const r = await apiClient.get('/accounts/');\n")
            repo.write("src/fixed.py", "# legacy '/api/identities' is gone\n")
            repo.commit()
            res = run_gate(repo.root, "--callers")
            self.assertEqual(res.returncode, 0, res.stdout)

    def test_trailing_comment_after_code_is_still_scanned(self):
        """Only whole-line comments are skipped -- imprecise in the safe direction."""
        with SyntheticRepo() as repo:
            repo.write("src/sneaky.ts", "fetch('/api/accounts'); // still a real call\n")
            repo.commit()
            self.assertEqual(run_gate(repo.root, "--callers").returncode, 1)

    def test_health_probe_in_client_is_exempt(self):
        with SyntheticRepo() as repo:
            repo.write("src/probe.ts", "fetch('/health');\n")
            repo.commit()
            self.assertEqual(run_gate(repo.root, "--callers").returncode, 0)


class TestCallerCheckSkipsTests(unittest.TestCase):
    """Test sources are not callers.

    The point of the exclusion is that the best regression test for this
    standard asserts an un-versioned path is ABSENT. Flagging that would force
    the author to delete the assertion or allowlist the path, and the allowlist
    entry would then blind the gate to the real callers too.

    Every "is skipped" case below is paired with a check that a NON-test file in
    the same repo is still caught, so the exclusion can never quietly widen into
    "the caller check does nothing".
    """

    def test_python_test_file_is_skipped(self):
        with SyntheticRepo() as repo:
            repo.write(
                "backend/tests/test_accounts.py",
                """
                async def test_unversioned_path_is_not_served(client):
                    response = await client.get("/api/accounts")
                    assert response.status_code == 404
                """,
            )
            repo.commit()
            self.assertEqual(run_gate(repo.root, "--callers").returncode, 0)

    def test_jest_spec_file_is_skipped(self):
        with SyntheticRepo() as repo:
            repo.write("src/Accounts.test.tsx", "expect('/api/accounts').toBe(x);\n")
            repo.write("src/Other.spec.ts", "expect('/api/identities').toBe(y);\n")
            repo.commit()
            self.assertEqual(run_gate(repo.root, "--callers").returncode, 0)

    def test_go_test_file_is_skipped(self):
        with SyntheticRepo() as repo:
            repo.write("internal/api/handler_test.go", 'p := "/api/accounts"\n')
            repo.commit()
            self.assertEqual(run_gate(repo.root, "--callers").returncode, 0)

    def test_tests_directory_is_skipped_whatever_the_filename(self):
        """A helper living under a test directory is test code too."""
        with SyntheticRepo() as repo:
            repo.write("e2e/fixtures/paths.ts", "export const LEGACY = '/api/accounts';\n")
            repo.write("__tests__/helpers.js", "const p = '/api/identities';\n")
            repo.commit()
            self.assertEqual(run_gate(repo.root, "--callers").returncode, 0)

    def test_production_file_is_still_caught_alongside_a_test_file(self):
        """The exclusion must not leak into the file next door."""
        with SyntheticRepo() as repo:
            repo.write(
                "backend/tests/test_accounts.py",
                'def test_absent(c):\n    assert c.get("/api/accounts").status_code == 404\n',
            )
            repo.write("src/pages/Accounts.tsx",
                       "const r = await fetch('/api/accounts');\n")
            repo.commit()
            res = run_gate(repo.root, "--callers")
            self.assertEqual(res.returncode, 1, res.stdout)
            self.assertIn("Accounts.tsx", res.stdout)
            self.assertNotIn("test_accounts.py", res.stdout)

    def test_a_source_file_merely_named_like_a_test_is_still_scanned(self):
        """`latest.py` / `contest.ts` must not slip through the name pattern."""
        with SyntheticRepo() as repo:
            repo.write("src/latest.py", 'URL = "/api/accounts"\n')
            repo.commit()
            res = run_gate(repo.root, "--callers")
            self.assertEqual(res.returncode, 1, res.stdout)
            self.assertIn("latest.py", res.stdout)

    def test_a_python_docstring_is_not_a_caller(self):
        """Documentation of the standard must not violate the standard.

        This gate's own module docstring says routes live under `/api/v{N}/`
        and warns about hardcoded `/api/...`. Scanning docstrings made the gate
        fail its own repository -- a rule that cannot be written down without
        breaking itself is not enforceable.
        """
        with SyntheticRepo() as repo:
            repo.write(
                "src/service.py",
                '''
                """Routes live under `/api/v{N}/`.

                Never hardcode `/api/accounts` -- it 404s.
                """


                def handler():
                    """Serves `/api/identities` in the old shape."""
                    return 1
                ''',
            )
            repo.commit()
            self.assertEqual(run_gate(repo.root, "--callers").returncode, 0)

    def test_code_beside_a_docstring_is_still_scanned(self):
        """The exemption is the docstring's own lines, not the file."""
        with SyntheticRepo() as repo:
            repo.write(
                "src/service.py",
                '''
                """Explains `/api/accounts` for the reader."""

                URL = "/api/accounts"
                ''',
            )
            repo.commit()
            res = run_gate(repo.root, "--callers")
            self.assertEqual(res.returncode, 1, res.stdout)
            self.assertIn("/api/accounts", res.stdout)
            # The violation reported must be the assignment, not the docstring.
            self.assertIn("service.py:3", res.stdout)

    def test_unparseable_python_is_scanned_in_full(self):
        """A syntax error must not become a way to hide a path."""
        with SyntheticRepo() as repo:
            repo.write("src/broken.py", 'def (:\nURL = "/api/accounts"\n')
            repo.commit()
            res = run_gate(repo.root, "--callers")
            self.assertEqual(res.returncode, 1, res.stdout)
            self.assertIn("/api/accounts", res.stdout)

    def test_a_templated_version_segment_is_versioned(self):
        """`/api/v${VERSION}/x` is correctly versioned, not a violation.

        Flagging it would push authors to hardcode `v1` to get green -- the
        opposite of what the standard is for.
        """
        with SyntheticRepo() as repo:
            repo.write("src/api.ts", "fetch(`/api/v${API_VERSION}/accounts`);\n")
            repo.write("src/doc.ts", "const shape = '/api/v{N}/accounts';\n")
            repo.commit()
            self.assertEqual(run_gate(repo.root, "--callers").returncode, 0)

    def test_a_placeholder_in_the_resource_slot_is_still_a_violation(self):
        """The template must occupy the VERSION segment, not just any segment."""
        with SyntheticRepo() as repo:
            repo.write("src/api.ts", "fetch(`/api/${resource}/list`);\n")
            repo.commit()
            res = run_gate(repo.root, "--callers")
            self.assertEqual(res.returncode, 1, res.stdout)

    def test_a_non_numeric_version_is_still_a_violation(self):
        """`/api/vNext` is not a version this standard recognises."""
        with SyntheticRepo() as repo:
            repo.write("src/api.ts", "fetch('/api/vNext/accounts');\n")
            repo.commit()
            self.assertEqual(run_gate(repo.root, "--callers").returncode, 1)

    def test_a_bare_api_prefix_is_not_a_route(self):
        """`/api/` alone carries no resource, so it cannot be reported usefully.

        It is always a base-URL constant or a prefix-stripping table. The only
        way to green such a finding is an allowlist entry for `/api/`, which --
        matching by path -- would then excuse every bare `/api/` in the repo,
        including a real one.
        """
        with SyntheticRepo() as repo:
            repo.write(
                "scripts/export-openapi.py",
                'for prefix in ("/api/v1/", "/api/"):\n'
                '    slug = slug[len(prefix):]\n',
            )
            repo.write("src/base.ts", "const BASE = '/api';\n")
            repo.commit()
            self.assertEqual(run_gate(repo.root, "--callers").returncode, 0)

    def test_a_prefix_with_a_route_segment_is_still_a_violation(self):
        """One character of resource is the whole difference."""
        with SyntheticRepo() as repo:
            repo.write("src/base.ts", "const URL = '/api/x';\n")
            repo.commit()
            res = run_gate(repo.root, "--callers")
            self.assertEqual(res.returncode, 1, res.stdout)
            self.assertIn("/api/x", res.stdout)

    def test_interpolated_base_with_a_segment_is_still_caught(self):
        """The concatenation form the scanner CAN see keeps its coverage."""
        with SyntheticRepo() as repo:
            repo.write("src/api.ts", "fetch(`${base}/api/accounts`);\n")
            repo.commit()
            res = run_gate(repo.root, "--callers")
            self.assertEqual(res.returncode, 1, res.stdout)
            self.assertIn("/api/accounts", res.stdout)

    def test_contract_check_still_covers_specs_under_a_test_directory(self):
        """The exclusion is caller-only; a declared route is a route."""
        with SyntheticRepo() as repo:
            repo.spec("/api/accounts", name="tests/fixtures/openapi.yaml")
            repo.commit()
            res = run_gate(repo.root)
            self.assertEqual(res.returncode, 1, res.stdout)
            self.assertIn("/api/accounts", res.stdout)


if __name__ == "__main__":
    unittest.main()
