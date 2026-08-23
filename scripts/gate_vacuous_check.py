#!/usr/bin/env python3
"""gate-vacuous-check — forbid a verification step that can never fail.

WHY THIS EXISTS. `|| true` (and `continue-on-error: true`) are legitimate in a lot of
places — but the fleet accumulated a specific defect shape hiding behind the same
syntax: a step whose whole PURPOSE is to gate (lint / type-check / test / security scan)
suffixed so it can never fail the job. Same family as `gate-authz`'s bare `|| true`, the
`[extend]`-less gitleaks config that scanned nothing, and
`safety check --output safety-report.json || true`, which failed on a USAGE ERROR for
its entire life while the suffix hid it. Every one of them was "green" and none of them
was checking anything.

THE DISTINCTION THIS GATE MUST ENCODE (do not blunt it — most `|| true` is fine):
  * diagnostic log dumps in failure handlers        (`kubectl logs ... || true`)
  * teardown / cleanup                               (`kill $PID || true`, `... prune -f || true`)
  * command substitution where empty is a valid answer
        `x=$(grep ... || true)`                      — required under `set -e -o pipefail`
  * RECORD-THEN-GATE, which is GOOD practice: an unfiltered report run suffixed `|| true`
    that writes an artifact, followed by a *later, bare* enforcing run of the same tool in
    the same job. `bandit -r . -f json -o bandit-report.json || true` then a bare
    `bandit -r . --skip B101 -f txt` is the shape to preserve, not flag.

THE DEFECT this gate targets is narrower than "contains `|| true`": a step whose LAST
EFFECTIVE COMMAND is a verification tool suffixed `|| true`, with no later bare
invocation of that same tool anywhere in the job — and the equivalent for
`continue-on-error: true` on a step/job that exists to gate.

TWO MODES, AND IT ALWAYS SAYS WHICH. `PyYAML` gives exact job/step boundaries and
therefore an exact record-then-gate search scoped to "the rest of this job". Without it,
this script falls back to an INDENTATION-STRUCTURAL scan of the raw workflow text —
genuinely weaker (its record-then-gate search is whole-file, not job-scoped, so it can
occasionally miss a same-named tool used for an unrelated purpose in another job and
wrongly call something record-then-gate) — and it prints that it did. A degraded run
that looks identical to a clean one is how every vacuous gate in this repo got that way;
see gate_manifest.py for the same convention.

RATCHET (governance/vacuous-check-policy.json), same shape as
governance/frames-first-policy.json: an allowlist entry needs `file`, `match`, `reason`,
`owner`. CRITICALLY: a MISSING policy file is NOT "no policy configured" — it is treated
as `{"mode": "fail", "allowlist": []}`, the strictest posture there is. Deleting the
policy file must never be a way to silence this gate; only editing it down to an empty
allowlist under `mode: "fail"` has that effect, and that edit is a reviewable diff.
`mode: "ramp"` is the only mode in which allowlist entries actually suppress a finding;
`mode: "fail"` (including the missing-file default) ignores the allowlist entirely and
fails on every finding, so downgrading the policy's own `mode` back to `fail` is how you
prove a ratchet is fully retired.

Usage: gate_vacuous_check.py [root] [--policy path]
Exit 0 = clean, 1 = violation(s) found and not allowlisted under mode=ramp.
"""
from __future__ import annotations

import json
import os
import re
import sys

try:
    import yaml  # type: ignore
except ImportError:
    yaml = None

PRUNE_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv", "dist", "build"}
POLICY_REL = os.path.join("governance", "vacuous-check-policy.json")
WORKFLOW_DIR = os.path.join(".github", "workflows")

# Tools whose invocation is a *verification* step: lint / type-check / test / security /
# audit / schema-validate. Matched as a whole word/phrase, case-insensitive. Deliberately
# NOT "any command" — a build or install step suffixed `|| true` is a different question
# this gate does not answer.
CHECK_TOOL_RE = re.compile(
    r"\b("
    r"pytest|py\.test|mypy|black|isort|flake8|pylint|ruff|bandit|safety|pip-audit|"
    r"eslint|tsc|jest|vitest|cypress|playwright\s+test|"
    r"kubeconform|helm\s+lint|helm\s+template\s+--validate|"
    r"terraform\s+validate|tflint|checkov|trivy|semgrep|gitleaks|snyk|kubescape|"
    r"conftest|opa\s+test|golangci-lint|shellcheck|actionlint|hadolint|yamllint|"
    r"npm\s+audit|yarn\s+audit|pnpm\s+audit|"
    r"npm\s+run\s+(?:test|lint|typecheck|type-check)|"
    r"go\s+vet|go\s+test|cargo\s+test|cargo\s+clippy|"
    r"gate_[a-z_]+\.py|check-[a-z-]+\.mjs"
    r")\b",
    re.IGNORECASE,
)

# Presence of any of these anywhere on the line marks it diagnostic/teardown, never a
# gating check, regardless of whether a CHECK_TOOL token also appears.
DIAGNOSTIC_RE = re.compile(
    r"\b("
    r"kubectl\s+logs|kubectl\s+describe|kubectl\s+get\s+events|kubectl\s+top|"
    r"docker\s+logs|docker\s+system\s+prune|docker\s+compose\s+down|"
    r"docker-compose\s+down|compose\s+down|kill\s+[$]|pkill|"
    r"docker\s+rm|docker\s+stop|rm\s+-rf|rm\s+-f\b"
    r")\b",
    re.IGNORECASE,
)

# `|| true` that is inside a `$( ... )` command substitution rather than at the tail of
# the whole shell statement — e.g. `x=$(grep foo bar || true)`. The suffix there is
# required under `set -e -o pipefail` so an empty match doesn't blow up the script; it is
# not gating anything.
INLINE_SUBST_RE = re.compile(r"\|\|\s*true\s*\)")

TRAILING_TRUE_RE = re.compile(r"\|\|\s*true\s*;?\s*(#.*)?$")

SARIF_EXEMPT_RE = re.compile(r"sarif|code-scanning|report-only", re.IGNORECASE)

# A tool name appearing as the ARGUMENT to a package-manager install command is not an
# invocation of that tool — `pip install pytest pytest-benchmark` mentions "pytest" but
# never runs it. Measured false negative: without this guard, a standalone
# performance-tests job whose ONLY pytest invocation was
# `pytest ... --benchmark-only || true` was wrongly exempted as "record-then-gate"
# because an EARLIER `pip install pytest pytest-benchmark` line in the same job also
# contains the word "pytest". Applied both when picking the tool token off the last
# effective line and when searching for a later bare invocation, so an install line can
# never itself satisfy either.
INSTALL_LINE_RE = re.compile(
    r"\b(pip3?|npm|yarn|pnpm|apt(?:-get)?|brew|conda|gem)\s+(?:install|add|ci)\b",
    re.IGNORECASE,
)


def _tool_token(line: str) -> str | None:
    if INSTALL_LINE_RE.search(line):
        return None
    m = CHECK_TOOL_RE.search(line)
    return m.group(1).lower() if m else None


def _tool_phrase_re(tool: str) -> re.Pattern:
    """Build a bare-invocation regex from the FULL tool phrase, not just its first
    word. Using only `tool.split()[0]` let a two-word tool's bare-invocation search
    false-positive on any OTHER command sharing that first word — e.g. a `tool="npm
    audit"` finding would count an unrelated `npm run build` line elsewhere in the same
    job as its enforcing sibling, because both merely contain "npm". Matching the whole
    phrase (spaces tolerant of extra whitespace) is precise the same way CHECK_TOOL_RE
    itself is."""
    words = [re.escape(w) for w in tool.split()]
    return re.compile(r"(?<![\w./-])" + r"\s+".join(words) + r"(?![\w-])", re.IGNORECASE)


def _is_diagnostic_or_teardown(line: str) -> bool:
    return bool(DIAGNOSTIC_RE.search(line))


def _is_inline_substitution(line: str) -> bool:
    return bool(INLINE_SUBST_RE.search(line))


def _last_effective_line(run_text: str) -> str | None:
    lines = [l for l in run_text.splitlines() if l.strip() and not l.strip().startswith("#")]
    return lines[-1] if lines else None


# ---------------------------------------------------------------------------
# File discovery — tracked files via `git ls-files`, pruned os.walk fallback.
# Same convention as scripts/gate_identifier.py / scripts/gate_pagination.py.
# ---------------------------------------------------------------------------

def _workflow_files(root: str) -> list[str]:
    import subprocess

    wf_dir = os.path.join(root, WORKFLOW_DIR)
    try:
        res = subprocess.run(
            ["git", "-C", root, "ls-files", "--", os.path.join(WORKFLOW_DIR, "*.yml"),
             os.path.join(WORKFLOW_DIR, "*.yaml")],
            capture_output=True, text=True, timeout=60,
        )
        if res.returncode == 0 and res.stdout.strip():
            return sorted(os.path.join(root, p) for p in res.stdout.splitlines() if p.strip())
    except Exception:
        pass
    if not os.path.isdir(wf_dir):
        return []
    return sorted(
        os.path.join(wf_dir, fn) for fn in os.listdir(wf_dir)
        if fn.endswith((".yml", ".yaml"))
    )


# ---------------------------------------------------------------------------
# MODE A — full structural analysis via PyYAML. Exact job/step boundaries.
# ---------------------------------------------------------------------------

def _find_all_run_texts(job: dict) -> list[tuple[str, bool]]:
    """Every step's run text in a job, in order, as (text, continue_on_error)."""
    out = []
    for step in job.get("steps") or []:
        if not isinstance(step, dict):
            continue
        run = step.get("run")
        if isinstance(run, str):
            coe = bool(step.get("continue-on-error"))
            out.append((run, coe))
    return out


def _analyze_yaml(path: str, text: str) -> list[dict]:
    findings: list[dict] = []
    try:
        doc = yaml.safe_load(text)
    except Exception as err:  # malformed YAML — report, don't crash the whole gate
        findings.append({
            "file": path, "kind": "parse-error", "detail": str(err),
            "match": "", "fatal": False,
        })
        return findings
    if not isinstance(doc, dict):
        return findings

    jobs = doc.get("jobs") or {}
    if not isinstance(jobs, dict):
        return findings

    for job_id, job in jobs.items():
        if not isinstance(job, dict):
            continue
        job_continue = bool(job.get("continue-on-error"))
        steps = job.get("steps") or []
        if not isinstance(steps, list):
            continue

        # Pre-scan every run text in the job for a later BARE invocation of each tool —
        # this is the record-then-gate exemption, scoped correctly because we have real
        # job boundaries here.
        all_runs = _find_all_run_texts(job)

        for i, step in enumerate(steps):
            if not isinstance(step, dict):
                continue
            run = step.get("run")
            step_coe = bool(step.get("continue-on-error")) or job_continue
            name = step.get("name") or step.get("id") or f"step[{i}]"

            if isinstance(run, str):
                last = _last_effective_line(run)
                if last and TRAILING_TRUE_RE.search(last) and not _is_inline_substitution(last):
                    if not _is_diagnostic_or_teardown(last):
                        tool = _tool_token(last)
                        if tool:
                            if _has_later_bare_invocation(all_runs, run, tool):
                                continue
                            findings.append({
                                "file": path, "kind": "trailing-or-true", "job": job_id,
                                "step": name, "tool": tool, "match": last.strip(),
                                "fatal": True,
                            })

            # continue-on-error on a step/job whose run text is itself a gating check.
            if step_coe and isinstance(run, str):
                tool = None
                matched_line = None
                for line in run.splitlines():
                    if _is_diagnostic_or_teardown(line):
                        continue
                    tool = _tool_token(line)
                    if tool:
                        matched_line = line.strip()
                        break
                if tool and not SARIF_EXEMPT_RE.search(run) and not SARIF_EXEMPT_RE.search(str(name)):
                    findings.append({
                        "file": path, "kind": "continue-on-error", "job": job_id,
                        "step": name, "tool": tool,
                        # Includes the actual matched command line (not just the
                        # continue-on-error descriptor) so a ratchet allowlist entry can
                        # key off the real command text, same as a trailing-or-true
                        # finding's `match` — otherwise an allowlist entry written
                        # against the command never matches a continue-on-error finding.
                        "match": f"{matched_line} — continue-on-error: true (job={job_continue}, step={bool(step.get('continue-on-error'))})",
                        "fatal": True,
                    })
    return findings


def _has_later_bare_invocation(all_runs: list[tuple[str, bool]], this_run: str, tool: str) -> bool:
    """True if some OTHER run text in the same job invokes `tool` without a trailing
    `|| true` on the line that invokes it — the record-then-gate enforcing step."""
    bare_re = _tool_phrase_re(tool)
    for run_text, _coe in all_runs:
        if run_text is this_run:
            continue
        for line in run_text.splitlines():
            if INSTALL_LINE_RE.search(line):
                continue  # mentions the tool as an install argument, not an invocation
            if not bare_re.search(line):
                continue
            if TRAILING_TRUE_RE.search(line) and not _is_inline_substitution(line):
                continue  # also suffixed — not the enforcing run
            return True
    return False


# ---------------------------------------------------------------------------
# MODE B — structural fallback (no PyYAML). Indentation-based `run:` block
# extraction; record-then-gate search is WHOLE-FILE, not job-scoped (weaker,
# and we say so).
# ---------------------------------------------------------------------------

RUN_KEY_RE = re.compile(r"^(\s*)run:\s*(\|[+-]?|>[+-]?)?\s*(.*)$")
STEP_MARKER_RE = re.compile(r"^(\s*)-\s")
COE_RE = re.compile(r"continue-on-error:\s*true\b")
NAME_RE = re.compile(r"^\s*name:\s*(.*)$")


def _extract_run_blocks_fallback(text: str) -> list[dict]:
    lines = text.splitlines()
    blocks = []
    i = 0
    while i < len(lines):
        m = RUN_KEY_RE.match(lines[i])
        if not m:
            i += 1
            continue
        indent = len(m.group(1))
        is_block_scalar = m.group(2) is not None
        block_lines = []
        if is_block_scalar:
            j = i + 1
            while j < len(lines):
                line = lines[j]
                if line.strip() == "":
                    block_lines.append(line)
                    j += 1
                    continue
                this_indent = len(line) - len(line.lstrip(" "))
                if this_indent <= indent:
                    break
                block_lines.append(line)
                j += 1
            end = j
        else:
            block_lines = [m.group(3)]
            end = i + 1

        # Look backward for this step's nearest preceding "- " marker at <= indent, and
        # collect name:/continue-on-error: lines between that marker and the run key.
        step_start = 0
        for k in range(i - 1, -1, -1):
            sm = STEP_MARKER_RE.match(lines[k])
            if sm and len(sm.group(1)) < indent:
                step_start = k
                break
        header = "\n".join(lines[step_start:i])
        name_m = NAME_RE.search(header)
        step_coe = bool(COE_RE.search(header))
        # continue-on-error can also trail the run block within the same step.
        tail_scan_end = min(end + 6, len(lines))
        trailer = "\n".join(lines[end:tail_scan_end])
        if not step_coe:
            # only counts if still inside the same step (no new "- " at <= indent before it)
            for l in lines[end:tail_scan_end]:
                sm = STEP_MARKER_RE.match(l)
                if sm and len(sm.group(1)) <= indent - 2:
                    break
                if COE_RE.search(l):
                    step_coe = True
                    break

        blocks.append({
            "run": "\n".join(block_lines),
            "name": name_m.group(1).strip() if name_m else f"line {i + 1}",
            "continue_on_error": step_coe,
            "line": i + 1,
        })
        i = end
    return blocks


def _analyze_fallback(path: str, text: str) -> list[dict]:
    findings: list[dict] = []
    blocks = _extract_run_blocks_fallback(text)
    all_run_texts = [b["run"] for b in blocks]

    for b in blocks:
        run = b["run"]
        last = _last_effective_line(run)
        if last and TRAILING_TRUE_RE.search(last) and not _is_inline_substitution(last):
            if not _is_diagnostic_or_teardown(last):
                tool = _tool_token(last)
                if tool:
                    bare_re = _tool_phrase_re(tool)
                    later_bare = False
                    for other in all_run_texts:
                        if other is run:
                            continue
                        for line in other.splitlines():
                            if INSTALL_LINE_RE.search(line):
                                continue
                            if bare_re.search(line) and not (
                                TRAILING_TRUE_RE.search(line) and not _is_inline_substitution(line)
                            ):
                                later_bare = True
                                break
                        if later_bare:
                            break
                    if not later_bare:
                        findings.append({
                            "file": path, "kind": "trailing-or-true", "job": "?",
                            "step": b["name"], "tool": tool, "match": last.strip(),
                            "fatal": True,
                        })

        if b["continue_on_error"]:
            tool = None
            matched_line = None
            for line in run.splitlines():
                if _is_diagnostic_or_teardown(line):
                    continue
                tool = _tool_token(line)
                if tool:
                    matched_line = line.strip()
                    break
            if tool and not SARIF_EXEMPT_RE.search(run) and not SARIF_EXEMPT_RE.search(b["name"]):
                findings.append({
                    "file": path, "kind": "continue-on-error", "job": "?",
                    "step": b["name"], "tool": tool,
                    "match": f"{matched_line} — continue-on-error: true", "fatal": True,
                })
    return findings


# ---------------------------------------------------------------------------
# Ratchet / allowlist
# ---------------------------------------------------------------------------

def _load_policy(root: str, override: str | None):
    path = override or os.path.join(root, POLICY_REL)
    if not os.path.isfile(path):
        # Missing file => strictest posture. NEVER treat this as "no policy configured,
        # skip". Deleting the file must never silence the gate.
        return {"mode": "fail", "allowlist": []}, None
    with open(path, encoding="utf-8") as f:
        policy = json.load(f)
    policy.setdefault("mode", "fail")
    policy.setdefault("allowlist", [])
    return policy, path


def _rel(root: str, path: str) -> str:
    return os.path.relpath(path, root).replace("\\", "/")


def _allowlisted(finding: dict, root: str, policy: dict) -> dict | None:
    if policy.get("mode") != "ramp":
        return None
    rel = _rel(root, finding["file"])
    for entry in policy.get("allowlist", []):
        if entry.get("file") != rel:
            continue
        match = entry.get("match", "")
        if match and match not in finding.get("match", "") and match not in finding.get("step", ""):
            continue
        if not entry.get("reason") or not entry.get("owner"):
            continue  # an allowlist entry with no reason/owner is not honored
        return entry
    return None


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main(argv: list[str]) -> int:
    args = [a for a in argv[1:] if not a.startswith("--")]
    flags = dict()
    rest = argv[1:]
    i = 0
    policy_override = None
    while i < len(rest):
        if rest[i] == "--policy" and i + 1 < len(rest):
            policy_override = rest[i + 1]
            i += 2
            continue
        i += 1

    root = args[0] if args else "."
    mode = "full (PyYAML)" if yaml is not None else "STRUCTURAL FALLBACK — PyYAML not installed"
    print(f"gate-vacuous-check: mode={mode}")
    if yaml is None:
        print(
            "gate-vacuous-check: NOTE — record-then-gate exemption is WHOLE-FILE, not "
            "job-scoped, in this mode. Install pyyaml (pip install -q pyyaml) for exact "
            "job-boundary analysis."
        )

    files = _workflow_files(root)
    if not files:
        print(f"gate-vacuous-check: no workflows under {WORKFLOW_DIR} — nothing to check.")
        return 0

    policy, policy_path = _load_policy(root, policy_override)
    print(
        f"gate-vacuous-check: policy={_rel(root, policy_path) if policy_path else '(none found — implicit mode=fail, empty allowlist)'} "
        f"mode={policy.get('mode')}"
    )

    all_findings: list[dict] = []
    for path in files:
        try:
            with open(path, encoding="utf-8", errors="ignore") as f:
                text = f.read()
        except OSError as err:
            print(f"gate-vacuous-check: cannot read {path}: {err}", file=sys.stderr)
            continue
        if yaml is not None:
            findings = _analyze_yaml(path, text)
        else:
            findings = _analyze_fallback(path, text)
        all_findings.extend(findings)

    real_violations = []
    allowlisted = []
    parse_errors = []
    for f in all_findings:
        if f.get("kind") == "parse-error":
            parse_errors.append(f)
            continue
        entry = _allowlisted(f, root, policy)
        if entry:
            allowlisted.append((f, entry))
        else:
            real_violations.append(f)

    if parse_errors:
        print(f"\ngate-vacuous-check: {len(parse_errors)} workflow(s) could not be parsed:")
        for f in parse_errors:
            print(f"  ! {_rel(root, f['file'])}: {f['detail']}")

    if allowlisted:
        print(f"\ngate-vacuous-check: {len(allowlisted)} finding(s) ALLOWLISTED (mode=ramp):")
        for f, entry in allowlisted:
            print(
                f"  ~ {_rel(root, f['file'])} [{f['job']}/{f['step']}] {f['kind']} "
                f"({f['tool']}): {f['match']!r} — reason: {entry['reason']} (owner: {entry['owner']})"
            )

    if real_violations:
        print(f"\ngate-vacuous-check: {len(real_violations)} violation(s)\n")
        for f in real_violations:
            print(
                f"  ✗ {_rel(root, f['file'])} [{f['job']}/{f['step']}] "
                f"last-effective-command is '{f['tool']}' guarded by {f['kind']}: {f['match']!r}"
            )
        print(
            "\nA verification step must be able to fail. If this IS a diagnostic/teardown "
            "command, it should not match a check-tool pattern — file a false-positive "
            "against gate_vacuous_check.py. If it is a genuine pre-existing finding being "
            "ramped down, add it to governance/vacuous-check-policy.json's allowlist with a "
            "reason and an owner and set policy.mode to \"ramp\". Otherwise: make the step "
            "enforcing, or convert it to record-then-gate (report run suffixed || true, "
            "followed by a bare enforcing run of the same tool later in the same job)."
        )
        return 1

    print("gate-vacuous-check: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
