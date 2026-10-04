#!/usr/bin/env python3
"""llm-endpoint's runner-local `docker run` must be wall-clock bounded.

`docker run -d` includes the image pull, and every ARC runner pod is ephemeral,
so on the runner-local fallback path the pull is always cold. Before this test
existed, nothing bounded it: the 45s readiness loop only starts AFTER
`docker run` returns, so a stuck pull or a wedged dind daemon held the step --
and the caller's whole `Run automated review` budget -- open indefinitely.

This test runs the real `resolve` step against a stub `docker` whose `run`
never returns, and asserts the step:
  1. finishes well inside an outer deadline (it is cut off, not hung), and
  2. still DEGRADES to the direct-Anthropic leg (mode=fallback-anthropic),
     i.e. the bound did not turn an available path into an outage.

Mutation check: against the pre-fix action.yml this test fails on (1) -- the
step is still running when the outer deadline kills it.

Run: python3 .github/actions/fuze-code-action/__tests__/test_llm_endpoint_docker_timeout.py
"""
import os
import signal
import stat
import subprocess
import sys
import tempfile
import time
import unittest

try:
    import yaml
except ImportError:  # pragma: no cover - reported, never silently skipped
    print("SKIP-BLOCKED: PyYAML is not installed, so the docker bound was NOT tested.")
    print("This is a gap, not a pass. Install PyYAML in this job.")
    sys.exit(1)

HERE = os.path.dirname(__file__)
ACTION = os.path.normpath(
    os.path.join(HERE, os.pardir, os.pardir, "llm-endpoint", "action.yml")
)

DOCKER_STUB = """#!/usr/bin/env bash
echo "docker $*" >> "$STUB_DIR/docker.calls"
if [ "$1" = "run" ]; then exec sleep 600; fi
exit 0
"""

# Readiness probes fail (no LiteLLM reachable); the direct-Anthropic serve
# probe answers 200 so the degrade leg can complete without any network.
CURL_STUB = """#!/usr/bin/env bash
for a in "$@"; do
  case "$a" in *api.anthropic.com*) printf 200; exit 0 ;; esac
done
exit 7
"""


def _resolve_block():
    with open(ACTION) as fh:
        action = yaml.safe_load(fh)
    for step in action["runs"]["steps"]:
        if step.get("id") == "resolve":
            return step["run"]
    raise AssertionError("llm-endpoint has no step with id=resolve")


class DockerRunIsBounded(unittest.TestCase):
    def test_hung_docker_run_is_cut_off_and_degrades(self):
        with tempfile.TemporaryDirectory() as d:
            bindir = os.path.join(d, "bin")
            os.makedirs(bindir)
            os.makedirs(os.path.join(d, "tmp"))
            for name, body in (("docker", DOCKER_STUB), ("curl", CURL_STUB)):
                p = os.path.join(bindir, name)
                with open(p, "w") as fh:
                    fh.write(body)
                os.chmod(p, os.stat(p).st_mode | stat.S_IEXEC)
            script = os.path.join(d, "resolve.sh")
            with open(script, "w") as fh:
                fh.write(_resolve_block())
            out = os.path.join(d, "out")
            env = dict(os.environ)
            env.update({
                "PATH": bindir + os.pathsep + env.get("PATH", ""),
                "STUB_DIR": d,
                "RUNNER_TEMP": os.path.join(d, "tmp"),
                "GITHUB_OUTPUT": out,
                "LITELLM_BASE_URL": "", "LITELLM_KEY": "",
                "CF_ACCESS_CLIENT_ID": "", "CF_ACCESS_CLIENT_SECRET": "",
                "PUBLIC_LITELLM_BASE_URL": "", "LITELLM_CI_KEY": "",
                "PROBE_TIMEOUT": "1", "SERVE_PROBE_TIMEOUT": "1",
                # Two vendors so the single-vendor shortcut is NOT taken and the
                # runner-local docker path is exercised.
                "FALLBACK_CHAIN": "anthropic,openai",
                "FALLBACK_ANTHROPIC_KEY": "placeholder-anthropic",
                "FALLBACK_OPENAI_KEY": "placeholder-openai",
                "FALLBACK_GEMINI_KEY": "",
                "FALLBACK_ANTHROPIC_MODEL": "a", "FALLBACK_OPENAI_MODEL": "b",
                "FALLBACK_GEMINI_MODEL": "c",
                "LOCAL_LITELLM_IMAGE": "stub-image", "LOCAL_LITELLM_PORT": "4000",
                "LOCAL_LITELLM_STARTUP_TIMEOUT": "2",
                "LOCAL_LITELLM_DOCKER_RUN_TIMEOUT": "2",
            })
            start = time.monotonic()
            # bash -e: the runner invokes `shell: bash` steps with errexit on.
            # Own process group, so a hung stub is reaped with the whole tree
            # instead of being orphaned when the outer deadline fires.
            proc = subprocess.Popen(
                ["bash", "-e", script], env=env, stdout=subprocess.PIPE,
                stderr=subprocess.PIPE, text=True, start_new_session=True,
            )
            try:
                stdout, stderr = proc.communicate(timeout=30)
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid, signal.SIGKILL)
                proc.communicate()
                self.fail("resolve step was still running after 30s with a hung "
                          "`docker run` -- the docker CLI call is not wall-clock bounded")
            elapsed = time.monotonic() - start
            self.assertLess(elapsed, 25, "resolve step took %.1fs" % elapsed)
            self.assertEqual(proc.returncode, 0, stdout + stderr)
            with open(out) as fh:
                outputs = fh.read()
            self.assertIn("mode=fallback-anthropic", outputs)
            self.assertIn("rc=124", stdout)
            with open(os.path.join(d, "docker.calls")) as fh:
                calls = fh.read()
            self.assertIn("docker run", calls)
            self.assertIn("docker rm -f fuze-llm-fallback", calls,
                          "a timed-out run must be cleaned up so a late container "
                          "cannot hold the port")


if __name__ == "__main__":
    unittest.main()
