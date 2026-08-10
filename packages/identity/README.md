# @izzywdev/fuzefront-identity

Server-owned entity identifiers and graph-create middleware for **Node**
FuzeFront microservices. The peer of `fuzefront-identity` (Python).

Policy: [`governance/identifier-standard.md`](../../governance/identifier-standard.md)
· Family baseline §4.2.

**Dependency-free.** Nothing but Node's `crypto`. This is deliberate: it is
installed by backend services, and a middleware package that drags React (as its
previous home `@fuzefront/shared` did) into a server image is a defect, not a
detail.

## Install

```bash
npm install @izzywdev/fuzefront-identity
```

Requires an `.npmrc` pointing `@izzywdev` at GitHub Packages — see
`docs/guides/BUILDING_ON_FUZEFRONT.md`.

## Typed identifiers

Wire form `cus_01h455vb4pex5vsknk084sn02q`; storage stays a native `uuid`
column. No string is simultaneously a valid `cus_` and a valid `inv_`, so
cross-type confusion is structurally impossible rather than merely checked.

```ts
import { mintId, assertRef, toUuid, type EntityId } from '@izzywdev/fuzefront-identity'

const customerId = mintId('customer')          // cus_01h455…  — the ONLY constructor
await db.insert({ id: toUuid(customerId) })    // 16-byte uuid column

assertRef('customer', body.customerId)         // L0: no network, no cache, no DB
assertRef('customer', mintId('invoice'))       // throws IdentityError PREFIX_MISMATCH
```

`EntityId<T>` is branded, so a raw `string` off `req.body` will not compile
against a repository that takes one — the hole is unreachable, not merely
detected:

```ts
function findCustomer(id: EntityId<'customer'>) { /* … */ }
findCustomer(req.body.id)          // ✗ does not compile
findCustomer(mintId('invoice'))    // ✗ does not compile
findCustomer(parseId('customer', req.body.id))  // ✓
```

## Graph create

```ts
app.use(express.json())
app.use(graphCreate({ aggregate: new Set(['customer', 'invoice']) }))
```

Clients label nodes with a document-scoped `lid` and reference them as
`"lid:<n>"`; the response gains `idMap`. Ids are minted **up front**, so handlers
receive real ids, never learn `lid` existed, and reference cycles resolve.

**Mount it after your JSON body parser and after any raw-body webhook route** —
provider webhook payloads carry an `id` and would otherwise 422.

## Migration

`parseId` is strict by default. A service adopting it on an existing surface
widens the dual-accept window per type at bootstrap:

```ts
configureIdentity({ legacyUuidTypes: new Set(['customer']) })
```

## Development

```bash
npm run build && npm test
```

Cross-language parity with the Python package is enforced by
`scripts/gate_identifier.py --registry-parity` — a prefix that differs between
them means a reference minted by one language is rejected by the other.
