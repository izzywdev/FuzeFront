#!/usr/bin/env python3
"""Self-test for fuze-code-action's `extra-env` export step.

It extracts the step's ACTUAL `run:` script out of action.yml and executes it,
rather than testing a copy — a copied script drifts from the real one and then
tests nothing, which is the failure shape this repo keeps finding.

What matters here, and why:
  * A caller's step `env:` does not reliably reach a composite action's inner
    steps, so 30 fleet call sites pass their task environment through this input
    instead. If the export silently dropped a line, a KUBECONFIG or a model pin
    would vanish while every run still reported success.
  * ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN must be REFUSED: the action probes
    for a working endpoint itself, and a literal override would defeat that.
  * Values may be secrets. They must reach $GITHUB_ENV and never stdout.
"""
import os, subprocess, sys, tempfile, textwrap, unittest

try:
    import yaml
except ImportError:  # pragma: no cover
    print("SKIP-BLOCKED: PyYAML missing, extra-env export NOT checked. A gap, not a pass.")
    sys.exit(1)

ACTION = os.path.join(os.path.dirname(__file__), os.pardir, "action.yml")
STEP = "Export caller-supplied task environment"


def _script():
    with open(ACTION, encoding="utf-8") as fh:
        doc = yaml.safe_load(fh)
    for st in doc["runs"]["steps"]:
        if st.get("name") == STEP:
            return st["run"]
    raise AssertionError(f"step {STEP!r} not found in action.yml")


def run(extra_env):
    """Execute the real export script with EXTRA_ENV set; return (rc, stdout, env_file)."""
    fd, envf = tempfile.mkstemp()
    os.close(fd)
    p = subprocess.run(
        ["bash", "-c", _script()],
        env={**os.environ, "EXTRA_ENV": extra_env, "GITHUB_ENV": envf},
        capture_output=True, text=True,
    )
    with open(envf, encoding="utf-8") as fh:
        written = fh.read()
    os.unlink(envf)
    return p.returncode, p.stdout + p.stderr, written


class TestExtraEnv(unittest.TestCase):
    def test_exports_each_line(self):
        rc, out, w = run("KUBECONFIG=/tmp/kc\nANTHROPIC_MODEL=claude-opus-5")
        self.assertEqual(rc, 0, out)
        self.assertIn("KUBECONFIG=/tmp/kc", w)
        self.assertIn("ANTHROPIC_MODEL=claude-opus-5", w)
        self.assertIn("exported 2", out)

    def test_skips_blanks_and_comments(self):
        rc, out, w = run("A=1\n\n   \n# note\nB=2")
        self.assertEqual(rc, 0, out)
        self.assertIn("exported 2", out)
        self.assertNotIn("#", w)

    def test_refuses_anthropic_base_url(self):
        rc, out, w = run("ANTHROPIC_BASE_URL=http://elsewhere")
        self.assertEqual(rc, 1)
        self.assertIn("must not set ANTHROPIC_BASE_URL", out)
        self.assertEqual(w.strip(), "", "refused input must write nothing")

    def test_refuses_anthropic_auth_token_without_echoing_it(self):
        rc, out, w = run("ANTHROPIC_AUTH_TOKEN=sk-ant-SECRET")
        self.assertEqual(rc, 1)
        self.assertNotIn("sk-ant-SECRET", out, "refusal message leaked the value")

    def test_refuses_malformed_line(self):
        rc, out, _ = run("NOT_A_PAIR")
        self.assertEqual(rc, 1)

    def test_never_echoes_a_value_on_success(self):
        rc, out, w = run("GH_TOKEN=ghp_supersecret")
        self.assertEqual(rc, 0, out)
        self.assertNotIn("ghp_supersecret", out, "value leaked to the job log")
        self.assertIn("ghp_supersecret", w, "value must still reach $GITHUB_ENV")

    def test_preserves_awkward_values(self):
        rc, out, w = run('A=1=2\nB=has spaces and "quotes"')
        self.assertEqual(rc, 0, out)
        self.assertIn("A=1=2", w)
        self.assertIn('B=has spaces and "quotes"', w)


if __name__ == "__main__":
    unittest.main(verbosity=2)
