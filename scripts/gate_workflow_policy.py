#!/usr/bin/env python3
"""gate-workflow-policy — lint every workflow for the runner-hygiene policy knobs.

WHY THIS EXISTS (a production failure the whole family now shares):
Fuze self-hosted ARC runners jammed for hours because product-owned workflows shipped
with NO `timeout-minutes`. A hung job never ends on its own, so its runner pod never
frees its maxRunners slot — one zombie per hung job, pinning slots on a shared node until
a human drains the pool by hand. The *content* of those workflows (ci-cd.yml, release.yml)
is product-specific and repo-owned, so it is not canonical. But three POLICY KNOBS inside
any workflow are a family concern that nothing else enforces:

  1. every job sets `timeout-minutes`     — a hung job must die on a clock, not a human.
  2. `runs-on` is present and non-empty    — and is NOT the bare `self-hosted` string or a
                                             `[self-hosted, ...]` label array, because
                                             neither matches an ARC scale set: such a job
                                             QUEUES FOREVER against a set that does not
                                             exist (see FuzeInfra runners/arc/
                                             runner-scale-set-values.yaml). A scale set is
                                             addressed by its single name label.
  3. a `pull_request`-triggered workflow declares a top-level `concurrency` group with
     `cancel-in-progress: true`            — so a rapid push sequence cancels superseded
                                             runs instead of stacking N of them onto the
                                             shared pool at once.

REPORT-ONLY, FIRST PASS. This scanner emits `::warning::` for every finding and ALWAYS
exits 0 — exactly like harden-gate's first-pass gates (gate-pagination, the semgrep
scans). The value is fleet-wide visibility on day one without turning every repo red; a
repo ratchets it to enforcing later, per-repo, once its own workflows are clean (flip the
`|| true` off in gate-workflow-policy.yml — the same convention harden-gate documents).

CORRECTNESS NOTES (things that make a naive scanner wrong):
  * YAML's `on:` key parses as the *boolean* True under YAML 1.1 (on/off/yes/no), so a
    workflow's triggers live under the Python key `True`, not the string "on". Both forms
    are handled (see _get_on).
  * A reusable-workflow-call job (`uses:` at job level) has NO `runs-on`/`timeout-minutes`
    of its own — the callee owns those — so those two checks are SKIPPED for such a job.
  * `on:` has three shapes — scalar (`on: pull_request`), list (`on: [pull_request]`) and
    map (`on: {pull_request: {...}}`) — all handled.
  * A file this parser cannot read is REPORTED, never crashed on.
"""
import argparse
import glob
import os
import sys

try:
    import yaml
except ImportError:  # pragma: no cover - the workflow pip-installs pyyaml first
    yaml = None


# Sentinel distinct from a present-but-None value (`runs-on:` with nothing after it).
_MISSING = object()


class Finding:
    """One policy violation, tied to a file (and job, when job-scoped)."""

    __slots__ = ("code", "file", "job", "message")

    def __init__(self, file, code, message, job=None):
        self.file = file
        self.code = code
        self.message = message
        self.job = job

    def __repr__(self):
        where = f"{self.file}::{self.job}" if self.job else self.file
        return f"Finding({self.code} {where}: {self.message})"


def _get_on(doc):
    """Return the raw `on:` value, handling YAML 1.1 folding `on` -> boolean True."""
    if not isinstance(doc, dict):
        return None
    if "on" in doc:
        return doc["on"]
    if True in doc:  # `on:` was parsed as the boolean True
        return doc[True]
    return None


def _triggers(on_val):
    """The set of trigger names declared under `on:`, across all three shapes."""
    if on_val is None:
        return set()
    if isinstance(on_val, str):
        return {on_val}
    if isinstance(on_val, list):
        return {str(x) for x in on_val}
    if isinstance(on_val, dict):
        return {str(k) for k in on_val}
    return set()


def _concurrency_ok(doc):
    """(ok, why) for the top-level concurrency + cancel-in-progress requirement.

    A bare string concurrency (`concurrency: my-group`) has no cancel-in-progress and so
    does NOT satisfy the rule. A mapping must carry a truthy `cancel-in-progress`; an
    expression string there (`${{ ... }}`) is accepted since it cannot be evaluated
    statically and a report-only gate must not cry wolf on it.
    """
    conc = doc.get("concurrency", _MISSING)
    if conc is _MISSING or conc is None:
        return False, "no top-level `concurrency` group"
    if isinstance(conc, str):
        return False, "`concurrency` is a bare group with no `cancel-in-progress: true`"
    if isinstance(conc, dict):
        cip = conc.get("cancel-in-progress", _MISSING)
        if cip is True:
            return True, ""
        if isinstance(cip, str) and cip.strip().lower() not in ("false", "0", ""):
            return True, ""  # expression form — cannot evaluate, do not flag
        return False, "`concurrency.cancel-in-progress` is not `true`"
    return False, "`concurrency` is in an unrecognized form"


def _runs_on_finding(path, name, job):
    """A runs-on violation for a normal (non-reusable) job, or None."""
    ro = job.get("runs-on", _MISSING)
    if ro is _MISSING or ro is None or ro == "":
        return Finding(path, "missing-runs-on",
                       f"job `{name}` has no `runs-on`", job=name)
    if isinstance(ro, (list, dict)) and len(ro) == 0:
        return Finding(path, "missing-runs-on",
                       f"job `{name}` has an empty `runs-on`", job=name)
    if isinstance(ro, str) and ro.strip() == "self-hosted":
        return Finding(path, "invalid-runs-on-selfhosted",
                       f"job `{name}` uses bare `self-hosted`, which never matches an ARC "
                       "scale set (queues forever) — target the scale set by its name label",
                       job=name)
    if isinstance(ro, list) and any(str(x).strip() == "self-hosted" for x in ro):
        return Finding(path, "invalid-runs-on-selfhosted",
                       f"job `{name}` uses a `[self-hosted, ...]` label array, which never "
                       "matches an ARC scale set (queues forever) — target it by its name label",
                       job=name)
    return None


def analyze_doc(doc, path):
    """All findings for one parsed workflow document. Pure — no I/O."""
    findings = []
    if not isinstance(doc, dict):
        return [Finding(path, "unparseable", "workflow is not a YAML mapping")]

    jobs = doc.get("jobs")
    if isinstance(jobs, dict):
        for name, job in jobs.items():
            if not isinstance(job, dict):
                continue  # malformed job entry — nothing to check, do not crash
            if "uses" in job:
                # Reusable-workflow call: the CALLEE owns runs-on/timeout-minutes.
                continue
            ro = _runs_on_finding(path, name, job)
            if ro is not None:
                findings.append(ro)
            if "timeout-minutes" not in job:
                findings.append(Finding(
                    path, "missing-timeout",
                    f"job `{name}` has no `timeout-minutes` — a hung job becomes a zombie "
                    "runner pod that pins a scale-set slot until a human intervenes",
                    job=name))

    triggers = _triggers(_get_on(doc))
    if "pull_request" in triggers:
        ok, why = _concurrency_ok(doc)
        if not ok:
            findings.append(Finding(
                path, "missing-concurrency-cancel",
                f"workflow is `pull_request`-triggered but {why} — rapid pushes stack "
                "superseded runs onto the shared pool instead of cancelling them"))
    return findings


def analyze_text(text, path):
    """Parse workflow YAML text and return its findings. Never raises on bad YAML."""
    if yaml is None:
        return [Finding(path, "no-pyyaml", "PyYAML unavailable — cannot lint")]
    try:
        doc = yaml.safe_load(text)
    except yaml.YAMLError as e:
        first = str(e).splitlines()[0] if str(e) else e.__class__.__name__
        return [Finding(path, "unparseable", f"could not parse YAML: {first}")]
    return analyze_doc(doc, path)


def analyze_file(path):
    try:
        with open(path, encoding="utf-8") as f:
            text = f.read()
    except OSError as e:
        return [Finding(path, "unreadable", f"could not read file: {e}")]
    return analyze_text(text, path)


def scan_repo(root):
    """Findings across every workflow file under <root>/.github/workflows/."""
    wf_dir = os.path.join(root, ".github", "workflows")
    findings = []
    files = sorted(set(glob.glob(os.path.join(wf_dir, "*.yml")))
                   | set(glob.glob(os.path.join(wf_dir, "*.yaml"))))
    for path in files:
        findings.extend(analyze_file(path))
    return findings, files


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("root", nargs="?", default=".", help="repo root (default: .)")
    args = ap.parse_args(argv)

    findings, files = scan_repo(args.root)

    print(f"gate-workflow-policy: scanned {len(files)} workflow file(s) "
          f"under {os.path.join(args.root, '.github', 'workflows')}")
    for path in files:
        rel = os.path.relpath(path, args.root)
        hits = [f for f in findings if f.file == path]
        if not hits:
            print(f"  OK   {rel}")
            continue
        for f in hits:
            # GitHub annotation — file= makes it land on the workflow in the PR's Files tab.
            print(f"::warning file={rel},title=gate-workflow-policy [{f.code}]::{f.message}")
        print(f"  WARN {rel} ({len(hits)} finding(s))")

    total = len(findings)
    if total == 0:
        print("gate-workflow-policy: no findings — every job has a timeout + valid runs-on, "
              "and every PR-triggered workflow cancels in progress.")
    else:
        print(f"gate-workflow-policy: {total} finding(s) — REPORT-ONLY first pass, not "
              "gating. Fix these, then flip this gate to enforcing per-repo "
              "(remove the `|| true` in gate-workflow-policy.yml).")

    # REPORT-ONLY: always succeed. Visibility, not breakage — remove this when the repo
    # ratchets the gate to enforcing.
    return 0


if __name__ == "__main__":
    sys.exit(main())
