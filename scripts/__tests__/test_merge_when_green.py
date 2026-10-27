"""Tests for the merge-when-green watchdog.

The load-bearing test is `test_unreachable_api_refuses`: a watchdog that cannot
reach GitHub must EXIT NON-ZERO, not shrug and report "nothing to merge". A sweep
that silently sees no candidate PRs because its token is wrong, or the API is
down, looks identical to a healthy sweep with an empty queue — the same
vacuous-green shape as the gitleaks config with no rules. The decision-table
tests then pin the safety gates: it merges ONLY a PR that is armed, conflict-free,
up to date, and all-required-checks-green, and it merges NOTHING when any one of
those is false or when the ruleset names no required checks.
"""
import json
import os
import subprocess
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SCRIPT = os.path.join(REPO_ROOT, "scripts", "merge_when_green.py")
sys.path.insert(0, os.path.join(REPO_ROOT, "scripts"))

import merge_when_green as mwg

REPO = "izzywdev/FuzeFront"

# All 11 contexts the real master ruleset requires, trimmed to a representative
# few for the fixtures — the logic is identical for 3 or 300.
RULESET_OK = [
    {
        "type": "required_status_checks",
        "parameters": {
            "required_status_checks": [
                {"context": "gate-build"},
                {"context": "gate-test"},
                {"context": "gate-lint"},
            ]
        },
    }
]
RULESET_EMPTY = [{"type": "pull_request", "parameters": {}}]


def _armed_pr(number, sha, mergeable=True, auto_merge=True, draft=False,
              labels=("auto-merge",), state="open", base="master"):
    return {
        "number": number,
        "state": state,
        "draft": draft,
        "mergeable": mergeable,
        "auto_merge": {"merge_method": "squash"} if auto_merge else None,
        "labels": [{"name": l} for l in labels],
        "head": {"sha": sha},
        "base": {"ref": base},
    }


def _green_checks(contexts):
    return {"check_runs": [{"name": c, "conclusion": "success"} for c in contexts]}


class Fixture:
    """Routing table the stub server answers from, set per test."""
    def __init__(self):
        self.rules = RULESET_OK
        self.pulls_list = []       # list endpoint rows
        self.pulls = {}            # number -> PR object
        self.checks = {}           # sha -> {"check_runs":[...]}
        self.compare = {}          # sha -> behind_by
        self.merged = []           # recorded successful merges (number, method, sha)
        self.merge_head = None     # if set, server 409s a merge whose sha != this


class _Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):  # keep test output clean
        pass

    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        f = self.server.fixture
        path = self.path.split("?")[0]
        if path.endswith("/rules/branches/master"):
            return self._send(200, f.rules)
        if path == f"/repos/{REPO}/pulls":
            return self._send(200, f.pulls_list)
        if path.startswith(f"/repos/{REPO}/pulls/"):
            num = int(path.rsplit("/", 1)[1])
            return self._send(200, f.pulls.get(num, {}))
        if "/commits/" in path and path.endswith("/check-runs"):
            sha = path.split("/commits/")[1].split("/")[0]
            return self._send(200, f.checks.get(sha, {"check_runs": []}))
        if "/compare/" in path:
            spec = path.split("/compare/")[1]
            sha = spec.split("...")[1]
            return self._send(200, {"behind_by": f.compare.get(sha, 0)})
        return self._send(404, {"message": "no route"})

    def do_PUT(self):
        f = self.server.fixture
        path = self.path.split("?")[0]
        if path.startswith(f"/repos/{REPO}/pulls/") and path.endswith("/merge"):
            num = int(path.split("/pulls/")[1].split("/")[0])
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length) or "{}")
            # Enforce the GitHub `sha` contract: if the caller pinned a head that
            # no longer matches the server's current head, reject with 409.
            server_head = getattr(f, "merge_head", None)
            if server_head is not None and body.get("sha") != server_head:
                return self._send(409, {"message": "Head branch was modified. Review and try the merge again."})
            f.merged.append((num, body.get("merge_method"), body.get("sha")))
            return self._send(200, {"merged": True, "sha": f"merged-{num}"})
        return self._send(404, {"message": "no route"})


class StubServerCase(unittest.TestCase):
    def setUp(self):
        self.fx = Fixture()
        self.fx.merged = []
        self.srv = HTTPServer(("127.0.0.1", 0), _Handler)
        self.srv.fixture = self.fx
        self.t = threading.Thread(target=self.srv.serve_forever, daemon=True)
        self.t.start()
        self._old_api = mwg.API
        mwg.API = f"http://127.0.0.1:{self.srv.server_address[1]}"

    def tearDown(self):
        mwg.API = self._old_api
        self.srv.shutdown()
        self.srv.server_close()

    def _run(self, dry_run=False):
        return mwg.run(REPO, "master", "tok", dry_run=dry_run, fail_on_error=True)


class ReadyPrMerges(StubServerCase):
    def test_fully_green_armed_pr_is_merged(self):
        self.fx.pulls_list = [{"number": 1, "draft": False, "labels": [{"name": "auto-merge"}]}]
        self.fx.pulls = {1: _armed_pr(1, "sha1")}
        self.fx.checks = {"sha1": _green_checks(["gate-build", "gate-test", "gate-lint"])}
        rc = self._run()
        self.assertEqual(rc, 0)
        # merged with the armed method AND pinned to the evaluated head sha.
        self.assertEqual(self.fx.merged, [(1, "squash", "sha1")])

    def test_dry_run_never_merges(self):
        self.fx.pulls_list = [{"number": 1, "draft": False, "labels": [{"name": "auto-merge"}]}]
        self.fx.pulls = {1: _armed_pr(1, "sha1")}
        self.fx.checks = {"sha1": _green_checks(["gate-build", "gate-test", "gate-lint"])}
        rc = self._run(dry_run=True)
        self.assertEqual(rc, 0)
        self.assertEqual(self.fx.merged, [])


class SafetyGatesBlockMerge(StubServerCase):
    def _one_pr(self, pr, checks=None):
        self.fx.pulls_list = [{"number": pr["number"], "draft": pr["draft"],
                               "labels": pr["labels"]}]
        self.fx.pulls = {pr["number"]: pr}
        if checks is not None:
            self.fx.checks = {pr["head"]["sha"]: checks}

    def test_not_armed_is_skipped(self):
        self._one_pr(_armed_pr(2, "s2", auto_merge=False),
                     _green_checks(["gate-build", "gate-test", "gate-lint"]))
        self.assertEqual(self._run(), 0)
        self.assertEqual(self.fx.merged, [])

    def test_merge_conflict_is_skipped(self):
        self._one_pr(_armed_pr(3, "s3", mergeable=False),
                     _green_checks(["gate-build", "gate-test", "gate-lint"]))
        self.assertEqual(self._run(), 0)
        self.assertEqual(self.fx.merged, [])

    def test_mergeable_unknown_is_skipped(self):
        self._one_pr(_armed_pr(4, "s4", mergeable=None),
                     _green_checks(["gate-build", "gate-test", "gate-lint"]))
        self.assertEqual(self._run(), 0)
        self.assertEqual(self.fx.merged, [])

    def test_red_required_check_blocks(self):
        self._one_pr(_armed_pr(5, "s5"))
        self.fx.checks = {"s5": {"check_runs": [
            {"name": "gate-build", "conclusion": "success"},
            {"name": "gate-test", "conclusion": "failure"},
            {"name": "gate-lint", "conclusion": "success"},
        ]}}
        self.assertEqual(self._run(), 0)
        self.assertEqual(self.fx.merged, [])

    def test_missing_required_check_blocks(self):
        # gate-lint never reported on the head → not ready.
        self._one_pr(_armed_pr(6, "s6"),
                     _green_checks(["gate-build", "gate-test"]))
        self.assertEqual(self._run(), 0)
        self.assertEqual(self.fx.merged, [])

    def test_pending_required_check_blocks(self):
        self._one_pr(_armed_pr(7, "s7"))
        self.fx.checks = {"s7": {"check_runs": [
            {"name": "gate-build", "conclusion": "success"},
            {"name": "gate-test", "conclusion": None},   # still running
            {"name": "gate-lint", "conclusion": "success"},
        ]}}
        self.assertEqual(self._run(), 0)
        self.assertEqual(self.fx.merged, [])

    def test_behind_base_is_skipped(self):
        self._one_pr(_armed_pr(8, "s8"),
                     _green_checks(["gate-build", "gate-test", "gate-lint"]))
        self.fx.compare = {"s8": 3}  # 3 commits behind master
        self.assertEqual(self._run(), 0)
        self.assertEqual(self.fx.merged, [])

    def test_hold_label_excludes_candidate(self):
        # labelled auto-merge AND blocked → never a candidate
        self.fx.pulls_list = [{"number": 9, "draft": False,
                               "labels": [{"name": "auto-merge"}, {"name": "blocked"}]}]
        self.fx.pulls = {9: _armed_pr(9, "s9", labels=("auto-merge", "blocked"))}
        self.fx.checks = {"s9": _green_checks(["gate-build", "gate-test", "gate-lint"])}
        self.assertEqual(self._run(), 0)
        self.assertEqual(self.fx.merged, [])

    def test_no_optin_label_excludes_candidate(self):
        self.fx.pulls_list = [{"number": 10, "draft": False, "labels": []}]
        self.fx.pulls = {10: _armed_pr(10, "s10", labels=())}
        self.fx.checks = {"s10": _green_checks(["gate-build", "gate-test", "gate-lint"])}
        self.assertEqual(self._run(), 0)
        self.assertEqual(self.fx.merged, [])

    def test_hold_label_added_between_listing_and_fetch_blocks(self):
        """TOCTOU: the list says eligible (auto-merge, no hold), but by the time
        the per-PR fetch runs a `blocked` label has been added. Labels are the
        only enforcement of operator opt-out (the ruleset does not gate on them),
        so evaluate() must re-check the FRESH labels, not trust the stale list."""
        self.fx.pulls_list = [{"number": 11, "draft": False,
                               "labels": [{"name": "auto-merge"}]}]  # eligible at list time
        self.fx.pulls = {11: _armed_pr(11, "s11", labels=("auto-merge", "blocked"))}  # changed since
        self.fx.checks = {"s11": _green_checks(["gate-build", "gate-test", "gate-lint"])}
        self.assertEqual(self._run(), 0)
        self.assertEqual(self.fx.merged, [])

    def test_optin_removed_between_listing_and_fetch_blocks(self):
        """Mirror of the above: `auto-merge` removed after listing → not merged."""
        self.fx.pulls_list = [{"number": 12, "draft": False,
                               "labels": [{"name": "auto-merge"}]}]
        self.fx.pulls = {12: _armed_pr(12, "s12", labels=())}  # opt-in gone since
        self.fx.checks = {"s12": _green_checks(["gate-build", "gate-test", "gate-lint"])}
        self.assertEqual(self._run(), 0)
        self.assertEqual(self.fx.merged, [])

    def test_pr_targeting_other_base_is_skipped(self):
        """The required set is loaded for master, so a PR targeting a different
        base (e.g. a release branch) must not be judged by master's gates —
        evaluate() rejects on the base mismatch rather than merge it."""
        self.fx.pulls_list = [{"number": 20, "draft": False,
                               "labels": [{"name": "auto-merge"}]}]
        self.fx.pulls = {20: _armed_pr(20, "s20", base="release/1.2")}
        self.fx.checks = {"s20": _green_checks(["gate-build", "gate-test", "gate-lint"])}
        self.assertEqual(self._run(), 0)
        self.assertEqual(self.fx.merged, [])

    def test_head_moved_between_evaluate_and_merge_is_declined(self):
        """evaluate() checks head s13 and finds it green/ready, but the head has
        since moved to s13-new. The merge is pinned to s13 via `sha`, so the
        server returns 409 and nothing is merged — the watchdog never merges an
        unverified head."""
        self.fx.pulls_list = [{"number": 13, "draft": False,
                               "labels": [{"name": "auto-merge"}]}]
        self.fx.pulls = {13: _armed_pr(13, "s13")}
        self.fx.checks = {"s13": _green_checks(["gate-build", "gate-test", "gate-lint"])}
        self.fx.merge_head = "s13-new"   # server's head moved since evaluate()
        self.assertEqual(self._run(), 0)
        self.assertEqual(self.fx.merged, [])


class EmptyRulesetRefuses(StubServerCase):
    def test_no_required_checks_is_blind_refusal(self):
        """A ruleset with no required checks must REFUSE, not merge everything."""
        self.fx.rules = RULESET_EMPTY
        self.fx.pulls_list = [{"number": 1, "draft": False, "labels": [{"name": "auto-merge"}]}]
        self.fx.pulls = {1: _armed_pr(1, "sha1")}
        with self.assertRaises(mwg.Blind):
            self._run()
        self.assertEqual(self.fx.merged, [])


class BlindWatchdogRefuses(unittest.TestCase):
    """The regression this file exists for — run end-to-end via subprocess."""

    def _run(self, args, token="pretend-token"):
        env = dict(os.environ)
        env.pop("GITHUB_TOKEN", None)
        env.pop("GH_TOKEN", None)
        if token:
            env["GH_TOKEN"] = token
        env["MERGE_WHEN_GREEN_API"] = "http://127.0.0.1:9"  # nothing answers
        return subprocess.run([sys.executable, SCRIPT] + args, capture_output=True,
                              text=True, env=env, timeout=60, check=False)

    def test_unreachable_api_refuses(self):
        r = self._run(["--repo", REPO])
        self.assertEqual(r.returncode, 2, r.stdout + r.stderr)
        self.assertIn("REFUSING", r.stdout + r.stderr)

    def test_malformed_repo_refuses(self):
        r = self._run(["--repo", "not-a-repo"])
        self.assertEqual(r.returncode, 2, r.stdout + r.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)
