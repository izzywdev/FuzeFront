"""Tests for scripts/gate_vacuous_check.py.

These deliberately assert that the gate **FAILS** on a violation, not only that it
passes on a clean tree — see test_gate_identifier.py's header for why: a gate is only
worth its runtime if it is known to fire, and this repo has already been bitten once by
a check that was green solely because its work was always done by someone else before it
ran. Passing is not evidence.

Also asserts the NEGATIVE space explicitly: each legitimate `|| true` shape named in the
owner's ask (diagnostic dump, teardown, command substitution, record-then-gate) must stay
green, and the ratchet's anti-deletion property (missing policy file => strictest mode,
never a skip) is tested directly.

Run: python -m unittest discover -s scripts/__tests__ -p 'test_*.py'
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
GATE = os.path.join(REPO_ROOT, "scripts", "gate_vacuous_check.py")

# A `yaml.py` that raises ImportError on import, put FIRST on PYTHONPATH, forces the
# gate's `try: import yaml except ImportError` down its structural-fallback path in a
# REAL subprocess — not merely a patched import in this test process, which would never
# actually exercise the fallback code the gate ships. See TestFallbackModeAlsoFires below.
_FAKE_YAML_DIR = tempfile.mkdtemp(prefix="fake-yaml-")
with open(os.path.join(_FAKE_YAML_DIR, "yaml.py"), "w", encoding="utf-8") as _f:
    _f.write('raise ImportError("yaml intentionally blocked for gate_vacuous_check fallback test")\n')


def run_gate(root: str, *flags: str, force_fallback: bool = False) -> subprocess.CompletedProcess:
    env = os.environ.copy()
    if force_fallback:
        env["PYTHONPATH"] = _FAKE_YAML_DIR + os.pathsep + env.get("PYTHONPATH", "")
    return subprocess.run(
        [sys.executable, GATE, root, *flags],
        capture_output=True,
        text=True,
        timeout=120,
        env=env,
    )


class SyntheticRepo:
    """A throwaway git repo — the gate looks for tracked files via `git ls-files`."""

    def __init__(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = self._tmp.name
        subprocess.run(["git", "init", "-q", self.root], check=True)

    def workflow(self, name: str, content: str) -> None:
        path = os.path.join(self.root, ".github", "workflows", name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(textwrap.dedent(content).lstrip("\n"))

    def policy(self, **fields) -> None:
        path = os.path.join(self.root, "governance", "vacuous-check-policy.json")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(fields, f, indent=2)

    def commit(self) -> None:
        subprocess.run(["git", "-C", self.root, "add", "-A"], check=True)
        subprocess.run(
            ["git", "-C", self.root, "-c", "user.email=t@t", "-c", "user.name=t",
             "commit", "-q", "--allow-empty", "-m", "fixture"],
            check=True,
        )

    def __enter__(self) -> "SyntheticRepo":
        return self

    def __exit__(self, *exc) -> None:
        self._tmp.cleanup()


# ---------------------------------------------------------------------------
# The 9 measured shapes from the owner's scan — each must FAIL.
# ---------------------------------------------------------------------------

class TestKnownOffenderShapes(unittest.TestCase):
    def test_pytest_coverage_or_true(self):
        with SyntheticRepo() as repo:
            repo.workflow("test.yml", """
                on: push
                jobs:
                  test:
                    runs-on: ubuntu-latest
                    steps:
                      - name: coverage
                        run: python -m pytest --cov=. --cov-report=html tests/ || true
            """)
            repo.commit()
            result = run_gate(repo.root)
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn("pytest", result.stdout.lower())

    def test_black_check_or_true(self):
        with SyntheticRepo() as repo:
            repo.workflow("test.yml", """
                on: push
                jobs:
                  lint:
                    runs-on: ubuntu-latest
                    steps:
                      - name: black
                        run: black --check --diff . || true
            """)
            repo.commit()
            result = run_gate(repo.root)
        self.assertEqual(result.returncode, 1, result.stdout)

    def test_isort_check_or_true(self):
        with SyntheticRepo() as repo:
            repo.workflow("test.yml", """
                on: push
                jobs:
                  lint:
                    runs-on: ubuntu-latest
                    steps:
                      - name: isort
                        run: isort --check-only --diff . || true
            """)
            repo.commit()
            result = run_gate(repo.root)
        self.assertEqual(result.returncode, 1, result.stdout)

    def test_mypy_or_true(self):
        with SyntheticRepo() as repo:
            repo.workflow("test.yml", """
                on: push
                jobs:
                  typecheck:
                    runs-on: ubuntu-latest
                    steps:
                      - name: mypy
                        run: mypy . --ignore-missing-imports --no-strict-optional || true
            """)
            repo.commit()
            result = run_gate(repo.root)
        self.assertEqual(result.returncode, 1, result.stdout)

    def test_benchmark_pytest_or_true(self):
        with SyntheticRepo() as repo:
            repo.workflow("test.yml", """
                on: push
                jobs:
                  bench:
                    runs-on: ubuntu-latest
                    steps:
                      - name: benchmark
                        run: pytest tests/ -m "not slow" --benchmark-only --benchmark-json=out.json || true
            """)
            repo.commit()
            result = run_gate(repo.root)
        self.assertEqual(result.returncode, 1, result.stdout)

    def test_kubeconform_strict_or_true(self):
        with SyntheticRepo() as repo:
            repo.workflow("deploy-prod.yml", """
                on: push
                jobs:
                  validate:
                    runs-on: ubuntu-latest
                    steps:
                      - name: kubeconform
                        run: kubeconform -strict -ignore-missing-schemas manifests/ || true
            """)
            repo.commit()
            result = run_gate(repo.root)
        self.assertEqual(result.returncode, 1, result.stdout)

    def test_npm_audit_or_true(self):
        with SyntheticRepo() as repo:
            repo.workflow("ci-cd.yml", """
                on: push
                jobs:
                  audit:
                    runs-on: ubuntu-latest
                    steps:
                      - name: npm audit
                        run: npm audit --audit-level=moderate || true
            """)
            repo.commit()
            result = run_gate(repo.root)
        self.assertEqual(result.returncode, 1, result.stdout)

    def test_custom_gate_script_or_true(self):
        """FuzeFront's own harden-gate.yml:420 shape — a gate_*.py invocation itself
        suffixed || true with no enforcing run anywhere else in the job."""
        with SyntheticRepo() as repo:
            repo.workflow("harden-gate.yml", """
                on: push
                jobs:
                  gate-pagination:
                    runs-on: ubuntu-latest
                    steps:
                      - name: Pagination gate
                        run: python scripts/gate_pagination.py . || true
            """)
            repo.commit()
            result = run_gate(repo.root)
        self.assertEqual(result.returncode, 1, result.stdout)

    def test_install_line_mentioning_the_tool_is_not_mistaken_for_its_enforcing_sibling(self):
        """Regression: FuzeAgent's test.yml `performance-tests` job — `pip install pytest
        pytest-benchmark` mentions "pytest" but never RUNS it, so it must not exempt the
        job's only real pytest invocation (the benchmark run, guarded by `|| true`) as
        record-then-gate. Caught by mutation-testing this gate against a real repo."""
        with SyntheticRepo() as repo:
            repo.workflow("test.yml", """
                on: push
                jobs:
                  performance-tests:
                    runs-on: ubuntu-latest
                    steps:
                      - name: install
                        run: pip install pytest pytest-benchmark
                      - name: benchmark
                        run: python -m pytest tests/ -m "not slow" --benchmark-only --benchmark-json=benchmark.json || true
            """)
            repo.commit()
            result = run_gate(repo.root)
        self.assertEqual(result.returncode, 1, result.stdout)

    def test_unrelated_command_sharing_the_tools_first_word_is_not_a_false_sibling(self):
        """Regression: a two-word tool's bare-invocation search used to key off only
        `tool.split()[0]` — so a `tool="npm audit"` finding could be wrongly exempted by
        an unrelated `npm run build` line elsewhere in the same job, since both merely
        contain "npm". Caught wiring FuzePlan's record-then-gate npm-audit pair."""
        with SyntheticRepo() as repo:
            repo.workflow("ci.yml", """
                on: push
                jobs:
                  frontend:
                    runs-on: ubuntu-latest
                    steps:
                      - name: build
                        run: npm run build
                      - name: audit
                        run: npm audit --audit-level=moderate || true
            """)
            repo.commit()
            result = run_gate(repo.root)
        self.assertEqual(result.returncode, 1, result.stdout)

    def test_full_phrase_enforcing_sibling_still_exempts_correctly(self):
        """The positive control for the regression above: a genuine bare `npm audit`
        invocation (matching the FULL phrase, not just "npm") still counts as the
        record-then-gate enforcing sibling."""
        with SyntheticRepo() as repo:
            repo.workflow("ci.yml", """
                on: push
                jobs:
                  frontend:
                    runs-on: ubuntu-latest
                    steps:
                      - name: audit-record
                        run: npm audit --audit-level=moderate || true
                      - name: audit-gate
                        run: npm audit --audit-level=critical
            """)
            repo.commit()
            result = run_gate(repo.root)
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_bandit_json_report_alone_is_a_violation_without_its_enforcing_sibling(self):
        """fuzeplan:ci-cd.yml:54 shape in isolation — this is what makes it a violation
        (no bare bandit run elsewhere in the job). Paired with
        test_bandit_record_then_gate_is_not_flagged below, which is the SAME command
        but WITH its enforcing sibling and must stay green."""
        with SyntheticRepo() as repo:
            repo.workflow("ci-cd.yml", """
                on: push
                jobs:
                  security:
                    runs-on: ubuntu-latest
                    steps:
                      - name: bandit report
                        run: bandit -r backend/ -f json -o bandit-report.json || true
            """)
            repo.commit()
            result = run_gate(repo.root)
        self.assertEqual(result.returncode, 1, result.stdout)


# ---------------------------------------------------------------------------
# Legitimate shapes — must stay green. A gate that cannot tell these apart from the
# above is worse than none; it will get disabled.
# ---------------------------------------------------------------------------

class TestLegitimateShapesStayGreen(unittest.TestCase):
    def test_diagnostic_log_dump_in_failure_handler(self):
        with SyntheticRepo() as repo:
            repo.workflow("deploy.yml", """
                on: push
                jobs:
                  deploy:
                    runs-on: ubuntu-latest
                    steps:
                      - name: dump logs on failure
                        if: failure()
                        run: kubectl logs -n prod deploy/app --tail=200 || true
            """)
            repo.commit()
            result = run_gate(repo.root)
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_teardown_cleanup(self):
        with SyntheticRepo() as repo:
            repo.workflow("test.yml", """
                on: push
                jobs:
                  test:
                    runs-on: ubuntu-latest
                    steps:
                      - name: stop background server
                        run: kill $SERVER_PID || true
                      - name: prune docker
                        run: docker system prune -f || true
                      - name: compose down
                        run: docker compose down -v || true
            """)
            repo.commit()
            result = run_gate(repo.root)
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_command_substitution_empty_result_is_valid(self):
        with SyntheticRepo() as repo:
            repo.workflow("test.yml", """
                on: push
                jobs:
                  build:
                    runs-on: ubuntu-latest
                    steps:
                      - name: optional grep
                        run: |
                          set -euo pipefail
                          x=$(grep -r "TODO" . || true)
                          echo "found: $x"
            """)
            repo.commit()
            result = run_gate(repo.root)
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_bandit_record_then_gate_is_not_flagged(self):
        """FuzeAgent's model shape: unfiltered report run || true, THEN a bare enforcing
        run of the same tool later in the same job. Must stay green."""
        with SyntheticRepo() as repo:
            repo.workflow("test.yml", """
                on: push
                jobs:
                  security:
                    runs-on: ubuntu-latest
                    steps:
                      - name: bandit report
                        run: bandit -r . -f json -o bandit-report.json || true
                      - name: bandit enforce
                        run: bandit -r . --skip B101 -f txt
            """)
            repo.commit()
            result = run_gate(repo.root)
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_sarif_upload_continue_on_error_is_exempt(self):
        with SyntheticRepo() as repo:
            repo.workflow("test.yml", """
                on: push
                jobs:
                  scan:
                    runs-on: ubuntu-latest
                    steps:
                      - name: upload sarif (private repos lack code-scanning; report-only must stay green)
                        continue-on-error: true
                        run: gh api repos/x/y/code-scanning/sarifs -f sarif=@out.sarif
            """)
            repo.commit()
            result = run_gate(repo.root)
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_no_workflows_is_a_pass(self):
        with SyntheticRepo() as repo:
            repo.commit()
            result = run_gate(repo.root)
        self.assertEqual(result.returncode, 0, result.stdout)


# ---------------------------------------------------------------------------
# Ratchet / allowlist — anti-deletion property.
# ---------------------------------------------------------------------------

class TestRatchet(unittest.TestCase):
    def test_missing_policy_file_means_mode_fail_not_skip(self):
        """The core anti-deletion property: no governance/vacuous-check-policy.json at
        all must NOT silence the gate — it is the strictest posture, not an escape."""
        with SyntheticRepo() as repo:
            repo.workflow("test.yml", """
                on: push
                jobs:
                  lint:
                    runs-on: ubuntu-latest
                    steps:
                      - name: black
                        run: black --check --diff . || true
            """)
            repo.commit()
            result = run_gate(repo.root)
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn("mode=fail", result.stdout)

    def test_allowlist_entry_suppresses_under_ramp_mode(self):
        with SyntheticRepo() as repo:
            repo.workflow("test.yml", """
                on: push
                jobs:
                  lint:
                    runs-on: ubuntu-latest
                    steps:
                      - name: black
                        run: black --check --diff . || true
            """)
            repo.policy(mode="ramp", allowlist=[{
                "file": ".github/workflows/test.yml",
                "match": "black",
                "reason": "pre-existing, ticket JIRA-1 to fix",
                "owner": "someone",
            }])
            repo.commit()
            result = run_gate(repo.root)
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn("ALLOWLISTED", result.stdout)

    def test_allowlist_entry_can_match_a_continue_on_error_finding_by_command_text(self):
        """Regression: a continue-on-error finding's `match` field used to be only the
        descriptor string ("continue-on-error: true (job=..., step=...)"), never the
        actual command — so an allowlist entry written against the real command text
        (the only thing a human would ever write) could never match it. Caught wiring
        FuzeAgent's ratchet: entries written against `pytest --cov=. --cov-report=xml`
        and `npm audit --audit-level=high` silently failed to suppress their findings."""
        with SyntheticRepo() as repo:
            repo.workflow("ci.yml", """
                on: push
                jobs:
                  dependency-check:
                    runs-on: ubuntu-latest
                    steps:
                      - name: Frontend dependency audit
                        run: npm audit --audit-level=high
                        continue-on-error: true
            """)
            repo.policy(mode="ramp", allowlist=[{
                "file": ".github/workflows/ci.yml",
                "match": "npm audit --audit-level=high",
                "reason": "pre-existing, tracked",
                "owner": "someone",
            }])
            repo.commit()
            result = run_gate(repo.root)
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn("ALLOWLISTED", result.stdout)

    def test_allowlist_is_inert_under_fail_mode(self):
        """Downgrading policy.mode back to "fail" (the retirement path) must make every
        previously-allowlisted finding fail again — proves the allowlist cannot be used
        as a permanent escape once mode leaves "ramp"."""
        with SyntheticRepo() as repo:
            repo.workflow("test.yml", """
                on: push
                jobs:
                  lint:
                    runs-on: ubuntu-latest
                    steps:
                      - name: black
                        run: black --check --diff . || true
            """)
            repo.policy(mode="fail", allowlist=[{
                "file": ".github/workflows/test.yml",
                "match": "black",
                "reason": "pre-existing",
                "owner": "someone",
            }])
            repo.commit()
            result = run_gate(repo.root)
        self.assertEqual(result.returncode, 1, result.stdout)

    def test_allowlist_entry_without_reason_or_owner_is_not_honored(self):
        with SyntheticRepo() as repo:
            repo.workflow("test.yml", """
                on: push
                jobs:
                  lint:
                    runs-on: ubuntu-latest
                    steps:
                      - name: black
                        run: black --check --diff . || true
            """)
            repo.policy(mode="ramp", allowlist=[{
                "file": ".github/workflows/test.yml",
                "match": "black",
            }])
            repo.commit()
            result = run_gate(repo.root)
        self.assertEqual(result.returncode, 1, result.stdout)


# ---------------------------------------------------------------------------
# Mode B — structural fallback, exercised in a REAL subprocess with PyYAML made
# unimportable. A degraded run that looks identical to a clean one is the whole lesson of
# this sweep, so this asserts both (a) the mode line honestly says which mode ran, and
# (b) the fallback still catches a violation and still respects the ratchet.
# ---------------------------------------------------------------------------

class TestFallbackModeAlsoFires(unittest.TestCase):
    def test_mode_line_reports_fallback(self):
        with SyntheticRepo() as repo:
            repo.commit()
            result = run_gate(repo.root, force_fallback=True)
        self.assertIn("STRUCTURAL FALLBACK", result.stdout)
        self.assertNotIn("full (PyYAML)", result.stdout)

    def test_black_check_or_true_still_caught_without_pyyaml(self):
        with SyntheticRepo() as repo:
            repo.workflow("test.yml", """
                on: push
                jobs:
                  lint:
                    runs-on: ubuntu-latest
                    steps:
                      - name: black
                        run: black --check --diff . || true
            """)
            repo.commit()
            result = run_gate(repo.root, force_fallback=True)
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn("STRUCTURAL FALLBACK", result.stdout)

    def test_record_then_gate_still_green_without_pyyaml(self):
        with SyntheticRepo() as repo:
            repo.workflow("test.yml", """
                on: push
                jobs:
                  security:
                    runs-on: ubuntu-latest
                    steps:
                      - name: bandit report
                        run: bandit -r . -f json -o bandit-report.json || true
                      - name: bandit enforce
                        run: bandit -r . --skip B101 -f txt
            """)
            repo.commit()
            result = run_gate(repo.root, force_fallback=True)
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_missing_policy_still_strict_without_pyyaml(self):
        with SyntheticRepo() as repo:
            repo.workflow("test.yml", """
                on: push
                jobs:
                  lint:
                    runs-on: ubuntu-latest
                    steps:
                      - name: black
                        run: black --check --diff . || true
            """)
            repo.commit()
            result = run_gate(repo.root, force_fallback=True)
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn("mode=fail", result.stdout)


if __name__ == "__main__":
    unittest.main()
