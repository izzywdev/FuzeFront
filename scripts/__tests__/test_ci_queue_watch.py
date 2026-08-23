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
import json
import os
import subprocess
import sys
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
