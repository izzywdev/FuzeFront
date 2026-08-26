# FuzeFront's A2A surface — current state and what's left

**There is no A2A server in this repo, and there should not be one.** The shared
A2A runtime (Claude-driven, one image, zero product logic — system prompt,
skills, and tool access all arrive as mounted/env configuration) already
exists generically in `izzywdev/FuzeAgent`:

- `agent-templates/a2a/` — the server/adapter (Python, `python -m a2a.runtime`).
  It is a thin translation layer over the existing Managed-Agents provider seam
  (`agent-templates/providers/base.py`) — session creation, tool use, and
  interruption/resume are the platform's existing session machinery, not a new
  task engine (`agent-templates/contracts/a2a/v1/state-mapping.md`).
- `deploy/helm/a2a-shared/` — the chart, already deployed and `1/1 Ready` in
  prod as the shared multi-tenant server (`namespace: fuzeagent`). The **same**
  image and **same** values document also support a **per-product pod**
  serving exactly one tenant (contract v1.2.0 added `a2a.inClusterUrl` for
  this) — see `izzywdev/FuzeAgent`'s `docs/a2a/per-product-pod.md` for the
  full recipe.
- `ghcr.io/izzywdev/fuzeagent-a2a` — the published image both topologies run.

Building a second image/chart/server in FuzeFront for the same job would be
exactly the "second parallel A2A chart or image" this platform explicitly
warns against. This directory documents FuzeFront's side of the existing
contract instead: what FuzeFront's own data must contain, what's already
verified to work, and what remains — named precisely, for the agents that own
each remaining piece.

## What's verified (this repo's slice)

Run `scripts/verify-a2a-card.sh --test-rejection` from the repo root. It:

1. Fetches the **real, authoritative** `card_generator.py` from a pinned
   `izzywdev/FuzeAgent` commit (no reimplementation — the projection algorithm
   has exactly one owner).
2. Projects a card from THIS repo's `.fuze/manifest.json` +
   `agent-templates/roles/*/role.json` and validates it against the frozen
   `fuze-profile.schema.json`.
3. Proves the generator rejects a contract-violating fixture (an undescribed
   role) rather than silently emitting a placeholder.

As of this writing that script passes end-to-end:

```
OK: projected 'FuzeFront agent' with skills: ['app-shell-platform']
OK: interface: http://a2a-fuzefront.fuzefront.svc.cluster.local:8080/rpc (tenant=FuzeFront)
OK: correctly REJECTED (CardProjectionError: role 'broken-role' has no description; ...)
```

So `.fuze/manifest.json` (`providesTo`, `a2a.entryRole`, `a2a.servingRoles`)
and `agent-templates/roles/app-shell-platform/role.json` (`description`,
non-empty) are **already correct** card-projection inputs. Nothing to fix
there.

## What this PR added

`agent-templates/roles/app-shell-platform/role.json` now wires its session to
FuzeFront's own MCP gateway (`packages/mcp-gateway`, already deployed as the
`fuzefront-mcp` Service) via `mcp_servers`/`tools`, marked `optional: true` so
it degrades cleanly (drops with a log line, per `role_loader.py`'s
`agent_payload()`) until `FUZEFRONT_MCP_URL` is actually provisioned. This is
the mechanism by which the served role can **act** — query/mutate the app
registry — rather than only advertise its `a2a.examples`. It does not touch
the card: `mcp_servers`/`tools` are deliberately never projected
(`card-projection.md` §3/§7 — encapsulation).

## What's still open, named precisely

### 1. A real architectural gap: MCP identity forwarding for an A2A-invoked session

`packages/mcp-gateway` forwards the **caller's own** bearer token to
`app-registry-service` and refuses to start if given a service credential of
its own (`src/upstream.ts` / `src/config.ts` — a deliberate anti-confused-deputy
design). An A2A-invoked session has **no browser-originated caller token** to
forward — it is not a human's request, it is the agent's own action taken on
a delegated goal. Wiring `mcp_servers` (this PR) is therefore **necessary but
not sufficient**: until the served agent has *some* identity `app-registry-service`
recognizes and Permit can evaluate, calls through `fuzefront-mcp` from an A2A
session will fail with `MissingIdentityError`.

This needs a real design decision, not a quick fix: most likely a scoped
machine principal for the A2A pod's own identity (distinct per product,
distinct from the M2M `client_credentials` identity `backend/src/authentik/
provision-a2a-clients.ts` already mints for *inbound* A2A **callers** — that
one authenticates who may ask FuzeFront's agent to do something, not what
FuzeFront's agent may do to its own app registry). Flagging this rather than
routing around it with a shared bypass token, which is exactly the failure
mode `mcp-gateway`'s design already refuses.

**Owner:** a joint call between `backend-engineer` (mcp-gateway / app-registry
authz) and `appsec-reviewer` (this is a genuine authn/authz surface, not a
config value) — not a solo backend change.

### 2. Deployment — devops-engineer

FuzeFront's own Helm chart (`deploy/helm/fuzefront/`) does not yet deploy a
per-product A2A pod. Per `izzywdev/FuzeAgent`'s `docs/a2a/per-product-pod.md`
(the canonical recipe — do not re-derive it), the chart needs an `a2a:` values
block and a Deployment/Service/ConfigMap set mirroring
`deploy/helm/fuzefront/templates/mcp-gateway.yaml`'s shape, but running the
**existing** `ghcr.io/izzywdev/fuzeagent-a2a` image:

```yaml
a2a:
  enabled: true
  image:
    repository: ghcr.io/izzywdev/fuzeagent-a2a   # already published; do not build a new one
    tag: <pin to a real digest, never latest>
  service: { type: ClusterIP, port: 8080 }
  protocolVersion: "1.0"
  inClusterUrl: http://a2a-fuzefront.fuzefront.svc.cluster.local:8080/rpc   # MUST match the Service
  auth:
    oidcIssuerUrl: https://app.fuzefront.com/application/o/fuzefront/
    oidcDiscoveryUrl: http://authentik-server.fuzefront.svc.cluster.local:9000/application/o/fuzefront/.well-known/openid-configuration
    audience: a2a
    callerClaim: repo
  cardSigning:
    keySecretRef: { name: a2a-card-signing, key: jws.key }
  tenants:
    - tenant: FuzeFront
      repo: izzywdev/FuzeFront
      ref: master   # NOT main — FuzeFront's default branch is master
      enabled: true
      entryRole: app-shell-platform
      external: false
      provider: { name: anthropic, apiKeySecretRef: { name: a2a-provider-anthropic, key: api-key } }
```

Secrets (`a2a-provider-anthropic`, `a2a-card-signing`, `ghcr-pull`, and
`a2a-repos-git` since FuzeFront is private) must be sealed **for the
`fuzefront` namespace** — the shared server's SealedSecrets are scoped to
`fuzeagent` and are not reusable. See per-product-pod.md §3 for the full list.

### 3. `FUZEFRONT_MCP_URL` provisioning — operator step

Once the A2A pod exists, `FUZEFRONT_MCP_URL` needs to be set wherever this
repo's Managed-Agents role sync/provisioning runs (the same mechanism that
already sets `GITHUB_MCP_URL`/`HANDOFF_MCP_URL` — see
`agent-templates/providers/provision.py`), to:

```
http://fuzefront-mcp.fuzefront.svc.cluster.local:8081/sse
```

This is a credential/CI-environment change, not a code change — named here so
whoever runs provisioning has the exact value, not left to rediscover it.

### 4. `a2a-maintainer` — nothing new required, one thing to know

`a2a-maintainer`'s job (`.claude/agents/a2a-maintainer.md`) is metadata
reconciliation: the `.fuze/manifest.json` `a2a` block, `providesTo`, and role
skeletons project a valid card. All of that is **already true** here (§ above)
and no manifest/role change is needed from that surface for this PR. The one
thing worth recording for its "contract currency" duty: this repo now vendors
nothing from the frozen contract permanently — `scripts/verify-a2a-card.sh`
fetches a **pinned commit** (`FUZEAGENT_REF` at the top of the script) on
every run. If `izzywdev/FuzeAgent`'s `agent-templates/contracts/a2a/v1/VERSION`
bumps in a way that changes projection, bump `FUZEAGENT_REF` here too — that
is squarely "contract currency" and belongs to `a2a-maintainer`'s upkeep pass.

## What was explicitly NOT built here, and why

- **No `packages/a2a-agent` Node runtime.** An initial version of this PR
  built one before this investigation found the real shared image. It was
  removed. A second implementation of the same server, even a faithful one,
  would fork the platform's one canonical A2A adapter into two things that
  must now be kept in sync by hand — the exact failure mode a shared image
  exists to prevent.
- **No new build+publish CI workflow.** `ghcr.io/izzywdev/fuzeagent-a2a` is
  already built and published by `izzywdev/FuzeAgent`'s own CI. FuzeFront
  consumes it by tag; it does not build it.
- **No Helm chart/template.** Named above as devops-engineer's slice, with
  the exact values spelled out so it is a direct transcription, not a design
  task.
