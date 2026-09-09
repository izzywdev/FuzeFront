"""Self-test for gate_workflow_yaml.

The point of these is that the gate actually goes RED on the input it exists to
catch. A gate nobody has watched fail is indistinguishable from one that cannot.
"""
import os
import subprocess
import sys
import tempfile
import unittest

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
GATE = os.path.join(REPO, "scripts", "gate_workflow_yaml.py")

GOOD = "name: demo\non: [push]\njobs:\n  j:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n"


def run(directory):
    proc = subprocess.run(
        [sys.executable, GATE, directory], capture_output=True, text=True
    )
    return proc.returncode, proc.stdout + proc.stderr


class GateWorkflowYaml(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = self._tmp.name

    def tearDown(self):
        self._tmp.cleanup()

    def write(self, name, body):
        with open(os.path.join(self.dir, name), "w", encoding="utf-8") as fh:
            fh.write(body)

    def test_the_regression_unquoted_colon_in_step_name_fails(self):
        """THE case this gate exists for, verbatim in shape.

        #925 added exactly this step name. It broke release.yml parsing so
        completely that run 491 scheduled ZERO jobs and no image released for
        ~2.5h with nothing red anywhere. If this test ever goes green, the gate
        is dead and the outage can recur silently.
        """
        self.write(
            "release.yml",
            "name: r\non: [push]\njobs:\n  j:\n    runs-on: ubuntu-latest\n"
            "    steps:\n      - name: Sync design-system into fuzefront-website "
            "(vendored file: dependency)\n        run: echo hi\n",
        )
        code, out = run(self.dir)
        self.assertEqual(code, 1, out)
        self.assertIn("not parseable YAML", out)
        self.assertIn("release.yml", out)
        self.assertIn(
            "schedules NO JOBS", out, "the message must explain WHY silence is the failure"
        )

    def test_anti_vacuity_healthy_directory_passes(self):
        """Or the gate is just always-red, which is as useless as never-red."""
        self.write("a.yml", GOOD)
        self.write("b.yaml", GOOD)
        code, out = run(self.dir)
        self.assertEqual(code, 0, out)
        self.assertIn("parsed 2 workflow file(s), 0 unparseable", out)

    def test_anti_vacuity_empty_directory_fails(self):
        """A gate that scanned nothing must never report success."""
        code, out = run(self.dir)
        self.assertEqual(code, 1, out)
        self.assertIn("ZERO workflow files", out)

    def test_missing_directory_fails(self):
        code, out = run(os.path.join(self.dir, "nope"))
        self.assertEqual(code, 1, out)
        self.assertIn("cannot read", out)

    def test_reports_every_bad_file_not_just_the_first(self):
        self.write("a.yml", "name: x\n  bad: [\n")
        self.write("b.yml", "steps:\n  - name: a: b\n")
        self.write("c.yml", GOOD)
        code, out = run(self.dir)
        self.assertEqual(code, 1, out)
        self.assertIn("a.yml", out)
        self.assertIn("b.yml", out)
        self.assertIn("parsed 3 workflow file(s), 2 unparseable", out)

    def test_non_yaml_files_are_ignored(self):
        self.write("a.yml", GOOD)
        self.write("README.md", "not yaml: [")
        self.write(".gitkeep", "")
        code, out = run(self.dir)
        self.assertEqual(code, 0, out)
        self.assertIn("parsed 1 workflow file(s)", out)

    def test_reason_is_one_line(self):
        """PyYAML errors are multi-line; a multi-line ::error:: annotation is
        truncated by GitHub, hiding the reason."""
        self.write("a.yml", "a: b: c\n")
        code, out = run(self.dir)
        self.assertEqual(code, 1, out)
        annotation = [l for l in out.splitlines() if l.startswith("::error")][0]
        self.assertIn("not parseable YAML", annotation)


if __name__ == "__main__":
    unittest.main()
