#!/usr/bin/env python3
"""Launch a single session for a role (or the coordinator) via the selected provider.

    python launch_session.py --role qa --prompt "list the tests you would run"
    AGENT_PROVIDER=anthropic python launch_session.py --coordinator --prompt "..."

Resolves the role's agent + environment from the synced id state, attaches vault +
memory resources, sends the prompt, streams output, and answers always_ask pauses
via the approver (interactive by default; --auto allow|deny for headless). The
provider is chosen by AGENT_PROVIDER (default anthropic). For a cross-environment
hand-forward chain use orchestration/relay.py instead.
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))          # sync/
TEMPLATES_ROOT = os.path.dirname(HERE)                     # agent-templates/
for _p in (TEMPLATES_ROOT, HERE):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import common  # noqa: E402  (state_dir)
from providers import get_provider              # noqa: E402
from providers.base import interactive_approver, auto_approver  # noqa: E402

PROVIDER = get_provider()

STATE = common.state_dir()
AGENT_STATE = os.path.join(STATE, "agent-ids.json")
VAULT_STATE = os.path.join(STATE, "vault-ids.json")
MEMORY_STATE = os.path.join(STATE, "memory-ids.json")
HANDOFF_INSTRUCTIONS = ("Shared cross-session handoff workspace. Read relevant /handoff/*.md before "
                        "starting delegated work; persist your concise work-state under /handoff/<id>.md "
                        "and pass the path when you hand forward or resume another agent.")


def _resolve(target):
    if not os.path.exists(AGENT_STATE):
        raise SystemExit("Run providers/provision.py first (agent-ids.json missing).")
    state = json.load(open(AGENT_STATE, encoding="utf-8"))
    if target not in state:
        raise SystemExit(f"Unknown target '{target}'. Known: {', '.join(state)}")
    entry = state[target]
    if not entry.get("environment_id"):
        raise SystemExit(f"'{target}' has no environment_id — re-run providers/provision.py")
    return entry


def vault_ids(disabled):
    if disabled or not os.path.exists(VAULT_STATE):
        return []
    return list(json.load(open(VAULT_STATE, encoding="utf-8")).values())


def memory_resources(disabled):
    """Attach every synced memory store (read_write) so the chain shares one
    persistent handoff workspace. Attach-at-create only — resuming reuses whatever
    the session was created with."""
    if disabled or not os.path.exists(MEMORY_STATE):
        return []
    ids = json.load(open(MEMORY_STATE, encoding="utf-8"))
    return [PROVIDER.memory_resource(sid, "read_write", HANDOFF_INSTRUCTIONS) for sid in ids.values()]


def main():
    ap = argparse.ArgumentParser(description="Launch a role/coordinator session via the selected provider.")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--role", help="role key (frontend/backend/qa/devops)")
    g.add_argument("--coordinator", action="store_true", help="launch the routing coordinator")
    ap.add_argument("--prompt", required=True, help="the task to send as the first user message")
    ap.add_argument("--auto", choices=["allow", "deny"], help="headless approval mode (default: interactive)")
    ap.add_argument("--no-vault", action="store_true", help="do not attach vault credentials")
    ap.add_argument("--no-memory", action="store_true", help="do not attach the handoff memory store")
    args = ap.parse_args()

    target = "coordinator" if args.coordinator else args.role
    entry = _resolve(target)
    session_id = PROVIDER.create_session(
        entry["id"], entry["version"], entry["environment_id"],
        vault_ids=vault_ids(args.no_vault),
        memory_resources=memory_resources(args.no_memory), title=f"launch:{target}")
    print(f"session {session_id}  (provider {PROVIDER.name}, agent {entry['id']} v{entry['version']}, "
          f"env {entry['environment_id']})\n")

    approver = auto_approver(args.auto) if args.auto else interactive_approver
    PROVIDER.run_turn(session_id, args.prompt, approver)
    print("\n[done]")


if __name__ == "__main__":
    main()
