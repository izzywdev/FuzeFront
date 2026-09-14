#!/usr/bin/env python3
"""Ensure vaults + their credentials exist (idempotent), reading secret values
from the environment (never inline).

Credential keys (`mcp_server_url` / `secret_name`) are immutable and unique per
vault: create-if-missing, and if a key exists we leave it (rotate via the API's
credential update — see README). The github MCP `mcp_server_url` MUST match the
agents' `mcp_servers[].url` EXACTLY (scheme + trailing slash) or auth won't apply.

Writes sync/.state/vault-ids.json: {display_name: vault_id}. launch_session.py /
relay.py pass these ids as `vault_ids` at session creation.
"""
import glob
import json
import os

import common

HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATES_ROOT = os.path.dirname(HERE)
VAULT_DIR = os.path.join(TEMPLATES_ROOT, "vaults")
STATE_DIR = common.state_dir()
STATE_FILE = os.path.join(STATE_DIR, "vault-ids.json")


def _cred_key(auth):
    return auth.get("mcp_server_url") or auth.get("secret_name")


def main():
    if not os.path.isdir(VAULT_DIR):
        raise SystemExit("no vaults/ directory")
    existing_vaults = {v["display_name"]: v["id"] for v in common.list_all("/v1/vaults")}
    ids = {}

    for path in sorted(glob.glob(os.path.join(VAULT_DIR, "*.json"))):
        tmpl = common.expand_env(json.load(open(path, encoding="utf-8")))
        name = tmpl["display_name"]
        if name in existing_vaults:
            vid = existing_vaults[name]
            print(f"= vault {name}: exists ({vid})")
        else:
            body = {"display_name": name}
            if tmpl.get("metadata"):
                body["metadata"] = tmpl["metadata"]
            vid = common.request("POST", "/v1/vaults", body=body)["id"]
            print(f"+ vault {name}: created ({vid})")
        ids[name] = vid

        have = {_cred_key(c["auth"]): c for c in common.list_all(f"/v1/vaults/{vid}/credentials")
                if isinstance(c.get("auth"), dict)}
        for cred in tmpl.get("credentials", []):
            key = _cred_key(cred["auth"])
            if not key or "${" in json.dumps(cred["auth"]):
                print(f"  ! skip credential '{cred['display_name']}': unresolved ${{VAR}} — set the env var")
                continue
            if key in have:
                print(f"  = credential {key}: exists")
                continue
            common.request("POST", f"/v1/vaults/{vid}/credentials",
                           body={"display_name": cred["display_name"], "auth": cred["auth"]})
            print(f"  + credential {key}: created")

    os.makedirs(STATE_DIR, exist_ok=True)
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(ids, f, indent=2)
    print(f"\nWrote {STATE_FILE}")


if __name__ == "__main__":
    main()
