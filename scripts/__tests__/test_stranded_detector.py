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

import json
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


def run_resolved(branch_exists: bool = True, open_pr: str = "", merged_pr: str = "",
                 branch_err: str = "", pr_lookup_fails: bool = False) -> tuple:
    """Run resolved() against a stubbed `gh`. Returns (exit_code, stdout+stderr).

    Exit codes: 0 = resolved · 1 = genuinely stranded · 2 = inconclusive.
    """
    with tempfile.TemporaryDirectory() as d:
        bindir = Path(d) / "bin"
        bindir.mkdir()
        prs = []
        if open_pr:
            prs.append({"number": int(open_pr), "state": "open", "merged_at": None})
        if merged_pr:
            prs.append({"number": int(merged_pr), "state": "closed",
                        "merged_at": "2026-08-27T00:00:00Z"})
        # Stub `gh` covering the two REST shapes resolved() makes:
        #   gh api repos/<repo>/branches/<branch>  -> 0, or 1 with an error on stderr
        #   gh api repos/<repo>/pulls?head=...     -> the PR array, or a failure
        (bindir / "gh").write_text(
            "#!/bin/bash\n"
            'arg="$*"\n'
            'case "$arg" in\n'
            "  *branches*)\n"
            + (f'    echo "{branch_err}" >&2; exit 1\n' if not branch_exists else "    echo '{}'; exit 0\n")
            + "    ;;\n"
            "  *pulls*)\n"
            + ("    echo 'GraphQL: API rate limit already exceeded' >&2; exit 1\n"
               if pr_lookup_fails else
               f"    cat <<'JSON'\n{json.dumps(prs)}\nJSON\n    exit 0\n")
            + "    ;;\n"
            "esac\n"
            "exit 0\n"
        )
        (bindir / "gh").chmod(0o755)
        script = (
            "#!/bin/bash\n"
            "set -e\n"                      # the workflow step runs under `bash -e`
            "GITHUB_REPOSITORY=izzywdev/FuzeFront\n"
            "OWNER=izzywdev\n"
            "BRANCH=claude/some-branch\n"
            f"{RESOLVED}\n"
            "verdict=0; resolved || verdict=$?\n"
            "exit $verdict\n"
        )
        p = subprocess.run(
            ["bash", "-c", script],
            capture_output=True,
            text=True,
            env={"PATH": f"{bindir}:/usr/bin:/bin"},
        )
        return p.returncode, p.stdout + p.stderr


class ResolvedTests(unittest.TestCase):
    def test_branch_deleted_mid_window_is_resolved(self):
        """The #834 regression: merged with --delete-branch while we waited.

        Before the fix this returned 'not resolved', so the job burned the full
        300s grace window and then reported a successfully-merged branch as
        stranded work needing manual salvage.
        """
        code, out = run_resolved(branch_exists=False, branch_err="HTTP 404: Not Found")
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



class InconclusiveTests(unittest.TestCase):
    """Verdict 2 — a lookup FAILED, so we do not know. Never verdict 1.

    The #843 regression, and the worst of the three false positives because it is
    silent and load-triggered: `gh pr list` is a GraphQL call, it was rate-limited
    on all 15 polls, and `2>/dev/null || true` made the error indistinguishable
    from "no PR exists". The detector then reported a branch as stranded whose PR
    was open the entire time:

        No PR for claude/required-checks-and-merge-queue yet (waited 300s of 300s)
        GraphQL: API rate limit already exceeded for user ID 99821070.
        ### WARNING Stranded agent branch: `claude/required-checks-and-merge-queue`

    It fires precisely when many agents are pushing at once — exactly when this
    detector is meant to be useful.
    """

    def test_rate_limited_pr_lookup_is_inconclusive_not_stranded(self):
        code, out = run_resolved(branch_exists=True, pr_lookup_fails=True)
        self.assertEqual(code, 2, "a failed PR lookup must be INCONCLUSIVE, never stranded")
        self.assertNotEqual(code, 1)
        self.assertIn("PR lookup", out)

    def test_non_404_branch_error_is_inconclusive_not_deleted(self):
        """A 500 or a rate limit is not evidence the branch was deleted.

        Only an explicit 404 means gone; anything else means we could not tell,
        and guessing "deleted" would silently pass a genuinely stranded branch.
        """
        code, out = run_resolved(branch_exists=False, branch_err="HTTP 500: Internal Server Error")
        self.assertEqual(code, 2)
        self.assertIn("branch lookup", out)

    def test_404_is_still_read_as_deleted(self):
        """The inconclusive path must not swallow the real deleted-branch case."""
        code, _ = run_resolved(branch_exists=False, branch_err="HTTP 404: Not Found")
        self.assertEqual(code, 0)


class ShellSafetyTests(unittest.TestCase):
    def test_resolved_does_not_abort_under_set_e(self):
        """The workflow step runs as `bash -e`.

        A function returning non-zero as a bare statement exits the script there,
        so every call site must use `resolved || verdict=$?`. If the harness
        (which sets -e) can observe verdicts 1 and 2 at all, the idiom holds.
        """
        self.assertEqual(run_resolved(branch_exists=True)[0], 1)
        self.assertEqual(run_resolved(branch_exists=True, pr_lookup_fails=True)[0], 2)


class CallSiteTests(unittest.TestCase):
    def test_every_call_site_uses_the_set_e_safe_idiom(self):
        """Guard the idiom in the workflow itself, not just in the harness."""
        doc = yaml.safe_load(WORKFLOW.read_text(encoding="utf8"))
        run = next(s["run"] for s in doc["jobs"]["open-pr"]["steps"]
                   if s.get("name", "").startswith("Detect"))
        # `resolved` used as a COMMAND: at the start of a statement, i.e. after
        # line-start or `;`. Not the definition, not a mention inside an echo.
        invocations = [
            ln.strip() for ln in run.split("\n")
            if not ln.lstrip().startswith("#")
            and "resolved()" not in ln
            and re.search(r"(^|;)\s*resolved\b", ln)
        ]
        self.assertTrue(invocations, "no resolved() call sites found")
        for c in invocations:
            self.assertIn("|| verdict=$?", c,
                          f"call site must not abort under set -e: {c!r}")

    def test_no_graphql_pr_lookups_remain(self):
        """`gh pr list` is GraphQL — the call that ran out of budget on #843."""
        doc = yaml.safe_load(WORKFLOW.read_text(encoding="utf8"))
        run = next(s["run"] for s in doc["jobs"]["open-pr"]["steps"]
                   if s.get("name", "").startswith("Detect"))
        live = [ln for ln in run.split("\n")
                if "gh pr list" in ln and not ln.lstrip().startswith("#")]
        self.assertEqual(live, [], f"GraphQL PR lookups still present: {live}")


if __name__ == "__main__":
    unittest.main()
