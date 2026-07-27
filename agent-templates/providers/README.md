# providers/ — the runtime seam

The role manifests, environments, vaults, memory, and orchestration are **provider-
agnostic**. A `providers/<name>/adapter.py` translates them into a specific backend
and implements the runtime. Pick one with `AGENT_PROVIDER` (default `anthropic`):

```python
from providers import get_provider
p = get_provider()            # AGENT_PROVIDER env, default "anthropic"
p = get_provider("openai")    # explicit
```

## The interface — `base.py:AgentProvider`

- **Provisioning:** `ensure_environment`, `ensure_agent`, `ensure_vault`, `ensure_memory`
- **Runtime:** `create_session`, `send_message`, `run_turn`, `run_until_block`,
  `resume_session`, `confirm_tool`, `archive_session`
- **Memory:** `memory_resource`, `memory_write`, `memory_read`
- **`capabilities`** flags (`self_hosted`, `vaults`, `memory`, `multiagent`) — provisioning
  skips unsupported resource kinds.

The approver contract and the `{status: idle|blocked|error, pending}` shape are shared
(`base.interactive_approver` / `base.auto_approver`), so orchestration is identical across providers.

## Providers

| Provider | Status | Backing |
|---|---|---|
| `anthropic` | ✅ reference | Claude Managed Agents (`/v1/agents`, `/v1/environments`, `/v1/sessions`, vaults, memory) — wraps `sync/common.py` + `sync/driver.py` + `sync/role_loader.py`. |
| `openai` | 🧩 stub | Assistants / Responses + Agents SDK — see `openai/adapter.py` docstring for the mapping. |
| `hermes` | 🧩 stub | Hermes models on an OpenAI-compatible / custom tool-calling runtime — see `hermes/adapter.py`. |

## Add a provider

1. `providers/<name>/adapter.py` with `class <Name>Provider(AgentProvider)` implementing the
   methods; set `capabilities`. Translate the manifest *intent* (tools/policies/mcp/skills/packages)
   into your backend's payloads — don't change the manifests.
2. Register it in `providers/__init__.py:get_provider` (lazy import).
3. `providers/<name>/__init__.py` re-exports the class.

## Provision (create everything for a provider)

```bash
python providers/provision.py --provider anthropic --dry-run   # offline plan, no API calls
python providers/provision.py --provider anthropic             # create/update live, prints ids
```

`provision` creates environments + agents (+ vaults + memory) idempotently and writes the id
state (`environment-ids/agent-ids/vault-ids/memory-ids.json`) under the state dir.

## Auto-sync on merge

Agent-definition changes reconcile into their **deployed** counterparts automatically.
`.github/workflows/provision-sync.yml` triggers on every merge to `main` that touches a
definition (`roles/`, `environments/`, `vaults/`, `memory/`, `coordinator/`, `providers/`,
`sync/`, or the personas in `.claude/agents/`) and calls the reusable `provision.yml` **per
provider** (matrix — currently `[anthropic]`; add `openai`/`hermes` when implemented). Because
`provision.py` only updates an agent/environment when its config actually changed, unchanged
definitions are no-ops and changed ones get a new version. Editing a persona `.md` re-syncs the
agent's `system`; editing a `role.json` re-syncs its tools/policies/mcp/env; a new role is
created. (Removed roles are **not** pruned — archiving an orphaned agent is a separate step.)

## Not yet routed

The handoff MCP server (`orchestration/handoff_mcp/server.py`) still calls the Anthropic
`driver` directly (it's the deployed container; routing it through `get_provider()` needs a
Dockerfile change). Its cross-provider runtime (OpenAI/Hermes have different session-resume
semantics) is the next step — the stubs document the mapping.
