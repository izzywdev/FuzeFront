#!/usr/bin/env python3
"""One-shot provisioner: create/update every environment + agent (+ vaults, memory)
for a provider, idempotently, and print the resulting ids.

    python providers/provision.py --provider anthropic            # create/update live
    python providers/provision.py --provider anthropic --dry-run  # resolve + print, no API calls

Run this (or the provision CI job) once a Managed-Agents-entitled ANTHROPIC_API_KEY
and the MCP URLs (GITHUB_MCP_URL/TOKEN, HANDOFF_MCP_URL) are set. The final summary
is the "all agents created with their envs" confirmation. Writes the id state
(environment-ids/agent-ids/vault-ids/memory-ids.json) under the state dir.
"""
import argparse
import glob
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))          # providers/
TEMPLATES_ROOT = os.path.dirname(HERE)                     # agent-templates/
SYNC = os.path.join(TEMPLATES_ROOT, "sync")
for _p in (TEMPLATES_ROOT, SYNC):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from providers import get_provider  # noqa: E402
import common                       # noqa: E402  (state_dir)
import role_loader as rl            # noqa: E402

ENV_DIR = os.path.join(TEMPLATES_ROOT, "environments")
VAULT_DIR = os.path.join(TEMPLATES_ROOT, "vaults")
MEM_DIR = os.path.join(TEMPLATES_ROOT, "memory")
COORD_DIR = os.path.join(TEMPLATES_ROOT, "coordinator")


def _load(path):
    return json.load(open(path, encoding="utf-8"))


def _glob(d):
    return sorted(glob.glob(os.path.join(d, "*.json")))


def _env_basename_to_name(basename):
    if not basename:
        return None
    return _load(os.path.join(ENV_DIR, f"{basename}.json"))["name"]


def dry_run(provider):
    print(f"# DRY RUN (provider={provider.name}) — no API calls\n")
    print("Environments:")
    for p in _glob(ENV_DIR):
        e = _load(p)
        print(f"  - {e['name']}  (type={e['config'].get('type')})")
    if provider.capabilities.get("vaults"):
        print("Vaults:")
        for p in _glob(VAULT_DIR):
            v = _load(p)
            print(f"  - {v['display_name']}  ({len(v.get('credentials', []))} credentials)")
    if provider.capabilities.get("memory"):
        print("Memory stores:")
        for p in _glob(MEM_DIR):
            m = _load(p)
            print(f"  - {m['name']}  ({len(m.get('seed', []))} seed memories)")
    print("Agents:")
    for role in rl.role_dirs():
        m = rl.load_manifest(os.path.join(rl.ROLES_DIR, role, "role.json"))
        mcp = [s.get("name") for s in m.get("mcp_servers", [])]
        print(f"  - {m['name']}  model={m.get('model')}  tools={len(m.get('tools', []))}  "
              f"mcp={mcp}  skills={len(m.get('skills', []))}  env={m.get('environment')}")
    for p in _glob(COORD_DIR):
        c = rl.load_manifest(p)
        print(f"  - {c['name']}  (coordinator; roster={c.get('multiagent_roles', [])})")
    print("\n(no changes made)")


def apply(provider, no_vault, no_memory):
    state_dir = common.state_dir()
    os.makedirs(state_dir, exist_ok=True)

    def _write(name, obj):
        with open(os.path.join(state_dir, name), "w", encoding="utf-8") as f:
            json.dump(obj, f, indent=2)

    env_ids = {}
    for p in _glob(ENV_DIR):
        r = provider.ensure_environment(_load(p))
        env_ids[r["name"]] = r["id"]
        print(f"[env]    {r['name']}: {'created' if r.get('created') else 'exists'}  {r['id']}")
    _write("environment-ids.json", env_ids)

    vault_ids = {}
    if provider.capabilities.get("vaults") and not no_vault:
        for p in _glob(VAULT_DIR):
            r = provider.ensure_vault(_load(p))
            vault_ids[r["name"]] = r["id"]
            print(f"[vault]  {r['name']}: {r['id']}")
        _write("vault-ids.json", vault_ids)

    mem_ids = {}
    if provider.capabilities.get("memory") and not no_memory:
        for p in _glob(MEM_DIR):
            r = provider.ensure_memory(_load(p))
            mem_ids[r["name"]] = r["id"]
            print(f"[memory] {r['name']}: {r['id']}")
        _write("memory-ids.json", mem_ids)

    state = {}
    for role in rl.role_dirs():
        m = rl.load_manifest(os.path.join(rl.ROLES_DIR, role, "role.json"))
        a = provider.ensure_agent(m)
        state[role] = {"id": a["id"], "version": a["version"],
                       "environment": m.get("environment"),
                       "environment_id": env_ids.get(_env_basename_to_name(m.get("environment")))}
        print(f"[agent]  {a['name']}: {'created' if a.get('created') else 'exists'}  v{a['version']}  {a['id']}")
    # Coordinators are created after the roles they reference (sorted: coordinator.json
    # before exec-coordinator.json). A roster entry may reference a role OR an already-
    # created coordinator, resolved against the accumulated state.
    for p in _glob(COORD_DIR):
        c = rl.load_manifest(p)
        roster = [{"type": "agent", "id": state[r]["id"], "version": state[r]["version"]}
                  for r in c.get("multiagent_roles", []) if r in state]
        a = provider.ensure_agent(c, multiagent=roster or None)
        state[c["role"]] = {"id": a["id"], "version": a["version"],
                            "environment": c.get("environment"),
                            "environment_id": env_ids.get(_env_basename_to_name(c.get("environment")))}
        print(f"[agent]  {a['name']}: {'created' if a.get('created') else 'exists'}  v{a['version']}  {a['id']}")
    _write("agent-ids.json", state)

    print(f"\n✅ Provisioned via {provider.name}: {len(env_ids)} environments, {len(state)} agents, "
          f"{len(vault_ids)} vaults, {len(mem_ids)} memory stores.\n   State written to {state_dir}")


def main():
    ap = argparse.ArgumentParser(description="Provision all agents + environments for a provider.")
    ap.add_argument("--provider", default=os.environ.get("AGENT_PROVIDER", "anthropic"))
    ap.add_argument("--dry-run", action="store_true", help="resolve + print the plan; no API calls")
    ap.add_argument("--no-vault", action="store_true")
    ap.add_argument("--no-memory", action="store_true")
    args = ap.parse_args()

    provider = get_provider(args.provider)
    if args.dry_run:
        dry_run(provider)
    else:
        apply(provider, args.no_vault, args.no_memory)


if __name__ == "__main__":
    main()
