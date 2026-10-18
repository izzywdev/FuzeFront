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


VENDOR_USES = ("openai/", "google-github-actions/")
VENDOR_RUN = re.compile(r"@openai/codex|@google/gemini-cli|codex_subscription_review|\bcodex\s+(exec|login)\b|\bgemini\s+-")


def is_vendor_step(step):
    """A step that installs or executes a non-Anthropic vendor, found by what it DOES
    (the action it uses / the command it runs), not by its id or name."""
    return str(step.get("uses", "")).startswith(VENDOR_USES) or bool(VENDOR_RUN.search(str(step.get("run", ""))))


_REF = re.compile(r"\b(inputs|steps)\.([\w.-]+)")
_OTHER_VALUES = {"inputs": ("", "x"), "steps": ("", "1", "success", "failure")}


def true_assignments(cond):
    """Assignments (review-only='true' fixed) under which a GitHub `if:` is truthy.

    Supports only what the action's rung conditions use: `inputs.*` / `steps.*` refs,
    string literals, ==, !=, &&, ||, parentheses and always(). Anything else raises, so a
    new construct fails the test instead of being read as 'never true'."""
    import itertools
    expr = re.sub(r"\btrue\b(?!')", "True", re.sub(r"\bfalse\b(?!')", "False", " ".join(cond.split()))).replace("always()", "True")
    leftover = _REF.sub("", expr)
    if re.search(r"[A-Za-z_]\w*\s*\(|!(?!=)|\$\{\{", leftover.replace("True", "").replace("False", "")):
        raise AssertionError(f"unsupported expression in rung condition: {cond!r}")
    refs = sorted({m.group(0) for m in _REF.finditer(expr)} - {"inputs.review-only"})
    py = expr.replace("&&", " and ").replace("||", " or ")
    py = _REF.sub(lambda m: f"V[{m.group(0)!r}]", py)
    out = []
    for combo in itertools.product(*[_OTHER_VALUES[r.split(".")[0]] for r in refs]):
        V = dict(zip(refs, combo))
        V["inputs.review-only"] = "true"
        if eval(py, {"__builtins__": {}}, {"V": V}):  # noqa: S307 - constrained, test-only
            out.append(V)
    return out


class TestReviewOnlyOptIn(unittest.TestCase):
    """fuze-code-review.yml opts into `review-only`, and that can never become a no-op.

    An unknown `with:` input is only a GitHub warning, so if the action ever lost the
    `review-only` input the caller's `review-only: 'true'` would silently stop turning
    the Codex/OpenAI/Gemini fallover ladder off. fuze-code-action is FuzeSDLC-managed
    (a re-render resets it), and fuze-code-review.yml carries no `fuze:managed` marker
    (so neither governance-sync nor gate-workflow-drift would notice it drifting); this
    file is neither, so it is where the opt-in is pinned.
    """

    def _review_steps(self):
        doc = _load(os.path.join(WORKFLOWS, REVIEW_WORKFLOW))
        return [s for j in doc["jobs"].values() for s in j["steps"]
                if str(s.get("uses", "")).startswith("./.github/actions/fuze-code-action")]

    def test_caller_passes_review_only_true(self):
        steps = self._review_steps()
        self.assertTrue(steps, "no fuze-code-action step in the review workflow")
        for s in steps:
            self.assertEqual(str((s.get("with") or {}).get("review-only")), "true",
                             "fuze-code-review.yml must pass review-only: 'true'")

    def test_action_declares_review_only_input(self):
        inputs = _load(ACTION)["inputs"]
        self.assertIn("review-only", inputs,
                      "the action lost its review-only input: the caller's opt-in is now a silent no-op")
        self.assertEqual(str(inputs["review-only"].get("default")), "false")

    def test_vendor_keys_are_withheld_under_review_only(self):
        # Bound to the `llm` step's own `with:` fields, with exact equality, so swapped
        # vendor mappings or the expression sitting in some unrelated step cannot pass.
        steps = {s.get("id"): s for s in _load(ACTION)["runs"]["steps"] if s.get("id")}
        with_ = steps["llm"]["with"]
        for vendor in ("openai", "gemini"):
            self.assertEqual(
                " ".join(str(with_[f"fallback-{vendor}-key"]).split()),
                "${{ inputs.review-only != 'true' && inputs.%s-api-key || '' }}" % vendor,
                f"fallback-{vendor}-key must withhold ONLY the {vendor} key under review-only; the "
                f"inverted `review-only == 'true' && '' || key` always yields the key ('' is falsy)")

    def test_no_vendor_step_can_run_under_review_only(self):
        # EVALUATE each vendor step's `if` with review-only fixed to 'true' and every other
        # input / step output / outcome it reads taken over all plausible values. A step
        # that can still be true on any assignment would run a vendor for a read-only
        # reviewer (the caller does supply codex-auth-json). Matching guard text instead
        # would pass `(codex-auth-json != '' || review-only != 'true')`.
        steps = _load(ACTION)["runs"]["steps"]
        vendor = [s for s in steps if is_vendor_step(s)]
        self.assertGreaterEqual(len(vendor), 4,
                                "found too few vendor steps (codex install/run, openai, gemini); "
                                "the discovery rules in is_vendor_step() are stale")
        for s in vendor:
            cond = str(s.get("if", "")).strip()
            self.assertTrue(cond, f"vendor step {s.get('id') or s.get('name')!r} has no `if` at all")
            self.assertEqual(true_assignments(cond), [],
                             f"vendor step {s.get('id') or s.get('name')!r} can run under review-only: {cond}")

    def test_condition_evaluator_is_not_vacuous(self):
        self.assertEqual(true_assignments("inputs.review-only != 'true'"), [])
        self.assertEqual(true_assignments("inputs.a != '' && inputs.review-only != 'true'"), [])
        # The malformed shapes review flagged must be caught, not matched by substring.
        self.assertTrue(true_assignments("(inputs.codex-auth-json != '' || inputs.review-only != 'true')"))
        self.assertTrue(true_assignments("steps.x.outputs.code == '1'"))
        self.assertTrue(true_assignments("always() && inputs.review-only == 'true'"))
        # Unsupported syntax must fail loudly rather than be treated as 'never true'.
        with self.assertRaises(AssertionError):
            true_assignments("contains(inputs.a, 'b')")


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
