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

        checked = 0
        for code, prompt, okey, gkey, cout in itertools.product(
            codes, prompts, okeys, gkeys, codex_outcomes
        ):
            ctx = {
                "steps.classify-claude.outputs.code": code,
                "inputs.task-prompt": prompt,
                "inputs.codex-auth-json": "",
                "inputs.openai-api-key": okey,
                "inputs.gemini-api-key": gkey,
                "steps.codex.outcome": cout,
            }
            r2 = _evaluate(self.steps["codex"]["if"], ctx)
            r3 = _evaluate(self.steps["gemini"]["if"], ctx)
            checked += 1
            where = f"code={code} prompt={prompt!r} openai={bool(okey)} gemini={bool(gkey)} codex={cout}"

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

        self.assertEqual(checked, 96)

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
        }
        self.assertTrue(_evaluate(self.steps["codex"]["if"], base))
        self.assertTrue(_evaluate(self.steps["gemini"]["if"], base))


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
