#!/usr/bin/env python3
"""Project role manifests into versioned /v1/agents resources (idempotent).

For each roles/<role>/role.json (and coordinator/coordinator.json), render the
agent payload and create it if absent, else update it only when the config
actually changed (a matching config is a no-op — the API does not bump the
version). The coordinator is synced last so its multiagent roster can reference
the freshly-resolved role agent ids/versions.

Writes sync/.state/agent-ids.json: {role: {id, version, environment}}.
"""
import json
import os

import common
import role_loader as rl

HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATES_ROOT = os.path.dirname(HERE)
STATE_DIR = common.state_dir()
AGENT_STATE = os.path.join(STATE_DIR, "agent-ids.json")
ENV_STATE = os.path.join(STATE_DIR, "environment-ids.json")

# Fields we compare to decide whether an update is needed.
_COMPARE = ("model", "system", "description", "tools", "mcp_servers", "skills", "multiagent")


def _load_env_ids():
    if not os.path.exists(ENV_STATE):
        raise SystemExit("Run sync_environments.py first (environment-ids.json missing).")
    return json.load(open(ENV_STATE, encoding="utf-8"))


def _norm_model(m):
    return m["id"] if isinstance(m, dict) else m


def _changed(current, desired):
    """True if any field we manage differs. Fields we did not specify are ignored."""
    for k in _COMPARE:
        d = desired.get(k)
        if d is None:
            continue
        c = current.get(k)
        if k == "model":
            if _norm_model(c) != _norm_model(d):
                return True
        elif c != d:
            return True
    return False


def _upsert(name, payload, existing_by_name):
    if name in existing_by_name:
        cur = existing_by_name[name]
        if _changed(cur, payload):
            # Update is a POST to the agent id with the current version (409 on mismatch).
            updated = common.request(
                "POST", f"/v1/agents/{cur['id']}", body={**payload, "version": cur["version"]}
            )
            print(f"~ {name}: updated -> v{updated['version']} ({updated['id']})")
            return updated
        print(f"= {name}: unchanged (v{cur['version']}, {cur['id']})")
        return cur
    created = common.request("POST", "/v1/agents", body=payload)
    print(f"+ {name}: created v{created['version']} ({created['id']})")
    return created


def main():
    env_ids = _load_env_ids()
    existing = {a["name"]: a for a in common.list_all("/v1/agents")}
    state = {}

    # 1. role agents
    for role in rl.role_dirs():
        manifest = rl.load_manifest(os.path.join(rl.ROLES_DIR, role, "role.json"))
        payload = rl.agent_payload(manifest)
        agent = _upsert(manifest["name"], payload, existing)
        env_name_key = manifest.get("environment")
        state[role] = {
            "id": agent["id"],
            "version": agent["version"],
            "environment": env_name_key,
            "environment_id": env_ids.get(_env_name(env_name_key)),
        }

    # 2. coordinator (roster references the resolved role agents)
    coord_path = os.path.join(TEMPLATES_ROOT, "coordinator", "coordinator.json")
    if os.path.exists(coord_path):
        cmani = rl.load_manifest(coord_path)
        payload = rl.agent_payload(cmani)
        roster = []
        for role in cmani.get("multiagent_roles", []):
            if role in state:
                roster.append({"type": "agent", "id": state[role]["id"], "version": state[role]["version"]})
        if roster:
            payload["multiagent"] = {"agents": roster}
        agent = _upsert(cmani["name"], payload, existing)
        state["coordinator"] = {
            "id": agent["id"],
            "version": agent["version"],
            "environment": cmani.get("environment"),
            "environment_id": env_ids.get(_env_name(cmani.get("environment"))),
        }

    os.makedirs(STATE_DIR, exist_ok=True)
    with open(AGENT_STATE, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2)
    print(f"\nWrote {AGENT_STATE}")


def _env_name(env_basename):
    """environments/<basename>.json -> the env's `name` field."""
    if not env_basename:
        return None
    path = os.path.join(TEMPLATES_ROOT, "environments", f"{env_basename}.json")
    return json.load(open(path, encoding="utf-8"))["name"]


if __name__ == "__main__":
    main()
