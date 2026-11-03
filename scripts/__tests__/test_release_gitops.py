"""Exercise release publication without network, credentials or repository writes."""
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/publish-release-gitops.sh"
ALLOW = ROOT / "scripts/release-allow-bump.sh"
SOURCE = "a" * 40
FILE = "deploy/helm/fuzefront/values-prod.yaml"

# Both executable stubs record commands; only their private fixture is modified.
STUB = r'''#!/usr/bin/env python3
import json, os, pathlib, sys
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
with open(os.environ["CALL_LOG"], "a") as log:
    log.write(json.dumps([name] + args) + "\n")
scenario = os.environ.get("SCENARIO", "merged")
if name == "git":
    if args[0] == "hash-object": print("blob")
    elif args[0] == "ls-remote":
        sys.exit(128 if scenario == "transport" else 2)
    elif args[0] == "push" and scenario == "push_failed": sys.exit(1)
    elif args[0] == "fetch":
        if scenario == "fetch_failed": sys.exit(1)
        pathlib.Path(os.environ["FETCHED"]).touch()
    elif args[0] == "merge-base":
        # `git merge-base --is-ancestor <source> <master>`: 0=ancestor (accept
        # the rebase), 1=not an ancestor (divergent source -> reject), 128 =
        # "Not a valid object name" (master object not fetched yet).
        if scenario == "unresolvable_master" and not pathlib.Path(os.environ["FETCHED"]).exists(): sys.exit(128)
        sys.exit(1 if scenario == "divergent" else 0)
    sys.exit(0)
if args[:2] == ["pr", "list"]:
    if scenario in ("new", "transport", "push_failed"):
        marker = pathlib.Path(os.environ["CREATED"])
        print("17" if marker.exists() else "")
    else: print("17")
elif args[:2] == ["pr", "create"]:
    pathlib.Path(os.environ["CREATED"]).touch()
    print("https://github.com/owner/repo/pull/17")
elif args[:2] == ["pr", "view"]:
    field = args[args.index("--json") + 1]
    if field == "title":
        print("hand edited title" if scenario in ("different_blob", "human_edited") else "release: fuzefront images " + "a" * 12)
    elif field == "state":
        print("CLOSED" if scenario == "closed" else "OPEN" if scenario in ("pending", "advanced", "changed_head") else "MERGED")
    elif field == "autoMergeRequest": print("true" if scenario == "already_auto" else "false")
    elif field == "files": print("false" if scenario == "extra_files" else "true")
    elif field == "headRefOid":
        counter = pathlib.Path(os.environ["HEAD_COUNT"])
        n = int(counter.read_text()) if counter.exists() else 0
        counter.write_text(str(n + 1))
        print(("c" if scenario == "changed_head" and n else "b") * 40)
elif args[0] == "api":
    if "/contents/" in args[1]: print("changed" if scenario in ("different_blob", "human_edited", "rerun_moved") else "blob")
    elif "/commits/" in args[1]: print("human@example.com" if scenario in ("different_blob", "human_edited") else "release-bump@users.noreply.github.com")
    else:
        counter = pathlib.Path(os.environ["MASTER_COUNT"])
        n = int(counter.read_text()) if counter.exists() else 0
        counter.write_text(str(n + 1))
        print(("c" if scenario in ("advanced_before_arm", "divergent", "unresolvable_master", "fetch_failed", "rerun_moved") or (scenario == "advanced" and n) else "a") * 40)
elif args[:2] != ["pr", "merge"]:
    sys.exit("unexpected gh invocation")
'''


class ReleaseGitOpsTest(unittest.TestCase):
    def invoke(self, scenario="merged", file=FILE, tag=SOURCE[:12]):
        with tempfile.TemporaryDirectory() as directory:
            temp = Path(directory)
            for name in ("git", "gh"):
                executable = temp / name
                executable.write_text(STUB)
                executable.chmod(0o700)
            env = dict(os.environ, PATH=f"{temp}:{os.environ['PATH']}",
                       GITHUB_REPOSITORY="owner/repo", SCENARIO=scenario,
                       CALL_LOG=str(temp / "calls"), CREATED=str(temp / "created"),
                       HEAD_COUNT=str(temp / "heads"), FETCHED=str(temp / "fetched"), MASTER_COUNT=str(temp / "masters"),
                       GITOPS_MERGE_TIMEOUT_SECONDS="0", GITOPS_POLL_SECONDS="1")
            result = subprocess.run(["bash", str(SCRIPT), file, tag, SOURCE],
                                    cwd=temp, env=env, capture_output=True, text=True, timeout=10, check=False)
            calls = [json.loads(line) for line in (temp / "calls").read_text().splitlines()] if (temp / "calls").exists() else []
            return result, calls

    def test_existing_exact_pr_arms_persistent_checked_auto_merge(self):
        result, calls = self.invoke()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("queued for normal checks and independent approval", result.stdout)
        merge = next(call for call in calls if "--auto" in call)
        self.assertIn("--match-head-commit", merge)
        self.assertFalse(any(call[0] == "git" and "push" in call for call in calls))

    def test_new_pr_pushes_only_nonforced_release_branch(self):
        result, calls = self.invoke("new")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(["git", "push", "origin", "HEAD:refs/heads/release/gitops-bump-aaaaaaaaaaaa"], calls)
        self.assertTrue(any(call[:3] == ["gh", "pr", "create"] for call in calls))
        self.assertFalse(any("--force" in call or "HEAD:master" in call for call in calls))

    def test_existing_changed_file_or_extra_files_are_not_merged(self):
        for scenario in ("different_blob", "human_edited", "extra_files"):
            with self.subTest(scenario=scenario):
                result, calls = self.invoke(scenario)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(any("--auto" in call for call in calls))

    def test_pending_approval_hands_off_to_persistent_auto_merge(self):
        result, calls = self.invoke("pending")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(any("--auto" in call for call in calls))
        self.assertFalse(any("--disable-auto" in call for call in calls))

    def test_descendant_source_on_advanced_master_is_accepted(self):
        # FFRNT rebase-and-retry: master advancing past source is EXPECTED when
        # source is an ancestor of current master — the bump rebases onto current
        # master (per-service ancestry-guarded in release.yml) rather than being
        # rejected. This replaces the old abort-on-master-moved behavior that
        # livelocked every release.
        result, calls = self.invoke("advanced_before_arm")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(any("--auto" in call for call in calls))

    def test_divergent_source_is_rejected(self):
        # A source that is NOT in current master's history (not an ancestor) is
        # still refused — the one case the relaxed guard rejects.
        result, calls = self.invoke("divergent")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any("--auto" in call for call in calls))

    def test_transport_or_push_failure_never_opens_or_merges_pr(self):
        for scenario in ("transport", "push_failed"):
            with self.subTest(scenario=scenario):
                result, calls = self.invoke(scenario)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(any(call[:3] == ["gh", "pr", "create"] or "--auto" in call for call in calls))

    def test_idempotent_existing_auto_merge_is_not_reenabled(self):
        result, calls = self.invoke("already_auto")
        self.assertEqual(result.returncode, 0)
        self.assertFalse(any("--auto" in call for call in calls))

    def test_invalid_file_or_tag_fails_before_commands(self):
        for file, tag in (("unrelated.yaml", SOURCE[:12]), (FILE, "wrong")):
            result, calls = self.invoke(file=file, tag=tag)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(calls, [])

    def test_shell_syntax_and_workflow_safety_contract(self):
        subprocess.run(["bash", "-n", str(SCRIPT)], check=True)
        workflow = (ROOT / ".github/workflows/release.yml").read_text()
        helper = SCRIPT.read_text()
        for forbidden in ("RELEASE_BUMP_SSH_KEY", "HEAD:master", "[skip ci]", "--admin", "--approve", "GH_APPROVE_TOKEN"):
            self.assertNotIn(forbidden, workflow + helper)
        self.assertIn("token: ${{ steps.release_app.outputs.token }}", workflow)
        self.assertIn("if: needs.release-source.outputs.build == 'true'", workflow)
        self.assertIn('git log -1 --format=%s', workflow)
        # FFRNT: the abort-on-master-moved guard is gone — replaced by
        # rebase-and-retry with a per-service ancestry check.
        self.assertNotIn("master changed during the build", workflow)
        self.assertIn("rebasing bump onto current master", workflow)
        self.assertIn("merge-base --is-ancestor", ALLOW.read_text())
        self.assertLess(workflow.index('bash /tmp/publish-release-gitops.sh'), workflow.index('- name: Dispatch post-deploy verification'))
        self.assertIn("dispatch-post-deploy-verification:", (ROOT / ".github/workflows/auto-merge.yml").read_text())

    def test_tag_merge_recursion_guard_also_covers_manual_dispatch(self):
        workflow = (ROOT / ".github/workflows/release.yml").read_text()
        guard = workflow.split("        run: |\n", 1)[1].split("\n  build-and-bump:", 1)[0]
        lines = [line.removeprefix("          ") for line in guard.splitlines()]
        script = "\n".join(lines).replace('$(git log -1 --format=%s)', '$SUBJECT').replace('$(git diff-tree --no-commit-id --name-only -r HEAD)', '$CHANGED_FILES')
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "output"
            for subject, changed, expected in (("release: fuzefront images aaaaaaaaaaaa", FILE, "false"),
                                               ("release: fuzefront images aaaaaaaaaaaa (#42)", FILE, "false"),
                                               ("release: fuzefront images aaaaaaaaaaaa", "backend/src/server.ts", "true"),
                                               ("release: fuzefront images aaaaaaaaaaaa", FILE + "\nbackend/src/server.ts", "true"),
                                               ("fix(connectors): release provider", FILE, "true")):
                output.write_text("")
                subprocess.run(["bash", "-c", script], check=True,
                               env=dict(os.environ, SUBJECT=subject, CHANGED_FILES=changed, GITHUB_OUTPUT=str(output)))
                self.assertEqual(output.read_text().strip(), f"build={expected}")


    # ---- review-finding regressions -------------------------------------

    def test_unresolvable_cur_master_is_fetched_then_evaluated(self):
        # Finding 2: master object absent locally -> merge-base 128. The script must
        # fetch it first, and only THEN judge ancestry.
        result, calls = self.invoke("unresolvable_master")
        self.assertEqual(result.returncode, 0, result.stderr)
        names = [c[:2] for c in calls if c[0] == "git"]
        self.assertLess(names.index(["git", "fetch"]), names.index(["git", "merge-base"]))
        self.assertIn(["git", "fetch", "origin", "c" * 40], calls)
        self.assertTrue(any("--auto" in c for c in calls))

    def test_failed_fetch_of_current_master_fails_loudly(self):
        result, calls = self.invoke("fetch_failed")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("cannot fetch current master", result.stdout)
        self.assertFalse(any("--auto" in c for c in calls))

    def test_rerun_after_master_moved_updates_bot_branch_instead_of_wedging(self):
        # Finding 4: same tag-keyed branch, different (master-dependent) blob.
        result, calls = self.invoke("rerun_moved")
        self.assertEqual(result.returncode, 0, result.stderr)
        pushes = [c for c in calls if c[:2] == ["git", "push"]]
        self.assertEqual(len(pushes), 1, pushes)
        self.assertEqual(pushes[0][2], "--force-with-lease=refs/heads/release/gitops-bump-aaaaaaaaaaaa:" + "b" * 40)
        self.assertEqual(pushes[0][-1], "HEAD:refs/heads/release/gitops-bump-aaaaaaaaaaaa")
        self.assertFalse(any("--force" in c or "HEAD:master" in c for c in calls))
        self.assertTrue(any("--auto" in c for c in calls))

    def test_human_edited_release_pr_is_still_never_overwritten(self):
        result, calls = self.invoke("human_edited")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any(c[:2] == ["git", "push"] for c in calls))

    def test_workflow_contract_for_findings_3_5_6(self):
        workflow = (ROOT / ".github/workflows/release.yml").read_text()
        # 5: publish script is copied out BEFORE the tree swap and run from the copy.
        self.assertLess(workflow.index("cp scripts/publish-release-gitops.sh /tmp/publish-release-gitops.sh"),
                        workflow.index("checkout -q -f -B release-rebase"))
        self.assertNotIn("bash scripts/publish-release-gitops.sh", workflow)
        # 6: no silent shallow fallback; hard unshallow.
        self.assertIn("git fetch --unshallow origin master\n", workflow)
        self.assertNotIn("|| git fetch origin master", workflow)
        # 3: all-skipped is distinct from already-current and never claims SHA.
        self.assertIn('if [ "$EXPECTED" -eq 0 ]; then', workflow)
        self.assertIn("bumped NOTHING", workflow)
        self.assertLess(workflow.index('if [ "$EXPECTED" -eq 0 ]; then'), workflow.index("already at ${SHA}"))
        # 1/6: the per-service gate is the released checkout's script, fed the diff.
        self.assertIn("scripts/release-allow-bump.sh", workflow)
        self.assertIn('git diff --name-only "$GITHUB_SHA" "$MASTER_SHA"', workflow)
        subprocess.run(["bash", "-n", str(ALLOW)], check=True)

    def test_expected_zero_block_is_not_already_current(self):
        # Finding 3, executed: extract the EXPECTED=0 block and run it.
        workflow = (ROOT / ".github/workflows/release.yml").read_text()
        start = workflow.index('          if [ "$EXPECTED" -eq 0 ]; then')
        end = workflow.index('          if cmp -s /tmp/vp-current.yaml')
        block = "\n".join(l.removeprefix("          ") for l in workflow[start:end].splitlines())
        with tempfile.TemporaryDirectory() as directory:
            log = Path(directory) / "skip-log"
            for lines, code in (("a newer\nb newer\n", 0), ("a newer\nb unresolved\n", 1)):
                log.write_text(lines)
                script = block.replace("/tmp/skip-log", str(log))
                r = subprocess.run(["bash", "-c", "set -e\nEXPECTED=0 SHA=abc\n" + script + "\necho FELL_THROUGH"],
                                   capture_output=True, text=True, check=False)
                self.assertEqual(r.returncode, code, r.stdout + r.stderr)
                self.assertNotIn("already at", r.stdout)
                self.assertNotIn("FELL_THROUGH", r.stdout)
                self.assertIn("NOTHING", r.stdout)


class AllowBumpTest(unittest.TestCase):
    """Per-service gate, run against a real throwaway repository."""

    def sh(self, *cmd, cwd, env=None):
        return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, check=True,
                              env=dict(os.environ, GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@e", GIT_COMMITTER_NAME="t",
                                       GIT_COMMITTER_EMAIL="t@e", **(env or {}))).stdout.strip()

    def commit(self, repo, files, msg):
        for name, body in files.items():
            path = Path(repo, name)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(body)
        self.sh("git", "add", "-A", cwd=repo)
        self.sh("git", "commit", "-q", "-m", msg, cwd=repo)
        return self.sh("git", "rev-parse", "HEAD", cwd=repo)

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        self.sh("git", "init", "-q", "-b", "master", cwd=self.repo)
        self.base = self.commit(self.repo, {"README.md": "0"}, "base")
        self.built = self.commit(self.repo, {"README.md": "1"}, "built")
        self.sibling = None

    def run_gate(self, img, cur, master_changes, built="1", repo=None):
        repo = repo or self.repo
        # Master advances after the built commit by changing `master_changes`.
        master = self.sh("git", "rev-parse", "HEAD", cwd=repo)
        if master_changes:
            master = self.commit(repo, {f: "m" for f in master_changes}, "master moved")
        vp = self.root / "vp.yaml"
        vp.write_text(f"image:\n  repository: ghcr.io/izzywdev/{img}\n  tag: {cur}\n")
        changed = self.root / "changed.txt"
        changed.write_text(self.sh("git", "diff", "--name-only", self.built, master, cwd=repo) + "\n")
        log = self.root / "skiplog"
        log.write_text("")
        r = subprocess.run(["bash", str(ALLOW), built, img], cwd=repo, capture_output=True, text=True,
                           env=dict(os.environ, SHA=self.built[:12], GITHUB_SHA=self.built, MASTER_SHA=master,
                                    VP_CURRENT=str(vp), CHANGED_FILES=str(changed), SKIP_LOG=str(log)), check=False)
        return r, log.read_text()

    def test_unaffected_service_still_bumps_when_master_moved_elsewhere(self):
        r, log = self.run_gate("fuzefront-email-service", self.base[:12], ["docs/guide.md", "services/sms-service/a.ts"])
        self.assertEqual((r.returncode, r.stdout.strip()), (0, "1"), r.stderr)
        self.assertEqual(log, "")

    def test_service_whose_inputs_changed_after_build_is_skipped_with_notice(self):
        r, log = self.run_gate("fuzefront-email-service", self.base[:12], ["services/email-service/a.ts", "docs/x.md"])
        self.assertEqual((r.returncode, r.stdout.strip()), (0, "0"), r.stderr)
        self.assertIn("::notice::release skip fuzefront-email-service", r.stderr)
        self.assertEqual(log.strip(), "fuzefront-email-service newer")

    def test_shared_inputs_affect_workspace_images_but_not_standalone_ones(self):
        r, _ = self.run_gate("fuzefront-backend", self.base[:12], ["packages/ui/a.ts"])
        self.assertEqual(r.stdout.strip(), "0", r.stderr)
        self.sh("git", "reset", "-q", "--hard", self.built, cwd=self.repo)
        r, _ = self.run_gate("fuzefront-clock-app", self.base[:12], ["packages/ui/b.ts"])
        self.assertEqual(r.stdout.strip(), "1", r.stderr)

    def test_unmoved_master_never_skips_for_inputs(self):
        r, _ = self.run_gate("fuzefront-email-service", self.base[:12], [])
        self.assertEqual(r.stdout.strip(), "1", r.stderr)

    def test_non_ancestor_tag_is_a_logged_newer_skip(self):
        self.sh("git", "checkout", "-q", "-b", "other", self.base, cwd=self.repo)
        other = self.commit(self.repo, {"other.txt": "x"}, "other")
        self.sh("git", "checkout", "-q", "master", cwd=self.repo)
        r, log = self.run_gate("fuzefront-email-service", other[:12], [])
        self.assertEqual(r.stdout.strip(), "0", r.stderr)
        self.assertEqual(log.strip(), "fuzefront-email-service newer")

    def test_hand_pinned_non_sha_tag_is_logged_and_skipped(self):
        r, log = self.run_gate("fuzefront-email-service", "stable-pin", [])
        self.assertEqual((r.returncode, r.stdout.strip()), (0, "0"), r.stderr)
        self.assertIn("hand-pinned", r.stderr)
        self.assertEqual(log.strip(), "fuzefront-email-service unresolved")

    def test_unresolvable_sha_in_shallow_clone_fails_loudly(self):
        shallow = self.root / "shallow"
        self.sh("git", "clone", "-q", "--depth", "1", f"file://{self.repo}", str(shallow), cwd=self.root)
        r, _ = self.run_gate("fuzefront-email-service", self.base[:12], [], repo=shallow)
        # The shallow clone's HEAD is `built`; `base` is not in it.
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("shallow", r.stderr)
        self.assertEqual(r.stdout.strip(), "")

    def reset(self):
        self.sh("git", "reset", "-q", "--hard", self.built, cwd=self.repo)

    def test_design_system_change_skips_every_image_that_consumes_it(self):
        # frontend aliases it to source; website/devportal frontends vendor it.
        for img in ("fuzefront-frontend", "fuzefront-website-frontend", "fuzefront-devportal-frontend"):
            with self.subTest(img=img):
                self.reset()
                r, log = self.run_gate(img, self.base[:12], ["design-system/src/Button.tsx"])
                self.assertEqual((r.returncode, r.stdout.strip()), (0, "0"), r.stderr)
                self.assertEqual(log.strip(), f"{img} newer")

    def test_design_system_change_does_not_skip_images_that_do_not_use_it(self):
        for img in ("fuzefront-clock-app", "fuzefront-website-backend", "fuzefront-backend", "fuzefront-email-service"):
            with self.subTest(img=img):
                self.reset()
                r, _ = self.run_gate(img, self.base[:12], ["design-system/src/Button.tsx"])
                self.assertEqual((r.returncode, r.stdout.strip()), (0, "1"), r.stderr)

    def test_generated_client_change_skips_frontend_only(self):
        for d in ("billing-client", "portal-client", "config-client"):
            with self.subTest(d=d):
                self.reset()
                r, _ = self.run_gate("fuzefront-frontend", self.base[:12], [f"{d}/src/index.ts"])
                self.assertEqual(r.stdout.strip(), "0", r.stderr)
                self.reset()
                r, _ = self.run_gate("fuzefront-security-service", self.base[:12], [f"{d}/src/index.ts"])
                self.assertEqual(r.stdout.strip(), "1", r.stderr)

    def test_custom_hostname_client_change_skips_backend_only(self):
        r, log = self.run_gate("fuzefront-backend", self.base[:12], ["custom-hostname-client/src/index.ts"])
        self.assertEqual(r.stdout.strip(), "0", r.stderr)
        self.assertEqual(log.strip(), "fuzefront-backend newer")
        for img in ("fuzefront-security-service", "fuzefront-applications-service"):
            self.reset()
            r, _ = self.run_gate(img, self.base[:12], ["custom-hostname-client/src/index.ts"])
            self.assertEqual(r.stdout.strip(), "1", f"{img}: {r.stderr}")

    def test_unbuilt_image_is_never_allowed(self):
        r, _ = self.run_gate("fuzefront-email-service", self.base[:12], [], built="0")
        self.assertEqual(r.stdout.strip(), "0")


if __name__ == "__main__":
    unittest.main()
