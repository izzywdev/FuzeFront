#!/usr/bin/env python3
"""Merge-when-green watchdog — finish the auto-merges GitHub armed but stalled.

WHY THIS EXISTS
===============
`gh pr merge --auto` (auto-merge.yml) arms GitHub's native auto-merge, which is
supposed to merge the PR the moment its required checks pass. Usually it does.
But it is observably not reliable: PR #1566 sat at `mergeable_state: blocked`
for an hour with `mergeable: true`, every one of the 11 ruleset-required checks
green, the branch up to date, and auto-merge armed — and GitHub never fired the
merge. It had to be merged by hand via the REST endpoint. (#1603, armed the same
way minutes later, auto-merged fine — so the stall is INTERMITTENT, which is
worse than a hard failure: it leaves a green, ready, opted-in PR hanging
silently and indefinitely, defeating "nothing manual".)

This watchdog is the belt to auto-merge.yml's suspenders. Every 15 minutes it
asks one question per candidate PR: *was GitHub already going to merge this, and
is it now genuinely ready?* If yes, it performs the merge GitHub didn't.

BLAST RADIUS IS DELIBERATELY TINY. A PR is a candidate ONLY if ALL hold:
  * it is OPEN and NOT a draft;
  * it carries the `auto-merge` label (the explicit opt-in this family uses) and
    none of `wip` / `hold` / `blocked`;
  * GitHub's native auto-merge is ARMED on it (`auto_merge != null`) — so the
    watchdog only ever COMPLETES an intent that already existed; it never
    originates a merge, and cannot merge a PR nobody set to auto-merge;
  * it is conflict-free (`mergeable == true`) and NOT behind its base (the
    ruleset's strict up-to-date policy);
  * EVERY ruleset-required status check has a green run on the current head.

The required set is read LIVE from the branch ruleset, never hardcoded — a
hardcoded list drifts the instant someone edits the ruleset, and a watchdog that
merges against a stale idea of "required" is the exact vacuous-gate failure this
codebase keeps relearning. If the ruleset cannot be read, or names no required
checks, the watchdog REFUSES (non-zero exit) rather than merge against an empty
requirement — merging "when nothing is required" would merge anything.

The REST merge re-enforces the ruleset SERVER-SIDE, so even if the readiness
check here were wrong, GitHub rejects a merge that violates a gate: the local
check is an optimisation (don't hammer the endpoint, log a clear reason), not
the security boundary.

ATTRIBUTION MATTERS FOR SHIPPING. The merge must be attributed to the fuze-agent
App, not GITHUB_TOKEN: auto-merge.yml's `dispatch-release` job runs on the
`pull_request: closed` event, and GitHub starts NO workflow runs for events a
GITHUB_TOKEN action produced. A GITHUB_TOKEN-performed merge would therefore
merge green and ship nothing — the #400 failure. So the WORKFLOW mints an App
token and passes it in GH_TOKEN; this script is token-agnostic and merges with
whatever GH_TOKEN it is given. When only GITHUB_TOKEN is available (no App
creds), it still merges but warns that the release dispatch will not fire —
same stance auto-merge.yml takes for its GITHUB_TOKEN fallback.

The watchdog runs on ubuntu-latest, off the ARC fleet, for the same reason
ci-queue-watch does: a sweep that cannot reach the API must FAIL LOUD, not queue
behind the very backlog it is meant to clear.
"""
import argparse
import datetime
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

# Overridable so the self-tests can point discovery at a dead port and stay
# hermetic — they must never depend on live GitHub state.
API = os.environ.get("MERGE_WHEN_GREEN_API", "https://api.github.com")
NOW = datetime.datetime.now(datetime.timezone.utc)

# urllib speaks file://, ftp:// and more, so an unchecked base URL is an
# arbitrary-file read waiting to happen — MERGE_WHEN_GREEN_API is an env var, and
# env vars get set by things other than the person reading this. The scheme is
# checked at the one place every request funnels through.
_ALLOWED_SCHEMES = ("http", "https")

# Repo full names are interpolated into request paths. They arrive from args/API
# rather than a user, but "it came from an API" is the assumption that makes
# traversal bugs, so the shape is enforced instead of assumed.
_REPO_RE = re.compile(r"^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$")

# Labels that mean "not ready to merge no matter how green" — mirrors the
# branch-lifecycle DRAFT-BLOCKED states in CLAUDE.md.
_HOLD_LABELS = {"wip", "hold", "blocked", "do-not-merge", "dont-merge"}
_OPT_IN_LABEL = "auto-merge"


class Blind(Exception):
    """Raised when the watchdog cannot see the state it needs to decide safely.

    Surfacing this as a non-zero exit is the whole point: a merge watchdog that
    silently sees nothing must not silently conclude "nothing to merge"."""


def _valid_repo(full):
    return bool(_REPO_RE.match(full or ""))


def _req(method, path, token, body=None):
    """One HTTP call. Returns (parsed_json_or_None, error_or_None, status).

    Never raises for an HTTP error status — the caller decides whether a given
    status is fatal (can't-see-state → Blind) or expected (405 = not mergeable
    yet, skip). Raises only for a refused scheme, which is a misconfiguration.
    """
    url = f"{API}{path}"
    scheme = urllib.parse.urlsplit(url).scheme.lower()
    if scheme not in _ALLOWED_SCHEMES:
        raise Blind(f"refusing non-HTTP scheme {scheme!r} for {url!r}")
    data = json.dumps(body).encode() if body is not None else None
    headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "merge-when-green-watchdog",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode() or "null"
            return json.loads(raw), None, resp.status
    except urllib.error.HTTPError as e:
        detail = ""
        try:
            detail = e.read().decode()[:400]
        except (OSError, ValueError):
            detail = ""  # best-effort diagnostic; body may be unreadable
        return None, f"HTTP {e.code} on {method} {path}: {detail}", e.code
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        return None, f"network error on {method} {path}: {e}", None


def _get_all(path, token):
    """GET with page-number pagination until a short page. Returns a list.

    Raises Blind on the FIRST page failing — a watchdog that reads page 1 and
    silently drops the rest would under-count checks (or PRs) and could merge a
    PR whose red check happened to live on page 2."""
    out = []
    page = 1
    sep = "&" if "?" in path else "?"
    while True:
        j, err, _ = _req("GET", f"{path}{sep}per_page=100&page={page}", token)
        if err is not None:
            raise Blind(err)
        # Endpoints return either a bare list (pulls) or an object with a list
        # field (check-runs: {"check_runs": [...]}).
        if isinstance(j, dict):
            items = j.get("check_runs") or j.get("workflow_runs") or []
        else:
            items = j or []
        out.extend(items)
        if len(items) < 100:
            return out
        page += 1
        if page > 50:  # 5000 items — nothing here is ever that large; bail loud.
            raise Blind(f"pagination runaway on {path}")


def required_contexts(repo, branch, token):
    """The branch ruleset's required status-check contexts, read live.

    Blind if the ruleset can't be read OR names no required checks: merging
    against an empty requirement is the vacuous-merge failure."""
    b = urllib.parse.quote(branch, safe="")
    j, err, _ = _req("GET", f"/repos/{repo}/rules/branches/{b}", token)
    if err is not None:
        raise Blind(f"cannot read branch ruleset for {repo}@{branch}: {err}")
    contexts = set()
    for rule in j or []:
        if rule.get("type") == "required_status_checks":
            for c in rule.get("parameters", {}).get("required_status_checks", []):
                ctx = c.get("context")
                if ctx:
                    contexts.add(ctx)
    if not contexts:
        raise Blind(
            f"{repo}@{branch} ruleset names no required status checks — refusing "
            f"to merge against an empty requirement set (a merge 'when nothing is "
            f"required' would merge anything)."
        )
    return contexts


def head_checks_green(repo, head_sha, needed, token):
    """True iff every needed context has >=1 success run and 0 non-success runs
    on head_sha. Returns (ok, reason)."""
    runs = _get_all(f"/repos/{repo}/commits/{head_sha}/check-runs", token)
    by_name = {}
    for r in runs:
        by_name.setdefault(r.get("name"), []).append(r.get("conclusion"))
    missing, bad = [], []
    for ctx in sorted(needed):
        concs = by_name.get(ctx)
        if not concs:
            missing.append(ctx)
            continue
        # Conservative: ANY run for a required name that is not success (red,
        # cancelled, timed_out, or still pending → conclusion null) blocks.
        if any(c != "success" for c in concs):
            bad.append(f"{ctx}={[c or 'pending' for c in concs]}")
    if missing:
        return False, f"required checks with no run on head: {missing}"
    if bad:
        return False, f"required checks not green: {bad}"
    return True, "all required checks green"


def is_behind(repo, base_ref, head_sha, token):
    """True iff head is behind base (strict up-to-date policy would block).
    Returns (behind, reason)."""
    base = urllib.parse.quote(base_ref, safe="")
    j, err, _ = _req("GET", f"/repos/{repo}/compare/{base}...{head_sha}", token)
    if err is not None:
        raise Blind(f"cannot compare {base_ref}...{head_sha}: {err}")
    behind_by = (j or {}).get("behind_by", 0)
    return behind_by > 0, f"behind_by={behind_by}"


def _label_disqualifier(labels):
    """Return a reason string if these labels disqualify the PR, else ''.

    The opt-in and hold labels are the ONLY thing enforcing operator intent —
    GitHub's ruleset does not gate merges on labels — so this predicate is the
    boundary, not a convenience. It is applied to the cheap list response AND
    re-applied to the freshly-fetched PR in evaluate(), because the labels can
    change in the window between the two (see evaluate())."""
    names = {l.get("name") for l in (labels or [])}
    if _OPT_IN_LABEL not in names:
        return f"missing opt-in label {_OPT_IN_LABEL!r}"
    held = names & _HOLD_LABELS
    if held:
        return f"hold label(s) present: {sorted(held)}"
    return ""


def candidate_prs(repo, branch, token):
    """Open, non-draft PRs targeting `branch`, opted in and not held.

    Scoped to `branch` because the required-check set is loaded for that branch
    alone (required_contexts()): a PR targeting a different base has different
    gates, so judging it against this branch's contexts is simply wrong. The
    list is filtered server-side by base, and evaluate() re-checks the base on
    the fresh PR. The list endpoint omits `auto_merge`/`mergeable`, so this is
    only the cheap first filter; the per-PR GET in evaluate() reads the rest."""
    b = urllib.parse.quote(branch, safe="")
    prs = _get_all(f"/repos/{repo}/pulls?state=open&base={b}", token)
    out = []
    for p in prs:
        if p.get("draft"):
            continue
        if _label_disqualifier(p.get("labels")):
            continue
        out.append(p.get("number"))
    return out


def evaluate(repo, number, needed, branch, token):
    """Decide whether PR #number is ready to merge. Returns a dict verdict."""
    pr, err, _ = _req("GET", f"/repos/{repo}/pulls/{number}", token)
    if err is not None:
        raise Blind(f"cannot read PR #{number}: {err}")
    v = {"pr": number, "ready": False, "reason": "", "merge_method": "squash"}

    if pr.get("state") != "open" or pr.get("draft"):
        v["reason"] = "not an open non-draft PR"
        return v
    # Re-check the base on the fresh PR: `needed` was loaded for `branch`, so a
    # PR whose base is (now) something else must not be judged by these gates.
    pr_base = pr.get("base", {}).get("ref")
    if pr_base != branch:
        v["reason"] = f"base is {pr_base!r}, not the evaluated branch {branch!r}"
        return v
    # Re-check labels on the FRESHLY-FETCHED PR, not just the list response that
    # candidate_prs() filtered. candidate_prs() lists PRs, then each is fetched
    # one at a time (with pagination and earlier candidates processed between);
    # if `auto-merge` is removed or `hold`/`blocked` added in that window, the
    # list said eligible but the PR no longer is. The ruleset does not enforce
    # labels, so merging here would defeat the operator's opt-out entirely.
    label_bad = _label_disqualifier(pr.get("labels"))
    if label_bad:
        v["reason"] = f"label changed since listing — {label_bad}"
        return v

    am = pr.get("auto_merge")
    if not am:
        v["reason"] = "native auto-merge is not armed — watchdog only completes an armed intent"
        return v
    # Honour the method GitHub was armed with.
    v["merge_method"] = am.get("merge_method") or "squash"

    mergeable = pr.get("mergeable")
    if mergeable is False:
        v["reason"] = "mergeable=false (merge conflict)"
        return v
    if mergeable is None:
        v["reason"] = "mergeable not computed yet by GitHub — recheck next sweep"
        return v

    head_sha = pr.get("head", {}).get("sha")
    base_ref = pr.get("base", {}).get("ref")
    if not head_sha or not base_ref:
        raise Blind(f"PR #{number} missing head.sha/base.ref")

    behind, breason = is_behind(repo, base_ref, head_sha, token)
    if behind:
        v["reason"] = f"branch behind base ({breason}); strict policy would block — leave to branch update"
        return v

    ok, creason = head_checks_green(repo, head_sha, needed, token)
    if not ok:
        v["reason"] = creason
        return v

    v["ready"] = True
    v["reason"] = "armed, conflict-free, up-to-date, all required checks green"
    v["head_sha"] = head_sha
    return v


def do_merge(repo, number, method, token, head_sha):
    """Attempt the merge of the EXACT evaluated head. Returns (merged, message).

    `sha` pins the merge to the commit whose readiness evaluate() checked: the
    GitHub merge API merges only if the PR head still equals it, and returns 409
    otherwise. Without it, a push landing between evaluate() and here would be
    merged unverified — and since the ruleset does not preserve the armed-intent
    condition, that new head could even be one where auto-merge was disabled. A
    409 here is the guard doing its job, handled below as an expected skip."""
    body = {"merge_method": method, "sha": head_sha}
    j, err, status = _req("PUT", f"/repos/{repo}/pulls/{number}/merge", token, body)
    if err is None and j and j.get("merged"):
        return True, j.get("sha", "")
    # 405/409 = server says not mergeable: a gate we didn't model, a race with a
    # concurrent push (the `sha` mismatch above), or the head moved. Expected,
    # not a watchdog failure: report & skip.
    if status in (405, 409, 422):
        return False, f"server declined ({status}): {err}"
    # Anything else (403/5xx/network) is a real problem worth surfacing.
    return False, f"merge call failed: {err}"


def run(repo, branch, token, dry_run, fail_on_error):
    if not _valid_repo(repo):
        raise Blind(f"refusing malformed repo {repo!r}")
    needed = required_contexts(repo, branch, token)
    numbers = candidate_prs(repo, branch, token)
    results = []
    had_real_error = False
    for n in numbers:
        v = evaluate(repo, n, needed, branch, token)
        if v["ready"]:
            if dry_run:
                v["action"] = "would-merge (dry-run)"
            else:
                merged, msg = do_merge(repo, n, v["merge_method"], token, v["head_sha"])
                v["action"] = f"MERGED {msg}" if merged else f"not merged: {msg}"
                if not merged and msg.startswith("merge call failed"):
                    had_real_error = True
        else:
            v["action"] = "skip"
        results.append(v)
    summary = {
        "repo": repo,
        "branch": branch,
        "required_contexts": sorted(needed),
        "candidates": numbers,
        "results": results,
    }
    print(json.dumps(summary, indent=2))
    merged_prs = [r["pr"] for r in results if r.get("action", "").startswith("MERGED")]
    if merged_prs:
        print(f"::notice title=merge-when-green::completed stalled auto-merge for PR(s): {merged_prs}")
    if had_real_error and fail_on_error:
        return 1
    return 0


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--repo", default=os.environ.get("GITHUB_REPOSITORY", "izzywdev/FuzeFront"))
    ap.add_argument("--branch", default="master", help="base branch whose ruleset defines 'required'")
    ap.add_argument("--dry-run", action="store_true", help="evaluate and report, never merge")
    ap.add_argument(
        "--fail-on-error",
        action="store_true",
        help="exit non-zero if a merge call fails with an unexpected error (not a plain 'not mergeable yet')",
    )
    args = ap.parse_args()
    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN") or ""
    try:
        return run(args.repo, args.branch, token, args.dry_run, args.fail_on_error)
    except Blind as e:
        print(f"::error title=merge-when-green::REFUSING — cannot see state to decide safely: {e}")
        return 2


if __name__ == "__main__":
    sys.exit(main())
