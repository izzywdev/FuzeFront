#!/usr/bin/env python3
"""gate-ds-conformance — design-system conformance gate (CLAUDE.baseline.md §6).

Two responsibilities:
  1. HARD FAIL on conformance violations in UI feature code (outside the DS package):
       - raw color literals: #hex, rgb()/rgba(), hsl()/hsla()
       - hard-coded spacing/sizing in px outside the token scale (e.g. padding/margin/gap/width: 12px)
       - raw font-size / font-family literals outside tokens
  2. EXTRACTION SIGNAL (does NOT fail the build): when a UI pattern recurs / is duplicated
     across feature files (the same ad-hoc styled block appears >= THRESHOLD times), it should
     become a DS primitive. With --emit-issues + a GH token, opens ONE idempotent GitHub issue
     per proposed component (label `ds-extraction` + a stable fingerprint marker), mentioning
     @claude, with locations + a proposed spec + acceptance criteria. Idempotent: it searches
     existing open+closed issues for the fingerprint marker and skips if present.

Scope: scans the UI feature dirs (default: frontend/, apps/, packages/ui*, src/) and EXCLUDES
the design-system package itself (design-system/, packages/design-system/, **/design-system/**)
where raw token *definitions* legitimately live.

Ratchet mode: with --changed-only, only violations on lines ADDED/MODIFIED by the current PR
(computed from `git diff --unified=0 <GATE_BASE_REF>...HEAD`, default base origin/master) are
reported. This blocks NEW raw-design values without failing on the pre-existing findings, and
needs no baseline file. If the diff can't be computed (no base), it falls back to a full scan.

Usage:
  gate_ds_conformance.py [root] [--changed-only] [--emit-issues] [--repo owner/name] [--threshold N]
Env: GATE_BASE_REF (changed-only base ref, default origin/master);
     GH_TOKEN or GITHUB_TOKEN + GITHUB_REPOSITORY (for issue creation).
Exit 0 = conforms (extraction issues are non-fatal); exit 1 = hard violation.
"""
from __future__ import annotations
import fnmatch
import hashlib
import json
import os
import re
import subprocess
import sys
from collections import defaultdict

UI_EXT = (".tsx", ".jsx", ".ts", ".js", ".vue", ".svelte", ".css", ".scss", ".less")
SCAN_DIRS = ["frontend", "apps", "src", "packages"]
# Any path containing one of these segments is the DS package itself — exclude from feature checks.
DS_EXCLUDE_SEGMENTS = ("design-system", "design_system", "ds-tokens", "tokens")
SKIP_DIRS = {".git", "node_modules", "dist", "build", ".venv", "vendor",
             "__pycache__", "coverage", ".next", "storybook-static", "__snapshots__"}
# Feature-path globs that are NOT hand-authored feature UI: config, type decls, contract-frozen
# generated stubs, and test files. Matched against the forward-slash relative path. These are
# skipped to cut false positives on the hard-fail path.
SKIP_FEATURE_GLOBS = (
    "*.config.*",
    "*.d.ts",
    "packages/*/src/*",   # contract-frozen generated client stubs
    "*.test.*",
    "*/__tests__/*",
)

HEX_RE = re.compile(r"#[0-9a-fA-F]{3,8}\b")
RGB_RE = re.compile(r"\brgba?\(", re.I)
HSL_RE = re.compile(r"\bhsla?\(", re.I)
# spacing/sizing px literals on layout properties (allow 0px / 1px hairline)
PX_PROP_RE = re.compile(
    r"\b(padding|margin|gap|width|height|top|left|right|bottom|font-size|line-height|border-radius)"
    r"[^\n;{}]*?:\s*(\d{2,})px",
    re.I,
)
# raw font-family string (not a var/token)
FONT_FAMILY_RE = re.compile(r"font-family\s*:\s*[\"']?[A-Za-z]", re.I)
# allow lines that clearly use a token/var
TOKEN_HINT_RE = re.compile(r"(var\(--|tokens?\.|theme\.|\$[a-z]|@apply|colors?\.|spacing\.|--ds-)", re.I)
DISABLE_RE = re.compile(r"ds-conformance[- ]?(disable|ignore|allow)", re.I)

# @@ -a,b +c,d @@  — capture the +c[,d] added-line range
HUNK_RE = re.compile(r"^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,(\d+))?\s+@@")


def _skip_feature_path(rel: str) -> bool:
    """True if the (forward-slash) relative path is config/type-decl/generated-stub/test — not
    hand-authored feature UI. Cuts false positives on the hard-fail path."""
    relf = rel.replace("\\", "/")
    return any(fnmatch.fnmatch(relf, g) for g in SKIP_FEATURE_GLOBS)


def _hex_is_color(line: str) -> bool:
    """True only if some #… token on the line has a hex LETTER (a-f). An all-decimal match like
    `#117` is almost always an issue/PR ref, not a CSS color — skip it (baseline heuristic)."""
    for m in HEX_RE.finditer(line):
        digits = m.group()[1:]
        if any(c in "abcdefABCDEF" for c in digits):
            return True
    return False


def _git_ui_files(root: str) -> list[str] | None:
    """Tracked UI files via git (fast, skips build/untracked noise). None if git unavailable."""
    try:
        res = subprocess.run(
            ["git", "-C", root, "ls-files"] + [f"*{e}" for e in UI_EXT] + [f"**/*{e}" for e in UI_EXT],
            capture_output=True, text=True, timeout=60,
        )
        if res.returncode == 0:
            return [p for p in res.stdout.splitlines() if p.strip()]
    except Exception:
        pass
    return None


def changed_lines(root: str, base_ref: str) -> dict[str, set[int]] | None:
    """Map of {forward-slash relpath -> {added/modified line numbers}} from
    `git diff --unified=0 <base_ref>...HEAD`. None if the diff can't be computed."""
    try:
        res = subprocess.run(
            ["git", "-C", root, "diff", "--unified=0", f"{base_ref}...HEAD"],
            capture_output=True, text=True, timeout=90,
        )
    except Exception as e:
        print(f"::warning title=gate-ds-conformance::changed-only diff failed to run: {e}")
        return None
    if res.returncode != 0:
        print(f"::warning title=gate-ds-conformance::changed-only diff error "
              f"(base '{base_ref}'): {res.stderr.strip()[:200]}")
        return None
    out: dict[str, set[int]] = defaultdict(set)
    cur: str | None = None
    for line in res.stdout.splitlines():
        if line.startswith("+++ "):
            p = line[4:].strip()
            if p == "/dev/null":
                cur = None
            else:
                cur = p[2:] if (p.startswith("a/") or p.startswith("b/")) else p
            continue
        if line.startswith("@@") and cur is not None:
            m = HUNK_RE.match(line)
            if not m:
                continue
            start = int(m.group(1))
            count = int(m.group(2)) if m.group(2) is not None else 1
            for ln in range(start, start + count):
                out[cur].add(ln)
    return dict(out)


def iter_ui_files(root: str):
    tracked = _git_ui_files(root)
    if tracked is not None:
        for rel in tracked:
            reln = rel.replace("\\", "/")
            top = reln.split("/", 1)[0]
            if SCAN_DIRS and top not in SCAN_DIRS:
                continue
            segs = reln.lower().split("/")
            if any(seg in DS_EXCLUDE_SEGMENTS for seg in segs):
                continue  # DS package — tokens defined here
            if any(seg in SKIP_DIRS for seg in segs):
                continue
            yield os.path.join(root, *reln.split("/"))
        return
    for base in SCAN_DIRS:
        start = os.path.join(root, base)
        if not os.path.isdir(start):
            continue
        for dirpath, dirnames, filenames in os.walk(start):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
            rel = os.path.relpath(dirpath, root).replace("\\", "/").lower()
            if any(seg in rel.split("/") for seg in DS_EXCLUDE_SEGMENTS):
                continue  # inside the DS package — tokens are defined here
            for fn in filenames:
                if fn.endswith(UI_EXT):
                    yield os.path.join(dirpath, fn)


def scan_violations(root: str, changed: dict[str, set[int]] | None = None) -> list[str]:
    """Scan feature UI for raw design values. When `changed` is provided (ratchet mode), only
    violations on added/modified (file,line) pairs are reported."""
    violations = []
    for path in iter_ui_files(root):
        rel = os.path.relpath(path, root)
        relf = rel.replace("\\", "/")
        if _skip_feature_path(relf):
            continue
        if changed is not None and relf not in changed:
            continue  # ratchet: file not touched by this PR
        try:
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                lines = f.readlines()
        except OSError:
            continue
        for i, line in enumerate(lines, 1):
            if changed is not None and i not in changed.get(relf, ()):
                continue  # ratchet: line not added/modified by this PR
            if DISABLE_RE.search(line):
                continue
            stripped = line.strip()
            if stripped.startswith(("//", "*", "/*", "#")):
                continue
            hits = []
            if _hex_is_color(line) and not TOKEN_HINT_RE.search(line):
                hits.append("raw hex color")
            if RGB_RE.search(line) and not TOKEN_HINT_RE.search(line):
                hits.append("raw rgb()/rgba()")
            if HSL_RE.search(line) and not TOKEN_HINT_RE.search(line):
                hits.append("raw hsl()/hsla()")
            if PX_PROP_RE.search(line) and not TOKEN_HINT_RE.search(line):
                hits.append("hard-coded px spacing/size outside token scale")
            if FONT_FAMILY_RE.search(line) and not TOKEN_HINT_RE.search(line):
                hits.append("raw font-family outside tokens")
            if hits:
                violations.append(f"{rel}:{i}: {', '.join(hits)} -> {stripped[:80]}")
    return violations


# ---- extraction-candidate detection (duplicate styled blocks) -------------------------

STYLED_BLOCK_RE = re.compile(r"(className=\{?[\"'`][^\"'`]{8,}[\"'`]|styled\.\w+`[^`]{20,}`)", re.S)


def normalize(block: str) -> str:
    # strip whitespace + numbers so "p-4" and "p-6" collapse to the same shape
    return re.sub(r"\d+", "#", re.sub(r"\s+", " ", block)).strip().lower()


def detect_extraction_candidates(root: str, threshold: int) -> dict[str, dict]:
    buckets: dict[str, list[str]] = defaultdict(list)
    samples: dict[str, str] = {}
    for path in iter_ui_files(root):
        if not path.endswith((".tsx", ".jsx", ".vue", ".svelte")):
            continue
        try:
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                text = f.read()
        except OSError:
            continue
        rel = os.path.relpath(path, root)
        for m in STYLED_BLOCK_RE.finditer(text):
            norm = normalize(m.group(0))
            if len(norm) < 12:
                continue
            line = text[: m.start()].count("\n") + 1
            buckets[norm].append(f"{rel}:{line}")
            samples.setdefault(norm, m.group(0)[:160])
    out = {}
    for norm, locs in buckets.items():
        uniq = sorted(set(locs))
        # recurring AND across >1 file = an extraction signal
        if len(uniq) >= threshold and len({l.split(":")[0] for l in uniq}) >= 2:
            fp = hashlib.sha1(norm.encode()).hexdigest()[:12]
            out[fp] = {"fingerprint": fp, "locations": uniq, "sample": samples[norm]}
    return out


def gh_issue_exists(repo: str, fp: str) -> bool:
    marker = f"ds-fp:{fp}"
    try:
        res = subprocess.run(
            ["gh", "issue", "list", "-R", repo, "--label", "ds-extraction",
             "--state", "all", "--search", marker, "--json", "number", "--limit", "50"],
            capture_output=True, text=True, timeout=60,
        )
        if res.returncode != 0:
            print(f"::warning title=gate-ds-conformance::gh issue list failed: {res.stderr.strip()}")
            return True  # fail safe: do NOT create a dup if we can't verify
        return bool(json.loads(res.stdout or "[]"))
    except Exception as e:
        print(f"::warning title=gate-ds-conformance::issue-search error: {e}")
        return True


def ensure_label(repo: str):
    subprocess.run(
        ["gh", "label", "create", "ds-extraction", "-R", repo,
         "--color", "5319e7", "--description", "Candidate UI pattern to extract into the design system"],
        capture_output=True, text=True,
    )


def open_extraction_issue(repo: str, cand: dict) -> str | None:
    fp = cand["fingerprint"]
    if gh_issue_exists(repo, fp):
        print(f"gate-ds-conformance: extraction issue for ds-fp:{fp} already exists — skipping (idempotent)")
        return None
    ensure_label(repo)
    locs = "\n".join(f"- `{l}`" for l in cand["locations"][:20])
    title = f"DS extraction: recurring UI pattern (ds-fp:{fp})"
    body = f"""@claude — `gate-ds-conformance` detected a UI pattern duplicated across the codebase that **should be extracted into a design-system primitive** (CLAUDE.baseline.md §6).

<!-- ds-fp:{fp} -->
**Stable marker:** `ds-fp:{fp}` (do not edit — used for idempotent de-duplication)

### Where it recurs
{locs}

### Sample
```
{cand["sample"]}
```

### Proposed component spec (refine before building)
- **Name:** `<PascalCaseComponent>` (in the repo design-system package — `frontend-engineer` is the sole owner of `design-system/`)
- **Props:** derive from the variation across the call sites above.
- **Variants:** the distinct visual variations seen at the locations.
- **States:** default / hover / focus / active / disabled / loading as applicable.
- **Tokens:** must consume DS tokens only (color/spacing/type/radius) — zero raw values.

### Acceptance criteria
- [ ] Component added to the design-system package (not one-off in feature code), tokens-only.
- [ ] All listed call sites refactored to use it.
- [ ] a11y + RTL covered; unit test in the DS package.
- [ ] `gate-ds-conformance` stays green after refactor.

_Filed automatically; owner is `frontend-engineer`. Extraction is design work, not done by this gate._
"""
    try:
        res = subprocess.run(
            ["gh", "issue", "create", "-R", repo, "--title", title,
             "--body", body, "--label", "ds-extraction"],
            capture_output=True, text=True, timeout=60,
        )
        if res.returncode == 0:
            url = res.stdout.strip().splitlines()[-1] if res.stdout.strip() else "(created)"
            print(f"gate-ds-conformance: opened extraction issue {url}")
            return url
        print(f"::warning title=gate-ds-conformance::gh issue create failed: {res.stderr.strip()}")
    except Exception as e:
        print(f"::warning title=gate-ds-conformance::issue-create error: {e}")
    return None


def main() -> int:
    args = sys.argv[1:]
    emit = "--emit-issues" in args
    changed_only = "--changed-only" in args
    args = [a for a in args if a not in ("--emit-issues", "--changed-only")]
    repo = None
    threshold = 3
    pos = []
    it = iter(args)
    for a in it:
        if a == "--repo":
            repo = next(it, None)
        elif a == "--threshold":
            threshold = int(next(it, "3"))
        else:
            pos.append(a)
    root = pos[0] if pos else "."
    repo = repo or os.environ.get("GITHUB_REPOSITORY")

    changed = None
    if changed_only:
        base_ref = os.environ.get("GATE_BASE_REF", "origin/master")
        changed = changed_lines(root, base_ref)
        if changed is None:
            print("::warning title=gate-ds-conformance::--changed-only requested but diff "
                  f"unavailable (base '{base_ref}') — falling back to FULL scan")
        else:
            touched = sum(len(v) for v in changed.values())
            print(f"gate-ds-conformance: changed-only ratchet vs '{base_ref}' — "
                  f"{len(changed)} file(s), {touched} added/modified line(s)")

    violations = scan_violations(root, changed)
    # extraction candidates are advisory — compute always, emit issues only when asked
    candidates = detect_extraction_candidates(root, threshold)
    if candidates:
        print(f"gate-ds-conformance: {len(candidates)} extraction candidate(s) detected (advisory).")
        if emit and repo and (os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")):
            for cand in candidates.values():
                open_extraction_issue(repo, cand)
        elif emit:
            print("::warning title=gate-ds-conformance::--emit-issues set but no repo/token — skipping issue creation")
        else:
            for fp, c in candidates.items():
                print(f"  - ds-fp:{fp} @ {', '.join(c['locations'][:5])}")

    if violations:
        scope = "changed lines" if changed is not None else "feature code"
        print(f"::error title=gate-ds-conformance::raw design values found in {scope} (use DS tokens)")
        for v in violations[:200]:
            print(f"  - {v}")
        print(f"\ngate-ds-conformance FAILED: {len(violations)} hard conformance violation(s) "
              "(CLAUDE.baseline.md §6). Use design-system tokens/components, not raw values.")
        return 1
    ok_scope = "changed lines" if changed is not None else "feature code"
    print(f"gate-ds-conformance: no raw design values in {ok_scope}. OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
