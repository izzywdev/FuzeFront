# Pagination standard (FuzeFront)

FuzeFront inherits the family-wide pagination standard from the FuzeSDLC baseline (§4.1). This page is the FuzeFront-facing summary; the full reference is `governance/pagination-standard.md` (vendored from FuzeSDLC).

## The rule

Every **LIST / collection GET** that can return an unbounded number of rows MUST paginate — in the OpenAPI contract and in the implementation.

- **Request params:** `limit` (with a declared **default** and an enforced **max**) **and** either `cursor` (preferred — opaque, server-issued) **or** `offset` (fallback).
- **Response envelope:**
  ```json
  { "items": [ ... ], "page": { "nextCursor": "<string|null>", "hasMore": true, "total": 123 } }
  ```
  `nextCursor: null` ⇒ last page. `total` is optional (omit when counting is expensive). Offset-style endpoints may use `{ "offset", "limit", "hasMore", "total?" }` instead.
- **`limit` is enforced server-side** (a request over the max is clamped, never honored unbounded); the cursor walks the full set deterministically (no gaps/dupes under concurrent writes).

## Exemptions

An endpoint is exempt only when its result set is **inherently bounded or a singleton** (single-resource GET `/x/{id}`, a fixed small enum/lookup, an aggregate/scalar, or a hard server-capped feed). Declare it, don't silently skip it:

- Annotate the OpenAPI operation with `x-pagination: exempt` (+ `x-pagination-reason: "<why>"`), **or**
- list `GET /path` in `governance/pagination-allowlist.txt` (one per line, `#` comments allowed) — use only when you cannot edit the operation object.

## CI enforcement (`gate-pagination`)

The `gate-pagination` job in `.github/workflows/harden-gate.yml` runs `scripts/gate_pagination.py`, which parses the repo's OpenAPI/Swagger contracts and **fails** any unbounded collection GET lacking the params + envelope unless exempt. It is **report-only in the first pass** (`|| true`); it will be ratcheted to enforcing once the existing contracts are annotated.

### Current FuzeFront findings (first-pass, advisory)

As of this gate's introduction, `gate-pagination` flags these in `services/billing-service/openapi.yaml`:

- `GET /plans` — likely a genuine **exemption** (a closed, small set of plan tiers that does not grow with user data) → annotate `x-pagination: exempt`.
- `GET /subscriptions` — should **paginate** (a tenant can accrue unbounded subscription rows).

These are owned by `billing-payments-engineer` / `contract-designer` to resolve in the billing-service contract — not addressed here (this change is governance/CI only and does not touch the live billing flow).

## Ownership

- `contract-designer` declares pagination (or the exemption) in the OpenAPI contract.
- `backend-engineer` implements it + unit-tests the limit clamp, envelope, and cursor walk.
- `test-engineer` independently asserts params + envelope + limit-enforcement + cursor-walk on every paginated endpoint.
- `frontend-engineer` builds the pager / infinite-scroll UI wired to the cursor envelope.

Policy owned by `platform-governance` (FuzeSDLC baseline §4.1).
