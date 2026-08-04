# fuzefront-identity

Server-owned entity identifiers and graph-create middleware for **Python**
FuzeFront microservices. The peer of `@fuzefront/shared/identity` (Node).

Policy: [`governance/identifier-standard.md`](../../governance/identifier-standard.md).

Dependency-free and pure ASGI — it installs into any Python microservice and
works under FastAPI, Starlette or a bare ASGI app without pulling a framework.

## Install

```bash
pip install fuzefront-identity
```

## Typed identifiers

Wire form `cus_01h455vb4pex5vsknk084sn02q`; storage stays a native `uuid`
column. The prefix makes cross-type confusion structurally impossible — no
string is simultaneously a valid `cus_` and a valid `inv_`.

```python
from fuzefront_identity import mint_id, assert_ref, to_uuid, IdentityError

customer_id = mint_id("customer")          # cus_01h455vb4pex5vsknk084sn02q
db.execute(sql, (to_uuid(customer_id),))   # store the 16-byte uuid

assert_ref("customer", body["customerId"])  # L0 check: no network, no cache, no DB
assert_ref("customer", mint_id("invoice"))  # raises IdentityError PREFIX_MISMATCH
```

`assert_ref` answers *"is this the right kind of thing"* — the only question a
local check can answer without the owning service, and the one that matters in a
microservices split where no shared database can enforce it. Existence checks are
L1 (`ref_index` projection) and above.

## Graph create

```python
from fuzefront_identity import GraphCreateMiddleware

app.add_middleware(GraphCreateMiddleware, aggregate={"customer", "invoice"})
```

Clients post a graph whose nodes carry a document-scoped `lid` and reference each
other as `"lid:<local>"`:

```jsonc
// request
{ "type": "customer", "lid": "1", "name": "Acme",
  "invoices": [ { "type": "invoice", "lid": "2", "customerId": "lid:1" } ] }

// response — idMap added automatically
{ "status": "created",
  "idMap": { "1": "cus_01h455…", "2": "inv_01h456…" } }
```

Every id is minted **up front** and substituted in, so handlers receive a plain
body with real ids and never learn `lid` existed — a route opts in by doing
nothing. Reference cycles resolve, because both ids exist before either row is
written.

`aggregate` is the set of entity types **this service owns**. A `lid` node
declaring anything else is a 422: a graph spanning services cannot be created
atomically, so cross-service entities must be referenced by their existing ids.

## Cross-language parity

The entity-prefix registry and the base32 codec are byte-for-byte identical to
the TypeScript implementation, and both suites are pinned by the same TypeID spec
vectors. `tests/test_identity.py::TestCrossLanguageParity` reads
`shared/src/identity/registry.ts` directly and fails if the two registries drift —
a mismatch would mean a reference minted by a Node service is rejected by a
Python one, which no single-language test would catch.

## Development

```bash
pip install -e '.[dev]'
pytest
```
