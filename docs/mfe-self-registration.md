# MFE Self-Registration Pattern

Each MFE self-registers with FuzeFront at pod startup via a Kubernetes init container.
The registration manifest lives in the MFE's own repo — no FuzeFront coupling.

> **Use [`@fuzefront/onboarding-kit`](../packages/onboarding-kit/README.md).** This
> document describes the pattern; the kit is the implementation — `register.sh`,
> valid-as-shipped templates, the Helm init-container snippet, and a generated
> manifest schema. For a long time this page described a pattern that nothing
> implemented: there was no script and no template to copy, so in practice apps were
> registered by hand-editing platform source. Start from the kit, not from this page.

## Why registration is a hard requirement

The MFE depends on FuzeFront for AuthN, AuthZ, org/user context, billing, sockets,
and more. An unregistered MFE cannot function. If registration fails, the pod must
not start — it will CrashLoopBackOff until the issue is resolved.

## How it works

1. The MFE repo contains `registration/manifest.json` (AppManifest) and
   `registration/register.sh` (idempotent startup script).
2. The Helm chart runs the script as a Kubernetes init container (not optional).
3. The script logic:
   - `GET /api/v1/app-registry/apps/{slug}` → 200 + activated → done (skip)
   - 200 + not activated → POST activate, then done
   - 404 → POST register, POST activate, then done
   - Any other result → exit 1 (hard stop — pod will not start)
4. `FUZEFRONT_API_URL` and `FUZEFRONT_REGISTRATION_TOKEN` are required env vars,
   injected from a Kubernetes Secret named `fuzefront-registration` (key: `token`).
   Missing secret → pod fails at scheduling time (not optional).

## AppManifest shape

See `services/app-registry-service/openapi.yaml`. Key fields for an MF app:

```json
{
  "manifestVersion": "1",
  "slug": "fuzesales",
  "name": "FuzeSales",
  "menuLabel": "Sales",
  "mode": "portal",
  "integration": {
    "type": "module-federation",
    "remoteEntry": "https://fuzesales.prod.fuzefront.com/assets/remoteEntry.js",
    "scope": "fuzesales",
    "module": "./FuzeSalesApp"
  },
  "nav": { "section": "revenue", "order": 20 },
  "routing": { "path": "/app/fuzesales" },
  "visibility": "organization"
}
```

### `nav` — where the app lands in the side menu

`section` places the app in the company lifecycle; `order` ranks it within that
section. The registry returns apps already sorted by `(section, order)`, and the host
shell renders that order, so **this field is the only thing that decides menu
placement**.

| Section | Stage |
|---|---|
| `executive` | Steer |
| `plan` | Plan |
| `build` | Build |
| `revenue` | Sell |
| `customer` | Serve |
| `insight` | Measure |
| `platform` | Operate |

Omit `nav` and the app defaults to `platform` / order 999 — i.e. **last**. Before this
field existed the list was ordered by `created_at`, so the menu was in registration
order and placement could not be expressed at all.

## Policy and billing come with registration

Alongside `manifest.json`, an app may ship `policy.json` (its own Permit
resources/roles, with bare keys) and `billing-profile.json` (its billing product key).
`register.sh` submits both. This replaces two edits that previously had to be made
inside the platform repo — a `*.policy.ts` file plus a hardcoded sync list, and the
`BILLING_PRODUCT_KEYS` env allowlist — neither of which the product team could make
or see.

## Auth token

`FUZEFRONT_REGISTRATION_TOKEN` is a Bearer JWT for a service account with `apps:register`
scope. Same format as `SEED_API_TOKEN`. Create one service-level token and seal it
into a `fuzefront-registration` SealedSecret in each MFE's namespace:

```bash
kubectl create secret generic fuzefront-registration \
  --namespace=fuzesales \
  --from-literal=token=<PLATFORM_REGISTRATION_TOKEN> \
  --dry-run=client -o yaml | kubeseal > sealed-fuzefront-registration.yaml
```
