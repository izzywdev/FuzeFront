"""Exhaustive check of fuze-code-action's rung `if:` gates.

These four invariants are the whole safety argument for the fallover chain. Each
one, if broken, converts an honest red into a green — which is the defect this
action was written to prevent, so they are asserted over EVERY reachable
combination rather than spot-checked.

  0. ONLY an availability failure (classify code=1) reaches rung 2 or 3. Success
     (0), a task failure (2) and a decline (3) each have nothing another vendor
     could usefully retry.
  1. Mention mode (no task-prompt) never reaches rung 2 or 3. codex-action and
     run-gemini-cli receive no GitHub event context, so with an empty prompt they
     cannot see the task; a rung that "succeeds" there reports success for work
     nobody performed.
  2. A TASK failure (classify code=2) never reaches rung 2 or 3. Retrying a real
     review finding or build break against another vendor is the core defect.
  3. A SUCCESS (code=0) never reaches rung 2 or 3.
  4. A rung is never attempted without its own credential.
  5. The subscription rung's ABSENCE is announced. Rung 1a is the only rung whose
     omission changes the billing model rather than merely removing an option, and
     it used to skip in total silence: with no token every run quietly went metered,
     and the first metered provider to exhaust its prepaid balance reported a
     generic "vendor credit/quota exhausted" outage that pointed at the wrong thing.
     So the skip-notice step must fire EXACTLY when the rung does not.

Run: python3 .github/actions/fuze-code-action/__tests__/test_rung_gating.py
"""
import itertools
import os
import re
import sys
import unittest
from typing import ClassVar

try:
    import yaml
except ImportError:  # pragma: no cover - reported, never silently skipped
    print("SKIP-BLOCKED: PyYAML is not installed, so the rung gates were NOT checked.")
    print("This is a gap, not a pass. Install PyYAML in this job.")
    sys.exit(1)

ACTION = os.path.join(os.path.dirname(__file__), os.pardir, "action.yml")


def _norm(x):
    return re.sub(r"\s+", " ", x or "").strip()


_TOKENS = re.compile(
    r"""\s*(?:
          (?P<lparen>\()
        | (?P<rparen>\))
        | (?P<and>&&)
        | (?P<or>\|\|)
        | (?P<eq>==)
        | (?P<ne>!=)
        | (?P<not>!)
        | (?P<string>'(?:[^']|'')*')
        | (?P<ident>[A-Za-z_][A-Za-z0-9_.\-]*(?:\(\))?)
      )""",
    re.VERBOSE,
)


class GateSyntaxError(Exception):
    """The gate used syntax this evaluator does not implement.

    Raised, never swallowed: an `if:` this file cannot parse is an UNCHECKED
    gate, and a test suite that quietly treats one as False would report the
    invariants hold over combinations it never actually evaluated.
    """


def _tokenize(expr):
    pos, out = 0, []
    while pos < len(expr):
        m = _TOKENS.match(expr, pos)
        if not m:
            if expr[pos:].strip() == "":
                break
            raise GateSyntaxError(f"unparseable at offset {pos}: {expr[pos:]!r}")
        pos = m.end()
        kind = m.lastgroup
        out.append((kind, m.group(kind)))
    return out


def _truthy(v):
    # GitHub expression truthiness: booleans are themselves, strings are true
    # when non-empty. Matches how a bare `inputs.x` reads as a gate.
    return v if isinstance(v, bool) else bool(v)


class _Parser:
    """Recursive-descent parser for the `if:` subset this action uses.

    Deliberately a real parser rather than a regex over the text or a handoff to
    `eval`: the point is to test the SEMANTICS of the gate, so a future edit that
    changes the logic is caught even if it keeps the same words — and anything
    outside the implemented grammar raises instead of being silently reinterpreted
    by a different language's operator rules.
    """

    def __init__(self, tokens, ctx):
        self.toks, self.i, self.ctx = tokens, 0, ctx

    def peek(self):
        return self.toks[self.i][0] if self.i < len(self.toks) else None

    def take(self):
        if self.i >= len(self.toks):
            raise GateSyntaxError("expression ended unexpectedly")
        tok = self.toks[self.i]
        self.i += 1
        return tok

    def parse(self):
        v = self.parse_or()
        if self.i != len(self.toks):
            raise GateSyntaxError(f"trailing tokens: {self.toks[self.i:]!r}")
        return v

    def parse_or(self):
        v = self.parse_and()
        while self.peek() == "or":
            self.take()
            # No short-circuit: the right side must parse too, so an unsupported
            # gate cannot hide behind a left operand that happens to be true.
            v = _truthy(self.parse_and()) or _truthy(v)
        return v

    def parse_and(self):
        v = self.parse_cmp()
        while self.peek() == "and":
            self.take()
            v = _truthy(self.parse_cmp()) and _truthy(v)
        return v

    def parse_cmp(self):
        left = self.parse_unary()
        if self.peek() in ("eq", "ne"):
            op, _ = self.take()
            right = self.parse_unary()
            return (left == right) if op == "eq" else (left != right)
        return left

    def parse_unary(self):
        if self.peek() == "not":
            self.take()
            return not _truthy(self.parse_unary())
        return self.parse_atom()

    def parse_atom(self):
        kind, text = self.take()
        if kind == "lparen":
            v = self.parse_or()
            if self.peek() != "rparen":
                raise GateSyntaxError("unbalanced '('")
            self.take()
            return v
        if kind == "string":
            return text[1:-1].replace("''", "'")
        if kind == "ident":
            if text == "always()":
                return True
            if text in ("true", "false"):
                return text == "true"
            if text not in self.ctx:
                # A context key the test never supplied is an unexercised gate,
                # not a false one.
                raise GateSyntaxError(f"gate reads {text!r}, absent from the test context")
            return self.ctx[text]
        raise GateSyntaxError(f"unexpected token {text!r}")


def _evaluate(expr, ctx):
    """Evaluate a GitHub `if:` expression for the subset of syntax used here."""
    e = _norm(expr)
    if not e:
        return True
    return _truthy(_Parser(_tokenize(e), ctx).parse())


class TestRungGating(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(ACTION, encoding="utf-8") as fh:
            doc = yaml.safe_load(fh)
        cls.steps = {s.get("id") or s["name"]: s for s in doc["runs"]["steps"]}
        cls.inputs = doc["inputs"]

    def test_task_prompt_is_optional(self):
        # Mention mode depends on this: a required input cannot be left empty.
        self.assertFalse(self.inputs["task-prompt"].get("required", False))

    def test_subscription_rung_skip_is_announced(self):
        """Rung 1a and its skip-notice must be exact complements.

        Not "a notice exists somewhere" — the two gates have to partition the input
        space, so that for every token value exactly one of {run the rung, say we
        did not} happens. An overlap would warn on a run that WAS billed to the
        subscription; a gap is the original silent-skip bug.
        """
        rung = self.steps["claude-oauth"]
        notice = self.steps["Rung 1a skipped — no claude-code-oauth-token"]

        for token in ["", "sk-ant-oat-xxxx"]:
            ctx = {"inputs.claude-code-oauth-token": token}
            ran = _evaluate(rung["if"], ctx)
            announced = _evaluate(notice["if"], ctx)
            self.assertNotEqual(
                ran,
                announced,
                f"token={token!r}: rung ran={ran} and skip-announced={announced} — "
                "these must be exact complements, never both and never neither",
            )

        # And the direction, so a future edit cannot satisfy the complement above
        # by inverting both gates.
        self.assertTrue(_evaluate(rung["if"], {"inputs.claude-code-oauth-token": "sk-ant-oat-xxxx"}))
        self.assertTrue(_evaluate(notice["if"], {"inputs.claude-code-oauth-token": ""}))

    def test_subscription_skip_notice_is_a_warning_naming_the_secret(self):
        """The notice has to be actionable, not merely present.

        A reader hitting a credit outage needs the SECRET NAME and the fix. This
        asserts the three things that make it useful rather than decorative: it is a
        ::warning (not a ::notice — the openai/gemini skips are notices because
        their absence costs nothing), it names CLAUDE_CODE_OAUTH_TOKEN, and it names
        the command that mints one.
        """
        body = self.steps["Rung 1a skipped — no claude-code-oauth-token"]["run"]
        self.assertIn("::warning", body)
        self.assertNotIn("::notice", body)
        self.assertIn("CLAUDE_CODE_OAUTH_TOKEN", body)
        self.assertIn("claude setup-token", body)

    def test_subscription_rung_output_is_declared(self):
        # The output is how a CALLER distinguishes "a vendor ran out of credits"
        # from "we never tried the subscription", which is the whole point.
        with open(ACTION, encoding="utf-8") as fh:
            doc = yaml.safe_load(fh)
        self.assertIn("subscription-rung", doc["outputs"])
        self.assertIn(
            "steps.finish.outputs.subscription-rung",
            _norm(doc["outputs"]["subscription-rung"]["value"]),
        )

    def test_gate_invariants_over_every_combination(self):
        # "3" = declined: the rung ran and did no work. Like success and like a
        # task failure, it must NOT reach rungs 2 or 3 — there is nothing for
        # another vendor to retry.
        codes = ["0", "1", "2", "3"]
        prompts = ["", "do the thing"]
        okeys = ["", "sk-openai"]
        gkeys = ["", "sk-gemini"]
        codex_outcomes = ["success", "failure", "skipped"]
        review_only = ["false", "true"]

        checked = 0
        for code, prompt, okey, gkey, cout, ro in itertools.product(
            codes, prompts, okeys, gkeys, codex_outcomes, review_only
        ):
            ctx = {
                "steps.classify-claude.outputs.code": code,
                "inputs.task-prompt": prompt,
                "inputs.codex-auth-json": "",
                "inputs.openai-api-key": okey,
                "inputs.gemini-api-key": gkey,
                "steps.codex.outcome": cout,
                "inputs.review-only": ro,
            }
            r2 = _evaluate(self.steps["codex"]["if"], ctx)
            r3 = _evaluate(self.steps["gemini"]["if"], ctx)
            checked += 1
            where = (
                f"code={code} prompt={prompt!r} openai={bool(okey)} gemini={bool(gkey)} "
                f"codex={cout} review-only={ro}"
            )

            if ro == "true":
                self.assertFalse(r2, f"review-only reached rung 2: {where}")
                self.assertFalse(r3, f"review-only reached rung 3: {where}")

            if prompt == "":
                self.assertFalse(r2, f"mention mode reached rung 2: {where}")
                self.assertFalse(r3, f"mention mode reached rung 3: {where}")
            if code == "2":
                self.assertFalse(r2, f"TASK failure reached rung 2: {where}")
                self.assertFalse(r3, f"TASK failure reached rung 3: {where}")
            if code == "0":
                self.assertFalse(r2, f"success reached rung 2: {where}")
                self.assertFalse(r3, f"success reached rung 3: {where}")
            if code == "3":
                self.assertFalse(r2, f"declined reached rung 2: {where}")
                self.assertFalse(r3, f"declined reached rung 3: {where}")
            if not okey:
                self.assertFalse(r2, f"rung 2 ran with no openai key: {where}")
            if not gkey:
                self.assertFalse(r3, f"rung 3 ran with no gemini key: {where}")

        self.assertEqual(checked, 192)

    def test_the_gates_are_not_vacuous(self):
        # A suite that only proves "never fires" would pass on `if: false`.
        # Assert each rung DOES fire in its one legitimate case.
        base = {
            "steps.classify-claude.outputs.code": "1",
            "inputs.task-prompt": "do the thing",
            "inputs.codex-auth-json": "",
                "inputs.openai-api-key": "sk-openai",
            "inputs.gemini-api-key": "sk-gemini",
            "steps.codex.outcome": "failure",
            "inputs.review-only": "false",
        }
        self.assertTrue(_evaluate(self.steps["codex"]["if"], base))
        self.assertTrue(_evaluate(self.steps["gemini"]["if"], base))
        # review-only is the ONLY thing that flips these off in this otherwise-live case.
        ro = {**base, "inputs.review-only": "true"}
        self.assertFalse(_evaluate(self.steps["codex"]["if"], ro))
        self.assertFalse(_evaluate(self.steps["gemini"]["if"], ro))

    def test_classify_rung1_is_gated_on_rung_1a_not_settling(self):
        # Invariant 5: the rung-1 classify step must NOT run once rung 1a has
        # already settled the run. Unguarded it ran on every path, read the
        # (correctly) skipped rung 1 as an availability failure (code 1), and
        # that spurious code 1 is what the metered OpenAI/Gemini gates fire on —
        # so they ran on a finished run, burning spend and surfacing a provider
        # error inside an otherwise-successful review. The gate mirrors the `llm`
        # and rung-1 `claude` steps exactly: run only when rung 1a was not
        # attempted ('') or failed on availability ('1').
        gate = self.steps["classify-claude"].get("if")
        self.assertTrue(gate, "classify-claude must be gated, not always-run")
        for oauth_code, should_run in [
            ("", True),    # rung 1a not configured — rung 1 is the primary path
            ("1", True),   # rung 1a failed on availability — rung 1 took over
            ("0", False),  # rung 1a succeeded — run is settled
            ("2", False),  # rung 1a task failure — chain stops, no retry
            ("3", False),  # rung 1a declined — nothing to classify
        ]:
            ctx = {"steps.classify-claude-oauth.outputs.code": oauth_code}
            self.assertEqual(
                _evaluate(gate, ctx), should_run,
                f"classify-claude gate wrong for rung-1a code={oauth_code!r}",
            )

    def test_review_only_switches_off_the_codex_subscription_rung(self):
        """The Codex subscription review installs a pinned Node + the @openai/codex npm
        CLI on the runner — a vendor CLI exactly like rungs 2/3. Under review-only none
        of its three steps (Node setup, CLI install, the review itself) may run; without
        review-only they must, so this is not vacuous."""
        names = [
            "Install pinned Node.js for Codex subscription reviewer",
            "Install pinned Codex subscription reviewer",
            "codex-subscription",
        ]
        live = {
            "steps.classify-claude-oauth.outputs.code": "1",
            "steps.classify-claude.outputs.code": "1",
            "inputs.task-prompt": "do the thing",
            "inputs.codex-auth-json": "{}",
            "inputs.review-only": "false",
        }
        for name in names:
            cond = self.steps[name]["if"]
            self.assertTrue(_evaluate(cond, live), f"{name} should run when review-only is off")
            self.assertFalse(
                _evaluate(cond, {**live, "inputs.review-only": "true"}),
                f"{name} ran under review-only",
            )

    def test_review_only_default_is_off(self):
        # Default 'false' keeps every existing caller's ladder exactly as it was.
        self.assertEqual(self.inputs["review-only"]["default"], "false")
        self.assertFalse(self.inputs["review-only"].get("required", False))

    def test_review_only_suppression_is_announced_exactly_when_it_applies(self):
        """The Review-only notice must fire EXACTLY when review-only is what stopped the
        ladder: an availability failure at rung 1 in a prompt-driven run, review-only on.
        Not in mention mode (that has its own notice), not when review-only is off, not on
        success/task failure. A silent shorter chain is the 'looks like config, does
        nothing' trap this suite exists for."""
        notice = self.steps["Review-only — OpenAI and Gemini rungs deliberately not attempted"]
        self.assertIn("::warning", notice["run"])
        for code, prompt, ro in itertools.product(
            ["0", "1", "2", "3"], ["", "do the thing"], ["false", "true"]
        ):
            ctx = {
                "steps.classify-claude.outputs.code": code,
                "inputs.task-prompt": prompt,
                "inputs.review-only": ro,
            }
            expected = code == "1" and prompt != "" and ro == "true"
            self.assertEqual(
                _evaluate(notice["if"], ctx),
                expected,
                f"code={code} prompt={prompt!r} review-only={ro}",
            )

    def test_no_key_skip_notices_stay_quiet_under_review_only(self):
        # "skipped -- no openai/gemini key" is only true of a ladder that WOULD have run.
        # Under review-only the ladder is off by design, so announcing a missing key there
        # would misdiagnose a deliberate switch as a configuration gap.
        for step in ("codex-no-key", "gemini-no-key"):
            for code, prompt, ro in itertools.product(
                ["0", "1", "2", "3"], ["", "do the thing"], ["false", "true"]
            ):
                ctx = {
                    "steps.classify-claude.outputs.code": code,
                    "inputs.task-prompt": prompt,
                    "inputs.review-only": ro,
                    "inputs.codex-auth-json": "",
                    "inputs.openai-api-key": "",
                    "inputs.gemini-api-key": "",
                    "steps.codex.outcome": "skipped",
                }
                if ro == "true":
                    self.assertFalse(
                        _evaluate(self.steps[step]["if"], ctx),
                        f"{step} announced a missing key under review-only (code={code})",
                    )

    def test_review_only_does_not_forward_non_anthropic_keys_to_llm_endpoint(self):
        """With review-only the runner-local chain must be anthropic-only (single-vendor
        direct path, no container). The anthropic key is forwarded unconditionally; the
        openai/gemini keys only when review-only is not 'true'."""
        w = self.steps["llm"]["with"]
        self.assertEqual(_norm(w["fallback-anthropic-key"]), "${{ inputs.anthropic-api-key }}")
        for vendor in ("openai", "gemini"):
            expr = _norm(w[f"fallback-{vendor}-key"])
            # Shape is load-bearing: `cond && KEY || ''`, never `cond && '' || KEY`.
            # '' is falsy in a GHA expression, so the inverted `== 'true' && '' || KEY`
            # resolves to KEY unconditionally and never suppresses — the defect this
            # pins against. Require the positive-guard form and reject the inverted one.
            self.assertEqual(
                expr,
                f"${{{{ inputs.review-only != 'true' && inputs.{vendor}-api-key || '' }}}}",
                f"fallback-{vendor}-key must suppress under review-only",
            )
            self.assertNotIn("== 'true' && ''", expr,
                             f"fallback-{vendor}-key uses the inverted ternary")


class TestEvaluator(unittest.TestCase):
    """The evaluator is now the thing the invariants are measured with, so it is
    tested too. A permissive evaluator would pass every invariant above while
    proving nothing about the real gates."""

    CTX: ClassVar[dict] = {"a": "x", "b": "", "steps.s.outcome": "failure"}

    def test_comparisons(self):
        self.assertTrue(_evaluate("a == 'x'", self.CTX))
        self.assertFalse(_evaluate("a == 'y'", self.CTX))
        self.assertTrue(_evaluate("b != 'x'", self.CTX))

    def test_boolean_operators_and_precedence(self):
        self.assertFalse(_evaluate("a == 'x' && b != ''", self.CTX))
        self.assertTrue(_evaluate("a == 'x' || b != ''", self.CTX))
        # && binds tighter than ||, as in GitHub expressions.
        self.assertTrue(_evaluate("a == 'y' && a == 'z' || a == 'x'", self.CTX))
        self.assertTrue(_evaluate("(a == 'y' || a == 'x') && steps.s.outcome != 'success'", self.CTX))

    def test_bare_operand_truthiness(self):
        self.assertTrue(_evaluate("a", self.CTX))
        self.assertFalse(_evaluate("b", self.CTX))
        self.assertTrue(_evaluate("!b", self.CTX))
        self.assertTrue(_evaluate("always()", self.CTX))

    def test_unsupported_syntax_raises_rather_than_returning_false(self):
        # An `if:` this evaluator cannot parse is an UNCHECKED gate. Returning
        # False there would report the invariants hold over combinations that
        # were never evaluated — the exact vacuous-pass this suite exists to
        # prevent.
        for bad in ["contains(a, 'x')", "a =~ 'x'", "a == 'x' &&", "(a == 'x'"]:
            with self.assertRaises(GateSyntaxError, msg=bad):
                _evaluate(bad, self.CTX)

    def test_unknown_context_key_raises(self):
        with self.assertRaises(GateSyntaxError):
            _evaluate("inputs.not-supplied == ''", self.CTX)


if __name__ == "__main__":
    unittest.main(verbosity=2)
