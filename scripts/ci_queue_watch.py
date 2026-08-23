#!/usr/bin/env python3
"""Fleet CI queue watchdog — is each runner pool PROGRESSING?

WHY THIS MEASURES THROUGHPUT AND NOT WAIT TIME
==============================================
The obvious watchdog is "alert when a job has been queued longer than N
minutes". It does not work, because two completely different situations
produce identical long waits:

  1. The pool is DEAD. `runs-on` names an ARC scale set that is not serving --
     or does not exist at all. Jobs queue forever with no red X, no log and no
     timeout. Nothing in GitHub ever reports this.
  2. The pool is BUSY. More work was pushed than the runners can chew through.
     A 90-minute wait is the system working correctly under load.

A latency threshold fires on both. It therefore gets muted, and then case 1
goes unnoticed -- which is exactly how the current outage was found: an agent
wondered why its build never started.

What separates them is whether the pool is MOVING. A busy pool still starts
jobs; a dead pool starts none. So the signal is:

    queued > 0  AND  nothing started on this pool in the last N minutes
    => STALLED

and queue depth on a moving pool is reported as capacity, not as an incident.
Different signal, different response: STALLED means fix the runner or the
`runs-on` name; SATURATED means add runners, and is not paged.

TWO MORE THINGS THIS LEARNED THE HARD WAY
-----------------------------------------
* The pool key is (visibility, label), not the label. `ubuntu-latest` is
  healthy on a public repo and permanently queued on a private one when the
  account's Actions budget is exhausted -- same label, opposite meaning.
* A job that never got a runner still appears in the API with
  `runner_id: 0` and a start timestamp. Counting those as "started" would make
  a dead pool look alive, so they are excluded when measuring last-start.

The watchdog must not run on the pool it watches. See the workflow: it pins
`ubuntu-latest` on this public repo, which is unmetered and independent of ARC.
"""
import argparse
import concurrent.futures as cf
import datetime
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

# Overridable so the self-tests can point discovery at a dead port and stay
# hermetic — they must not depend on the fleet's live state, which is the very
# thing this script measures.
API = os.environ.get("CI_QUEUE_WATCH_API", "https://api.github.com")
NOW = datetime.datetime.now(datetime.timezone.utc)


# urllib speaks file://, ftp:// and more, so an unchecked base URL is an
# arbitrary-file read waiting to happen -- CI_QUEUE_WATCH_API is an env var, and
# env vars get set by things other than the person reading this. The scheme is
# checked at the one place every request funnels through rather than trusted at
# the point it was configured.
_ALLOWED_SCHEMES = ("http", "https")

# Repository full names are interpolated into request paths. They arrive from
# the API rather than from a user, but "it came from an API" is the assumption
# that makes traversal bugs, so the shape is enforced instead of assumed.
_REPO_RE = re.compile(r"^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$")


def _valid_repo(full):
    return bool(_REPO_RE.match(full))


def _get(path, token):
    url = API + path
    scheme = urllib.parse.urlsplit(url).scheme.lower()
    if scheme not in _ALLOWED_SCHEMES:
        return None, f"refusing non-HTTP scheme {scheme!r}"
    req = urllib.request.Request(url)
    req.add_header("Accept", "application/vnd.github+json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=30) as fh:
            return json.load(fh), None
    except urllib.error.HTTPError as exc:
        return None, f"HTTP {exc.code}"
    except Exception as exc:  # noqa: BLE001 - network shape varies
        return None, str(exc)


def _minutes_since(ts):
    if not ts:
        return None
    t = datetime.datetime.fromisoformat(ts.replace("Z", "+00:00"))
    return (NOW - t).total_seconds() / 60.0


def discover_repos(owner, token, prefix):
    """The fleet is whatever GitHub says it is -- no checked-in repo list.

    A list of repositories in a file is a second place to update on every new
    product, and it is silently wrong the moment someone forgets. Derived here
    from the account listing and filtered by name prefix.
    """
    repos, page = [], 1
    while True:
        data, err = _get(f"/users/{owner}/repos?per_page=100&type=all&page={page}", token)
        if err:
            data, err = _get(f"/orgs/{owner}/repos?per_page=100&type=all&page={page}", token)
        if err or not data:
            return repos, err
        for r in data:
            if r.get("archived"):
                continue
            if r["name"].lower().startswith(prefix):
                repos.append((r["full_name"], "private" if r.get("private") else "public"))
        if len(data) < 100:
            return repos, None
        page += 1


def scan_repo(args):
    """Every queued/running job in one repo, keyed by (visibility, runs-on)."""
    full, visibility, token, lookback = args
    rows, errors = [], []
    if not _valid_repo(full):
        return rows, {}, [f"{full!r}: not a valid owner/repo name — skipped"]

    for status in ("queued", "in_progress"):
        runs, err = _get(f"/repos/{full}/actions/runs?status={status}&per_page=100", token)
        if err:
            errors.append(f"{full}: {err}")
            continue
        for run in runs.get("workflow_runs", []):
            jobs, err = _get(f"/repos/{full}/actions/runs/{run['id']}/jobs?per_page=100", token)
            if err:
                errors.append(f"{full} run {run['id']}: {err}")
                continue
            for job in jobs.get("jobs", []):
                if job["status"] not in ("queued", "in_progress"):
                    continue
                rows.append({
                    "repo": full,
                    "visibility": visibility,
                    "pool": (job.get("labels") or ["<none>"])[0],
                    "status": job["status"],
                    "waited_min": _minutes_since(job.get("created_at") or run["created_at"]),
                    "started_min_ago": _minutes_since(job.get("started_at"))
                    if job["status"] == "in_progress" else None,
                })

    # Last REAL start, from recently completed runs. This is what makes a stall
    # distinguishable from a queue that simply has not been fed lately: a pool
    # with nothing queued and nothing running is idle, not broken, and an idle
    # pool must never page anyone.
    done, err = _get(f"/repos/{full}/actions/runs?status=completed&per_page={lookback}", token)
    last_start = {}
    if err:
        errors.append(f"{full}: {err}")
    else:
        for run in done.get("workflow_runs", []):
            jobs, jerr = _get(f"/repos/{full}/actions/runs/{run['id']}/jobs?per_page=100", token)
            if jerr:
                continue
            for job in jobs.get("jobs", []):
                # runner_id 0 == never actually picked up by a runner. Counting
                # these as starts is how a dead pool reads as alive.
                if not job.get("started_at") or not job.get("runner_id"):
                    continue
                key = (visibility, (job.get("labels") or ["<none>"])[0])
                age = _minutes_since(job["started_at"])
                if key not in last_start or age < last_start[key]:
                    last_start[key] = age

    return rows, last_start, errors


def aggregate(rows, last_starts):
    pools = {}
    for r in rows:
        key = (r["visibility"], r["pool"])
        p = pools.setdefault(key, {"queued": 0, "running": 0, "oldest_wait": 0.0,
                                   "last_start": None, "repos": set()})
        p["repos"].add(r["repo"].split("/")[-1])
        if r["status"] == "queued":
            p["queued"] += 1
            p["oldest_wait"] = max(p["oldest_wait"], r["waited_min"] or 0.0)
        else:
            p["running"] += 1
    for key, age in last_starts.items():
        if key in pools and (pools[key]["last_start"] is None or age < pools[key]["last_start"]):
            pools[key]["last_start"] = age
    return pools


def verdict(p, stall_minutes):
    """STALLED is the only state that warrants waking anyone up."""
    if p["queued"] == 0:
        # Nothing waiting. Running jobs with an empty queue is the healthiest
        # state there is; labelling it IDLE reads as "this pool does nothing".
        return ("HEALTHY" if p["running"] else "IDLE"), False
    if p["running"] > 0:
        # Moving. Depth is a capacity fact, not an incident.
        return ("SATURATED" if p["queued"] > p["running"] * 2 else "HEALTHY"), False
    last = p["last_start"]
    if last is None:
        # No start seen anywhere in the lookback window. That is a stall only if
        # something has also been waiting longer than the threshold -- a pool
        # whose first-ever job was queued two minutes ago has no history yet and
        # must not page.
        if p["oldest_wait"] > stall_minutes:
            return "STALLED (no start seen in the lookback window)", True
        return "PENDING (no history yet)", False
    if last > stall_minutes:
        return f"STALLED (last start {last:.0f}m ago)", True
    # Queued, nothing running right now, but a job started recently -- that is a
    # pool turning over between jobs, not a stall.
    return "HEALTHY", False


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--owner", default="izzywdev")
    ap.add_argument("--prefix", default="fuze", help="repo-name prefix defining the fleet")
    ap.add_argument("--repos", nargs="*", default=None,
                    help="explicit owner/repo list; skips discovery")
    ap.add_argument("--stall-minutes", type=int, default=30,
                    help="a pool with queued work and no start in this window is STALLED")
    ap.add_argument("--lookback-runs", type=int, default=40,
                    help="completed runs per repo scanned for the last real job start")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--fail-on-stall", action="store_true",
                    help="exit 1 when any pool is STALLED (for the scheduled watchdog)")
    ap.add_argument("--min-repos", type=int, default=5,
                    help="with a token present, discovering fewer than this many repos is a "
                         "misconfiguration and exits 2 — a watchdog that silently watches "
                         "nothing is worse than no watchdog")
    args = ap.parse_args()

    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN") or ""

    if args.repos:
        targets = [(r, "unknown") for r in args.repos]
        derr = None
    else:
        targets, derr = discover_repos(args.owner, token, args.prefix)
    # A watchdog that quietly watches nothing is the failure mode this whole
    # script exists to argue against: it stays green forever and everyone reads
    # green as "the fleet is fine". So an under-sized fleet is only tolerated
    # when there is no token to look with -- an environmental condition, which
    # must never masquerade as an outage. With a token in hand, too few repos
    # means the token's scope is wrong, and that is a hard failure.
    if not args.repos and len(targets) < args.min_repos:
        detail = f"discovered {len(targets)} repo(s), expected at least {args.min_repos}"
        if derr:
            detail += f" (last error: {derr})"
        if not token:
            print(f"::warning::{detail} and no token is set — skipping rather than "
                  f"reporting a fleet of one.", file=sys.stderr)
            return 0
        print(f"::error::{detail}. A token IS set, so this is a scope problem, not an "
              f"empty fleet — the token needs read access to the {args.owner}/{args.prefix}* "
              f"repositories. Refusing to report on a fleet this small: a watchdog that "
              f"watches nothing looks identical to a healthy one.", file=sys.stderr)
        return 2

    rows, last_starts, errors = [], {}, []
    work = [(full, vis, token, args.lookback_runs) for full, vis in targets]
    with cf.ThreadPoolExecutor(max_workers=8) as ex:
        for r, ls, errs in ex.map(scan_repo, work):
            rows.extend(r)
            errors.extend(errs)
            for key, age in ls.items():
                if key not in last_starts or age < last_starts[key]:
                    last_starts[key] = age

    pools = aggregate(rows, last_starts)
    stalled = []
    out = []
    for (vis, name), p in sorted(pools.items(), key=lambda kv: -kv[1]["queued"]):
        v, is_stall = verdict(p, args.stall_minutes)
        if is_stall:
            stalled.append((vis, name, p, v))
        out.append({"pool": name, "visibility": vis, "queued": p["queued"],
                    "running": p["running"], "oldest_wait_min": round(p["oldest_wait"], 1),
                    "last_start_min_ago": None if p["last_start"] is None else round(p["last_start"], 1),
                    "verdict": v, "repos": sorted(p["repos"])})

    if args.json:
        print(json.dumps({"observed_at": NOW.isoformat(timespec="seconds"),
                          "repos_scanned": len(targets), "pools": out,
                          "errors": errors}, indent=2))
    else:
        print(f"# fleet CI queue @ {NOW.isoformat(timespec='seconds')} "
              f"({len(targets)} repos)\n")
        hdr = (f"{'pool (runs-on)':24} {'vis':8} {'queued':>6} {'run':>4} "
               f"{'oldest wait':>12} {'last start':>11}  verdict")
        print(hdr)
        print("-" * len(hdr))
        for o in out:
            ls = "never" if o["last_start_min_ago"] is None else f"{o['last_start_min_ago']:.0f}m"
            print(f"{o['pool']:24} {o['visibility']:8} {o['queued']:>6} {o['running']:>4} "
                  f"{o['oldest_wait_min']:>11.0f}m {ls:>11}  {o['verdict']}")
            print(f"{'':24} repos: {', '.join(o['repos'])[:96]}")
        for e in errors:
            print(f"::warning::{e}")

    if stalled:
        for vis, name, p, v in stalled:
            print(f"::error::runner pool '{name}' ({vis}) is {v} — "
                  f"{p['queued']} job(s) queued, oldest {p['oldest_wait']:.0f}m, "
                  f"repos: {', '.join(sorted(p['repos']))}", file=sys.stderr)
        return 1 if args.fail_on_stall else 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
