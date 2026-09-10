#!/usr/bin/env python3
"""Self-test for execution_result.py — the deriver that fixes the "declined on
every run" bug.

WHY THIS MATTERS. claude-code-action (a composite) exposes no `conclusion`
output, so fuze-code-action read an always-empty value, classify.sh saw
empty+success on every clean review, and returned code=3 "declined" — the
workflow never once produced a verdict. execution_result.py derives the real
signal from the execution file's final SDK result record. If it ever returns the
wrong conclusion, the fail-closed contract breaks in one of two ways, both
asserted below: a genuine success misreported as empty (silent decline again), or
— far worse — a failure/absence misreported as "success" (a manufactured green).

The invariants:
  * success record  -> conclusion "success", result-text == the `result` string.
  * error record    -> conclusion "failure" (NEVER success), result-text from
                       `errors`.
  * is_error:true even with subtype success -> "failure".
  * no result record / missing file / corrupt JSON / non-list -> conclusion ""
    (empty), so classify.sh + the step outcome decide — never a fabricated green.
  * the script always exits 0 (a read failure must not red the composite).
  * conclusion is derived ONLY from the file, never invented.

Run: python3 .github/actions/fuze-code-action/__tests__/test_execution_result.py
"""
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(__file__)
SCRIPT = os.path.normpath(os.path.join(HERE, os.pardir, "execution_result.py"))

_spec = importlib.util.spec_from_file_location("execution_result", SCRIPT)
execution_result = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(execution_result)
derive = execution_result.derive


def _write(messages) -> str:
    fd, path = tempfile.mkstemp(suffix=".json")
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        if isinstance(messages, str):
            fh.write(messages)  # raw (for the corrupt-JSON case)
        else:
            json.dump(messages, fh)
    return path


SUCCESS_MSGS = [
    {"type": "system", "subtype": "init", "session_id": "s1"},
    {"type": "assistant", "message": {"content": "working"}},
    {
        "type": "result",
        "subtype": "success",
        "is_error": False,
        "result": "Looks clean.\n===FUZE_REVIEW_VERDICT_JSON:abc===\n"
                  '{"verdict":"approve","summary":"ok","findings":[]}\n'
                  "===END_FUZE_REVIEW_VERDICT_JSON:abc===",
        "session_id": "s1",
    },
]


class TestDerive(unittest.TestCase):
    def _run(self, messages):
        path = _write(messages)
        try:
            return derive(path)
        finally:
            os.unlink(path)

    # ── success ──────────────────────────────────────────────────────────────
    def test_success_record_yields_success_and_result_text(self):
        conclusion, text = self._run(SUCCESS_MSGS)
        self.assertEqual(conclusion, "success")
        self.assertIn("===FUZE_REVIEW_VERDICT_JSON:abc===", text)
        self.assertIn('"verdict":"approve"', text)

    def test_last_result_record_wins(self):
        msgs = list(SUCCESS_MSGS) + [
            {"type": "result", "subtype": "success", "is_error": False, "result": "FINAL"},
        ]
        self.assertEqual(self._run(msgs), ("success", "FINAL"))

    # ── failure: MUST NEVER be reported as success ─────────────────────────────
    def test_error_max_turns_is_failure_never_success(self):
        conclusion, text = self._run([
            {"type": "result", "subtype": "error_max_turns", "is_error": True,
             "errors": ["hit max turns"]},
        ])
        self.assertEqual(conclusion, "failure")
        self.assertIn("hit max turns", text)

    def test_error_during_execution_is_failure(self):
        conclusion, _ = self._run([
            {"type": "result", "subtype": "error_during_execution", "is_error": True,
             "errors": ["boom"]},
        ])
        self.assertEqual(conclusion, "failure")

    def test_is_error_true_overrides_success_subtype(self):
        # Defensive: a result claiming subtype success but is_error true is not a
        # success. Never manufacture a green from a self-contradictory record.
        conclusion, _ = self._run([
            {"type": "result", "subtype": "success", "is_error": True, "result": "x"},
        ])
        self.assertEqual(conclusion, "failure")

    # ── empty conclusion: the genuine decline / could-not-start shape ──────────
    def test_no_result_record_is_empty(self):
        self.assertEqual(
            self._run([{"type": "system", "subtype": "init"},
                       {"type": "assistant", "message": {"content": "hi"}}]),
            ("", ""),
        )

    def test_missing_file_is_empty(self):
        self.assertEqual(derive("/definitely/not/here.json"), ("", ""))

    def test_empty_path_is_empty(self):
        self.assertEqual(derive(""), ("", ""))

    def test_corrupt_json_is_empty_not_success(self):
        path = _write("{ this is not json ]")
        try:
            self.assertEqual(derive(path), ("", ""))
        finally:
            os.unlink(path)

    def test_non_list_top_level_is_empty(self):
        path = _write({"type": "result", "subtype": "success"})  # object, not array
        try:
            self.assertEqual(derive(path), ("", ""))
        finally:
            os.unlink(path)

    def test_success_without_result_text_still_success(self):
        # subtype success but no `result` string: conclusion still success, text
        # empty (the verdict gate then abstains on unparseable output — fail
        # closed — rather than approving on nothing).
        self.assertEqual(
            self._run([{"type": "result", "subtype": "success", "is_error": False}]),
            ("success", ""),
        )


class TestScriptContract(unittest.TestCase):
    def test_writes_github_output_and_exits_zero(self):
        path = _write(SUCCESS_MSGS)
        out_fd, out_path = tempfile.mkstemp(suffix=".txt")
        os.close(out_fd)
        try:
            env = dict(os.environ, GITHUB_OUTPUT=out_path)
            proc = subprocess.run(
                [sys.executable, SCRIPT, path],
                capture_output=True, text=True, env=env,
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)
            with open(out_path, encoding="utf-8") as fh:
                written = fh.read()
            self.assertIn("conclusion=success", written)
            self.assertIn("result-text<<", written)
            # The raw result text must go to GITHUB_OUTPUT, never to stdout logs.
            self.assertNotIn("verdict", proc.stdout)
        finally:
            os.unlink(path)
            os.unlink(out_path)

    def test_exits_zero_even_on_missing_file(self):
        proc = subprocess.run(
            [sys.executable, SCRIPT, "/no/such/file.json"],
            capture_output=True, text=True,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)
