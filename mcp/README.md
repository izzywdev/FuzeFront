# FuzeFront MCP server (scaffold)

**Status: scaffold — `enabled: false`.** This directory is the Model Context
Protocol surface declared by `.fuze/manifest.json` → `mcp` (server
`fuzefront-platform`, transport `stdio`, entry `mcp/server.ts`). It starts,
completes the MCP handshake, and advertises the tools in `tools.json` — which
is intentionally **empty**. It stays `enabled: false` until a real, working
tool is wired: an advertised server that errors on every call is worse than one
that is off.

MCP is how an **LLM session** queries and operates on this repo's objects and
data directly — the sibling of the A2A surface (`agent-templates/`,
`.fuze/manifest.json` → `a2a`), which is how another *agent* asks this repo for
an outcome.

## Run / verify

```bash
node --experimental-strip-types mcp/server.ts
# then feed newline-delimited JSON-RPC on stdin, e.g.:
printf '%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | node --experimental-strip-types mcp/server.ts
```

`initialize` returns the protocol version + server info; `tools/list` returns
`{"tools":[]}` until tools are implemented.

## Ownership

- **mcp-maintainer** owns the *wiring*: the manifest `mcp` block, this server's
  transport/handshake, the `tools.json` ↔ `tools/list` contract, `mutates`
  classification, and protocol-version currency. It does **not** author tool
  behaviour.
- **backend-engineer** owns tool *behaviour*: what each tool queries, its
  business rules, and the real `inputSchema` in `tools.json`.

## Intended tool inventory — `NEEDS PRODUCT` (backend-engineer)

The manifest note names the intended surface: *query the app registry (which
apps are registered, their manifest/nav placement, health) and the org/user
context*. The backend already exposes this domain over HTTP; the tools below
are the obvious MCP projections. **They are TODO skeletons — behaviour is not
invented here.** When implementing, add each to `tools.json` with a real
`inputSchema` and the `mutates` value shown, and only then consider
`enabled: true`.

| tool (proposed) | backing route | `mutates` | notes |
|---|---|---|---|
| `list_apps` | `GET /api/v1/apps` (`routes/apps.ts`) | `false` | registered apps, integration type, visibility, org scope |
| `get_app` | `GET /api/v1/apps/:id` | `false` | single app manifest / nav placement |
| `get_app_health` | app heartbeat (`online`/`offline`/`degraded`) | `false` | health only; do not leak internal remote URLs beyond what the HTTP API already returns |
| `get_portal_context` | `GET /api/v1/portal/context` (`routes/portal.ts`) | `false` | **public** boot context; must honour the same portal flag-gating and fail-closed (`PORTAL_SUSPENDED`) behaviour as the route |
| `get_current_portal` | `GET /api/v1/portal/current` | `false` | caller's own portal; resolve **only** from the authenticated session (`portalId`/JWT claim), never a client-supplied id — mirror the route's cross-tenant fail-closed guards |
| `list_organizations` | `routes/organizations.ts` | `false` | org/user context |

### Read/write + sensitive-exposure flags (mcp-maintainer classification)

- Every tool above is a **read** (`mutates: false`). A mutating tool (create/
  update/delete an app, suspend a portal, change org membership) must be its own
  explicitly-named tool with `mutates: true` — never a side effect of a read.
- **Tenant isolation is a fail-closed invariant, not a nicety.** `get_current_portal`
  and any org-scoped tool must resolve identity from the session/token, never
  from tool arguments, exactly as the HTTP routes do. An MCP tool that accepts a
  `portalId`/`orgId` argument and returns it without an authorization decision
  reintroduces the cross-tenant leak the routes were written to prevent.
- **No secret material.** None of the reads above should return credentials,
  tokens, or signing material. If a future tool needs to expose secret
  *material* (vs. listing/describing a key), that is a **product exposure
  decision** — it must be its own explicitly-named tool, and it is flagged to
  the product owner, not decided here.
