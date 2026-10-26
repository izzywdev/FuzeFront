#!/usr/bin/env python3
"""Regenerate build/a2a/agent-card.json from this repo's manifest + role.

Usage:
    python3 build/a2a/generate-card.py [--fuzeagent-src PATH]

--fuzeagent-src  Path to a local FuzeAgent checkout that contains
                 agent-templates/a2a/card_generator.py.
                 Defaults to /tmp/fuzeagent-gen (populated by CI).

Run this whenever .fuze/manifest.json or
agent-templates/roles/app-shell-platform/role.json changes.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent / "agent-card.json"

IN_CLUSTER_URL = "http://a2a-fuzefront.fuzefront.svc.cluster.local:8080/rpc"
TENANT = "FuzeFront"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fuzeagent-src", default="/tmp/fuzeagent-gen")
    args = parser.parse_args()

    fuzeagent = Path(args.fuzeagent_src)
    if not (fuzeagent / "agent-templates" / "a2a" / "card_generator.py").exists():
        print(f"card_generator.py not found under {fuzeagent}/agent-templates", file=sys.stderr)
        sys.exit(1)

    sys.path.insert(0, str(fuzeagent / "agent-templates"))
    from a2a.card_generator import project_product_card

    manifest_path = REPO_ROOT / ".fuze" / "manifest.json"
    role_path = REPO_ROOT / "agent-templates" / "roles" / "app-shell-platform" / "role.json"

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    roles = {"app-shell-platform": json.loads(role_path.read_text(encoding="utf-8"))}

    # sign=True emits a placeholder JWS so the card passes schema validation
    # (the 'signatures' field is required).  The fuze-a2a runtime re-signs the
    # card at pod startup with the pod's actual key when AGENT_CARD_FILE is set:
    #   izzywdev/FuzeAgent server.py → well_known_card() → re-sign path
    #   (introduced in FuzeAgent PR #2088, "static-card topology").
    # The placeholder value is never served — the server overwrites it in memory
    # before the /.well-known/agent-card.json endpoint goes live.
    card = project_product_card(
        manifest,
        roles,
        tenant=TENANT,
        in_cluster_url=IN_CLUSTER_URL,
        sign=True,
    )

    OUT.write_text(json.dumps(card, indent=2) + "\n", encoding="utf-8")
    print(f"Written {OUT}")


if __name__ == "__main__":
    main()
