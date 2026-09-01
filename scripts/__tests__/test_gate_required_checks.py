#!/usr/bin/env python3
"""Self-tests for gate_required_checks.py.

Every test asserts the gate FAILS on a reconstruction of a defect that was
MEASURED LIVE on 2026-08-23, not on a hypothetical. A gate proven only on a clean
tree is the thing this whole family of gates exists to stop.

  C1  gate-actionlint required in a repo whose Harden Gate predates the job
      (hardening-convention.md §6 names this as the lockout to avoid).
  C2  FuzeFront's `In-repo packages resolve from source` — required AND
      paths-filtered to **/package.json. Reported on none of four sampled PR
      heads; any Helm/docs-only PR could never merge.
  C3  FuzeSDLC's own harden-gate.yml, stamped `runs-on: fuzesdlc` against a dead
      ARC pool: queues forever, so required contexts never report. Its sanctioned
      cure — a hosted-default budget-fallback chooser (§2.2) — is proven fit here
      too, and its failure modes (unlisted fallback pool, missing chooser) red.
  C4  gate-code-review — report-only by design and self-hosted — drifting into a
      required list.
  C5a a policy claiming `can_fail: true` for a job that ends in `|| true`.
  C5b a required context with no audit entry at all.
  C6  a context SCHEDULED for promotion that is already defective where it is
      emitted -- measured live: stage 1 promotes gate-manifest/gate-identifier in
      FuzeSDLC, whose own harden-gate.yml stamps both to the dead `fuzesdlc`
      pool. C1-C5 look only at what is required TODAY, so that stayed green.

The last test asserts the real shipped policy and the real workflows agree, so a
future edit to either that breaks the other is caught here and not in production.
"""
import contextlib
import io
import json
import os
import sys
import tempfile
import textwrap
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import gate_required_checks as g  # noqa: E402

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def build(policy: dict, workflows: dict) -> str:
    """Materialise a throwaway repo with a policy and a set of workflow files."""
    root = tempfile.mkdtemp()
    os.makedirs(os.path.join(root, "governance"))
    os.makedirs(os.path.join(root, g.WORKFLOW_DIR))
    with open(os.path.join(root, "governance", "required-checks.json"), "w") as fh:
        json.dump(policy, fh)
    for name, body in workflows.items():
        with open(os.path.join(root, g.WORKFLOW_DIR, name), "w") as fh:
            fh.write(textwrap.dedent(body))
    return root


def policy_for(required, audit=None, never=None, stages=None, allowed=None):
    return {
        "never_require": never or {},
        "stages": stages or {},
        "allowed_self_hosted_runners": allowed or [],
        "fleet": {"required_now": required, "audit": audit or {}},
        "repos": {},
    }


CLEAN_JOB = """\
    name: Harden Gate
    on:
      pull_request:
    jobs:
      gate-secret-scan:
        runs-on: ubuntu-latest
        steps:
          - name: gitleaks
            run: |
              set -euo pipefail
              gitleaks git --redact --no-banner .
    """

# A required job routed through a hosted-default budget-fallback chooser (§2.2):
# GitHub-hosted by default, the self-hosted `fuzesdlc` pool only when the Actions
# budget is exhausted. The chooser runs on the pool it may fall back to, which is
# why that pool must be in allowed_self_hosted_runners.
FALLBACK_JOB = """\
    name: Harden Gate
    on:
      pull_request:
    jobs:
      pick-runner:
        runs-on: fuzesdlc
        outputs:
          runner: ${{ steps.p.outputs.runner }}
        steps:
          - id: p
            run: echo "runner=ubuntu-latest" >> "$GITHUB_OUTPUT"
      gate-lint:
        needs: [pick-runner]
        runs-on: ${{ needs.pick-runner.outputs.runner }}
        steps:
          - run: |
              set -euo pipefail
              npm run lint
    """


class GateRequiredChecksTest(unittest.TestCase):
    def run_gate(self, policy, workflows, repo="testrepo"):
        root = build(policy, workflows)
        pol, _ = g.load_policy(root)
        return g.audit(pol, g.load_workflows(root), repo)

    # --- the gate must PASS on a correct configuration -------------------
    def test_clean_config_passes(self):
        errors, warnings = self.run_gate(
            policy_for(["gate-secret-scan"], {"gate-secret-scan": {"can_fail": True}}),
            {"harden-gate.yml": CLEAN_JOB},
        )
        self.assertEqual(errors, [], f"clean config must pass, got: {errors}")
        self.assertEqual(warnings, [])

    # --- C1: required context that no job emits --------------------------
    def test_C1_phantom_required_context_fails(self):
        errors, _ = self.run_gate(
            policy_for(
                ["gate-secret-scan", "gate-actionlint"],
                {"gate-secret-scan": {"can_fail": True}, "gate-actionlint": {"can_fail": True}},
            ),
            {"harden-gate.yml": CLEAN_JOB},
        )
        self.assertTrue(
            any("C1" in e and "gate-actionlint" in e for e in errors),
            f"a required context no job emits must fail; got {errors}",
        )

    # --- C2: the live FuzeFront deadlock ---------------------------------
    def test_C2_path_filtered_required_context_fails(self):
        errors, _ = self.run_gate(
            policy_for(
                ["In-repo packages resolve from source"],
                {"In-repo packages resolve from source": {"can_fail": True}},
            ),
            {
                "workspace-deps-check.yml": """\
                name: Workspace deps
                on:
                  pull_request:
                    paths:
                      - '**/package.json'
                jobs:
                  workspace-deps:
                    name: In-repo packages resolve from source
                    runs-on: ubuntu-latest
                    steps:
                      - run: node scripts/check-workspace-deps.mjs
                """
            },
        )
        self.assertTrue(
            any("C2" in e for e in errors),
            f"a paths-filtered required context must fail; got {errors}",
        )

    def test_C2_no_pull_request_trigger_fails(self):
        errors, _ = self.run_gate(
            policy_for(["gate-x"], {"gate-x": {"can_fail": True}}),
            {
                "push-only.yml": """\
                name: Push only
                on:
                  push:
                    branches: [main]
                jobs:
                  gate-x:
                    runs-on: ubuntu-latest
                    steps:
                      - run: exit 1
                """
            },
        )
        self.assertTrue(any("C2" in e for e in errors), errors)

    # --- C3: FuzeSDLC's own dead-pool stamp ------------------------------
    def test_C3_self_hosted_required_context_fails(self):
        errors, _ = self.run_gate(
            policy_for(["gate-lint"], {"gate-lint": {"can_fail": True}}),
            {
                "harden-gate.yml": """\
                name: Harden Gate
                on:
                  pull_request:
                jobs:
                  gate-lint:
                    runs-on: fuzesdlc
                    steps:
                      - run: |
                          set -euo pipefail
                          npm run lint
                """
            },
        )
        self.assertTrue(
            any("C3" in e for e in errors),
            f"a self-hosted required context must fail; got {errors}",
        )

    def test_C3_self_hosted_fails_even_when_pool_is_allowlisted(self):
        """The allowlist sanctions a pool as a FALLBACK target, reached through a
        hosted-default chooser. A HARDCODED runs-on naming that same pool has no
        hosted default, so it still queues forever and must still red."""
        errors, _ = self.run_gate(
            policy_for(
                ["gate-lint"], {"gate-lint": {"can_fail": True}}, allowed=["fuzesdlc"]
            ),
            {
                "harden-gate.yml": """\
                name: Harden Gate
                on:
                  pull_request:
                jobs:
                  gate-lint:
                    runs-on: fuzesdlc
                    steps:
                      - run: |
                          set -euo pipefail
                          npm run lint
                """
            },
        )
        self.assertTrue(any("C3" in e for e in errors), errors)

    def test_C3_accepts_github_hosted_labels(self):
        for label in ("ubuntu-latest", "ubuntu-24.04", "windows-latest", "macos-14"):
            errors, _ = self.run_gate(
                policy_for(["gate-lint"], {"gate-lint": {"can_fail": True}}),
                {
                    "harden-gate.yml": f"""\
                    name: Harden Gate
                    on:
                      pull_request:
                    jobs:
                      gate-lint:
                        runs-on: {label}
                        steps:
                          - run: |
                              set -euo pipefail
                              npm run lint
                    """
                },
            )
            self.assertFalse([e for e in errors if "C3" in e], f"{label}: {errors}")

    def test_C3_accepts_budget_fallback_chooser(self):
        """The sanctioned cure for FuzeSDLC's dead-pool stamp: a required job whose
        runs-on selects a chooser output, the chooser routing to an allowlisted
        pool. Hosted default, self-hosted only when the budget is exhausted."""
        errors, _ = self.run_gate(
            policy_for(
                ["gate-lint"], {"gate-lint": {"can_fail": True}}, allowed=["fuzesdlc"]
            ),
            {"harden-gate.yml": FALLBACK_JOB},
        )
        self.assertFalse([e for e in errors if "C3" in e], f"budget-fallback must pass C3; got {errors}")

    def test_C3_fallback_through_unlisted_pool_fails(self):
        """A chooser that can only ever route to a self-hosted pool NOT in the
        allowlist reintroduces the queue-forever risk behind an expression."""
        errors, _ = self.run_gate(
            policy_for(["gate-lint"], {"gate-lint": {"can_fail": True}}),  # allowed defaults to []
            {"harden-gate.yml": FALLBACK_JOB},
        )
        self.assertTrue(
            any("C3" in e and "pick-runner" in e for e in errors),
            f"a fallback behind an unlisted pool must fail; got {errors}",
        )

    def test_C3_fallback_referencing_missing_chooser_fails(self):
        """`needs.<job>.outputs` pointing at a job that does not exist (typo, or a
        `name:` override that renamed it) leaves the runner unresolved."""
        errors, _ = self.run_gate(
            policy_for(
                ["gate-lint"], {"gate-lint": {"can_fail": True}}, allowed=["fuzesdlc"]
            ),
            {
                "harden-gate.yml": """\
                name: Harden Gate
                on:
                  pull_request:
                jobs:
                  gate-lint:
                    needs: [ghost]
                    runs-on: ${{ needs.ghost.outputs.runner }}
                    steps:
                      - run: |
                          set -euo pipefail
                          npm run lint
                """
            },
        )
        self.assertTrue(
            any("C3" in e and "ghost" in e for e in errors),
            f"a fallback referencing a missing chooser must fail; got {errors}",
        )

    # --- C4: never_require is absolute -----------------------------------
    def test_C4_never_require_in_required_now_fails(self):
        errors, _ = self.run_gate(
            policy_for(
                ["gate-code-review"],
                {"gate-code-review": {"can_fail": True}},
                never={"gate-code-review": "report-only by design and self-hosted"},
            ),
            {"harden-gate.yml": CLEAN_JOB},
        )
        self.assertTrue(any("C4" in e for e in errors), errors)

    def test_C4_never_require_in_a_stage_promote_list_fails(self):
        errors, _ = self.run_gate(
            policy_for(
                ["gate-secret-scan"],
                {"gate-secret-scan": {"can_fail": True}},
                never={"call-autofix": "remediation job"},
                stages={"stage_1": {"promote": ["call-autofix"]}},
            ),
            {"harden-gate.yml": CLEAN_JOB},
        )
        self.assertTrue(any("C4" in e and "call-autofix" in e for e in errors), errors)

    # --- C5: the policy must not overstate enforcement -------------------
    def test_C5_false_can_fail_claim_fails(self):
        errors, _ = self.run_gate(
            policy_for(["gate-authz"], {"gate-authz": {"can_fail": True}}),
            {
                "harden-gate.yml": """\
                name: Harden Gate
                on:
                  pull_request:
                jobs:
                  gate-authz:
                    runs-on: ubuntu-latest
                    steps:
                      - run: semgrep scan --config p/owasp-top-ten --sarif -o a.sarif || true
                """
            },
        )
        self.assertTrue(
            any("C5" in e for e in errors),
            f"claiming can_fail on a job ending in `|| true` must fail; got {errors}",
        )

    def test_C5_unclassified_required_context_fails(self):
        errors, _ = self.run_gate(
            policy_for(["gate-secret-scan"], {}), {"harden-gate.yml": CLEAN_JOB}
        )
        self.assertTrue(any("C5" in e for e in errors), errors)

    def test_C5_honest_vacuous_claim_warns_but_does_not_fail(self):
        """The worklist must not be silenced by de-listing. Vacuous-and-honest
        is a tracked warning; the fix is de-vacuuming, not removing the row."""
        errors, warnings = self.run_gate(
            policy_for(["gate-dependency-scan"], {"gate-dependency-scan": {"can_fail": False}}),
            {
                "harden-gate.yml": """\
                name: Harden Gate
                on:
                  pull_request:
                jobs:
                  gate-dependency-scan:
                    runs-on: ubuntu-latest
                    steps:
                      - uses: aquasecurity/trivy-action@v0.36.0
                        with:
                          exit-code: '0'
                """
            },
        )
        self.assertEqual(errors, [])
        self.assertTrue(any("C5 worklist" in w for w in warnings), warnings)

    # --- a `name:` override renames the context silently ------------------
    def test_job_name_override_defines_the_context(self):
        """gate-policy-integrity produced ZERO check runs while required, because
        a `name:` overrode the context string. The parser must follow `name:`."""
        errors, _ = self.run_gate(
            policy_for(["gate-policy-integrity"], {"gate-policy-integrity": {"can_fail": True}}),
            {
                "gate-policy-integrity.yml": """\
                name: gate-policy-integrity
                on:
                  pull_request:
                jobs:
                  gate-policy-integrity:
                    name: Policy integrity
                    runs-on: ubuntu-latest
                    steps:
                      - run: |
                          set -euo pipefail
                          ./check.sh
                """
            },
        )
        self.assertTrue(
            any("C1" in e for e in errors),
            "a `name:` override means the job-id context is never emitted",
        )

    # --- C6: a promotion candidate must be fit to promote ----------------
    def test_C6_promotion_candidate_on_dead_pool_fails(self):
        """FuzeSDLC stage 1 promotes gate-manifest while its own copy of the job
        is stamped `runs-on: fuzesdlc`. Listing it would deadlock the repo, and
        nothing before C6 said so."""
        errors, _ = self.run_gate(
            policy_for(
                ["gate-secret-scan"],
                audit={"gate-secret-scan": {"can_fail": True}},
                stages={"stage_1": {"promote": ["gate-manifest"]}},
            ),
            {
                "harden-gate.yml": CLEAN_JOB.rstrip(" ")
                + """\
      gate-manifest:
        runs-on: fuzesdlc
        steps:
          - run: python3 scripts/gate_manifest.py
    """
            },
        )
        self.assertTrue(any("C6" in e and "gate-manifest" in e for e in errors), errors)

    def test_C6_promotion_candidate_path_filtered_fails(self):
        errors, _ = self.run_gate(
            policy_for(
                ["gate-secret-scan"],
                audit={"gate-secret-scan": {"can_fail": True}},
                stages={"stage_1": {"promote": ["gate-manifest"]}},
            ),
            {
                "harden-gate.yml": CLEAN_JOB,
                "manifest.yml": """\
    name: Manifest
    on:
      pull_request:
        paths: ['.fuze/**']
    jobs:
      gate-manifest:
        runs-on: ubuntu-latest
        steps:
          - run: python3 scripts/gate_manifest.py
    """,
            },
        )
        self.assertTrue(any("C6" in e and "every PR" in e for e in errors), errors)

    def test_C6_promotion_candidate_that_cannot_fail_fails(self):
        """Promotion is the LAST of the four properties. Scheduling a vacuous
        context for listing must red before the ruleset edit, not after."""
        errors, _ = self.run_gate(
            policy_for(
                ["gate-secret-scan"],
                audit={"gate-secret-scan": {"can_fail": True}},
                stages={"stage_3": {"promote": ["gate-platform-auth"]}},
            ),
            {
                "harden-gate.yml": CLEAN_JOB.rstrip(" ")
                + """\
      gate-platform-auth:
        runs-on: ubuntu-latest
        steps:
          - run: python3 scripts/gate_platform_auth.py || true
    """
            },
        )
        self.assertTrue(any("C6" in e and "cannot fail" in e for e in errors), errors)

    def test_C6_accepts_budget_fallback_chooser(self):
        """A promotion candidate routed through the sanctioned chooser is fit on
        the `available` property, the same as a required one (§2.2)."""
        errors, _ = self.run_gate(
            policy_for(
                ["gate-secret-scan"],
                audit={"gate-secret-scan": {"can_fail": True}},
                stages={"stage_1": {"promote": ["gate-manifest"]}},
                allowed=["fuzesdlc"],
            ),
            {
                "harden-gate.yml": FALLBACK_JOB.rstrip(" ")
                + """\
      gate-manifest:
        needs: [pick-runner]
        runs-on: ${{ needs.pick-runner.outputs.runner }}
        steps:
          - run: |
              set -euo pipefail
              python3 scripts/gate_manifest.py
    """
            },
        )
        self.assertFalse([e for e in errors if "C6" in e], errors)

    def test_C6_is_silent_when_the_job_is_not_shipped_here_yet(self):
        """Stage 2 promotes into repos that have not received the job. Absence is
        the stage's whole reason to exist and must not red."""
        errors, warnings = self.run_gate(
            policy_for(
                ["gate-secret-scan"],
                audit={"gate-secret-scan": {"can_fail": True}},
                stages={"stage_2": {"promote": ["gate-identifier"]}},
            ),
            {"harden-gate.yml": CLEAN_JOB},
        )
        self.assertEqual([], errors)
        self.assertFalse(any("C6" in w for w in warnings), warnings)

    def test_C6_healthy_promotion_candidate_passes(self):
        errors, _ = self.run_gate(
            policy_for(
                ["gate-secret-scan"],
                audit={"gate-secret-scan": {"can_fail": True}},
                stages={"stage_1": {"promote": ["gate-manifest"]}},
            ),
            {
                "harden-gate.yml": CLEAN_JOB.rstrip(" ")
                + """\
      gate-manifest:
        runs-on: ubuntu-latest
        steps:
          - run: |
              set -euo pipefail
              python3 scripts/gate_manifest.py
    """
            },
        )
        self.assertEqual([], errors)

    # --- the ramp: declared in data, and never mistakable for clean --------
    def _run_main(self, policy, workflows, repo):
        root = build(policy, workflows)
        old = os.environ.get("GITHUB_REPOSITORY")
        os.environ["GITHUB_REPOSITORY"] = f"izzywdev/{repo}"
        buf = io.StringIO()
        try:
            with contextlib.redirect_stdout(buf):
                rc = g.main(["gate_required_checks.py", root])
        finally:
            if old is None:
                os.environ.pop("GITHUB_REPOSITORY", None)
            else:
                os.environ["GITHUB_REPOSITORY"] = old
        return rc, buf.getvalue()

    def _defective(self):
        """A policy with one real finding: a required context nothing emits."""
        return (
            {
                "enforce": {"owner": "@izzywdev", "default": False,
                            "flip_criterion": "when the gate reports GitHub-hosted",
                            "repos": {"EnforcingRepo": True}},
                "never_require": {},
                "stages": {},
                "fleet": {"required_now": ["gate-actionlint"], "audit": {}},
                "repos": {},
            },
            {"harden-gate.yml": CLEAN_JOB},
        )

    def test_ramped_repo_reports_every_finding_and_exits_zero(self):
        policy, wfs = self._defective()
        rc, out = self._run_main(policy, wfs, "RampedRepo")
        self.assertEqual(0, rc)
        # The finding is still PRINTED as an ::error annotation — only the exit
        # code is held back.
        self.assertIn("::error", out)
        self.assertIn("gate-actionlint", out)
        # ...and the run says which mode it was, so it cannot read as clean.
        self.assertIn("RAMP", out)
        self.assertNotIn("PASS", out)
        self.assertIn("@izzywdev", out)

    def test_enforcing_repo_fails_on_the_same_policy(self):
        policy, wfs = self._defective()
        rc, out = self._run_main(policy, wfs, "EnforcingRepo")
        self.assertEqual(1, rc)
        self.assertIn("FAIL", out)

    def test_clean_run_names_its_mode(self):
        policy = policy_for(["gate-secret-scan"], audit={"gate-secret-scan": {"can_fail": True}})
        policy["enforce"] = {"default": False, "repos": {}}
        rc, out = self._run_main(policy, {"harden-gate.yml": CLEAN_JOB}, "RampedRepo")
        self.assertEqual(0, rc)
        self.assertIn("PASS (ramp)", out)

    # --- the shipped policy must agree with the shipped workflows ---------
    def test_shipped_policy_is_internally_consistent(self):
        with open(os.path.join(REPO_ROOT, "governance", "required-checks.json")) as fh:
            policy = json.load(fh)
        never = set(policy["never_require"])
        for repo, cfg in policy["repos"].items():
            for ctx in cfg.get("required_now") or []:
                self.assertNotIn(ctx, never, f"{repo} requires a never_require context: {ctx}")
        for stage in policy["stages"].values():
            if isinstance(stage, dict):
                for key in ("promote", "promote_fuzesdlc_only"):
                    for ctx in stage.get(key) or []:
                        self.assertNotIn(ctx, never, f"stage promotes a never_require context: {ctx}")

    def test_shipped_policy_classifies_every_fleet_required_context(self):
        with open(os.path.join(REPO_ROOT, "governance", "required-checks.json")) as fh:
            policy = json.load(fh)
        audit = policy["fleet"]["audit"]
        for ctx in policy["fleet"]["required_now"]:
            self.assertIn(ctx, audit, f"fleet requires '{ctx}' with no audit entry")
        ff = policy["repos"]["FuzeFront"]
        merged = {**audit, **ff["audit"]}
        for ctx in ff["required_now"]:
            self.assertIn(ctx, merged, f"FuzeFront requires '{ctx}' with no audit entry")


if __name__ == "__main__":
    unittest.main(verbosity=2)
