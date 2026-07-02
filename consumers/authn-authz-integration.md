# Multi-product authN/authZ integration

How a **consumer product** (a product built on the FuzeFront platform — e.g.
**FuzeMarket**) onboards its own **authentication** (Authentik OIDC) and
**authorization** (Permit.io) policy, scoped to FuzeFront's multi-tenant org
model.

> Audience: platform engineers extending FuzeFront, and product teams onboarding
> a new consumer product. For the step-by-step consumer recipe see
> [`onboarding-authn-authz.md`](./onboarding-authn-authz.md).

---

## TL;DR

- A consumer product registers via its **App Manifest** (the federated-app
  registration contract). The manifest gains two new sections: **`auth`**
  (authN) and **`authz`** (authZ policy).
- **AuthN**: the platform provisions a **per-product Authentik OIDC application/
  client** from the manifest `auth` section (redirect URIs, scopes, claims).
  Identity is one shared Authentik; products trust the same issuer.
- **AuthZ**: the product declares its OWN resources/actions/roles with **bare
  keys** (`Listing`, `seller`). The platform **namespaces** them
  (`fuzemarket.Listing`, `fuzemarket.seller`) and **merges** them into the
  Permit environment schema. Two products can't collide.
- **Org model**: authZ is **per-tenant** (one Permit tenant per org), with a
  **ReBAC hierarchy** where **FuzeOne is the root/parent tenant** and FuzeOne
  staff manage child (customer) tenants by derivation.

---

## 1. Architecture

```
                         ┌──────────────────────────────────────────┐
                         │              FuzeFront platform            │
                         │                                            │
   Product registers     │   App Manifest                             │
   (App Manifest) ──────►│   ├─ auth   { oidc: {...} }  ──┐           │
                         │   └─ authz  { product, resources, roles }  │
                         │                               │  │         │
                         │      provisioning             │  │         │
                         │      ┌────────────────────────┘  │         │
                         │      ▼                            ▼         │
                         │  Authentik (OIDC)           Permit.io       │
                         │  per-product application    env schema      │
                         │  + client                   (merged,        │
                         │                              namespaced)    │
                         └──────┬──────────────────────────┬──────────┘
                                │ id_token / userinfo       │ check()/assign()
                                ▼                            ▼
                         ┌──────────────────────────────────────────┐
                         │      Consumer product runtime (FuzeMarket) │
                         │  - logs users in via shared Authentik OIDC │
                         │  - checks fuzemarket.Listing:update etc.   │
                         └──────────────────────────────────────────┘
```

- **AuthN** = **Authentik OIDC** (`backend/src/services/oidc.ts`; Helm
  `authentik` block in `deploy/helm/fuzefront/values-prod.yaml`). One Authentik
  instance, one issuer; each product is its own OIDC *application + client*.
- **AuthZ** = **Permit.io**, per-tenant (one Permit tenant per org). Base
  platform schema in `backend/security/src/permit/schema.ts` (mirrored to
  `backend/src/permit/schema.ts`), synced by
  `backend/src/permit/sync-permit-schema.ts`, checked via
  `backend/src/utils/permit/permission-check.ts` and (for product resources)
  `backend/src/utils/permit/product-authz.ts`.

---

## 2. End-to-end flow

1. **Register** — the product publishes its App Manifest with `auth` + `authz`.
2. **Declare policy** — `authz` lists the product's resources/actions/roles with
   bare keys. `auth.oidc` lists redirect URIs, scopes, claim mapping.
3. **Platform provisions**:
   - **AuthN**: creates/updates an Authentik **application + OIDC provider** for
     the product (client_id/secret, redirect URIs, scopes). Secrets land in a
     k8s Secret the product consumes.
   - **AuthZ**: validates + **namespaces** the product policy and **merges** it
     into the Permit environment schema, then runs the idempotent sync
     (`syncPermitSchemaWithProducts`).
4. **Product consumes at runtime**:
   - **AuthN**: redirect users to the shared Authentik issuer with the product's
     client; trust `id_token`/`userinfo` (same `sub` across products).
   - **AuthZ**: assign product roles to users
     (`assignProductRole(user, 'fuzemarket', 'seller', orgId)`) and check
     (`checkProductPermission(user, 'fuzemarket', 'Listing', 'update', orgId)`).

---

## 3. AuthN — per-product Authentik OIDC client

One Authentik, one issuer, **one OIDC application/client per product**. The
manifest drives provisioning:

```jsonc
// App Manifest — auth section
"auth": {
  "oidc": {
    "applicationSlug": "fuzemarket",          // Authentik application + provider slug
    "redirectUris": [
      "https://market.fuzefront.com/api/auth/oidc/callback"
    ],
    "scopes": ["openid", "email", "profile"],  // default platform scopes
    "claims": {                                 // claim → product field mapping
      "sub": "userId",
      "email": "email",
      "groups": "roles"
    }
  }
}
```

**Trust model**

- All products trust the **same Authentik issuer** (`AUTHENTIK_ISSUER_URL`). The
  `sub` claim is a stable, cross-product user id — the same person is the same
  `sub` in FuzeFront and in FuzeMarket. This is what lets a Permit role
  assignment made by the platform apply to the product's checks.
- Each product gets its **own client_id/client_secret** and its **own redirect
  URIs** so tokens are scoped and revocable per product. Secrets are delivered
  as k8s Secrets (SealedSecrets in prod), never embedded in the manifest.
- The platform shell remains the canonical session holder; products may either
  reuse the shell session (same-origin) or run their own OIDC code-flow against
  the shared issuer with their client. Authorization is **always** re-checked
  against Permit at the product API — a valid token is necessary but not
  sufficient.

Provisioning the Authentik application/provider from the manifest is an
operations step (Authentik blueprint or API); the manifest is the declarative
source. See the onboarding guide for the exact blueprint fields.

---

## 4. AuthZ — per-product policy declaration & merge

### 4.1 Declaration schema (`ProductPolicy`)

A product submits **bare** keys; the platform namespaces them. Type:
`backend/src/permit/product-policy.ts`.

```ts
interface ProductPolicy {
  product: string            // namespace key, lowercase [a-z0-9-], e.g. 'fuzemarket'
  name?: string              // display prefix, e.g. 'FuzeMarket'
  resources: { key; name; actions: Record<string,{name}> }[]
  roles:     { key; name; permissions: string[] }[]   // 'Listing:create' (bare)
}
```

Worked example: `backend/src/permit/products/fuzemarket.policy.ts` — resources
`Listing`/`Order`/`Cart`, roles `seller`/`buyer`/`market-admin`.

### 4.2 Namespacing (collision avoidance)

Every product key is prefixed with `<product>.` (the separator `PRODUCT_NS_SEP`,
a `.`). So `Listing` → **`fuzemarket.Listing`**, role `seller` →
**`fuzemarket.seller`**, and permission `Listing:create` →
**`fuzemarket.Listing:create`**. The `.` never collides with the `:` that
separates a resource key from its action in a permission string.

Two products that both define a `Listing` resource and a `seller` role never
collide: `fuzemarket.Listing` vs `fuzeshop.Listing`.

### 4.3 Merge & sync

`mergeProductPolicy(base, ...policies)` is a **pure** function that returns the
base platform schema with the namespaced product resources/roles appended; it
throws `ProductPolicyError` on a re-used product namespace. `buildEnvSchema(...)`
is the base + products convenience wrapper.

`syncPermitSchemaWithProducts(permit, [fuzemarketPolicy])` builds the merged
schema and runs the existing **idempotent** get-or-(create|update) sync. Running
it for one product never disturbs another product's namespace.

### 4.4 Runtime checks & role assignment

Product resources are checked/assigned with namespacing handled for you
(`backend/src/utils/permit/product-authz.ts`):

```ts
// is this user allowed to update this listing in org `orgId`?
await checkProductPermission(userId, 'fuzemarket', 'Listing', 'update', orgId, listingId)

// make a user a seller in org `orgId`
await assignProductRole(userId, 'fuzemarket', 'seller', orgId)

// express route guard
router.patch('/listings/:id',
  requireProductPermission('fuzemarket', 'Listing', 'update',
    req => req.organizationId, req => req.params.id),
  handler)
```

Permit checks **fail safe** (deny on PDP error), matching the platform's
existing `checkPermission`.

---

## 5. ReBAC org hierarchy — FuzeOne is the root

AuthZ is **per-tenant** (one Permit tenant per org). On top of that, the
`Organization` resource declares a **ReBAC** parent→child hierarchy so **FuzeOne
staff manage all child (customer) tenants** without a per-tenant assignment.

In the base schema (`schema.ts`), the `Organization` resource gains:

```ts
relations: { parent: 'Organization' },     // a child org points at its parent
roles: {
  'org-admin': {                            // resource-instance-scoped ReBAC role
    permissions: ['create','read','update','delete','manage'],
    granted_to: { users_with_role: [
      { role: 'org-admin', on_resource: 'Organization', linked_by_relation: 'parent' }
    ] },
  },
}
```

Read it as: *a user who is `org-admin` on a **parent** Organization instance is
**granted** `org-admin` on every **child** instance via the `parent` relation* —
transitively down the whole tree. Grant a FuzeOne staff member `org-admin` on
the **FuzeOne root org** and they administer every customer org beneath it.

**Provisioning** (`backend/src/utils/permit/resource-instances.ts`):

- `setOrganizationParent(childOrgId, parentOrgId)` — records the `parent`
  relationship tuple between two Organization instances (idempotent). Customer
  orgs are created with `parent = FuzeOne root org`.
- `assignOrgAdminRebac(userId, organizationId)` — grants `org-admin` on a
  specific Organization instance (use the FuzeOne root for platform staff).

The existing flat tenant roles (`admin`/`editor`/`viewer`, mapped from
membership in `role-assignment.ts`) are unchanged and additive — they govern
in-tenant membership; the ReBAC `org-admin` governs cross-tenant staff reach.

> The org `type: 'platform'` (see `Organization` in
> `backend/src/types/shared.ts`) marks the FuzeOne root; customer orgs are
> `type: 'organization'` with `parent_id` set to the root.

---

## 6. Files

| Concern | File |
| --- | --- |
| Base platform schema + ReBAC | `backend/src/permit/schema.ts` (mirror: `backend/security/src/permit/schema.ts`) |
| Product policy types + merge | `backend/src/permit/product-policy.ts` (mirror under `backend/security`) |
| Schema sync (+ product merge) | `backend/src/permit/sync-permit-schema.ts` |
| FuzeMarket sample policy | `backend/src/permit/products/fuzemarket.policy.ts` |
| Runtime product checks/roles | `backend/src/utils/permit/product-authz.ts` |
| ReBAC org provisioning | `backend/src/utils/permit/resource-instances.ts` |
| AuthN (OIDC) | `backend/src/services/oidc.ts`, Helm `authentik` block |
| Tests | `backend/tests/product-policy.test.ts` |

> `backend/src/permit/*` and `backend/security/src/permit/*` are kept
> **byte-identical** (the security microservice owns the sync job). Edit both.
