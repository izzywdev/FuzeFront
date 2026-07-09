# Consumer onboarding: authN + authZ (FuzeMarket worked example)

Step-by-step recipe for onboarding a **consumer product** to FuzeFront's
authentication (Authentik OIDC) and authorization (Permit.io). The running
example is **FuzeMarket**: a marketplace product with resources
`Listing`/`Order`/`Cart` and roles `seller`/`buyer`/`market-admin`.

For the architecture and trust model, read
[`authn-authz-integration.md`](./authn-authz-integration.md) first.

---

## Prerequisites

- Your product is (or will be) registered with the platform via an **App
  Manifest** (the federated-app registration contract).
- You have a product key: a lowercase `[a-z0-9-]` slug, e.g. `fuzemarket`. This
  is your **namespace** for every Permit resource/role and your Authentik
  application slug.

---

## Step 1 — Declare your `auth` section (authN)

Add an `auth.oidc` block to your App Manifest:

```jsonc
"auth": {
  "oidc": {
    "applicationSlug": "fuzemarket",
    "redirectUris": [
      "https://market.fuzefront.com/api/auth/oidc/callback"
    ],
    "scopes": ["openid", "email", "profile"],
    "claims": { "sub": "userId", "email": "email", "groups": "roles" }
  }
}
```

The platform provisions a **per-product Authentik application + OIDC provider**
from this. You receive:

- `AUTHENTIK_ISSUER_URL` — shared issuer (same for all products).
- `AUTHENTIK_CLIENT_ID` / `AUTHENTIK_CLIENT_SECRET` — **your** client, delivered
  as a k8s Secret (SealedSecret in prod). Never commit these.
- `AUTHENTIK_REDIRECT_URI` — one of your declared redirect URIs.

At runtime, run the OIDC code flow against the shared issuer with your client
(mirror `backend/src/services/oidc.ts`). The `sub` claim is the **same user id**
the platform uses for Permit role assignments — do not invent your own user ids.

> A valid token authenticates; it does **not** authorize. Always re-check
> permissions against Permit at your API (Step 4).

---

## Step 2 — Write your `ProductPolicy` (authZ declaration)

Declare resources/actions/roles with **bare** keys (no `fuzemarket.` prefix —
the platform adds it). This is the FuzeMarket policy
(`backend/src/permit/products/fuzemarket.policy.ts`):

```ts
export const fuzemarketPolicy: ProductPolicy = {
  product: 'fuzemarket',
  name: 'FuzeMarket',
  resources: [
    { key: 'Listing', name: 'Listing',
      actions: { create:{name:'Create'}, read:{name:'Read'}, update:{name:'Update'},
                 delete:{name:'Delete'}, publish:{name:'Publish'} } },
    { key: 'Order', name: 'Order',
      actions: { create:{name:'Create'}, read:{name:'Read'}, update:{name:'Update'},
                 cancel:{name:'Cancel'}, refund:{name:'Refund'} } },
    { key: 'Cart', name: 'Cart',
      actions: { read:{name:'Read'}, add_item:{name:'Add Item'},
                 remove_item:{name:'Remove Item'}, checkout:{name:'Checkout'} } },
  ],
  roles: [
    { key: 'seller', name: 'Seller',
      permissions: ['Listing:create','Listing:read','Listing:update','Listing:delete',
                    'Listing:publish','Order:read','Order:update','Order:refund'] },
    { key: 'buyer', name: 'Buyer',
      permissions: ['Listing:read','Cart:read','Cart:add_item','Cart:remove_item',
                    'Cart:checkout','Order:create','Order:read','Order:cancel'] },
    { key: 'market-admin', name: 'Market Admin',
      permissions: [/* full control of Listing/Order/Cart */] },
  ],
}
```

Rules enforced by `validateProductPolicy()`:

- `product` must match `^[a-z][a-z0-9-]{1,30}[a-z0-9]$`.
- Resource/role keys must be unique and match `^[A-Za-z][A-Za-z0-9_-]*$`.
- Every permission `Resource:action` must reference a resource **and** action
  you declared. Typos fail fast at sync time, not at runtime.

---

## Step 3 — Merge & sync into Permit

The platform validates, **namespaces**, and merges your policy into the Permit
environment schema, then runs the idempotent sync:

```ts
import { syncPermitSchemaWithProducts } from './permit/sync-permit-schema'
import { fuzemarketPolicy } from './permit/products/fuzemarket.policy'
import permit from './config/permit'

await syncPermitSchemaWithProducts(permit, [fuzemarketPolicy])
```

After sync, Permit has (alongside the platform's own resources/roles):

| Bare | In Permit |
| --- | --- |
| resource `Listing` | `fuzemarket.Listing` |
| role `seller` | `fuzemarket.seller` |
| permission `Listing:create` | `fuzemarket.Listing:create` |

Re-running sync is safe and only touches **your** namespace.

---

## Step 4 — Assign roles & check permissions at runtime

Use the helpers in `backend/src/utils/permit/product-authz.ts` — they namespace
for you, so you pass bare names:

```ts
// onboard a user as a seller within an org (tenant)
await assignProductRole(userId, 'fuzemarket', 'seller', orgId)

// guard an API route
router.patch('/listings/:id',
  requireProductPermission('fuzemarket', 'Listing', 'update',
    req => req.organizationId,           // tenant
    req => req.params.id),               // resource instance
  updateListingHandler)

// or check inline
if (!(await checkProductPermission(userId, 'fuzemarket', 'Listing', 'publish', orgId, listingId))) {
  return res.status(403).json({ error: 'forbidden' })
}
```

Expected outcomes for FuzeMarket:

- a `buyer` calling `Listing:create` or `Listing:publish` → **denied**.
- a `seller` calling `Listing:publish` → **allowed**.
- a `market-admin` calling `Order:refund` → **allowed**.

---

## Step 5 — Multi-tenant & the FuzeOne hierarchy

- Authorization is **per-tenant**: a user's `fuzemarket.seller` role in org A
  does **not** grant it in org B. Assign per org.
- **FuzeOne staff** who hold the ReBAC `org-admin` role on the **FuzeOne root
  org** automatically administer **child** orgs (see §5 of the integration doc).
  Your product gets this for free via the org hierarchy — you don't model it.
- When the platform creates a customer org it calls
  `setOrganizationParent(childOrgId, fuzeOneRootOrgId)` so the derivation
  applies. Your product never sets parents itself.

---

## Checklist

- [ ] Product key chosen (`[a-z0-9-]`), used for both Authentik slug and authZ namespace.
- [ ] `auth.oidc` block in the App Manifest; client secret delivered as a k8s Secret.
- [ ] `ProductPolicy` written with bare keys; passes `validateProductPolicy`.
- [ ] `syncPermitSchemaWithProducts` wired into your provisioning/onboarding job.
- [ ] Runtime routes guarded with `requireProductPermission` / `checkProductPermission`.
- [ ] Role assignment on user onboarding via `assignProductRole`.
- [ ] Verified deny/allow for at least one buyer-vs-seller-vs-admin case.
