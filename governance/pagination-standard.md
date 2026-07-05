# Pagination standard (enforced)

The canonical pagination standard for the Fuze family. The policy summary is `CLAUDE.baseline.md` §4.1; this is the full reference that §4.1 and the agent defs point to. Policy owned by `platform-governance`; enforced by **`gate-pagination`** (`scripts/gate_pagination.py`, run from `harden-gate.yml`). Where this doc and §4.1 ever disagree, the **wire contract in §4.1 wins** — this doc only elaborates it.

## 1. Rule

Every **LIST / collection GET** that can return an unbounded number of rows **MUST** paginate — in the contract **and** in the implementation. "Unbounded" means the row count grows with data the caller does not control (all orgs, all events, all messages, search hits). A collection GET that returns "all of X" with no `limit` is a defect, even if X is small *today*.

### Wire contract (canonical — identical to §4.1)

**Request params:**
- `limit` — integer, with a declared **default** and an enforced **max**.
- **and either** `cursor` — preferred; an opaque, server-issued string — **or** `offset` — integer; only where cursoring is impractical.

**Response envelope:**
```json
{
  "items": [ /* ... the page of rows ... */ ],
  "page": {
    "nextCursor": "<string|null>",
    "hasMore": false,
    "total": 0
  }
}
```
- `nextCursor: null` ⇒ this is the last page.
- `hasMore` ⇒ a further page exists.
- `total` is **optional** — omit it when counting the full set is expensive.
- The **offset variant** carries `page: { "offset", "limit", "hasMore", "total?" }` instead of `nextCursor`.

**Server-side enforcement:**
- `limit` is enforced server-side: a request over the max is **clamped to the max** — never honored unbounded, never trusted from the client.
- The cursor walks the **full set deterministically**, with **no gaps and no duplicates**, even under concurrent writes.

### Compliant OpenAPI snippet

A cursor-paginated collection GET — request params plus the shared envelope schema:

```yaml
paths:
  /v1/orgs/{orgId}/members:
    get:
      operationId: listOrgMembers
      summary: List members of an organization
      parameters:
        - { name: orgId, in: path, required: true, schema: { type: string } }
        - name: limit
          in: query
          schema: { type: integer, default: 50, maximum: 200 }   # default + enforced max
        - name: cursor
          in: query
          required: false
          schema: { type: string }                                # opaque, server-issued
      responses:
        '200':
          description: A page of members
          content:
            application/json:
              schema: { $ref: '#/components/schemas/MemberPage' }

components:
  schemas:
    Page:
      type: object
      required: [nextCursor, hasMore]
      properties:
        nextCursor: { type: string, nullable: true }   # null ⇒ last page
        hasMore:    { type: boolean }
        total:      { type: integer }                   # optional
    MemberPage:
      type: object
      required: [items, page]
      properties:
        items:
          type: array
          items: { $ref: '#/components/schemas/Member' }
        page: { $ref: '#/components/schemas/Page' }
```

### Compliant JSON response

```json
{
  "items": [
    { "id": "mbr_01H...", "email": "ada@example.com", "role": "owner" },
    { "id": "mbr_01H...", "email": "grace@example.com", "role": "admin" }
  ],
  "page": {
    "nextCursor": "eyJsYXN0SWQiOiJtYnJfMDFILi4uIiwibGFzdFNvcnRWYWwiOiIyMDI2LTA2LTI5VDExOjAyOjAzWiJ9",
    "hasMore": true
  }
}
```

The next request repeats with `?limit=50&cursor=eyJsYXN0SWQ...`. When the server returns `"nextCursor": null` (or `"hasMore": false`), the walk is complete.

## 2. Cursor vs offset

**Default to cursor.** Use `offset` only as a fallback.

| | Cursor (preferred) | Offset (fallback) |
|---|---|---|
| Stable under concurrent writes | Yes — keys off a value, not a position; inserts/deletes don't shift the window | No — a row inserted/deleted before the window causes a skipped or duplicated row |
| Deep-page cost | Constant — `WHERE (sort_key, id) > (?, ?)` rides an index | Degrades — `OFFSET n` scans and discards `n` rows |
| Jump to arbitrary page N | No (sequential walk only) | Yes |
| Good for | Any large or actively-written set: feeds, events, search, audit logs, members | Small **bounded** sets, or admin tables where "go to page N" is a real requirement and the set is small |

**Opaque cursors.** A cursor is an **opaque, server-issued token** — the client treats it as a blob and echoes it back unmodified. It encodes the **sort key + a tiebreaker** so the walk is deterministic (the tiebreaker, usually the primary id, breaks ties when the sort key is non-unique — without it, rows sharing a sort value can be skipped or repeated). A typical implementation is `base64({ "lastId": ..., "lastSortVal": ... })`.

- **Never leak internals** through the cursor: no raw SQL `OFFSET`, no internal row numbers, no DB primary keys the client could enumerate or tamper with for unauthorized access. If the cursor's integrity matters, sign or encrypt it. The client must not be able to forge a cursor that reads outside its authorization scope.
- Treat a malformed/expired cursor as a `400`, not a silent reset to page 1.

## 3. Exemptions

An endpoint is exempt **only** when its result set is **inherently bounded or a singleton**:

- **Single-resource GET** — `GET /x/{id}` (returns one object). The gate already skips `/{id}` tails.
- **Fixed-small enum / lookup** — e.g. `GET /currencies`, `GET /plan-tiers`: a closed, small set that does not grow with user data.
- **Aggregate / scalar** — a count, a sum, a single computed object.
- **Hard server-capped feed** — an endpoint that returns at most a fixed small N by design (e.g. "top 10").

Exemption is **annotated, never silent.** A collection GET that is genuinely bounded but trips the heuristic must declare *why* — so the next reader (and the gate) sees an explicit decision, not an oversight. Two ways to annotate:

**A. Vendor extension on the OpenAPI operation** (preferred — lives with the contract):
```yaml
  /v1/plan-tiers:
    get:
      operationId: listPlanTiers
      summary: List the fixed set of subscription plan tiers
      x-pagination: exempt
      x-pagination-reason: closed enum of 7 plan tiers, never grows with user data
      responses:
        '200': { description: All plan tiers, ... }
```

**B. Repo allowlist** — list the route in either:
- `governance/pagination-allowlist.txt`, **or**
- `.fuze/pagination-allowlist.txt`

one `GET /path` per line; `#` introduces a comment; blank lines ignored. The path must match the route as written in the spec (e.g. `GET /v1/plan-tiers`). Matching is case-insensitive. A starter (empty) allowlist ships at `governance/pagination-allowlist.txt`.

Prefer the **`x-pagination` annotation** (the contract is the source of truth and travels with the spec); reserve the allowlist for cases where you can't edit the operation object (e.g. a vendored/generated spec).

## 4. CI enforcement

`gate-pagination` is a job in `harden-gate.yml`. It runs `scripts/gate_pagination.py` (it probes `scripts/`, `.fuze/`, then `.github/scripts/` for the script; if none is found it warns and passes). The script:

1. **Finds every OpenAPI/Swagger spec** in the repo (by filename pattern or a cheap content sniff for an `openapi:`/`swagger:` key), pruning `node_modules`, `dist`, `vendor`, etc. **No spec found ⇒ pass** (report-only-friendly).
2. For each `paths.*.get`, decides whether it is a **collection GET** (the heuristic below).
3. For each collection GET that is **not exempt**, FAILS it if it is missing any of: the `limit` param, a `cursor` **or** `offset` param, or the `{ items, page }` response envelope. The failure message names exactly what's missing.

**Collection-GET heuristic** (an operation is treated as a collection GET when):
- its method is `get`, **and** the path does **not** end in a path-param tail (`/{id}`) — singletons are skipped; **and** any one of:
  - the 2xx response schema is an **array**, **or**
  - the 2xx response schema is already a **`{ items, page }` envelope**, **or**
  - the `operationId` / `summary` is **list-like** (`list`, `search`, `index`, `all`, `feed`, `collection`, `query`), **or**
  - the path has a **plural segment** (a segment ending in `s` that isn't a `{param}`).

This is deliberately broad so it errs toward *flagging*: a genuinely-bounded endpoint that trips it is silenced with one `x-pagination: exempt` line (§3), which is the intended, visible escape hatch. A malformed spec is a report-only `::warning` (the gate does not crash on bad YAML/JSON).

**Roll-out.** The first pass is **report-only** (`python "$SCRIPT" . || true`) — it surfaces violations as annotations without breaking the build, so a repo can annotate/allowlist its existing endpoints. It is **ratcheted to enforcing per-repo** by removing the `|| true`, once that repo's contracts are clean. Treat report-only output as a punch-list, not as permission to skip.

## 5. Ownership

Pagination is designed into the contract and verified end-to-end — not bolted on:

- **`contract-designer`** — **declares** pagination in the contract: the `limit`/`cursor`|`offset` params, the `{ items, page }` envelope schema, the default + max, and any `x-pagination: exempt` annotations. The contract PR is not valid if a collection GET lacks pagination or an exemption.
- **`backend-engineer`** — **implements** it: clamps `limit` to the max server-side, builds opaque deterministic cursors (sort key + tiebreaker), and covers limit-clamping + cursor-walk in its own unit tests.
- **`test-engineer`** — **independently asserts**, on every paginated endpoint: the params + envelope are present, the limit is enforced (an over-max request is clamped), and the cursor **walks the full set with no gaps/dupes**. This is the objective verification — the backend does not grade its own pagination.
- **`frontend-engineer`** — builds the **pager / infinite-scroll UI** wired to the cursor envelope (consume `nextCursor`/`hasMore`, request the next page; never assume offset math), design-system-first.
- **`platform-governance`** — owns this **policy**, the gate, and its propagation across repos.
