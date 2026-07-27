#!/usr/bin/env python3
"""Ensure memory stores + their seed memories exist (idempotent).

Memory-store endpoints use the agent-memory beta header (NOT the managed-agents
one). Matches stores by `name` and seed memories by `path`: create-if-missing.

Writes <state>/memory-ids.json: {name: memory_store_id}. launch_session.py /
relay.py / the handoff server attach these to sessions as read_write resources so
agents share a persistent cross-session handoff workspace.
"""
import glob
import json
import os

import common

MEM_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "memory")
STATE_FILE = os.path.join(common.state_dir(), "memory-ids.json")


def main():
    if not os.path.isdir(MEM_DIR):
        raise SystemExit("no memory/ directory")
    existing = {s["name"]: s["id"] for s in common.list_all("/v1/memory_stores", beta=common.MEMORY_BETA)}
    ids = {}

    for path in sorted(glob.glob(os.path.join(MEM_DIR, "*.json"))):
        tmpl = json.load(open(path, encoding="utf-8"))
        name = tmpl["name"]
        if name in existing:
            sid = existing[name]
            print(f"= memory store {name}: exists ({sid})")
        else:
            sid = common.request("POST", "/v1/memory_stores",
                                 body={"name": name, "description": tmpl["description"]},
                                 beta=common.MEMORY_BETA)["id"]
            print(f"+ memory store {name}: created ({sid})")
        ids[name] = sid

        have = {m["path"] for m in common.list_all(
            f"/v1/memory_stores/{sid}/memories", beta=common.MEMORY_BETA) if m.get("path")}
        for mem in tmpl.get("seed", []):
            if mem["path"] in have:
                print(f"  = memory {mem['path']}: exists")
                continue
            common.request("POST", f"/v1/memory_stores/{sid}/memories",
                           body={"path": mem["path"], "content": mem["content"]}, beta=common.MEMORY_BETA)
            print(f"  + memory {mem['path']}: seeded")

    os.makedirs(common.state_dir(), exist_ok=True)
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(ids, f, indent=2)
    print(f"\nWrote {STATE_FILE}")


if __name__ == "__main__":
    main()
