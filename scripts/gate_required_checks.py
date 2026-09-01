#!/usr/bin/env python3
"""gate-required-checks — audit the REQUIRED status-check set against reality.

Policy: governance/required-checks.json   Doc: governance/required-checks.md

WHY THIS EXISTS. "Required" was being tracked as one property — is the context
named in the ruleset — when it is four. Measured 2026-08-23: of the six contexts
required across the fleet, exactly ONE (`gate-secret-scan`) could actually fail a
PR; of FuzeFront's eleven, four could, and one was a live merge deadlock because
its workflow was `paths:`-filtered. Every one of those facts is visible only by
reading the workflow files. There is no API for "can this check fail".

So this gate reads them, on every PR, from inside the repo — the only place that
property can be seen — and holds the policy file to what the workflows actually
do.

WHAT IT ENFORCES (each maps to an invariant in required-checks.json):

  C1 no_phantom_required   every required context is emitted by some job here.
                           A context nothing emits never reports, and a required
                           context that never reports blocks merges FOREVER, with
                           no red to look at. This is the gate-actionlint lockout
                           (hardening-convention.md §6) caught before it happens.
  C2 no_path_filtered      no required context comes from a workflow with a
                           `paths:`/`paths-ignore:` trigger filter. Same deadlock,
                           reached from the other direction: the workflow simply
                           does not run, so the context is never created. Filter
                           INSIDE the job instead — it costs seconds.
  C3 no_self_hosted        no required context sits on a runner that can QUEUE
                           FOREVER. A hardcoded `runs-on: <pool>` naming a scale
                           set that is down does not fail — it queues, with no
                           error. A GitHub-hosted label is always fit; a
                           budget-fallback runner-selection EXPRESSION is fit
                           because it keeps a hosted default (§2.2), and when it
                           selects a chooser job's output the chooser must run on a
                           hosted or ALLOWLISTED self-hosted pool.
  C4 never_require         nothing on the never_require list is required anywhere.
                           Report-only, remediation, notification and actor-gated
                           jobs are excluded ON PURPOSE and each carries its reason
                           in the policy; this stops one drifting in by accident.
  C5 honest_audit          the policy's `can_fail` claim matches the job body. A
                           context claimed `can_fail: true` whose job carries a
                           vacuity marker FAILS — the policy is lying, which is
                           worse than the vacuity. A context required with NO audit
                           entry FAILS: unclassified is not the same as fine.
                           `can_fail: false` is the tracked worklist and warns.
  C6 promotion_ready       a context named in a stage's `promote` list must ALREADY
                           satisfy can_fail / always_reports / available WHEREVER it
                           is emitted. C1-C5 only look at what is required TODAY, so
                           without this a defective context can be scheduled for
                           promotion and the gate stays green right up until the
                           ruleset edit that deadlocks the repo. Not-yet-emitted is
                           fine and silent -- that is what the stage is for; emitted
                           and defective is an error, because the stage's precondition
                           is already false and nothing else says so.

RAMP. `enforce` in the policy decides, PER REPO, whether findings fail the job.
It is declared in the data, never as a `|| true` in the workflow — the gate always
runs and always prints every finding, and the summary line names the mode it ran
in, so a ramped run can never be mistaken for a clean one. gate-toolchain is the
counter-example this avoids: its suppression is hardcoded in harden-gate.yml,
invisible from any policy file, and its own comment history records three rounds
of false confidence about whether it enforced.

C5 is the ratchet. It cannot be satisfied by adding `|| true` (that flips the
claim to false, which the diff shows) and it shrinks only by real de-vacuuming.
"""
from __future__ import annotations

import json
import os
import re
import sys

POLICY_PATHS = ("governance/required-checks.json", ".fuze/required-checks.json")
WORKFLOW_DIR = ".github/workflows"

# A GitHub-hosted label. Anything else is a self-hosted scale set (C3).
HOSTED = re.compile(r"^(ubuntu|windows|macos)-", re.I)

# A runs-on that selects a chooser job's output, e.g.
# `${{ needs.pick-runner.outputs.runner }}`. This is the sanctioned budget-fallback
# shape (governance/required-checks.md §2.2): GitHub-hosted by default, self-hosted
# only while the Actions budget is exhausted, back to hosted when it resets.
NEEDS_OUTPUT = re.compile(r"needs\.([A-Za-z0-9_-]+)\.outputs\.")

# Markers that mean the decisive step cannot propagate a failure. Deliberately
# textual: this is a code smell audit, not an interpreter. False positives are
# resolved by classifying the context honestly in the policy, not by loosening
# the pattern.
VACUITY = (
    "|| true",
    "exit 0",
    "set +e",
    "continue-on-error: true",
    "exit-code: '0'",
    'exit-code: "0"',
)


class Finding(str):
    pass


def runner_finding(name, runner, contexts, allowed, code):
    """Return an error string if a REQUIRED/promotion context's runner can queue
    forever, else None.

    Fit means one of:
      * a GitHub-hosted label (ubuntu/windows/macos-*);
      * a runner-selection EXPRESSION. An expression keeps a hosted default, so it
        cannot queue forever the way a hardcoded self-hosted label does. When the
        expression selects a chooser job's output (`needs.<job>.outputs.*`) that
        chooser must exist and must itself run on a hosted label or an ALLOWLISTED
        self-hosted pool (`allowed_self_hosted_runners`) — otherwise the whole
        fallback sits behind a pool that can queue forever, defeating the point.

    A hardcoded self-hosted label is never fit: it does not fail when the pool is
    down, it QUEUES FOREVER, blocking merges with no error. This is the budget
    fallback done wrong — self-hosted as the ONLY runner rather than as the
    hosted-defaulted fallback §2.2 sanctions.
    """
    if not isinstance(runner, str):
        return None
    if HOSTED.match(runner):
        return None
    if "${{" in runner:
        m = NEEDS_OUTPUT.search(runner)
        if not m:
            # e.g. `${{ vars.X || 'ubuntu-latest' }}` — a hosted-defaulted expression.
            # The smell audit does not evaluate it; keeping a literal hosted default is
            # the author's responsibility and is visible in the diff.
            return None
        chooser = m.group(1)
        info = contexts.get(chooser)
        if info is None:
            return (
                f"{code}: '{name}' selects its runner from needs.{chooser}.outputs, but "
                f"no job '{chooser}' emits it (a `name:` override, or a missing job). The "
                f"budget-fallback chooser must be a real job in the same workflow, its id "
                f"un-renamed."
            )
        crun = info.get("runs_on")
        if isinstance(crun, str) and not HOSTED.match(crun) and "${{" not in crun and crun not in allowed:
            return (
                f"{code}: '{name}' falls back through chooser '{chooser}', which itself "
                f"runs on '{crun}' — not GitHub-hosted and not in "
                f"allowed_self_hosted_runners {sorted(allowed)}. A fallback behind an "
                f"unlisted self-hosted pool can queue forever. Allowlist the pool, or run "
                f"the chooser on a hosted runner."
            )
        return None
    return (
        f"{code}: '{name}' runs on a hardcoded self-hosted runner '{runner}'. It does not "
        f"fail when the pool is down — it QUEUES FOREVER, which blocks merges with no "
        f"error. Use a GitHub-hosted runner, or a budget-fallback runner-selection "
        f"expression that keeps a hosted default (governance/required-checks.md §2.2)."
    )


def load_policy(root: str) -> tuple[dict, str]:
    for rel in POLICY_PATHS:
        p = os.path.join(root, rel)
        if os.path.isfile(p):
            with open(p, encoding="utf-8") as fh:
                return json.load(fh), rel
    raise SystemExit(
        "::error title=gate-required-checks::no required-checks.json found "
        f"(looked in {', '.join(POLICY_PATHS)}). It is installed by sdlc-bootstrap "
        "together with this job. Do NOT 'fix' this by skipping — a repo with this "
        "gate and no policy is a repo whose required set is unaudited."
    )


def load_workflows(root: str) -> dict:
    """Map each emitted status-check context -> its workflow facts.

    PyYAML is a hard requirement. gate-manifest's structural-fallback mode is the
    documented precedent for a degraded run, and the documented cost is that a
    degraded run reads exactly like a clean one. This gate has no fallback: it
    either parses the workflows or says it could not.
    """
    try:
        import yaml
    except ImportError:
        raise SystemExit(
            "::error title=gate-required-checks::PyYAML is unavailable, so no "
            "workflow could be parsed. This gate has NO structural fallback on "
            "purpose — a degraded audit of the required set is indistinguishable "
            "from a clean one. Install pyyaml."
        )

    wf_dir = os.path.join(root, WORKFLOW_DIR)
    ctx: dict[str, dict] = {}
    if not os.path.isdir(wf_dir):
        return ctx

    for fn in sorted(os.listdir(wf_dir)):
        if not fn.endswith((".yml", ".yaml")):
            continue
        path = os.path.join(wf_dir, fn)
        with open(path, encoding="utf-8") as fh:
            raw = fh.read()
        try:
            doc = yaml.safe_load(raw) or {}
        except yaml.YAMLError as exc:
            print(f"::warning title=gate-required-checks::{fn} is not parseable YAML ({exc}); skipped")
            continue
        if not isinstance(doc, dict):
            continue

        # `on:` is the YAML 1.1 boolean True once parsed. Both spellings occur.
        triggers = doc.get("on", doc.get(True)) or {}
        pr = triggers.get("pull_request") if isinstance(triggers, dict) else None
        path_filtered = isinstance(pr, dict) and ("paths" in pr or "paths-ignore" in pr)
        runs_on_pr = isinstance(triggers, dict) and (
            "pull_request" in triggers or "pull_request_target" in triggers
        )

        for job_id, job in (doc.get("jobs") or {}).items():
            if not isinstance(job, dict):
                continue
            # The context string is the job's `name:` when it has one, else the
            # job id. A `name:` override silently renames the context — that is
            # how gate-policy-integrity produced ZERO check runs while being
            # required (see .github/workflows/gate-policy-integrity.yml).
            name = job.get("name") or job_id
            runner = job.get("runs-on")
            if isinstance(runner, list):
                runner = runner[0] if runner else None
            ctx[str(name)] = {
                "workflow": fn,
                "job_id": job_id,
                "path_filtered": path_filtered,
                "on_pull_request": runs_on_pr,
                "runs_on": runner,
                "body": yaml.dump(job, default_flow_style=False),
            }
    return ctx


def audit(policy: dict, contexts: dict, repo: str) -> tuple[list, list]:
    errors: list[str] = []
    warnings: list[str] = []

    never = policy.get("never_require", {})
    repos = policy.get("repos", {})
    fleet = policy.get("fleet", {})
    # Self-hosted pools sanctioned as budget-exhaustion FALLBACK targets. Only a
    # chooser (a hosted-default expression) may route to one; a hardcoded self-hosted
    # runs-on is still an error even for an allowlisted pool, because it has no hosted
    # default and so can queue forever. Declared in data, greppable and owned.
    allowed = set(policy.get("allowed_self_hosted_runners") or [])

    repo_cfg = repos.get(repo, {})
    required = repo_cfg.get("required_now") or fleet.get("required_now") or []
    audits = {**fleet.get("audit", {}), **repo_cfg.get("audit", {})}

    # C4 — never_require is absolute, everywhere in the policy, not just here.
    stage_promotions: list[str] = []
    for stage in (policy.get("stages") or {}).values():
        if isinstance(stage, dict):
            for key in ("promote", "promote_fuzesdlc_only"):
                stage_promotions += stage.get(key) or []
    for name, reason in never.items():
        for where, lst in (("required_now", required), ("a stage promote list", stage_promotions)):
            if name in lst:
                errors.append(
                    f"C4 never_require: '{name}' appears in {where}. It is excluded on "
                    f"purpose: {reason}"
                )

    for name in required:
        info = contexts.get(name)

        # C1 — a context nothing emits can never report.
        if info is None:
            errors.append(
                f"C1 no_phantom_required: '{name}' is required but no job in "
                f"{WORKFLOW_DIR} emits it. A required context that never reports "
                f"blocks every PR at 'Expected — waiting for status to be reported', "
                f"with no red to look at. Ship the job first, confirm it green, "
                f"then list it (hardening-convention.md §6)."
            )
            continue

        # C2 — a path-filtered required check is a deadlock waiting for the
        # first PR that does not touch those paths.
        if info["path_filtered"]:
            errors.append(
                f"C2 no_path_filtered_required: '{name}' is required, but "
                f"{info['workflow']} filters its pull_request trigger on paths. On a "
                f"PR touching none of them the workflow does not run and the context "
                f"is never created. Delete the `paths:` block and early-exit INSIDE "
                f"the job instead."
            )
        if not info["on_pull_request"]:
            errors.append(
                f"C2 no_path_filtered_required: '{name}' is required, but "
                f"{info['workflow']} has no pull_request trigger, so it cannot report "
                f"on a PR at all."
            )

        # C3 — a required context must not sit on a runner that can queue forever.
        # Hosted, or a hosted-default budget-fallback expression (§2.2), only;
        # never a hardcoded self-hosted label.
        c3 = runner_finding(name, info["runs_on"], contexts, allowed, "C3 no_self_hosted_required")
        if c3:
            errors.append(c3)

        # C5 — the policy's claim must match the job body.
        claim = audits.get(name, {}).get("can_fail", "__missing__")
        hits = [m for m in VACUITY if m in info["body"]]
        if claim == "__missing__":
            errors.append(
                f"C5 honest_audit: '{name}' is required but has no `audit` entry in "
                f"the policy. Unclassified is not the same as fine — state its "
                f"can_fail with a note, so the next reader inherits the evidence "
                f"rather than re-deriving it."
            )
        elif claim is True and hits:
            errors.append(
                f"C5 honest_audit: '{name}' is claimed `can_fail: true` but its job "
                f"carries {hits}. Either the marker is on a non-decisive step — then "
                f"say so in the audit note and narrow the step — or the claim is "
                f"false. A policy that overstates enforcement is worse than the "
                f"vacuity it hides."
            )
        elif claim is False:
            warnings.append(
                f"C5 worklist: '{name}' is REQUIRED and cannot fail "
                f"({hits or 'report-only by construction'}). It is listed, so people "
                f"rely on it; it is vacuous, so it enforces nothing. De-vacuum it "
                f"(governance/required-checks.md §4, Stage 0) — do not de-list it."
            )
        elif claim == "partial":
            warnings.append(
                f"C5 worklist: '{name}' is REQUIRED and only conditionally able to "
                f"fail — {audits.get(name, {}).get('note', 'see policy')}"
            )

    # C6 -- a promotion candidate must be fit to promote WHERE IT ALREADY EXISTS.
    # Absence here is expected (stage 2 promotes into repos that have not received
    # the job yet), so absence is silent. Presence-and-defective is not: the stage
    # says "already established, pure listing", and this is the only thing that
    # holds it to that.
    for name in dict.fromkeys(stage_promotions):
        if name in required:
            continue  # already covered by C1-C5 above.
        info = contexts.get(name)
        if info is None:
            continue  # not shipped in this repo yet -- exactly what the stage is for.
        if info["path_filtered"] or not info["on_pull_request"]:
            errors.append(
                f"C6 promotion_ready: '{name}' is scheduled for promotion but "
                f"{info['workflow']} does not report on every PR "
                f"({'paths-filtered' if info['path_filtered'] else 'no pull_request trigger'}). "
                f"Listing it would deadlock any PR the filter excludes. Fix the "
                f"trigger before the stage, not after."
            )
        c6 = runner_finding(name, info["runs_on"], contexts, allowed, "C6 promotion_ready")
        if c6:
            errors.append(c6)
        hits = [m for m in VACUITY if m in info["body"]]
        if hits:
            errors.append(
                f"C6 promotion_ready: '{name}' is scheduled for promotion but its "
                f"job carries {hits}, so listing it would add another required "
                f"context that cannot fail. De-vacuum it first -- promotion is the "
                f"LAST of the four properties, never the first."
            )

    return errors, warnings


def main(argv: list[str]) -> int:
    root = argv[1] if len(argv) > 1 else "."
    repo = os.environ.get("GITHUB_REPOSITORY", "").split("/")[-1] or os.path.basename(
        os.path.abspath(root)
    )

    policy, rel = load_policy(root)
    contexts = load_workflows(root)
    errors, warnings = audit(policy, contexts, repo)

    print(f"gate-required-checks: repo={repo} policy={rel} contexts_emitted={len(contexts)}")
    for w in warnings:
        print(f"::warning title=gate-required-checks::{w}")
    for e in errors:
        print(f"::error title=gate-required-checks::{e}")

    enf = policy.get("enforce") or {}
    enforcing = bool((enf.get("repos") or {}).get(repo, enf.get("default", True)))

    if errors and enforcing:
        print(f"\ngate-required-checks: FAIL — {len(errors)} error(s), {len(warnings)} warning(s)")
        return 1
    if errors:
        # Findings were PRINTED above as ::error annotations and remain visible in the
        # Checks UI. Only the exit code is held back, and only while this repo is
        # ramping. Say so on its own line: a ramped run that reads like a clean one is
        # the exact defect this gate exists to end.
        print(
            f"\ngate-required-checks: RAMP — {len(errors)} error(s) reported and NOT "
            f"failing the job, because governance/required-checks.json sets "
            f"enforce.repos['{repo}'] (or enforce.default) to false. "
            f"Owner: {enf.get('owner', 'unset')}. {enf.get('flip_criterion', '')}"
        )
        print(f"gate-required-checks: {len(warnings)} tracked worklist item(s)")
        return 0
    print(
        f"\ngate-required-checks: PASS ({'enforcing' if enforcing else 'ramp'}) — "
        f"{len(warnings)} tracked worklist item(s)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
