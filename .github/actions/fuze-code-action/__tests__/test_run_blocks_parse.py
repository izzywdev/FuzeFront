#!/usr/bin/env python3
"""Every `run:` block in these actions must be parseable bash.

This exists because a shipped one was not. A `::warning::` message added to the
rung-1 classify step used the `'"'"'` idiom to write an apostrophe — correct
inside SINGLE quotes, wrong inside the double-quoted string it was actually in,
where it closed the quote, emitted a literal `"`, and left the rest of the line
opening a string that never closed.

The failure mode is what makes this worth a test. The step had already written
`code=3` to $GITHUB_OUTPUT before reaching the malformed line, so the composite's
Finish step read the right value and exited 0 — while the classify step itself
died on a syntax error and failed the whole composite. Every log line said the
chain had resolved correctly; the job was red anyway. Nothing in YAML validation,
actionlint's own checks, or the unit tests looked at whether the shell parsed.

`bash -n` is not a full correctness check and is not claimed to be one. It parses
without executing, which catches exactly this class: unterminated strings,
unbalanced heredocs, unclosed `if`/`for`/`case`.

Run: python3 .github/actions/fuze-code-action/__tests__/test_run_blocks_parse.py
"""
import os
import re
import subprocess
import sys
import tempfile
import unittest

try:
    import yaml
except ImportError:  # pragma: no cover - reported, never silently skipped
    print("SKIP-BLOCKED: PyYAML is not installed, so the run blocks were NOT parsed.")
    print("This is a gap, not a pass. Install PyYAML in this job.")
    sys.exit(1)

HERE = os.path.dirname(__file__)
# This action, and the endpoint resolver it calls — same repo, same failure mode.
ACTIONS = [
    os.path.normpath(os.path.join(HERE, os.pardir, "action.yml")),
    os.path.normpath(os.path.join(HERE, os.pardir, os.pardir, "llm-endpoint", "action.yml")),
]

# `${{ ... }}` is substituted by the runner before bash ever sees it, and is not
# valid shell on its own. Replace it with a plain word so the REST of the line is
# still parsed — the point is to check the shell around the expression.
EXPR = re.compile(r"\$\{\{[^}]*\}\}")


def _run_blocks(path):
    with open(path, encoding="utf-8") as fh:
        doc = yaml.safe_load(fh)
    for step in doc["runs"]["steps"]:
        if "run" in step:
            yield (step.get("id") or step.get("name") or "<unnamed>"), step["run"]


class TestRunBlocksParse(unittest.TestCase):
    def test_every_run_block_parses(self):
        checked = 0
        for action in ACTIONS:
            if not os.path.isfile(action):
                continue
            for name, body in _run_blocks(action):
                checked += 1
                script = EXPR.sub("GHA_EXPR", body)
                fd, path = tempfile.mkstemp(suffix=".sh")
                try:
                    with os.fdopen(fd, "w") as fh:
                        fh.write(script)
                    proc = subprocess.run(
                        ["bash", "-n", path], capture_output=True, text=True
                    )
                finally:
                    os.unlink(path)
                self.assertEqual(
                    proc.returncode,
                    0,
                    f"{os.path.basename(os.path.dirname(action))} step {name!r} is not "
                    f"parseable bash:\n{proc.stderr.strip()}",
                )
        # Without this the suite would pass on a restructured file it never read.
        self.assertGreater(checked, 5, f"only {checked} run blocks found — expected more")


if __name__ == "__main__":
    unittest.main(verbosity=2)
