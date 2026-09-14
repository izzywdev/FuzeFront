#!/usr/bin/env python3
"""Parse a list_sessions tool-result file (saved by the harness when the
result is too large to inline) and print matching sessions as
`id | title | status | repo` lines, one per session.

Usage:
    python3 parse_sessions.py <tool-result-file> [--repo SUBSTRING] [--ids id1,id2,...]

--repo matches case-insensitively against session_context.sources[0].git_repository.url.
--ids restricts to an explicit comma-separated list of session ids (still reads
      the file, just filters differently) -- handy for a quick sanity check.
With neither flag, every session in the file is printed.
"""
import argparse
import json
import sys


def load_sessions(path: str):
    with open(path, "r") as f:
        data = f.read()
    start = data.index('{"ccr"')
    end = data.rindex("}")
    blob = data[start : end + 1]
    obj = json.loads(blob)
    return obj["ccr"]["data"]


def repo_of(session: dict) -> str:
    try:
        return session["session_context"]["sources"][0]["git_repository"]["url"]
    except Exception:
        return ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("file")
    ap.add_argument("--repo", default=None, help="substring to match against the repo URL, case-insensitive")
    ap.add_argument("--ids", default=None, help="comma-separated session ids to restrict to")
    args = ap.parse_args()

    sessions = load_sessions(args.file)

    id_filter = set(args.ids.split(",")) if args.ids else None
    repo_needle = args.repo.lower() if args.repo else None

    matched = []
    for s in sessions:
        if id_filter is not None and s["id"] not in id_filter:
            continue
        repo = repo_of(s)
        if repo_needle is not None and repo_needle not in repo.lower():
            continue
        matched.append(s)

    for s in matched:
        print(f'{s["id"]} | {s.get("title")} | {s.get("session_status")} | {repo_of(s)}')

    print(f"\n# {len(matched)} matched / {len(sessions)} in this page", file=sys.stderr)
    if sessions:
        print(f"# last id in this page (for after_id pagination): {sessions[-1]['id']}", file=sys.stderr)


if __name__ == "__main__":
    main()
