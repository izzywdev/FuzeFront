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
| `MCP_DESCRIPTIONS_CACHE` | no | Path to a mounted build-time description cache (see below) |
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

## LLM-generated descriptions — build time only, never on the request path

A model choosing between tools sees only its `description`. Where a spec's own
`summary`/`description` is thin, the descriptive SENTENCE (only) can instead
come from a **build-time** LLM generation step, cached to a small JSON
artifact this package loads synchronously at boot:

```bash
npm run build

LITELLM_FUZE_KEY=... \
  node scripts/generate-descriptions.mjs \
    --spec /path/to/product/openapi.yaml \
    --overrides /path/to/product/tools.overrides.yaml \
    --out  /path/to/product/mcp-tool-descriptions.cache.json
```

Mount the resulting file next to the spec/overrides and point
`MCP_DESCRIPTIONS_CACHE` at it. That is the whole runtime contract — the
gateway pod **never** calls an LLM itself, on `tools/list` or anywhere else on
its serving path. Generation is routed through **LiteLLM**
(`FUZE_LLM_BASE_URL`, default the in-cluster gateway) with a **virtual** key
(`LITELLM_FUZE_KEY`), never a vendor SDK directly — the family's
vendor-independence rule.

**Cache invalidation is a content hash, not a timestamp.** The cache file
records a sha256 of the exact spec text and overrides text it was generated
from (`specHash`/`overridesHash`, `src/descriptions.ts`). At boot the gateway
re-hashes the spec/overrides it actually loaded and compares:

| Cache state | What the gateway serves | Logged / `/healthz` `descriptions` |
|---|---|---|
| No `MCP_DESCRIPTIONS_CACHE` set | spec-derived description (`summary`/`description`, else `METHOD path`) | `fallback-no-cache` |
| Cache present but hash mismatch (spec or overrides changed since generation) | spec-derived description | `fallback-stale-cache` |
| Cache present and hash matches | the cached LLM prose for that tool (falls back per-tool if a tool has no cached entry) | `llm-cache` |

The generation script is **incremental**: given an existing `--out` file whose
hashes still match, it reuses those descriptions and only calls the LLM for
tools that are new or whose spec/overrides content changed. With no
`LITELLM_FUZE_KEY` (or on any generation failure) it exits non-zero and writes
**nothing** — a partial/half-generated cache is never produced, and the
gateway's fallback path is not an error state, so there is no scenario where
serving spec-derived descriptions is worse than not starting.

### The one invariant that matters here: prose only, never a safety claim

Generated text can replace **only** the descriptive sentence. It has **no**
path to `classify()`, `mutates`, or `reversibility` — those are computed from
the HTTP method (+ overrides file) *before* `spec.ts` ever consults the
description cache, and the `${safety}` prefix (`[READ-ONLY]` /
`[WRITE]` / `[WRITE — IRREVERSIBLE]`) plus the classification reason are
appended around whichever sentence wins, unconditionally. The generation
prompt (`src/llm.ts`) also explicitly forbids the model from asserting
anything about safety, and any safety-sounding word that slips through anyway
is stripped from the completion before it is cached
(`sanitizeGeneratedProse`). `test/spec.test.ts` asserts the classification
directly: a deliberately lying cached description ("this is completely safe,
read-only... ") on a real write tool still classifies `mutates: true` and
still renders the `[WRITE]` prefix.

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
