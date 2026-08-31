#!/usr/bin/env python3
"""
gate-workflow-drift — REQUIRED check that fails a PR when a repo's `fuze:managed`
workflow files have drifted TOO FAR from the FuzeSDLC canonical.

WHY THIS EXISTS. governance-sync.yml already detects drift in `.github/workflows/**`
(scripts/governance_sync.py's `report["workflows"]`), but it is deliberately advisory:
the default GITHUB_TOKEN cannot push `.github/workflows/**` at all (GitHub blocks it at
the API level), and the workflows-scoped fuze-agent App token that WOULD let it
self-heal has never been granted the Workflows permission — so today drift can ONLY be
fixed by a human re-running sdlc-bootstrap.sh or by the nightly sweep. Turning that
`::warning::` into a hard failure the moment ANY drift appears would therefore redden
every one of the ~20 onboarded repos on the next canonical release, for a condition none
of them can self-fix in CI. That is the "too strict" failure mode this gate is built to
avoid (governance/workflow-drift-policy.json documents the ramp and why).

Equally, staying purely advisory forever is the "too lax" failure mode the task that
created this file was scoped to fix: an advisory warning nobody reads is functionally the
same as no gate.

THE RAMP. Rather than counting elapsed time (which says nothing about how much policy
moved) this gate counts **baseline-version releases** — each commit that bumped
`governance/baseline-version.txt`, i.e. each deliberate `governance/versioning.md` §5
release cut — between the commit the repo's file was ORIGINALLY STAMPED FROM and the
commit its `baselineRef` currently resolves to. A file is:

  - IN SYNC        — digest matches the canonical template at the repo's pinned ref.
  - `warn`         — drifted, but by fewer releases than the policy threshold. Reported,
                     non-blocking — the repo has not been given a fair chance to catch up
                     yet (nothing pushes these files back automatically today).
  - `fail`         — drifted by AT LEAST the threshold's worth of releases. Blocking:
                     the gap has had enough successive releases to be noticed and fixed
                     by a human/nightly-sweep pass, and staying silent past that point is
                     exactly the alarm-fatigue failure this gate replaces.
  - `unknown`      — the stamped digest cannot be found anywhere in the canonical
                     template's OWN git history (renamed/deleted template, a squashed or
                     shallow canonical checkout, or a marker predating this gate).
                     Reported loudly, but NEVER hard-fails: this signal cannot
                     distinguish "genuinely tampered" from "the git history this run had
                     was incomplete", and a check that reds out on an unprovable signal is
                     the same shape of false-positive this fleet has spent real effort
                     removing elsewhere (required-checks.json, file-ownership.md).

WHAT THIS GATE NEVER TOUCHES, BY DESIGN (mirrors governance_sync.py's own scoping):
  - `detached` files (marker removed) — the SUPPORTED way to fork a managed workflow.
    This gate never even looks at a file with no `fuze:managed` marker.
  - Files that do not exist yet in `.github/workflows/**` — a repo the re-stamp fan-out
    has not reached is not "drifted", it is simply not there yet. Absence is
    governance_sync.py's `missing`/`workflows (ABSENT ...)` concern, not this gate's.
  - A repo with no `.fuze/manifest.json` at all — not yet onboarded. Skips cleanly.

Usage:
    python scripts/gate_workflow_drift.py --canonical <fuzesdlc-checkout> [--repo .] \
        [--policy governance/workflow-drift-policy.json] [--report PATH]

Exit codes: 0 = clean or warn-only    1 = at least one `fail`    2 = usage/config error
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(SCRIPT_DIR, "bootstrap"))
from lib import render as rnd  # noqa: E402

DEFAULT_MAX_VERSIONS_BEHIND = 3
BASELINE_VERSION_FILE = os.path.join("governance", "baseline-version.txt")


# --------------------------------------------------------------------------------------
# Git plumbing — kept minimal and directly testable (no shelling out to `git log --grep`
# style one-liners whose parsing edge cases would otherwise hide inside a bash step).
# --------------------------------------------------------------------------------------

def _git_text(args, cwd):
    proc = subprocess.run(["git"] + args, cwd=cwd, capture_output=True, text=True)
    return proc.returncode, proc.stdout


def _git_bytes(args, cwd):
    proc = subprocess.run(["git"] + args, cwd=cwd, capture_output=True)
    return proc.returncode, proc.stdout


def find_stamped_commit(canonical_dir: str, template_rel: str, digest_hex: str):
    """The MOST RECENT commit in `canonical_dir`'s history (on the currently checked-out
    ref) at which `template_rel`'s raw blob hashed to `digest_hex` (sha256, matching
    lib.render.build_marker_line's own digest input).

    Returns the commit sha, or None if no commit in the tracked history of that path ever
    produced that digest — see the `unknown` bucket in the module docstring for why that
    is reported, not failed.
    """
    rc, out = _git_text(["log", "--format=%H", "--", template_rel], canonical_dir)
    if rc != 0:
        return None
    for commit in out.split():
        rc2, blob = _git_bytes(["show", f"{commit}:{template_rel}"], canonical_dir)
        if rc2 != 0:
            continue  # file did not exist at this commit (created later / renamed)
        if hashlib.sha256(blob).hexdigest() == digest_hex:
            return commit
    return None


def versions_behind(canonical_dir: str, stamped_commit: str, head_ref: str = "HEAD"):
    """Count of `governance/baseline-version.txt`-touching commits strictly after
    `stamped_commit` and reachable from `head_ref` — i.e. how many deliberate baseline
    releases (governance/versioning.md §5) have shipped since the repo's file was stamped
    from this exact canonical content. Returns None if the count could not be computed
    (e.g. `stamped_commit` is not an ancestor of `head_ref` — an incomplete/shallow clone).
    """
    rc, out = _git_text(
        ["rev-list", "--count", f"{stamped_commit}..{head_ref}", "--", BASELINE_VERSION_FILE],
        canonical_dir,
    )
    out = out.strip()
    if rc != 0 or not out.isdigit():
        return None
    return int(out)


# --------------------------------------------------------------------------------------
# Policy
# --------------------------------------------------------------------------------------

def load_policy(path):
    default = {"max_versions_behind": DEFAULT_MAX_VERSIONS_BEHIND}
    if not path or not os.path.isfile(path):
        return default
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return default
    out = dict(default)
    if isinstance(data.get("max_versions_behind"), int) and data["max_versions_behind"] > 0:
        out["max_versions_behind"] = data["max_versions_behind"]
    return out


# --------------------------------------------------------------------------------------
# Core evaluation
# --------------------------------------------------------------------------------------

def classify_file(canonical_dir: str, marker: dict, max_versions_behind: int) -> dict:
    """Given a parsed `fuze:managed` marker (template, baseline, digest), decide whether
    the canonical template at the currently checked-out HEAD of `canonical_dir` still
    matches it, and if not, how stale that drift is.

    Returns a dict: {status: "ok"|"warn"|"fail"|"unknown"|"orphaned", ...details}.
    """
    template = marker["template"]
    stamped_digest = marker["digest"]
    template_rel = os.path.join("workflow-templates", template)
    template_path = os.path.join(canonical_dir, template_rel)

    if not os.path.isfile(template_path):
        # The canonical retired/renamed this template. Not this repo's fault, and not
        # something a version-count ramp can even reason about — surfaced, never blocking.
        return {"status": "orphaned", "template": template,
                "detail": f"{template_rel} no longer exists in the canonical"}

    with open(template_path, "rb") as f:
        current_raw = f.read()
    current_digest = hashlib.sha256(current_raw).hexdigest()

    if current_digest == stamped_digest:
        return {"status": "ok", "template": template}

    stamped_commit = find_stamped_commit(canonical_dir, template_rel.replace(os.sep, "/"), stamped_digest)
    if stamped_commit is None:
        return {
            "status": "unknown", "template": template,
            "detail": (
                f"stamped digest sha256:{stamped_digest[:12]}... for {template_rel} was not "
                "found anywhere in the canonical template's tracked history — cannot "
                "compute how stale this is (see 'unknown' in the module docstring)."
            ),
        }

    n = versions_behind(canonical_dir, stamped_commit)
    if n is None:
        return {
            "status": "unknown", "template": template,
            "detail": (
                f"found the stamped commit ({stamped_commit[:12]}) but could not count "
                "releases since it — likely an incomplete git history in this checkout."
            ),
        }

    status = "fail" if n >= max_versions_behind else "warn"
    return {
        "status": status, "template": template, "versions_behind": n,
        "detail": (
            f"{template_rel} is {n} baseline release(s) behind the canonical at this "
            f"repo's pinned baselineRef (threshold: {max_versions_behind})."
        ),
    }


def evaluate(canonical: str, repo: str, max_versions_behind: int) -> dict:
    """Full per-repo evaluation. Never raises on a missing manifest/marker/workflow dir —
    those are all documented degrade-cleanly paths (see module docstring)."""
    report = {"ok": True, "skipped": None, "results": []}

    manifest_path = os.path.join(repo, ".fuze", "manifest.json")
    if not os.path.isfile(manifest_path):
        report["skipped"] = "no .fuze/manifest.json — repo not onboarded yet"
        return report

    repo_wf = os.path.join(repo, ".github", "workflows")
    if not os.path.isdir(repo_wf):
        report["skipped"] = "no .github/workflows directory"
        return report

    checked_any = False
    for fname in sorted(os.listdir(repo_wf)):
        if not fname.endswith(".yml"):
            continue
        fpath = os.path.join(repo_wf, fname)
        try:
            with open(fpath, encoding="utf-8") as f:
                text = f.read()
        except (OSError, UnicodeDecodeError):
            continue
        marker = rnd.parse_marker(text)
        if marker is None:
            continue  # unmarked / detached — never this gate's concern
        checked_any = True
        result = classify_file(canonical, marker, max_versions_behind)
        result["file"] = os.path.join(".github", "workflows", fname)
        report["results"].append(result)
        if result["status"] == "fail":
            report["ok"] = False

    if not checked_any:
        report["skipped"] = "no fuze:managed workflow files found — nothing to check yet"

    return report


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--canonical", required=True, help="checked-out FuzeSDLC dir, at the repo's pinned baselineRef")
    ap.add_argument("--repo", default=".", help="consuming repo dir")
    ap.add_argument("--policy", default=os.path.join("governance", "workflow-drift-policy.json"))
    ap.add_argument("--report", default=".gate-workflow-drift-report.json")
    args = ap.parse_args()

    policy_path = args.policy
    if not os.path.isabs(policy_path):
        # Prefer the policy as vendored inside the canonical checkout — it is CANONICAL
        # policy (like required-checks.json), never a repo-local override.
        candidate = os.path.join(args.canonical, args.policy)
        policy_path = candidate if os.path.isfile(candidate) else args.policy
    policy = load_policy(policy_path)

    report = evaluate(os.path.abspath(args.canonical), os.path.abspath(args.repo),
                       policy["max_versions_behind"])

    with open(os.path.join(args.repo, args.report), "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    if report["skipped"]:
        print(f"gate-workflow-drift: skipped — {report['skipped']}")
        return 0

    for r in report["results"]:
        status = r["status"]
        if status == "ok":
            continue
        detail = r.get("detail", "")
        if status == "fail":
            print(f"::error title=gate-workflow-drift::{r['file']}: {detail}")
        elif status == "warn":
            print(f"::warning title=gate-workflow-drift::{r['file']}: {detail}")
        else:  # unknown / orphaned
            print(f"::notice title=gate-workflow-drift::{r['file']}: {detail}")

    if report["ok"]:
        print("gate-workflow-drift: no blocking drift (warnings/unknowns, if any, are advisory).")
        return 0

    print("gate-workflow-drift: FAILING — one or more managed workflow files have drifted "
          "past the policy threshold. Re-run scripts/sdlc-bootstrap.sh, or wait for the "
          "nightly governance sweep, to bring them current.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
