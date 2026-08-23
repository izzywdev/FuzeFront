"""Tests for the fleet CI queue watchdog.

These exist because of one property that is invisible on inspection: a
watchdog that cannot see the fleet stays GREEN. It reports no stalls, because
it observed no pools, and green reads as "the fleet is fine". That is the same
shape as the gitleaks config with no rules and the Semgrep gate ending in
`|| true` — a check satisfied by not doing its job.

So the load-bearing test is `test_token_present_but_no_fleet_is_a_hard_failure`,
which asserts the script REFUSES rather than shrugs. A test that only confirmed
it reports correctly on a healthy fleet would pass just as happily against a
watchdog wired to nothing.
"""
import datetime
import http.server
import json
import os
import subprocess
import sys
import threading
import unittest

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SCRIPT = os.path.join(REPO, "scripts", "ci_queue_watch.py")
sys.path.insert(0, os.path.join(REPO, "scripts"))


def run(args, token=None):
    env = dict(os.environ)
    env.pop("GITHUB_TOKEN", None)
    env.pop("GH_TOKEN", None)
    if token:
        env["GITHUB_TOKEN"] = token
    # Point discovery at a host that cannot answer, so no test touches the
    # network or depends on the real fleet's current state.
    env["CI_QUEUE_WATCH_API"] = "http://127.0.0.1:9"
    return subprocess.run([sys.executable, SCRIPT] + args,
                          capture_output=True, text=True, env=env, timeout=120)


class BlindWatchdogMustNotLookHealthy(unittest.TestCase):
    """The regression this file exists for."""

    def test_token_present_but_no_fleet_is_a_hard_failure(self):
        """THE test. A token is set, so the account IS reachable in principle;
        discovering nothing therefore means the token's scope is wrong, not that
        the fleet is empty. Exiting 0 here would paint a blind watchdog green."""
        r = run([], token="pretend-token")
        self.assertEqual(r.returncode, 2, r.stderr)
        self.assertIn("::error::", r.stderr)
        self.assertIn("scope problem", r.stderr)

    def test_no_token_skips_cleanly(self):
        """The mirror image, and equally deliberate: with no credential there is
        nothing to misconfigure. An environmental gap must never render as an
        outage — that inversion is what made a2a-maintain's red meaningless."""
        r = run([])
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("::warning::", r.stderr)
        self.assertNotIn("::error::", r.stderr)

    def test_explicit_repo_list_bypasses_the_floor(self):
        """--repos is an operator saying exactly what to watch, so the
        fleet-size floor does not apply; otherwise debugging a single repo
        would be impossible."""
        r = run(["--repos", "izzywdev/FuzeFront", "--min-repos", "99"],
                token="pretend-token")
        self.assertNotEqual(r.returncode, 2, r.stderr)


class VerdictLogic(unittest.TestCase):
    """Pure decision table — the part that must not regress to wait-time."""

    def setUp(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location("ciqw", SCRIPT)
        self.m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.m)

    def v(self, queued, running, oldest, last, stall=30):
        return self.m.verdict({"queued": queued, "running": running,
                               "oldest_wait": oldest, "last_start": last}, stall)

    def test_deep_queue_that_is_moving_is_not_an_incident(self):
        """The whole point. 500 jobs queued behind 4 runners is capacity, and
        paging on it is how the real alert gets muted."""
        v, stall = self.v(queued=500, running=4, oldest=900, last=2)
        self.assertFalse(stall)
        self.assertEqual(v, "SATURATED")

    def test_long_wait_alone_never_stalls(self):
        """A four-day wait on a pool that started a job a minute ago is healthy.
        This is the exact case a wait-time threshold gets wrong, and it was
        observed live: ubuntu-latest, 5698m oldest wait, serving normally."""
        v, stall = self.v(queued=6, running=1, oldest=5698, last=1)
        self.assertFalse(stall)

    def test_queued_with_no_recent_start_is_stalled(self):
        v, stall = self.v(queued=121, running=0, oldest=1180, last=2120)
        self.assertTrue(stall)
        self.assertIn("STALLED", v)

    def test_no_history_and_a_short_wait_does_not_page(self):
        """A pool's first-ever job must not alert the moment it is queued."""
        v, stall = self.v(queued=1, running=0, oldest=5, last=None)
        self.assertFalse(stall)
        self.assertIn("PENDING", v)

    def test_no_history_and_a_long_wait_does_stall(self):
        """A `runs-on` naming a scale set that never existed has no history and
        never will. That must page — it is the original bug."""
        v, stall = self.v(queued=1, running=0, oldest=600, last=None)
        self.assertTrue(stall)

    def test_empty_queue_with_running_jobs_is_healthy_not_idle(self):
        self.assertEqual(self.v(queued=0, running=4, oldest=0, last=1)[0], "HEALTHY")
        self.assertEqual(self.v(queued=0, running=0, oldest=0, last=1)[0], "IDLE")

    def test_idle_pool_never_pages(self):
        """No queue means no complaint, however long since the last job."""
        for last in (None, 1, 10_000):
            self.assertFalse(self.v(queued=0, running=0, oldest=0, last=last)[1])


class RequestSurface(unittest.TestCase):
    """urllib speaks more than HTTP, and repo names reach request paths.

    Neither is a live vulnerability here -- the base URL comes from env and the
    names come from the API -- but "it came from an API" is precisely the
    assumption that produces traversal bugs, so both are enforced rather than
    reasoned about.
    """

    def setUp(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location("ciqw", SCRIPT)
        self.m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.m)

    def test_non_http_scheme_is_refused(self):
        r = run(["--repos", "izzywdev/FuzeFront"], token="pretend-token")
        # the harness points the API at http://127.0.0.1:9, so this asserts the
        # allowed scheme still gets through to a (failed) connection
        self.assertNotIn("refusing non-HTTP scheme", r.stdout + r.stderr)

    def test_file_scheme_never_reaches_urlopen(self):
        env = dict(os.environ, CI_QUEUE_WATCH_API="file:///etc", GITHUB_TOKEN="x")
        r = subprocess.run([sys.executable, SCRIPT, "--repos", "izzywdev/FuzeFront"],
                           capture_output=True, text=True, env=env, timeout=120)
        self.assertIn("refusing non-HTTP scheme", r.stderr + r.stdout)

    def test_repo_name_shape_is_enforced(self):
        self.assertTrue(self.m._valid_repo("izzywdev/FuzeFront"))
        self.assertTrue(self.m._valid_repo("izzywdev/fuze-market.v2"))
        for bad in ("../../etc/passwd", "izzywdev/Fuze Front", "no-slash",
                    "a/b/c", "izzywdev/x?y=1", ""):
            self.assertFalse(self.m._valid_repo(bad), bad)


def run_token_gate(event_name, token=None, gh_output_path=None):
    """Invoke the workflow-facing `--token-gate` mode exactly as the
    `Check for a fleet-scoped token` step does: FLEET_READ_PAT and
    GITHUB_EVENT_NAME come from the environment, nothing touches the
    network. GITHUB_OUTPUT is pointed at a temp file when the caller wants
    to assert on the `ok=` step output, mirroring what Actions sets up."""
    env = dict(os.environ)
    env.pop("FLEET_READ_PAT", None)
    env["GITHUB_EVENT_NAME"] = event_name
    if token is not None:
        env["FLEET_READ_PAT"] = token
    if gh_output_path is not None:
        env["GITHUB_OUTPUT"] = gh_output_path
    else:
        env.pop("GITHUB_OUTPUT", None)
    env["CI_QUEUE_WATCH_API"] = "http://127.0.0.1:9"
    return subprocess.run([sys.executable, SCRIPT, "--token-gate"],
                          capture_output=True, text=True, env=env, timeout=30)


class ScheduledRunWithNoTokenMustFail(unittest.TestCase):
    """THE regression under test: the watchdog ran green, twice, 15 minutes
    apart, while the fleet it watches was 40 hours into a total ARC outage --
    because FLEET_READ_PAT was unset and the old "no token -> warn, exit 0"
    rule applied unconditionally, including on `schedule`, where there is no
    legitimate transient reason for the token to be missing. A scheduled run
    with no token must FAIL loudly; every other trigger keeps warning and
    exiting 0, because there an absent secret is a real environmental gap
    (a fork PR, a contributor with no repo secrets) and must not look like an
    outage -- the same inversion that made the a2a-maintain actor gate
    meaningless in the opposite direction."""

    def test_scheduled_run_with_no_token_is_a_hard_failure(self):
        r = run_token_gate("schedule")
        self.assertEqual(r.returncode, 1, r.stderr)
        self.assertIn("::error::", r.stderr)
        self.assertIn("FLEET_READ_PAT", r.stderr)
        self.assertIn("SCHEDULED", r.stderr)

    def test_pull_request_run_with_no_token_still_skips_cleanly(self):
        r = run_token_gate("pull_request")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("::warning::", r.stderr)
        self.assertNotIn("::error::", r.stderr)

    def test_workflow_dispatch_with_no_token_still_skips_cleanly(self):
        r = run_token_gate("workflow_dispatch")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("::warning::", r.stderr)
        self.assertNotIn("::error::", r.stderr)

    def test_scheduled_run_with_a_token_proceeds(self):
        r = run_token_gate("schedule", token="pretend-token")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertNotIn("::error::", r.stderr)

    def test_ok_output_reflects_token_presence_not_trigger(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            out = os.path.join(d, "gh_output")
            open(out, "w").close()
            r = run_token_gate("schedule", token="pretend-token", gh_output_path=out)
            self.assertEqual(r.returncode, 0, r.stderr)
            with open(out) as fh:
                self.assertIn("ok=true", fh.read())

        with tempfile.TemporaryDirectory() as d:
            out = os.path.join(d, "gh_output")
            open(out, "w").close()
            r = run_token_gate("pull_request", gh_output_path=out)
            self.assertEqual(r.returncode, 0, r.stderr)
            with open(out) as fh:
                self.assertIn("ok=false", fh.read())


class _FakeFleetHandler(http.server.BaseHTTPRequestHandler):
    """A minimal stand-in for the GitHub API, just enough of it to make one
    pool STALLED: a job queued 60 minutes ago (past the 30-minute default
    threshold), nothing in_progress, and no completed run in the lookback
    window -- so `verdict()` takes the "no start seen in the lookback
    window" branch. Used to prove end-to-end (not just verdict()'s pure
    logic) that a token-present, pool-stalled scheduled run exits non-zero,
    which is the second half of the defect this PR was asked to rule out."""

    OLD_TS = (datetime.datetime.now(datetime.timezone.utc)
              - datetime.timedelta(minutes=60)).strftime("%Y-%m-%dT%H:%M:%SZ")

    def log_message(self, *a):
        pass

    def _reply(self, body):
        data = json.dumps(body).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if "/actions/runs" in self.path and "status=queued" in self.path:
            self._reply({"workflow_runs": [{"id": 1, "created_at": self.OLD_TS}]})
        elif "/actions/runs" in self.path and "status=in_progress" in self.path:
            self._reply({"workflow_runs": []})
        elif "/actions/runs" in self.path and "status=completed" in self.path:
            self._reply({"workflow_runs": []})
        elif "/actions/runs/1/jobs" in self.path:
            self._reply({"jobs": [{"status": "queued", "labels": ["ubuntu-latest"],
                                   "created_at": self.OLD_TS, "started_at": None,
                                   "runner_id": None}]})
        else:
            self.send_response(404)
            self.end_headers()


class TokenPresentAndPoolStalledMustAlsoFail(unittest.TestCase):
    """The other half of the same question: with FLEET_READ_PAT set, does a
    genuinely stalled pool make the scheduled run exit non-zero, or does it
    just print and exit 0 (which would make the token-gate fix necessary but
    not sufficient)? This runs the real CLI end-to-end (not just verdict())
    against a fake GitHub API so the answer is verified, not assumed."""

    def test_stalled_pool_with_token_present_fails(self):
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _FakeFleetHandler)
        port = server.server_address[1]
        t = threading.Thread(target=server.serve_forever, daemon=True)
        t.start()
        try:
            env = dict(os.environ)
            env["CI_QUEUE_WATCH_API"] = f"http://127.0.0.1:{port}"
            env["GITHUB_TOKEN"] = "pretend-token"
            r = subprocess.run(
                [sys.executable, SCRIPT, "--repos", "izzywdev/fuzefake",
                 "--stall-minutes", "30", "--fail-on-stall"],
                capture_output=True, text=True, env=env, timeout=30,
            )
        finally:
            server.shutdown()
            t.join(timeout=5)
            server.server_close()
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn("STALLED", r.stdout)
        self.assertIn("::error::", r.stderr)


class StartsThatNeverHappened(unittest.TestCase):
    """runner_id 0 == the job was never picked up. Counting those as starts is
    how a dead pool reads as alive, so the filter is asserted directly."""

    def setUp(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location("ciqw", SCRIPT)
        self.m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.m)

    def test_minutes_since_handles_absent_timestamp(self):
        self.assertIsNone(self.m._minutes_since(None))

    def test_source_excludes_zero_runner_id(self):
        with open(SCRIPT) as fh:
            src = fh.read()
        self.assertIn('not job.get("runner_id")', src,
                      "the runner_id filter is load-bearing: without it a pool that "
                      "never picked anything up reports recent starts and reads healthy")


if __name__ == "__main__":
    unittest.main()
