#!/usr/bin/env python3
"""A pure-review caller of fuze-code-action must be read-only at the TOOL level.

fuze-code-review.yml hands an attacker-controlled PR diff to a model and promises
that the model has no Bash/Write/Edit. That promise held only for the Anthropic
rungs (`--allowedTools "Read,Grep,Glob"`). On fallover the OpenAI rung ran
`danger-full-access` (a full shell on the runner) and the Gemini rung runs
`gemini --yolo` (auto-approve every tool, shell included) with no allow-list, while
`actions/checkout` left the job's GITHUB_TOKEN (`pull-requests: write`) in
`.git/config`. A prompt-injected diff could therefore run commands and use the token.

Invariants, checked against the real files (not a copy of their text):

  1. Every caller whose own `claude-args` allow-list has no write-capable tool
     (Bash/Edit/MultiEdit/Write/NotebookEdit) is a READ-ONLY-INTENT caller. Each one
     must NOT forward `openai-api-key` or `gemini-api-key`: fuze-code-action only
     runs a fallover rung whose key is non-empty, so an absent key is what keeps
     codex (`danger-full-access`) and gemini (`--yolo`) out of a reviewer.
  2. Each such caller's checkout steps set `persist-credentials: false`.
  3. No such caller's fuze-code-action step carries an `env:` block, so the job
     token is not exported into the LLM-running step.
  4. fuze-code-review.yml is explicitly a read-only-intent caller (so a refactor
     that drops its `--allowedTools` cannot make invariant 1 vacuous).
  5. The action still gates BOTH the codex and gemini rungs on their key being
     non-empty. fuze-code-action is a FuzeSDLC-managed file (governance-sync resets
     local edits), so this is the mechanism available here; if the canonical ever
     drops it, this test fails loudly instead of the reviewer silently regaining a
     shell.

Run: python3 .github/actions/fuze-code-action/__tests__/test_review_caller_readonly.py
"""
import glob
import os
import re
import sys
import unittest

try:
    import yaml
except ImportError:  # pragma: no cover - reported, never silently skipped
    print("SKIP-BLOCKED: PyYAML is not installed, so the review caller was NOT checked.")
    sys.exit(1)

HERE = os.path.dirname(os.path.abspath(__file__))
ACTION = os.path.join(HERE, os.pardir, "action.yml")
WORKFLOWS = os.path.normpath(os.path.join(HERE, os.pardir, os.pardir, os.pardir, "workflows"))
REVIEW_WORKFLOW = "fuze-code-review.yml"

WRITE_TOOLS = ("Bash", "Edit", "MultiEdit", "Write", "NotebookEdit")


def _load(path):
    with open(path, encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def _allowlist(claude_args):
    """Tool names from `--allowedTools` / `--allowed-tools`; None when absent."""
    if not claude_args:
        return None
    m = re.search(r"--allowed-?[tT]ools\s+(?:\"([^\"]*)\"|'([^']*)'|(\S+))", claude_args)
    if not m:
        return None
    raw = next(g for g in m.groups() if g is not None)
    # Split on commas/whitespace outside parentheses: `Bash(git:*)` stays one tool.
    tools, depth, cur = [], 0, ""
    for ch in raw:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch in ", \t" and depth == 0:
            if cur:
                tools.append(cur)
            cur = ""
        else:
            cur += ch
    if cur:
        tools.append(cur)
    return tools


def _is_write_capable(tools):
    return any(t.split("(")[0] in WRITE_TOOLS for t in tools)


def callers(workflows_dir=WORKFLOWS):
    """Yield (file, job_name, job, step) for every step calling fuze-code-action."""
    for path in sorted(glob.glob(os.path.join(workflows_dir, "*.yml"))):
        if os.path.basename(path) == "gate-fuze-code-action.yml":
            continue
        doc = _load(path)
        for jname, job in (doc.get("jobs") or {}).items():
            for step in job.get("steps") or []:
                if "fuze-code-action" in str(step.get("uses", "")):
                    yield os.path.basename(path), jname, job, step


def read_only_intent(step):
    tools = _allowlist((step.get("with") or {}).get("claude-args", ""))
    return tools is not None and not _is_write_capable(tools)


def violations(file, job, step):
    """Every way this READ-ONLY-INTENT caller fails to be read-only. [] = clean."""
    out = []
    w = step.get("with") or {}
    for key in ("openai-api-key", "gemini-api-key"):
        if key in w:
            out.append(f"forwards `{key}` to a read-only reviewer")
    if step.get("env"):
        out.append("fuze-code-action step has an `env:` block (token/secret export into the LLM step)")
    for s in job.get("steps") or []:
        if str(s.get("uses", "")).startswith("actions/checkout"):
            pc = (s.get("with") or {}).get("persist-credentials")
            if pc is not False:
                out.append(f"checkout `{s.get('name') or s.get('uses')}` persists credentials (persist-credentials={pc!r})")
    return out


class TestReviewCallerReadOnly(unittest.TestCase):
    def test_review_workflow_is_a_read_only_intent_caller(self):
        # Pin the one caller by name so a refactor that drops --allowedTools cannot
        # turn invariant 1 into a vacuous "no read-only callers found".
        found = [(f, j, s) for f, j, _job, s in callers() if f == REVIEW_WORKFLOW]
        self.assertEqual(len(found), 1, f"{REVIEW_WORKFLOW} must call fuze-code-action exactly once")
        _f, _j, step = found[0]
        tools = _allowlist(step["with"].get("claude-args", ""))
        self.assertIsNotNone(tools, "the reviewer must declare an explicit --allowedTools list")
        self.assertEqual(sorted(tools), ["Glob", "Grep", "Read"])

    def test_every_read_only_intent_caller_is_locked_down(self):
        checked, bad = 0, []
        for f, j, job, step in callers():
            if not read_only_intent(step):
                continue
            checked += 1
            for v in violations(f, job, step):
                bad.append(f"{f} job `{j}`: {v}")
        self.assertGreaterEqual(checked, 1, "no read-only-intent caller found: the check ran over nothing")
        self.assertEqual(bad, [], "read-only reviewer is not read-only at the tool level:\n  " + "\n  ".join(bad))

    def test_review_checkout_does_not_persist_the_token(self):
        doc = _load(os.path.join(WORKFLOWS, REVIEW_WORKFLOW))
        checkouts = [
            s for j in doc["jobs"].values() for s in j["steps"]
            if str(s.get("uses", "")).startswith("actions/checkout")
        ]
        self.assertTrue(checkouts, "no checkout step found")
        for s in checkouts:
            self.assertIs((s.get("with") or {}).get("persist-credentials"), False)

    def test_review_submit_step_still_has_its_own_token(self):
        # persist-credentials: false must not break `gh pr review`: that step takes
        # GH_TOKEN from its own env and names the repo explicitly.
        doc = _load(os.path.join(WORKFLOWS, REVIEW_WORKFLOW))
        steps = [s for j in doc["jobs"].values() for s in j["steps"] if s.get("name") == "Submit GitHub review"]
        self.assertEqual(len(steps), 1)
        env = steps[0]["env"]
        self.assertIn("GH_TOKEN", env)
        self.assertIn("GH_REPO", env)

    def test_action_rungs_are_gated_on_their_key(self):
        doc = _load(ACTION)
        steps = {s.get("id") or s["name"]: s for s in doc["runs"]["steps"]}
        for rung, key in (("codex", "openai-api-key"), ("gemini", "gemini-api-key")):
            cond = " ".join(str(steps[rung]["if"]).split())
            self.assertIn(f"inputs.{key} != ''", cond,
                          f"rung `{rung}` is not gated on a non-empty {key}: omitting the "
                          f"key no longer keeps it out of a read-only reviewer")


PRE_FIX_STEP = {
    "uses": "./.github/actions/fuze-code-action",
    "with": {
        "claude-args": '--allowedTools "Read,Grep,Glob"',
        "openai-api-key": "${{ secrets.OPENAI_API_KEY }}",
        "gemini-api-key": "${{ secrets.GEMINI_API_KEY }}",
    },
}
PRE_FIX_JOB = {"steps": [{"uses": "actions/checkout@x", "with": {"fetch-depth": 0}}]}


class TestDetectorIsNotVacuous(unittest.TestCase):
    """The detector must flag the pre-fix shape, or the suite above proves nothing."""

    def test_pre_fix_shape_is_flagged(self):
        self.assertTrue(read_only_intent(PRE_FIX_STEP))
        v = violations("x.yml", PRE_FIX_JOB, PRE_FIX_STEP)
        self.assertEqual(len(v), 3, v)

    def test_maintainer_allowlists_are_not_read_only_intent(self):
        for args in (
            '--allowedTools "Bash,Read,Edit,MultiEdit,Write,Glob,Grep,WebFetch"',
            "--model m --allowedTools 'Edit,Read,Bash(git:*)'",
            "--allowedTools Write",
        ):
            self.assertFalse(read_only_intent({"with": {"claude-args": args}}), args)
        for args in ('--allowedTools "Read,Grep,Glob"', "--allowedTools Read,Glob"):
            self.assertTrue(read_only_intent({"with": {"claude-args": args}}), args)
        # No allow-list at all is default tools, not read-only intent.
        self.assertFalse(read_only_intent({"with": {}}))

    def test_fixed_shape_is_clean(self):
        step = {
            "uses": "./.github/actions/fuze-code-action",
            "with": {"claude-args": '--allowedTools "Read,Grep,Glob"'},
        }
        job = {"steps": [{"uses": "actions/checkout@x", "with": {"persist-credentials": False}}]}
        self.assertEqual(violations("x.yml", job, step), [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
