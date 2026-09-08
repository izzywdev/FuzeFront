#!/usr/bin/env python3
"""gate-workflow-yaml — every file in .github/workflows/ must be parseable YAML.

WHY THIS EXISTS. On 2026-09-08, #925 added a step named

    - name: Sync design-system into fuzefront-website (vendored file: dependency)

The unquoted colon in `file: dependency` makes YAML read the scalar as a nested
mapping, so `.github/workflows/release.yml` stopped parsing entirely. GitHub does
not report that as a failing job -- it schedules NO JOBS AT ALL. Release run 491
came back with zero jobs, and every image in this repo (backend, security,
notification, chat, billing, applications-service, clock-app, frontend, website)
was unable to release for ~2.5h until #984 quoted the name. Nothing went red.
The failure mode of a broken workflow file is SILENCE, which is precisely the
class of defect that needs a gate rather than review.

WHY NOT JUST FIX gate_required_checks.py, WHICH ALREADY PARSES THESE FILES.
It does parse them, and on a yaml.YAMLError it prints a `::warning::` and
`continue`s (see its load_workflows loop). So the repo already noticed #925's
break and downgraded it to a warning nobody read. That is worth fixing at the
source -- but that file is `mode: "managed"` in .fuze/installed.json, so
governance-sync reconciles it back to the FuzeSDLC canonical and a local edit is
reverted. The upstream fix belongs in FuzeSDLC. This repo-local gate closes the
hole today without fighting governance, and stays correct if the upstream fix
lands too: both would fail on the same input.

DELIBERATELY NOT A SCHEMA CHECK OR actionlint. The only claim made here is "this
file parses" -- exactly the property whose absence produces silence instead of a
red run. A broader linter is a larger change with its own false-positive budget
and is not a prerequisite for closing this.

ANTI-VACUITY. Finding zero workflow files is a FAILURE, not a pass. This repo has
~80, so an empty scan means the path is wrong and the gate is checking nothing --
the exact shape of a green check that verifies nothing.
"""
from __future__ import annotations

import os
import sys

import yaml

WORKFLOW_DIR = ".github/workflows"


def find_workflow_files(directory: str) -> list[str]:
    """Workflow filenames in `directory`, sorted. Non-YAML files are ignored."""
    return sorted(
        f for f in os.listdir(directory) if f.endswith(".yml") or f.endswith(".yaml")
    )


def parse_failures(directory: str, files: list[str]) -> list[tuple[str, str]]:
    """(path, one-line reason) for every file that does not parse."""
    failures = []
    for name in files:
        path = os.path.join(directory, name)
        try:
            with open(path, encoding="utf-8") as fh:
                yaml.safe_load(fh.read())
        except yaml.YAMLError as exc:
            reason = " ".join(str(exc).split())
            failures.append((path, reason))
    return failures


def main(argv: list[str]) -> int:
    directory = argv[1] if len(argv) > 1 else WORKFLOW_DIR

    try:
        files = find_workflow_files(directory)
    except OSError as exc:
        print(f"::error title=gate-workflow-yaml::cannot read {directory}: {exc}")
        return 1

    if not files:
        print(
            f"::error title=gate-workflow-yaml::found ZERO workflow files in "
            f"{directory} — this repo has many, so the gate scanned nothing and "
            f"must not report success"
        )
        return 1

    failures = parse_failures(directory, files)
    for path, reason in failures:
        print(
            f"::error title=gate-workflow-yaml,file={path}::{path} is not "
            f"parseable YAML: {reason}. GitHub schedules NO JOBS for an "
            f"unparseable workflow — it fails silently, which is why this is a "
            f"hard error. A colon inside an unquoted step name is the usual "
            f"cause; quote the name."
        )

    print(
        f"gate-workflow-yaml: parsed {len(files)} workflow file(s), "
        f"{len(failures)} unparseable."
    )
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
