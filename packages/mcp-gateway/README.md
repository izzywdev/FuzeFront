# `@fuzefront/mcp-gateway`

A generic **OpenAPI → MCP SSE gateway**. It exposes a product's existing REST
API as MCP tools. It contains no product logic and never will: adding a product
means pointing a new pod at a different spec, not editing this package.

**Shared implementation, per-product deployment.** One codebase, one container
image — but each product runs its **own** gateway pod in its **own** namespace,
configured with its own OpenAPI document and its own upstream base URL. There is
no cross-product routing, no spec registry, and no multi-tenancy: a pod knows
exactly one product. The owner's target shape is four pods per product —
backend, frontend, MCP SSE, A2A — and this is the third of those.

## Why a gateway instead of ten hand-written MCP servers

A hand-written server per product means ten places to get the dangerous part
wrong. The dangerous part is not the HTTP call; it is the claim each tool makes
about whether it changes anything. Deriving that mechanically from one spec, in
one place, with the invariants enforced at boot, is the only version of this
that stays true as the products change.

## Configuration

All runtime, all per pod:

| Variable | Required | Meaning |
|---|---|---|
| `MCP_PRODUCT` | yes | Product name; becomes the MCP server name |
| `MCP_UPSTREAM_BASE_URL` | yes | In-cluster base URL of the product's REST API |
| `MCP_OPENAPI_SPEC` | yes | Path to the mounted OpenAPI 3.x document (YAML or JSON) |
| `MCP_TOOL_OVERRIDES` | no | Path to the mounted mutation-overrides file |
| `PORT` | no | Listen port (default 8081) |

## Endpoints

| Route | Purpose |
|---|---|
| `GET /sse` | Opens the MCP event stream, returns a session id |
| `POST /messages?sessionId=…` | Client → server JSON-RPC for that session |
| `GET /healthz` | Liveness; reports the tool count |
| `GET /tools.json` | The tool manifest with its mutation classification |

`/tools.json` is unauthenticated on purpose: it exposes the *shape* of the API,
which the OpenAPI document already publishes, and never any data from it.

## The `mutates` contract

Every tool carries an explicit `mutates` boolean and a `reversibility` value.
Both are derived from the spec, then narrowed by an optional per-product
overrides file.

Defaults, from the HTTP method:

| Method | `mutates` | `reversibility` |
|---|---|---|
| `GET` `HEAD` `OPTIONS` `TRACE` | `false` | — |
| `POST` to a path ending `/search`, `/query`, `/preview` | `false` | — |
| `POST` `PUT` `PATCH` | `true` | `reversible` |
| `DELETE` | `true` | `irreversible` |

The query-shaped-POST allowlist matches on **suffix**, not substring, so
`POST /tickets/search` is a read while `POST /search-index/rebuild` is not.

### The invariants that make this trustworthy

`src/classify.ts` throws — and the pod **refuses to start** — if an overrides
file tries to:

1. declare an operation `irreversible` while also declaring it a read;
2. relabel a non-query-shaped write as a read;
3. call a safe method `irreversible` (if a `GET` really mutates, the spec is
   what needs fixing).

A gateway that boots with a mis-declared irreversible tool is worse than one
that does not boot, because nobody finds out until something unrecoverable has
already happened.

**An irreversible operation cannot be reached as a side effect of a read.** That
is structural, not a convention: one MCP tool maps to exactly one OpenAPI
operation and issues exactly that one HTTP request, so a read tool has no code
path to a second request at all.

The classification also reaches the model that picks the tool — it is prefixed
into the description (`[READ-ONLY]`, `[WRITE]`, `[WRITE — IRREVERSIBLE]`) and
mirrored into MCP `annotations` (`readOnlyHint`, `destructiveHint`) and `_meta`,
so a client can refuse to auto-approve an irreversible call.

### Overrides file

```yaml
tools:
  decideApproval:
    reversibility: irreversible
    reason: An approval decision is final from the requester's side
  transitionTicket:
    reversibility: reversible
    reason: The status machine includes a reopen edge
```

## Authorization — forwarded, never substituted

The gateway forwards the **caller's** `Authorization` header to the product API
and holds no credential of its own. There is no `MCP_UPSTREAM_TOKEN`, and
`src/config.ts` refuses to start if one is set.

A shared service token would make every request look like the gateway rather
than like the user, silently bypassing every per-user Permit check on the
product side and turning the gateway into a confused deputy holding the union of
all users' permissions. A per-product pod sits in that product's namespace and
forwards the caller's identity to that product's API — which is why the
per-product deployment shape makes this *easier*, not harder.

A call with no caller identity is refused **before** any upstream request is
made, so it fails closed and visibly. Only an allowlist of headers is forwarded
(`authorization`, `x-request-id`, `x-tenant-id`, `x-organization-id`) — cookies
and everything else are dropped.

## Verifying a product before enabling it

Do not flip a product's `mcp.enabled` to `true` in `.fuze/manifest.json` until
the gateway has actually run against that product's spec and the tools have
enumerated over the real transport:

```bash
npm run build

MCP_PRODUCT=fuzeservice \
MCP_UPSTREAM_BASE_URL=http://fuzeservice-service.fuzeservice.svc.cluster.local:8080/v1 \
MCP_OPENAPI_SPEC=/path/to/FuzeService/contracts/openapi.yaml \
MCP_TOOL_OVERRIDES=/path/to/FuzeService/mcp/tools.overrides.yaml \
PORT=8099 node dist/main.js &

node scripts/smoke.mjs http://127.0.0.1:8099
```

`scripts/smoke.mjs` speaks the real MCP SSE transport and asserts the properties
the unit tests cannot: the handshake completes, tools enumerate, no read-only
tool is bound to an unsafe method, every irreversible tool is also a write, and
a call without caller identity fails closed.

## Tests

`npm test` — 31 vitest tests over classification, spec translation and identity
forwarding. The load-bearing one asserts that an unauthenticated call results in
**zero** upstream requests, not merely an error response.
