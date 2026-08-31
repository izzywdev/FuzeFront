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
  "name": "Sales",
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

Note `slug` keeps the `fuze` prefix above while `name`/`menuLabel` drop it — that
is not an inconsistency. `slug` is free-form and immutable once registered;
`name`/`menuLabel` are mutable and, by convention, prefix-free. See the canonical
rule in the root `CLAUDE.md` § "`slug`, display name, and the federated serve path
are THREE INDEPENDENT questions" before changing any of the three.

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

`FUZEFRONT_REGISTRATION_TOKEN` is a **static pre-shared string**. It is not a JWT, it
is not issued per-product, and there is no service-account system behind it — there is
nothing to "create a service account with `apps:register` scope" in, and no admin UI
that mints one. (An earlier version of this page said otherwise. It was wrong, and it
cost a consuming product a day of probing platform secrets that could never have
worked.)

The value is **one platform-wide secret**, `CONSUMER_REGISTRATION_SECRET`. The registry
compares the incoming Bearer against it in
`backend/applications/src/middleware/consumer-auth.ts`; on a match the request is
treated as a platform-admin service call and Permit checks are bypassed.

The middleware tells a consumer-secret attempt apart from a human JWT **by shape**,
not by whether the comparison happens to succeed: a JWT is always
`header.payload.signature` (two dots); the pre-shared secret is a flat hex string with
none. A JWT-shaped bearer (or no `Authorization` header at all) falls through to
ordinary Authentik JWT validation unaffected. A non-JWT-shaped bearer is a consumer
attempt and is decided **right there, fail-closed** — it is never handed to JWT
validation:
- secret unset on this pod → `503 consumer_registration_unavailable`
- secret set but the token doesn't match → `401 invalid_registration_token`

Both responses log an actionable line naming which of the two it is. (Earlier, either
case silently fell through to JWT validation and came back as a generic
`401 Invalid token.` — indistinguishable from the caller sending the wrong token, even
when the real problem was that the platform had no secret configured at all.)

That single middleware is applied to **every** `/api/v1/app-registry` route, because
`register.sh` calls `GET`, `POST`, and `PUT` in the course of one registration.

Because it is one shared credential that grants platform-admin on the registry,
rotating it invalidates every consumer at once — see "Rotation" below.

### 1. Platform side (once per cluster)

Seal the value into `fuzefront-secrets` and enable the seed Job that publishes it.

```bash
# Generate and seal. Plaintext never touches git, chat, or shell history —
# seal-secret.sh prompts hidden and merges in place, preserving other keys.
openssl rand -hex 32 | deploy/scripts/seal-secret.sh \
  CONSUMER_REGISTRATION_SECRET --scope fuzefront/fuzefront-secrets --in -
```

`deploy/helm/fuzefront/values-prod.yaml` must also carry
`secret.consumerRegistrationSecret` (any non-empty placeholder — with
`secret.existingSecret` set, `templates/secret.yaml` never renders, so the value is a
**render gate only**). Without it,
`templates/consumer-registration-seed-job.yaml` and its RBAC do not render at all and
step 2 has nothing to read.

### 2. Distribution to a consuming product

The `consumer-registration-seed` Job (post-install/post-upgrade) copies the value into
`Secret/fuzefront-registration`, key `token`, in the **`fuzefront`** namespace. That
secret is the published hand-off point: a consumer's CI reads it, re-seals it for its
own namespace, and commits the SealedSecret.

```bash
# In the consuming product's provisioning workflow (needs read on that one secret):
TOKEN=$(kubectl -n fuzefront get secret fuzefront-registration \
  -o jsonpath='{.data.token}' | base64 -d)

kubectl create secret generic fuzefront-registration \
  --namespace=fuzehub --from-literal=token="$TOKEN" \
  --dry-run=client -o yaml | kubeseal --format yaml > sealed-fuzefront-registration.yaml
```

Do **not** probe `fuzefront-secrets` for a likely-looking key. `JWT_SECRET`,
`SESSION_SECRET`, `AUTHENTIK_BOOTSTRAP_TOKEN`, `INTERNAL_PROVISION_SECRET`,
`PERMIT_API_KEY` and `AUTHENTIK_SECRET_KEY` all 401 here by design — none of them is
this credential.

### Diagnosing a 401 or 503

Since the middleware fails closed, the response body tells you which of the two
problems you have — no more generic `401 Invalid token.` guessing game:

- **`503 { "error": "consumer_registration_unavailable" }`** — `CONSUMER_REGISTRATION_SECRET`
  is **unset on the applications pod**. It is mounted `optional: true`
  (`deploy/helm/fuzefront/templates/applications.yaml`), so the pod starts healthy
  without it; this is a platform configuration gap, not something the consumer can fix
  by changing its token. Check:
- **`401 { "error": "invalid_registration_token" }`** — the secret IS configured, but
  the caller's `FUZEFRONT_REGISTRATION_TOKEN` doesn't match it. Re-check step 2 below
  (the consumer may be holding a stale or wrong value).

For the 503 case, confirm the secret is actually sealed:

```bash
kubectl -n fuzefront get secret fuzefront-secrets \
  -o jsonpath='{.data.CONSUMER_REGISTRATION_SECRET}' | wc -c   # 0 = not sealed yet
```

### Rotation

Re-seal the key, `helm upgrade` (which re-runs the seed Job), then re-run each
consumer's provisioning workflow. Consumers keep working on the old value until their
own SealedSecret is refreshed, so rotate the platform first and the consumers promptly
after — a consumer whose pod restarts in between will fail its init container.
