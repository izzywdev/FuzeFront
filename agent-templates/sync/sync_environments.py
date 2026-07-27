#!/usr/bin/env python3
"""Ensure every environments/*.json exists as a /v1/environments resource.

Environments are NOT versioned in the API, so this is create-if-missing by name.
If a manifest's config changed, delete/recreate manually (or rename it) — we do
not silently diverge. The resulting name->id map is written to
sync/.state/environment-ids.json for sync_agents.py / launch_session.py.
"""
import glob
import json
import os

import common

HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATES_ROOT = os.path.dirname(HERE)
ENV_DIR = os.path.join(TEMPLATES_ROOT, "environments")
STATE_DIR = common.state_dir()
STATE_FILE = os.path.join(STATE_DIR, "environment-ids.json")


def main():
    existing = {e["name"]: e["id"] for e in common.list_all("/v1/environments")}
    ids = {}
    for path in sorted(glob.glob(os.path.join(ENV_DIR, "*.json"))):
        manifest = json.load(open(path, encoding="utf-8"))
        name = manifest["name"]
        if name in existing:
            ids[name] = existing[name]
            print(f"= {name}: exists ({existing[name]})")
            continue
        body = {"name": name, "config": manifest["config"]}
        created = common.request("POST", "/v1/environments", body=body)
        ids[name] = created["id"]
        print(f"+ {name}: created ({created['id']})")

    os.makedirs(STATE_DIR, exist_ok=True)
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(ids, f, indent=2)
    print(f"\nWrote {STATE_FILE}")


if __name__ == "__main__":
    main()
