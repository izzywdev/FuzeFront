"""Tests for the stranded-branch detector's `resolved()` predicate.

This workflow's entire history is a chain of false positives, each one making the
check less believable:

  * it was green for its whole life because every run took the "PR already open"
    early exit, so it was never evidence of anything (see its own header);
  * then it fired ~20s before the agent opened its PR, on three consecutive PRs,
    which is why the 300s grace window exists;
  * then (2026-08-27, PR #834) it failed on a branch whose PR had MERGED and been
    deleted mid-window, and printed a summary telling a human to go salvage work
    that was already on master.

So the predicate that decides "is this branch still work in need of a PR?" is
worth pinning, and pinning against the real failure — the load-bearing case here
is `branch_deleted_mid_window_is_resolved`.

The predicate lives inline in the workflow YAML, so the test extracts it from
there rather than from a copy: a copy would keep passing after someone edits the
workflow, which is the same "green but not measuring anything" trap as above.

Run with:  python3 -m unittest scripts/__tests__/test_stranded_detector.py
"""

import re
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = REPO_ROOT / ".github" / "workflows" / "claude-auto-pr.yml"


def extract_resolved() -> str:
    """Pull the `resolved()` shell function out of the workflow's run block."""
    doc = yaml.safe_load(WORKFLOW.read_text(encoding="utf8"))
    steps = doc["jobs"]["open-pr"]["steps"]
    run = next(s["run"] for s in steps if s.get("name", "").startswith("Detect"))
    m = re.search(r"^(\s*)resolved\(\) \{$", run, re.M)
    if not m:
        raise AssertionError(
            "resolved() not found in claude-auto-pr.yml — if it was renamed or "
            "inlined, update this test rather than deleting it."
        )
    indent = m.group(1)
    lines = run[m.start():].split("\n")
    body = [lines[0]]
    for line in lines[1:]:
        body.append(line)
        if line == indent + "}":
            break
    else:
        raise AssertionError("resolved() has no closing brace at its own indent level")
    return textwrap.dedent("\n".join(body))


RESOLVED = extract_resolved()


def run_resolved(branch_exists: bool, open_pr: str = "", merged_pr: str = "") -> tuple:
    """Run resolved() against a stubbed `gh`. Returns (exit_code, stdout)."""
    with tempfile.TemporaryDirectory() as d:
        bindir = Path(d) / "bin"
        bindir.mkdir()
        # Stub `gh` covering exactly the two call shapes resolved() makes:
        #   gh api repos/<repo>/branches/<branch>   -> 0 if the branch exists, 1 if 404
        #   gh pr list --head <b> --state <s> ...   -> the PR number, or empty
        (bindir / "gh").write_text(
            "#!/bin/bash\n"
            'if [ "$1" = "api" ]; then\n'
            f'  exit {0 if branch_exists else 1}\n'
            "fi\n"
            'if [ "$1" = "pr" ] && [ "$2" = "list" ]; then\n'
            "  state=\"\"\n"
            '  while [ $# -gt 0 ]; do [ "$1" = "--state" ] && state="$2"; shift; done\n'
            f'  [ "$state" = "open" ] && printf "%s" "{open_pr}"\n'
            f'  [ "$state" = "merged" ] && printf "%s" "{merged_pr}"\n'
            "  exit 0\n"
            "fi\n"
            "exit 0\n"
        )
        (bindir / "gh").chmod(0o755)
        script = (
            "#!/bin/bash\n"
            "GITHUB_REPOSITORY=izzywdev/FuzeFront\n"
            "BRANCH=claude/some-branch\n"
            f"{RESOLVED}\n"
            "resolved\n"
        )
        p = subprocess.run(
            ["bash", "-c", script],
            capture_output=True,
            text=True,
            env={"PATH": f"{bindir}:/usr/bin:/bin"},
        )
        return p.returncode, p.stdout


class ResolvedTests(unittest.TestCase):
    def test_branch_deleted_mid_window_is_resolved(self):
        """The #834 regression: merged with --delete-branch while we waited.

        Before the fix this returned 'not resolved', so the job burned the full
        300s grace window and then reported a successfully-merged branch as
        stranded work needing manual salvage.
        """
        code, out = run_resolved(branch_exists=False)
        self.assertEqual(code, 0, "a deleted branch must be treated as resolved")
        self.assertIn("no longer exists", out)

    def test_open_pr_is_resolved(self):
        code, out = run_resolved(branch_exists=True, open_pr="123")
        self.assertEqual(code, 0)
        self.assertIn("#123", out)

    def test_merged_pr_with_branch_retained_is_resolved(self):
        """Same race, branch kept: `--state open` alone would miss this."""
        code, out = run_resolved(branch_exists=True, merged_pr="456")
        self.assertEqual(code, 0)
        self.assertIn("MERGED", out)

    def test_genuinely_stranded_still_fails(self):
        """The case the detector EXISTS for — it must not be softened away.

        Branch present, no open PR, no merged PR: an agent pushed and died. If
        this ever returns resolved, the workflow is green and vacuous, which is
        precisely the state its header warns about.
        """
        code, _ = run_resolved(branch_exists=True)
        self.assertEqual(code, 1, "a real stranded branch must NOT be resolved")

    def test_closed_unmerged_pr_is_still_stranded(self):
        """A closed-but-unmerged PR is not a landing.

        The branch still has commits nobody will merge, so widening the lookup
        to `--state all` would have quietly disabled the detector.
        """
        code, _ = run_resolved(branch_exists=True, open_pr="", merged_pr="")
        self.assertEqual(code, 1)


if __name__ == "__main__":
    unittest.main()
