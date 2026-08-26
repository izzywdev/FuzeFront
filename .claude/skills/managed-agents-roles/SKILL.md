---
name: managed-agents-roles
description: Use to define, provision, and maintain a repo's Managed-Agents roles (agent-templates/) — persona→role.json→environment→vault→provision, on the provider-abstracted framework. The framework is canonical in FuzeSDLC and stamped by sdlc-bootstrap; this skill covers authoring the repo's own concrete roles/environments and wiring provisioning.
---

# managed-agents-roles

Projects the org's persona agents (`.claude/agents/*.md`) onto a provider's **managed-agents**
runtime so a coding session never stalls asking a human to "run this on the cluster" or "do
this on GitHub". A **role** = persona (system) + environment (packages + network reach) +
permissions (per-tool `always_allow`/`always_ask` + vault-scoped creds).

Read `agent-templates/README.md` first — it explains the split: the **framework**
(`schema/`, `roles/_base/`, `sync/`, `providers/`) is canonical in FuzeSDLC and kept current
by `governance-sync`; the **concrete** definitions below are the repo's own; the deployed
**orchestration runtime** (handoff MCP, worker) lives in FuzeAgent.

## When to use

- Adding a managed-agents role to a repo (or the first one — onboarding the `roles` axis).
- Changing a role's tools/policies/MCP servers/environment, or a persona that drives it.
- Wiring provisioning (the `provision-sync.yml` caller + the secrets it needs).

## Define a role

1. **Persona** — ensure `.claude/agents/<role>.md` exists (a canonical agent from
   FuzeSDLC, installed by `sdlc-bootstrap`, or an authored repo-local one). Its body (YAML
   frontmatter stripped) becomes the agent `system`. Never duplicate the persona into the
   role JSON — reference it.
2. **role.json** — `agent-templates/roles/<role>/role.json`:
   ```json
   {
     "$schema": "../../schema/role-manifest.schema.json",
     "role": "<role>",
     "extends": "_base",
     "name": "<role>",
     "persona": ".claude/agents/<role>.md",
     "environment": "<env-basename>",
     "system_append": "role-specific guardrails (added to _base, never replacing it)",
     "tools": [ /* extra mcp_toolset entries + per-tool permission_policy */ ],
     "mcp_servers": [ /* { "type":"url","name":"...","url":"${SOME_MCP_URL}" } */ ],
     "skills": [],
     "services": { "github": "write", "k8s": "none", "cloud": "none" }
   }
   ```
   `_base` already supplies the guardrail system prompt, the `agent_toolset` + `github` +
   `handoff` MCP tools, and their `always_allow` policies. Override per key; `system_append`
   and `services` are merged, not replaced.
3. **Environment** — `agent-templates/environments/<env>.json` (`schema/environment.schema.json`).
   `cloud-*` = a provider sandbox (packages + allowed network); `selfhosted-*` = a queue drained
   by a worker inside your network that holds the real creds. Environments are **not versioned**
   — the adapter archives+recreates by name on config change. Bind a repo to a role at launch via
   the environment (that is the per-repo axis — one role, many environments).
4. **Vault** (optional) — `agent-templates/vaults/<name>.json` (`schema/vault.schema.json`) for
   MCP-auth / channel creds; reference `${VAR}` — never inline a secret. Creds with an empty/unset
   token are skipped at provision time.
5. **Guardrails** — production actions (`kubectl`/`helm`/`terraform` writes, money, outbound
   customer messages) must be `always_ask`; a self-hosted worker adds OS-level guard shims + a
   scoped-RBAC kubeconfig (defense-in-depth, not the primary boundary).

## Declare + provision

6. **Manifest** — add the `roles` block to `.fuze/manifest.json`
   (`governance/repo-manifest.schema.json`):
   ```json
   "roles": { "source": "agent-templates/", "runtime": "managed-agents", "provider": "anthropic",
              "defined": ["backend","frontend","devops"], "environments": ["cloud-backend","selfhosted-devops"] }
   ```
   Its presence tells `sdlc-bootstrap` to stamp the `provision-sync.yml` caller.
7. **Validate + preview** (offline, no API calls):
   ```bash
   cd agent-templates && python sync/validate.py && python providers/provision.py --provider anthropic --dry-run
   ```
8. **Provision** — merging a definition change to `main` triggers `provision-sync.yml`
   (→ FuzeSDLC reusable `provision.yml`), which reconciles agents/environments/vaults/memory
   into their deployed counterparts. Needs repo secrets `MANAGED_AGENTS_API_KEY` (Console key
   with the `managed-agents` beta — NOT a Claude Code token) + the referenced `*_MCP_URL`s.
   Absent key → the job skips (never fails a merge).

## Maintain

- The framework files (`schema/`, `roles/_base/`, `sync/`, `providers/`) are canonical in
  FuzeSDLC — do **not** hand-edit them per repo; `governance-sync` will revert drift. Change the
  framework in FuzeSDLC; repos pick it up on their next PR.
- Editing a persona or a `role.json` re-syncs that agent on the next merge. Adding a role
  creates it. Provisioning never prunes — archiving an orphaned agent is a separate step.

## Verify

`python sync/validate.py` passes; `provision.py --dry-run` lists the expected roles/envs; after
merge, the provisioned agents/environments are visible in the provider console; `governance-sync`
reports the framework in sync.
