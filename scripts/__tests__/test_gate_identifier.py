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


class TestAdoptionUsage(unittest.TestCase):
    """A2: a declared dependency that nothing imports is not adoption.

    Measured 2026-08-19: thirteen repos declared @izzywdev/fuzefront-identity and
    not one imported it, so --adoption was green family-wide while the standard was
    adopted nowhere. These tests pin the distinction the gate now draws, including
    the exclusion that makes it meaningful — a manifest NAMES the package, only
    source USES it.
    """

    MINTS = """
        import { randomUUID } from 'node:crypto'
        export function createQuote() {
          const quoteId = randomUUID()
          return { quoteId }
        }
    """

    DECLARES = '{"name":"sales","dependencies":{"@izzywdev/fuzefront-identity":"^1.0.0"}}'

    def test_declared_but_unimported_fails_when_the_repo_has_ratcheted(self):
        with SyntheticRepo() as repo:
            repo.manifest(
                repo="izzywdev/FuzeSales",
                identity={"namespace": "sales", "enforceUsage": True},
            )
            repo.write("package.json", self.DECLARES)
            repo.write("src/quote.ts", self.MINTS)
            repo.commit()
            result = run_gate(repo.root, "--adoption")
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn("no tracked source file imports it", result.stdout)

    def test_declared_but_unimported_only_warns_by_default(self):
        """Landing this enforcing would red every repo that just declared the
        dependency — the same 'enforcement ahead of adoption' mistake that produced
        the inert declarations. Each repo opts in."""
        with SyntheticRepo() as repo:
            repo.manifest(repo="izzywdev/FuzeSales", identity={"namespace": "sales"})
            repo.write("package.json", self.DECLARES)
            repo.write("src/quote.ts", self.MINTS)
            repo.commit()
            result = run_gate(repo.root, "--adoption")
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn("::warning", result.stdout)

    def test_a_real_import_satisfies_the_ratchet(self):
        with SyntheticRepo() as repo:
            repo.manifest(
                repo="izzywdev/FuzeSales",
                identity={"namespace": "sales", "enforceUsage": True},
            )
            repo.write("package.json", self.DECLARES)
            repo.write(
                "src/quote.ts",
                """
                import { mintId } from '@izzywdev/fuzefront-identity'
                export const createQuote = () => ({ quoteId: mintId('quo') })
                """,
            )
            repo.commit()
            result = run_gate(repo.root, "--adoption")
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_a_python_import_satisfies_the_ratchet(self):
        with SyntheticRepo() as repo:
            repo.manifest(
                repo="izzywdev/FuzePlan",
                identity={"namespace": "plan", "enforceUsage": True},
            )
            repo.write("requirements.txt", "fuzefront-identity==1.0.0\n")
            repo.write("package.json", '{"name":"plan"}')
            repo.write("src/quote.ts", self.MINTS)
            repo.write(
                "api/quotes.py",
                """
                from fuzefront_identity import mint_id

                def create_quote():
                    return {"quote_id": mint_id("quo")}
                """,
            )
            repo.commit()
            result = run_gate(repo.root, "--adoption")
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_naming_the_package_in_a_lockfile_is_not_usage(self):
        """The load-bearing exclusion. package.json, package-lock.json and the
        manifest all contain the package name; if they counted, the tightened check
        would be exactly as satisfiable-by-declaration as the one it replaces."""
        with SyntheticRepo() as repo:
            repo.manifest(
                repo="izzywdev/FuzeSales",
                identity={
                    "namespace": "sales",
                    "enforceUsage": True,
                    "packages": {"node": "@izzywdev/fuzefront-identity"},
                },
            )
            repo.write("package.json", self.DECLARES)
            repo.write(
                "package-lock.json",
                json.dumps({
                    "lockfileVersion": 3,
                    "packages": {
                        "node_modules/@izzywdev/fuzefront-identity": {"version": "1.0.0"},
                    },
                }),
            )
            repo.write("src/quote.ts", self.MINTS)
            repo.commit()
            result = run_gate(repo.root, "--adoption")
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn("no tracked source file imports it", result.stdout)


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


class TestPolymorphicRefInComposedSchemas(unittest.TestCase):
    """
    C3 must see references declared under allOf/oneOf/anyOf, not only inline ones.

    It used to read top-level `properties` alone and `continue` past anything composed, so
    a polymorphic id in a composition branch was never checked. Measured on FuzeSocial:
    `LibraryItem.ownerId` and `HistoryRecord.ownerId` nest under allOf and were invisible,
    while the structurally identical `ComposedPost.ownerId` and `MediaItem.ownerId` were
    caught only because they happened to be declared inline. The gate reported clean on
    half the violations of the same rule in the same file.

    Asserting the gate FAILS is the point. A test that only checks a clean tree passes
    cannot tell a working gate from one that inspects nothing — which is exactly the
    defect being fixed here.
    """

    SPEC_HEAD = """
        openapi: 3.0.0
        info: { title: t, version: '1' }
        paths: {}
        components:
          schemas:
        """

    def _repo(self, schemas: str) -> SyntheticRepo:
        repo = SyntheticRepo()
        repo.manifest(repo="izzywdev/Thing", identity={"namespace": "thing"})
        repo.write("contracts/openapi.yaml", self.SPEC_HEAD + schemas)
        repo.commit()
        return repo

    def test_a_polymorphic_id_under_allOf_is_CAUGHT(self):
        with self._repo("""
            Base:
              type: object
              properties:
                createdAt: { type: string }
            LibraryItem:
              allOf:
                - $ref: '#/components/schemas/Base'
                - type: object
                  properties:
                    ownerId: { type: string }
        """) as repo:
            r = run_gate(repo.root)
        self.assertNotEqual(r.returncode, 0,
                            "a polymorphic id under allOf must fail the gate")
        self.assertIn("ownerId", r.stdout + r.stderr)
        self.assertIn("LibraryItem", r.stdout + r.stderr)

    def test_the_discriminator_may_live_in_a_DIFFERENT_branch(self):
        # A base contributing ownerType and a variant contributing ownerId satisfies the
        # rule. Checking each part in isolation would raise a false violation here, which
        # is why properties are unioned across the composition before checking.
        with self._repo("""
            Owned:
              type: object
              properties:
                ownerType: { type: string }
            LibraryItem:
              allOf:
                - $ref: '#/components/schemas/Owned'
                - type: object
                  properties:
                    ownerId: { type: string }
        """) as repo:
            r = run_gate(repo.root)
        self.assertEqual(r.returncode, 0,
                         f"discriminator in a sibling branch satisfies C3\n{r.stdout}{r.stderr}")

    def test_an_inline_polymorphic_id_is_still_caught(self):
        with self._repo("""
            ComposedPost:
              type: object
              properties:
                ownerId: { type: string }
        """) as repo:
            r = run_gate(repo.root)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("ComposedPost", r.stdout + r.stderr)

    def test_an_inline_pair_still_passes(self):
        with self._repo("""
            ComposedPost:
              type: object
              properties:
                ownerId: { type: string }
                ownerType: { type: string }
        """) as repo:
            r = run_gate(repo.root)
        self.assertEqual(r.returncode, 0, f"{r.stdout}{r.stderr}")

    def test_oneOf_and_anyOf_are_walked_too(self):
        for key in ("oneOf", "anyOf"):
            with self.subTest(key=key):
                with self._repo(f"""
                    Thing:
                      {key}:
                        - type: object
                          properties:
                            targetId: {{ type: string }}
                """) as repo:
                    r = run_gate(repo.root)
                self.assertNotEqual(r.returncode, 0, f"{key} branch must be inspected")
                self.assertIn("targetId", r.stdout + r.stderr)
