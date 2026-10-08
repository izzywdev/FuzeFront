#!/usr/bin/env python3
"""Collect data-only agentic-security metadata and validate its control register."""

from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "security" / "agentic"
UTC = dt.timezone.utc
RELEVANT = re.compile(r"\b(prompt injection|jailbreak|agentic|ai agent|llm|mcp|multimodal)\b", re.I)
CONTROL_ID = re.compile(r"^AGENT-\d{3}$")


def load(name: str, default=None):
    path = DATA / name
    if not path.exists() and default is not None:
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def write(name: str, value) -> None:
    (DATA / name).write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def clean_text(value: object, limit: int = 240) -> str:
    """Flatten untrusted text for plain-text/Markdown reporting."""
    text = html.unescape(str(value or ""))
    text = re.sub(r"[\x00-\x1f\x7f]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    text = text.replace("`", "'").replace("[", "(").replace("]", ")")
    return text[:limit]


def safe_url(value: object) -> str:
    url = str(value or "")
    parsed = urllib.parse.urlparse(url)
    return url if parsed.scheme == "https" and parsed.netloc else ""


def request_json(url: str, params: dict[str, str], headers=None):
    target = url + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(target, headers={"User-Agent": "FuzeFront-agentic-threat-gate/1", **(headers or {})})
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.load(response)


def fetch_nvd(source: dict, since: dt.datetime) -> list[dict]:
    now = dt.datetime.now(UTC)
    params = {
        "keywordSearch": source["query"],
        "lastModStartDate": since.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "lastModEndDate": now.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "resultsPerPage": "100",
    }
    data = request_json(source["url"], params)
    records = []
    for item in data.get("vulnerabilities", []):
        cve = item.get("cve", {})
        descriptions = cve.get("descriptions", [])
        description = next((d.get("value", "") for d in descriptions if d.get("lang") == "en"), "")
        records.append(record(source["id"], cve.get("id"), description, cve.get("published"),
                              f"https://nvd.nist.gov/vuln/detail/{cve.get('id', '')}"))
    return records


def fetch_github(source: dict, since: dt.datetime) -> list[dict]:
    headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    records = []
    page = 1
    while True:
        advisories = request_json(
            source["url"],
            {"per_page": "100", "page": str(page), "sort": "updated", "direction": "desc"},
            headers,
        )
        if not advisories:
            break
        reached_since = False
        for advisory in advisories:
            changed = parse_date(advisory.get("updated_at") or advisory.get("published_at"))
            if changed < since:
                reached_since = True
                break
            haystack = f"{advisory.get('summary', '')} {advisory.get('description', '')}"
            if RELEVANT.search(haystack):
                records.append(record(source["id"], advisory.get("ghsa_id"), advisory.get("summary"),
                                      advisory.get("published_at"), advisory.get("html_url")))
        if reached_since or len(advisories) < 100:
            break
        page += 1
    return records


def fetch_arxiv(source: dict, since: dt.datetime) -> list[dict]:
    params = {"search_query": source["query"], "start": "0", "max_results": "50",
              "sortBy": "submittedDate", "sortOrder": "descending"}
    target = source["url"] + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(target, headers={"User-Agent": "FuzeFront-agentic-threat-gate/1"})
    with urllib.request.urlopen(req, timeout=30) as response:
        root = ET.parse(response).getroot()
    ns = {"a": "http://www.w3.org/2005/Atom"}
    records = []
    for entry in root.findall("a:entry", ns):
        published = entry.findtext("a:published", "", ns)
        if parse_date(published) < since:
            continue
        url = entry.findtext("a:id", "", ns).replace("http://", "https://")
        identifier = url.rstrip("/").rsplit("/", 1)[-1]
        records.append(record(source["id"], identifier, entry.findtext("a:title", "", ns), published, url))
    return records


FETCHERS = {"nvd": fetch_nvd, "github": fetch_github, "arxiv": fetch_arxiv}


def parse_date(value: object) -> dt.datetime:
    text = str(value or "1970-01-01T00:00:00Z").replace("Z", "+00:00")
    parsed = dt.datetime.fromisoformat(text)
    return parsed.replace(tzinfo=parsed.tzinfo or UTC).astimezone(UTC)


def record(source: str, identifier: object, title: object, published: object, url: object) -> dict:
    return {
        "id": f"{source}:{clean_text(identifier, 100)}",
        "source": source,
        "title": clean_text(title),
        "published": clean_text(published, 40),
        "url": safe_url(url),
    }


def validate() -> None:
    errors = []
    controls = load("controls.json").get("controls", [])
    ids = [item.get("id") for item in controls]
    if len(controls) < 18:
        errors.append("at least 18 initial controls are required")
    if len(ids) != len(set(ids)) or not all(CONTROL_ID.match(str(value)) for value in ids):
        errors.append("control IDs must be unique AGENT-NNN values")
    for item in controls:
        if item.get("status") != "required" or not item.get("evidence"):
            errors.append(f"{item.get('id')} must be required and name evidence")
    for item in load("baseline.json").get("records", []):
        if not safe_url(item.get("url")):
            errors.append(f"baseline {item.get('id')} has an unsafe URL")
        unknown = set(item.get("controls", [])) - set(ids)
        if unknown:
            errors.append(f"baseline {item.get('id')} references unknown controls: {sorted(unknown)}")
    sources = load("sources.json").get("sources", [])
    if not sources or any(s.get("kind") not in FETCHERS or not safe_url(s.get("url")) for s in sources):
        errors.append("every source must use a supported parser and HTTPS")
    if errors:
        raise ValueError("\n".join(errors))
    print(f"Validated {len(controls)} controls, {len(sources)} feeds, and the research baseline")


def collect(output: Path, lookback_days: int) -> int:
    validate()
    state = load("state.json")
    fallback = dt.datetime.now(UTC) - dt.timedelta(days=lookback_days)
    since = parse_date(state["last_successful_run"]) - dt.timedelta(hours=6) if state.get("last_successful_run") else fallback
    seen = set(state.get("seen_ids", []))
    fresh, failures = [], []
    sources = load("sources.json")["sources"]
    for source in sources:
        try:
            fresh.extend(item for item in FETCHERS[source["kind"]](source, since) if item["id"] not in seen)
        except urllib.error.HTTPError as exc:
            failures.append(f"{source['id']}: HTTP {exc.code}")
        except (OSError, ValueError, KeyError, ET.ParseError, urllib.error.URLError) as exc:
            failures.append(f"{source['id']}: {type(exc).__name__}")
    unique = {item["id"]: item for item in fresh if item["url"] and item["id"].split(":", 1)[-1]}
    delta = sorted(unique.values(), key=lambda item: (item["published"], item["id"]), reverse=True)
    now = dt.datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    lines = ["# Nightly agentic threat-intelligence report", "", f"Run: {now}",
             f"Window start: {since.isoformat().replace('+00:00', 'Z')}", f"New records: {len(delta)}", ""]
    if delta:
        lines += ["## Delta", ""] + [f"- **{item['title']}** ({item['source']}, {item['published']}) — <{item['url']}>" for item in delta]
    else:
        lines += ["No previously unseen matching records were found."]
    if failures:
        lines += ["", "## Feed warnings", ""] + [f"- {clean_text(item)}" for item in failures]
    output.write_text("\n".join(lines) + "\n", encoding="utf-8")
    if len(failures) == len(sources):
        raise RuntimeError("all threat-intelligence feeds failed")
    if delta:
        discoveries = load("discoveries.json", {"schema_version": 1, "records": []})
        discoveries["records"].extend(delta)
        discoveries["records"] = list({x["id"]: x for x in discoveries["records"]}.values())
        write("discoveries.json", discoveries)

    if delta or not failures:
        state["seen_ids"] = sorted(seen | set(unique))
        if not failures:
            state["last_successful_run"] = now
        write("state.json", state)
    print(f"Collected {len(delta)} new records; {len(failures)} feed warnings")
    return len(delta)


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("validate")
    collect_parser = sub.add_parser("collect")
    collect_parser.add_argument("--output", type=Path, default=DATA / "latest-report.md")
    collect_parser.add_argument("--lookback-days", type=int, default=7)
    args = parser.parse_args()
    if args.command == "validate":
        validate()
        return 0
    count = collect(args.output, args.lookback_days)
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as handle:
            handle.write(f"delta_count={count}\n")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, RuntimeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(1)
