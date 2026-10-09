"""Exercise release publication without network, credentials or repository writes."""
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/publish-release-gitops.sh"
SOURCE = "a" * 40
FILE = "deploy/helm/fuzefront/values-prod.yaml"

# Both executable stubs record commands; only their private fixture is modified.
STUB = r'''#!/usr/bin/env python3
import json, os, pathlib, sys
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
with open(os.environ["CALL_LOG"], "a") as log:
    log.write(json.dumps([name] + args) + "\n")
scenario = os.environ.get("SCENARIO", "merged")
if name == "git":
    if args[0] == "hash-object": print("blob")
    elif args[0] == "ls-remote":
        sys.exit(128 if scenario == "transport" else 2)
    elif args[0] == "push" and scenario == "push_failed": sys.exit(1)
    sys.exit(0)
if args[:2] == ["pr", "list"]:
    if scenario in ("new", "transport", "push_failed"):
        marker = pathlib.Path(os.environ["CREATED"])
        print("17" if marker.exists() else "")
    else: print("17")
elif args[:2] == ["pr", "create"]:
    pathlib.Path(os.environ["CREATED"]).touch()
    print("https://github.com/owner/repo/pull/17")
elif args[:2] == ["pr", "view"]:
    field = args[args.index("--json") + 1]
    if field == "state":
        print("CLOSED" if scenario == "closed" else "OPEN" if scenario in ("pending", "advanced", "changed_head") else "MERGED")
    elif field == "autoMergeRequest": print("true" if scenario == "already_auto" else "false")
    elif field == "files": print("false" if scenario == "extra_files" else "true")
    elif field == "headRefOid":
        counter = pathlib.Path(os.environ["HEAD_COUNT"])
        n = int(counter.read_text()) if counter.exists() else 0
        counter.write_text(str(n + 1))
        print(("c" if scenario == "changed_head" and n else "b") * 40)
elif args[0] == "api":
    if "/contents/" in args[1]: print("changed" if scenario == "different_blob" else "blob")
    else:
        counter = pathlib.Path(os.environ["MASTER_COUNT"])
        n = int(counter.read_text()) if counter.exists() else 0
        counter.write_text(str(n + 1))
        print(("c" if scenario == "advanced" and n else "a") * 40)
elif args[:2] != ["pr", "merge"]:
    sys.exit("unexpected gh invocation")
'''


class ReleaseGitOpsTest(unittest.TestCase):
    def invoke(self, scenario="merged", file=FILE, tag=SOURCE[:12]):
        with tempfile.TemporaryDirectory() as directory:
            temp = Path(directory)
            for name in ("git", "gh"):
                executable = temp / name
                executable.write_text(STUB)
                executable.chmod(0o700)
            env = dict(os.environ, PATH=f"{temp}:{os.environ['PATH']}",
                       GITHUB_REPOSITORY="owner/repo", SCENARIO=scenario,
                       CALL_LOG=str(temp / "calls"), CREATED=str(temp / "created"),
                       HEAD_COUNT=str(temp / "heads"), MASTER_COUNT=str(temp / "masters"),
                       GITOPS_MERGE_TIMEOUT_SECONDS="0", GITOPS_POLL_SECONDS="1")
            result = subprocess.run(["bash", str(SCRIPT), file, tag, SOURCE],
                                    cwd=temp, env=env, capture_output=True, text=True, timeout=10, check=False)
            calls = [json.loads(line) for line in (temp / "calls").read_text().splitlines()] if (temp / "calls").exists() else []
            return result, calls

    def test_existing_exact_pr_requires_real_merge_and_checked_auto_merge(self):
        result, calls = self.invoke()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("production verification is still required", result.stdout)
        merge = next(call for call in calls if "--auto" in call)
        self.assertIn("--match-head-commit", merge)
        self.assertFalse(any(call[0] == "git" and "push" in call for call in calls))

    def test_new_pr_pushes_only_nonforced_release_branch(self):
        result, calls = self.invoke("new")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(["git", "push", "origin", "HEAD:refs/heads/release/gitops-bump-aaaaaaaaaaaa"], calls)
        self.assertTrue(any(call[:3] == ["gh", "pr", "create"] for call in calls))
        self.assertFalse(any("--force" in call or "HEAD:master" in call for call in calls))

    def test_existing_changed_file_or_extra_files_are_not_merged(self):
        for scenario in ("different_blob", "extra_files"):
            with self.subTest(scenario=scenario):
                result, calls = self.invoke(scenario)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(any("--auto" in call for call in calls))

    def test_closed_is_not_a_successful_release(self):
        result, _ = self.invoke("closed")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("not merged", result.stdout)

    def test_pending_approval_timeout_disables_late_auto_merge(self):
        result, calls = self.invoke("pending")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("no deployment claimed", result.stdout)
        self.assertTrue(any("--disable-auto" in call for call in calls))

    def test_changed_source_or_pr_head_disables_auto_merge(self):
        for scenario in ("advanced", "changed_head"):
            with self.subTest(scenario=scenario):
                result, calls = self.invoke(scenario)
                self.assertNotEqual(result.returncode, 0)
                self.assertTrue(any("--disable-auto" in call for call in calls))

    def test_transport_or_push_failure_never_opens_or_merges_pr(self):
        for scenario in ("transport", "push_failed"):
            with self.subTest(scenario=scenario):
                result, calls = self.invoke(scenario)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(any(call[:3] == ["gh", "pr", "create"] or "--auto" in call for call in calls))

    def test_idempotent_existing_auto_merge_is_not_reenabled(self):
        result, calls = self.invoke("already_auto")
        self.assertEqual(result.returncode, 0)
        self.assertFalse(any("--auto" in call for call in calls))

    def test_invalid_file_or_tag_fails_before_commands(self):
        for file, tag in (("unrelated.yaml", SOURCE[:12]), (FILE, "wrong")):
            result, calls = self.invoke(file=file, tag=tag)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(calls, [])

    def test_shell_syntax_and_workflow_safety_contract(self):
        subprocess.run(["bash", "-n", str(SCRIPT)], check=True)
        workflow = (ROOT / ".github/workflows/release.yml").read_text()
        helper = SCRIPT.read_text()
        for forbidden in ("RELEASE_BUMP_SSH_KEY", "HEAD:master", "[skip ci]", "--admin", "--approve", "GH_APPROVE_TOKEN"):
            self.assertNotIn(forbidden, workflow + helper)
        self.assertIn("token: ${{ steps.release_app.outputs.token }}", workflow)
        self.assertIn("if: needs.release-source.outputs.build == 'true'", workflow)
        self.assertIn('git log -1 --format=%s', workflow)
        self.assertIn("master changed during the build", workflow)
        self.assertLess(workflow.index('bash scripts/publish-release-gitops.sh'), workflow.index('- name: Dispatch post-deploy verification'))

    def test_tag_merge_recursion_guard_also_covers_manual_dispatch(self):
        workflow = (ROOT / ".github/workflows/release.yml").read_text()
        guard = workflow.split("        run: |\n", 1)[1].split("\n  build-and-bump:", 1)[0]
        lines = [line.removeprefix("          ") for line in guard.splitlines()]
        script = "\n".join(lines).replace('$(git log -1 --format=%s)', '$SUBJECT').replace('$(git diff-tree --no-commit-id --name-only -r HEAD)', '$CHANGED_FILES')
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "output"
            for subject, changed, expected in (("release: fuzefront images aaaaaaaaaaaa", FILE, "false"),
                                               ("release: fuzefront images aaaaaaaaaaaa (#42)", FILE, "false"),
                                               ("release: fuzefront images aaaaaaaaaaaa", "backend/src/server.ts", "true"),
                                               ("release: fuzefront images aaaaaaaaaaaa", FILE + "\nbackend/src/server.ts", "true"),
                                               ("fix(connectors): release provider", FILE, "true")):
                output.write_text("")
                subprocess.run(["bash", "-c", script], check=True,
                               env=dict(os.environ, SUBJECT=subject, CHANGED_FILES=changed, GITHUB_OUTPUT=str(output)))
                self.assertEqual(output.read_text().strip(), f"build={expected}")


if __name__ == "__main__":
    unittest.main()
