"""Tests for scripts/gate_identifier.py.

These deliberately assert that the gate **FAILS** on a violation, not only that
it passes on a clean tree. A gate is only worth its runtime if it is known to
fire; this repo has already been bitten once by a check that was green solely
because its work was always done by someone else before it ran
(`claude-auto-pr.yml` — every green run was the early-exit path, and the one
time it actually had work to do it failed). Passing is not evidence.

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
GATE = os.path.join(REPO_ROOT, "scripts", "gate_identifier.py")


def run_gate(root: str, *flags: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, GATE, root, *flags],
        capture_output=True,
        text=True,
        timeout=180,
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

    def manifest(self, **fields) -> None:
        self.write(".fuze/manifest.json", json.dumps(fields, indent=2))

    def registry(self, **types: str) -> None:
        body = "\n".join(f"  {name}: '{prefix}'," for name, prefix in types.items())
        self.write(
            "packages/identity/src/registry.ts",
            f"export const ENTITY_PREFIXES = {{\n{body}\n}} as const\n",
        )

    def commit(self) -> None:
        subprocess.run(["git", "-C", self.root, "add", "-A"], check=True)
        subprocess.run(
            ["git", "-C", self.root, "-c", "user.email=t@t", "-c", "user.name=t",
             "commit", "-qm", "fixture"],
            check=True,
        )

    def __enter__(self) -> "SyntheticRepo":
        return self

    def __exit__(self, *exc) -> None:
        self._tmp.cleanup()


class TestNamespaceCheck(unittest.TestCase):
    """--namespace: family-wide prefix uniqueness, enforced with no cross-repo state."""

    def test_product_local_prefix_must_be_namespaced(self):
        with SyntheticRepo() as repo:
            repo.manifest(repo="izzywdev/FuzeSales", identity={"namespace": "sales"})
            repo.registry(quote="quo")
            repo.commit()
            result = run_gate(repo.root, "--namespace")
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn("bare prefix 'quo'", result.stdout)
        self.assertIn("sales_quo", result.stdout)

    def test_namespaced_prefix_passes(self):
        with SyntheticRepo() as repo:
            repo.manifest(repo="izzywdev/FuzeSales", identity={"namespace": "sales"})
            repo.registry(quote="sales_quo")
            repo.commit()
            result = run_gate(repo.root, "--namespace")
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_consuming_repo_may_not_mint_a_spine_prefix(self):
        """The collision this whole tier exists to prevent: FuzeHub minting `usr`
        would produce ids indistinguishable from FuzeFront's own users."""
        with SyntheticRepo() as repo:
            repo.manifest(repo="izzywdev/FuzeHub", identity={"namespace": "hub"})
            repo.registry(user="usr")
            repo.commit()
            result = run_gate(repo.root, "--namespace")
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn("owned by FuzeFront", result.stdout)

    def test_owning_repo_may_mint_its_spine_prefix(self):
        with SyntheticRepo() as repo:
            repo.manifest(repo="izzywdev/FuzeFront", identity={"namespace": "front"})
            repo.registry(user="usr", organization="org")
            repo.commit()
            result = run_gate(repo.root, "--namespace")
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_namespace_must_be_declared(self):
        """Never derived from the directory name — a repo rename would silently
        orphan every id already issued."""
        with SyntheticRepo() as repo:
            repo.manifest(repo="izzywdev/FuzeSales")
            repo.registry(quote="sales_quo")
            repo.commit()
            result = run_gate(repo.root, "--namespace")
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn("declares no 'identity.namespace'", result.stdout)

    def test_malformed_namespace_is_rejected(self):
        with SyntheticRepo() as repo:
            repo.manifest(repo="izzywdev/FuzeSales", identity={"namespace": "Sales_X"})
            repo.registry(quote="sales_quo")
            repo.commit()
            result = run_gate(repo.root, "--namespace")
        self.assertEqual(result.returncode, 1, result.stdout)

    def test_repo_with_no_registry_is_not_penalised(self):
        with SyntheticRepo() as repo:
            repo.manifest(repo="izzywdev/FuzeSales")
            repo.write("src/app.ts", "export const x = 1\n")
            repo.commit()
            result = run_gate(repo.root, "--namespace")
        self.assertEqual(result.returncode, 0, result.stdout)


class TestAdoptionCheck(unittest.TestCase):
    """--adoption: the absence check the other families cannot make."""

    MINTS = """
        import { randomUUID } from 'node:crypto'
        export function createQuote() {
          const quoteId = randomUUID()
          return { quoteId }
        }
    """

    def test_minting_without_the_package_fails(self):
        with SyntheticRepo() as repo:
            repo.manifest(repo="izzywdev/FuzeSales")
            repo.write("package.json", '{"name":"sales","dependencies":{"express":"^4.0.0"}}')
            repo.write("src/quote.ts", self.MINTS)
            repo.commit()
            result = run_gate(repo.root, "--adoption")
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn("declares no dependency on an identity package", result.stdout)

    def test_declaring_the_node_package_passes(self):
        with SyntheticRepo() as repo:
            repo.manifest(repo="izzywdev/FuzeSales")
            repo.write(
                "package.json",
                '{"name":"sales","dependencies":{"@izzywdev/fuzefront-identity":"^0.1.0"}}',
            )
            repo.write("src/quote.ts", self.MINTS)
            repo.commit()
            result = run_gate(repo.root, "--adoption")
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_declaring_the_python_package_passes(self):
        with SyntheticRepo() as repo:
            repo.manifest(repo="izzywdev/FuzeSales")
            repo.write("package.json", '{"name":"sales"}')
            repo.write("requirements.txt", "fuzefront-identity==0.1.0\n")
            repo.write("src/quote.ts", self.MINTS)
            repo.commit()
            result = run_gate(repo.root, "--adoption")
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_repo_with_no_entity_work_is_not_penalised(self):
        """A docs or infra repo owns no entities and must not be asked to adopt."""
        with SyntheticRepo() as repo:
            repo.manifest(repo="izzywdev/FuzeDocs")
            repo.write("package.json", '{"name":"docs"}')
            repo.write("src/util.ts", "export const greet = () => 'hi'\n")
            repo.commit()
            result = run_gate(repo.root, "--adoption")
        self.assertEqual(result.returncode, 0, result.stdout)


class TestFlagHandling(unittest.TestCase):
    def test_unknown_flag_is_an_error_not_a_silent_pass(self):
        """A typo'd flag used to run NOTHING and print OK — indistinguishable
        from a clean tree, which is the worst possible failure for a gate."""
        with SyntheticRepo() as repo:
            repo.manifest(repo="izzywdev/FuzeSales")
            repo.commit()
            result = run_gate(repo.root, "--namespaces")
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
