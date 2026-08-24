#!/usr/bin/env python3
"""Exhaustive check of fuze-code-action's rung `if:` gates.

These four invariants are the whole safety argument for the fallover chain. Each
one, if broken, converts an honest red into a green — which is the defect this
action was written to prevent, so they are asserted over EVERY reachable
combination rather than spot-checked.

  1. Mention mode (no task-prompt) never reaches rung 2 or 3. codex-action and
     run-gemini-cli receive no GitHub event context, so with an empty prompt they
     cannot see the task; a rung that "succeeds" there reports success for work
     nobody performed.
  2. A TASK failure (classify code=2) never reaches rung 2 or 3. Retrying a real
     review finding or build break against another vendor is the core defect.
  3. A SUCCESS (code=0) never reaches rung 2 or 3.
  4. A rung is never attempted without its own credential.

Run: python3 .github/actions/fuze-code-action/__tests__/test_rung_gating.py
"""
import itertools
import os
import re
import sys
import unittest

try:
    import yaml
except ImportError:  # pragma: no cover - reported, never silently skipped
    print("SKIP-BLOCKED: PyYAML is not installed, so the rung gates were NOT checked.")
    print("This is a gap, not a pass. Install PyYAML in this job.")
    sys.exit(1)

ACTION = os.path.join(os.path.dirname(__file__), os.pardir, "action.yml")


def _norm(x):
    return re.sub(r"\s+", " ", x or "").strip()


def _evaluate(expr, ctx):
    """Evaluate a GitHub `if:` expression for the subset of syntax used here.

    Deliberately a small literal evaluator rather than a regex over the text: the
    point is to test the SEMANTICS of the gate, so a future edit that changes the
    logic is caught even if it keeps the same words.
    """
    e = _norm(expr)
    if not e:
        return True
    e = e.replace("always()", "True")
    # Longest key first so `steps.codex.outcome` is not clipped by a shorter key.
    for key in sorted(ctx, key=len, reverse=True):
        e = e.replace(key, repr(ctx[key]))
    e = e.replace("&&", " and ").replace("||", " or ")
    return bool(eval(e))  # noqa: S307 - inputs are this file's own literals


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

    def test_gate_invariants_over_every_combination(self):
        codes = ["0", "1", "2"]
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
            if not okey:
                self.assertFalse(r2, f"rung 2 ran with no openai key: {where}")
            if not gkey:
                self.assertFalse(r3, f"rung 3 ran with no gemini key: {where}")

        self.assertEqual(checked, 72)

    def test_the_gates_are_not_vacuous(self):
        # A suite that only proves "never fires" would pass on `if: false`.
        # Assert each rung DOES fire in its one legitimate case.
        base = {
            "steps.classify-claude.outputs.code": "1",
            "inputs.task-prompt": "do the thing",
            "inputs.openai-api-key": "sk-openai",
            "inputs.gemini-api-key": "sk-gemini",
            "steps.codex.outcome": "failure",
        }
        self.assertTrue(_evaluate(self.steps["codex"]["if"], base))
        self.assertTrue(_evaluate(self.steps["gemini"]["if"], base))


if __name__ == "__main__":
    unittest.main(verbosity=2)
