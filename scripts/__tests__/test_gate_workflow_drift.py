"""
Unit tests for scripts/gate_workflow_drift.py — the REQUIRED-check ratchet that converts
governance-sync.yml's advisory workflow-drift `::warning::` into a hard failure once a
`fuze:managed` file's drift has survived enough baseline-version releases
(governance/workflow-drift-policy.json's `max_versions_behind`).

Builds a real, SYNTHETIC canonical git repo per test (a handful of commits touching one
template plus `governance/baseline-version.txt`) rather than mocking `git` — the logic
under test IS git plumbing (`git log`, `git show`, `git rev-list --count`), so a mock
would only assert that the code calls what it calls, not that the calls answer correctly.
Fully offline: no network, no dependency on the real FuzeSDLC history.

Run: python -m unittest discover -s scripts/__tests__ -p 'test_*.py'
"""
import hashlib
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(HERE))
SCRIPTS = os.path.join(REPO_ROOT, "scripts")

sys.path.insert(0, SCRIPTS)
import gate_workflow_drift as G  # noqa: E402

sys.path.insert(0, os.path.join(SCRIPTS, "bootstrap"))
from lib import render as R  # noqa: E402

TEMPLATE_NAME = "sample.yml"
TEMPLATE_REL = os.path.join("workflow-templates", TEMPLATE_NAME)
BASELINE_REL = os.path.join("governance", "baseline-version.txt")


def _run(args, cwd):
    proc = subprocess.run(["git"] + args, cwd=cwd, capture_output=True, text=True)
    assert proc.returncode == 0, f"git {args} failed: {proc.stderr}"
    return proc.stdout


def _write(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(content)


def _commit(cwd, msg):
    _run(["add", "-A"], cwd)
    _run(["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-m", msg], cwd)
    return _run(["rev-parse", "HEAD"], cwd).strip()


def _digest_of(cwd, rel):
    with open(os.path.join(cwd, rel), "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def make_canonical(tmp):
    """A synthetic FuzeSDLC-shaped canonical repo with a history of N releases against ONE
    template. Returns (canonical_dir, {label: commit_sha}, {label: digest}).
    """
    canonical = os.path.join(tmp, "canonical")
    os.makedirs(canonical)
    _run(["init", "-q", "-b", "main"], canonical)

    _write(os.path.join(canonical, TEMPLATE_REL), "name: Sample v1\non:\n  pull_request:\n")
    _write(os.path.join(canonical, BASELINE_REL), "1.0.0\n")
    c_v1 = _commit(canonical, "release 1.0.0")
    d_v1 = _digest_of(canonical, TEMPLATE_REL)

    # A non-release commit touching the template WITHOUT bumping baseline-version — must
    # NOT count as a "release" in versions_behind's count. Its content is deliberately
    # distinct from every release's own content so it can never be mistaken for one of
    # the labelled digests below.
    _write(os.path.join(canonical, TEMPLATE_REL), "name: Sample WIP\non:\n  pull_request:\n")
    c_prerelease = _commit(canonical, "wip tweak, not yet released")

    _write(os.path.join(canonical, TEMPLATE_REL), "name: Sample v1.1\non:\n  pull_request:\n")
    _write(os.path.join(canonical, BASELINE_REL), "1.1.0\n")
    c_v1_1 = _commit(canonical, "release 1.1.0")
    d_v1_1 = _digest_of(canonical, TEMPLATE_REL)

    _write(os.path.join(canonical, TEMPLATE_REL), "name: Sample v1.2\non:\n  pull_request:\n")
    _write(os.path.join(canonical, BASELINE_REL), "1.2.0\n")
    c_v1_2 = _commit(canonical, "release 1.2.0")
    d_v1_2 = _digest_of(canonical, TEMPLATE_REL)

    _write(os.path.join(canonical, TEMPLATE_REL), "name: Sample v1.3\non:\n  pull_request:\n")
    _write(os.path.join(canonical, BASELINE_REL), "1.3.0\n")
    c_v1_3 = _commit(canonical, "release 1.3.0")
    d_v1_3 = _digest_of(canonical, TEMPLATE_REL)

    commits = {"v1": c_v1, "prerelease": c_prerelease, "v1.1": c_v1_1,
               "v1.2": c_v1_2, "v1.3": c_v1_3}
    digests = {"v1": d_v1, "v1.1": d_v1_1, "v1.2": d_v1_2, "v1.3": d_v1_3}
    return canonical, commits, digests


def make_repo_with_marker(tmp, baseline_ref, digest):
    """A minimal onboarded consumer repo carrying one marked workflow file."""
    repo = os.path.join(tmp, "repo")
    os.makedirs(os.path.join(repo, ".fuze"))
    os.makedirs(os.path.join(repo, ".github", "workflows"))
    _write(os.path.join(repo, ".fuze", "manifest.json"),
           '{"repo": "izzywdev/sample", "baselineRef": "%s"}\n' % baseline_ref)
    marker = R.build_marker_line(TEMPLATE_NAME, baseline_ref, b"raw-bytes-irrelevant-here")
    # The marker's own digest field is what this gate reads — rebuild the line with the
    # EXACT digest we want stamped, rather than relying on build_marker_line's own hashing
    # of arbitrary bytes (we want to control the digest directly per test case).
    marker = f"# fuze:managed template={TEMPLATE_NAME} baseline={baseline_ref} digest=sha256:{digest}"
    _write(os.path.join(repo, ".github", "workflows", TEMPLATE_NAME),
           marker + "\nname: Sample\non:\n  pull_request:\n")
    return repo


class TestFindStampedCommit(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.canonical, self.commits, self.digests = make_canonical(self.tmp)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_finds_the_commit_matching_an_old_digest(self):
        found = G.find_stamped_commit(self.canonical, TEMPLATE_REL.replace(os.sep, "/"),
                                       self.digests["v1.1"])
        self.assertEqual(found, self.commits["v1.1"])

    def test_finds_the_current_head_digest_too(self):
        found = G.find_stamped_commit(self.canonical, TEMPLATE_REL.replace(os.sep, "/"),
                                       self.digests["v1.3"])
        self.assertEqual(found, self.commits["v1.3"])

    def test_unknown_digest_returns_none(self):
        found = G.find_stamped_commit(self.canonical, TEMPLATE_REL.replace(os.sep, "/"),
                                       "0" * 64)
        self.assertIsNone(found)


class TestVersionsBehind(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.canonical, self.commits, self.digests = make_canonical(self.tmp)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_zero_when_stamped_at_head(self):
        n = G.versions_behind(self.canonical, self.commits["v1.3"])
        self.assertEqual(n, 0)

    def test_counts_releases_not_raw_commits(self):
        # Between v1.1 and HEAD (v1.3) there are two releases (1.2.0, 1.3.0) — the
        # intervening non-release "wip tweak" commit for v1 must not be double-counted,
        # and is anyway before v1.1 in this fixture.
        n = G.versions_behind(self.canonical, self.commits["v1.1"])
        self.assertEqual(n, 2)

    def test_prerelease_commit_between_releases_does_not_inflate_the_count(self):
        # v1 -> HEAD spans the prerelease commit AND three releases (1.0.0's own bump is
        # the ancestor boundary and excluded; 1.1.0, 1.2.0, 1.3.0 are counted).
        n = G.versions_behind(self.canonical, self.commits["v1"])
        self.assertEqual(n, 3)

    def test_unrelated_commit_returns_none(self):
        n = G.versions_behind(self.canonical, "0" * 40)
        self.assertIsNone(n)


class TestClassifyFile(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.canonical, self.commits, self.digests = make_canonical(self.tmp)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _marker(self, digest, baseline="v1"):
        return {"template": TEMPLATE_NAME, "baseline": baseline, "digest": digest}

    def test_matching_digest_is_ok(self):
        result = G.classify_file(self.canonical, self._marker(self.digests["v1.3"]), 3)
        self.assertEqual(result["status"], "ok")

    def test_one_release_behind_is_warn_under_threshold_three(self):
        result = G.classify_file(self.canonical, self._marker(self.digests["v1.2"]), 3)
        self.assertEqual(result["status"], "warn")
        self.assertEqual(result["versions_behind"], 1)

    def test_at_threshold_is_fail(self):
        # v1 -> HEAD is 3 releases behind; threshold 3 means >= 3 fails.
        result = G.classify_file(self.canonical, self._marker(self.digests["v1"]), 3)
        self.assertEqual(result["status"], "fail")
        self.assertEqual(result["versions_behind"], 3)

    def test_just_under_threshold_is_warn_not_fail(self):
        result = G.classify_file(self.canonical, self._marker(self.digests["v1.1"]), 3)
        self.assertEqual(result["status"], "warn")
        self.assertEqual(result["versions_behind"], 2)

    def test_lower_threshold_promotes_warn_to_fail(self):
        result = G.classify_file(self.canonical, self._marker(self.digests["v1.2"]), 1)
        self.assertEqual(result["status"], "fail")

    def test_unmatchable_digest_is_unknown_never_fail(self):
        result = G.classify_file(self.canonical, self._marker("f" * 64), 1)
        self.assertEqual(result["status"], "unknown")

    def test_orphaned_template_is_reported_never_fail(self):
        marker = {"template": "does-not-exist.yml", "baseline": "v1", "digest": "a" * 64}
        result = G.classify_file(self.canonical, marker, 1)
        self.assertEqual(result["status"], "orphaned")


class TestEvaluateDegradesCleanly(unittest.TestCase):
    """The requirement that made this gate safe to land at all: it must not go red on a
    repo the re-stamp fan-out has not reached yet."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.canonical, self.commits, self.digests = make_canonical(self.tmp)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_no_manifest_skips(self):
        repo = os.path.join(self.tmp, "bare-repo")
        os.makedirs(repo)
        report = G.evaluate(self.canonical, repo, 3)
        self.assertTrue(report["ok"])
        self.assertIn("not onboarded", report["skipped"])

    def test_no_workflows_dir_skips(self):
        repo = os.path.join(self.tmp, "onboarded-no-wf")
        os.makedirs(os.path.join(repo, ".fuze"))
        _write(os.path.join(repo, ".fuze", "manifest.json"), '{"baselineRef": "v1"}\n')
        report = G.evaluate(self.canonical, repo, 3)
        self.assertTrue(report["ok"])
        self.assertIn(".github/workflows", report["skipped"])

    def test_unmarked_workflow_is_never_examined(self):
        repo = os.path.join(self.tmp, "unmarked-repo")
        os.makedirs(os.path.join(repo, ".fuze"))
        os.makedirs(os.path.join(repo, ".github", "workflows"))
        _write(os.path.join(repo, ".fuze", "manifest.json"), '{"baselineRef": "v1"}\n')
        # A repo-authored workflow sharing the canonical template's name, with NO marker.
        _write(os.path.join(repo, ".github", "workflows", TEMPLATE_NAME),
               "name: My own thing\non:\n  push:\n")
        report = G.evaluate(self.canonical, repo, 3)
        self.assertTrue(report["ok"])
        self.assertEqual(report["results"], [])
        self.assertIn("nothing to check", report["skipped"])

    def test_detached_marker_removed_is_never_examined(self):
        # Same file that WOULD be badly drifted, but with the marker stripped — the
        # supported, deliberate fork. Must be indistinguishable from "no marker at all".
        repo = make_repo_with_marker(self.tmp, "v1", self.digests["v1"])
        wf = os.path.join(repo, ".github", "workflows", TEMPLATE_NAME)
        with open(wf, encoding="utf-8") as f:
            body = f.read().splitlines(keepends=True)[1:]  # drop the marker line
        with open(wf, "w", encoding="utf-8") as f:
            f.writelines(body)
        report = G.evaluate(self.canonical, repo, 1)
        self.assertTrue(report["ok"])
        self.assertEqual(report["results"], [])

    def test_badly_drifted_marked_file_fails(self):
        repo = make_repo_with_marker(self.tmp, "v1", self.digests["v1"])
        report = G.evaluate(self.canonical, repo, 3)
        self.assertFalse(report["ok"])
        self.assertEqual(report["results"][0]["status"], "fail")

    def test_mildly_drifted_marked_file_warns_but_does_not_fail(self):
        repo = make_repo_with_marker(self.tmp, "v1", self.digests["v1.2"])
        report = G.evaluate(self.canonical, repo, 3)
        self.assertTrue(report["ok"])
        self.assertEqual(report["results"][0]["status"], "warn")

    def test_in_sync_file_is_clean(self):
        repo = make_repo_with_marker(self.tmp, "v1", self.digests["v1.3"])
        report = G.evaluate(self.canonical, repo, 3)
        self.assertTrue(report["ok"])
        self.assertEqual(report["results"][0]["status"], "ok")


class TestLoadPolicy(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_missing_file_uses_default(self):
        policy = G.load_policy(os.path.join(self.tmp, "nope.json"))
        self.assertEqual(policy["max_versions_behind"], G.DEFAULT_MAX_VERSIONS_BEHIND)

    def test_valid_file_overrides_default(self):
        p = os.path.join(self.tmp, "policy.json")
        _write(p, '{"max_versions_behind": 5}')
        policy = G.load_policy(p)
        self.assertEqual(policy["max_versions_behind"], 5)

    def test_malformed_file_falls_back_to_default(self):
        p = os.path.join(self.tmp, "bad.json")
        _write(p, "{not json")
        policy = G.load_policy(p)
        self.assertEqual(policy["max_versions_behind"], G.DEFAULT_MAX_VERSIONS_BEHIND)

    def test_non_positive_threshold_is_rejected(self):
        p = os.path.join(self.tmp, "zero.json")
        _write(p, '{"max_versions_behind": 0}')
        policy = G.load_policy(p)
        self.assertEqual(policy["max_versions_behind"], G.DEFAULT_MAX_VERSIONS_BEHIND)


class TestRealPolicyFileIsValid(unittest.TestCase):
    """The actual shipped policy file must parse and produce a sane threshold — a broken
    JSON file here would silently fall back to the hardcoded default everywhere."""

    def test_shipped_policy_parses_and_has_positive_threshold(self):
        path = os.path.join(REPO_ROOT, "governance", "workflow-drift-policy.json")
        self.assertTrue(os.path.isfile(path), path)
        policy = G.load_policy(path)
        self.assertGreater(policy["max_versions_behind"], 0)


if __name__ == "__main__":
    unittest.main()
