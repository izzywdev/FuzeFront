# MendysRobotics Authentik blueprints (isolated identity silo)

Blueprints in this directory are applied **only** to the `authentik-mendys`
instance (chart values `authentikMendys`), mounted at `/blueprints/mendys/`.
FuzeFront's own blueprints live one directory up in `../blueprints/` and are
mounted only on the FuzeFront instance.

**Never mount both sets on one instance.** Authentik's worker applies every
`*.yaml` it discovers under `/blueprints`, so a shared mount would recreate
FuzeFront's flows, providers and applications inside the Mendys directory and
erase the separation this split exists to create.

## Why a separate instance instead of a brand

Authentik has no realm. One instance is one user directory:

- **Brands** (`authentik_brands.brand`) are *soft* multi-tenancy — branding and
  default flows per domain. Per authentik's own docs, "all objects like
  applications and providers are still global". A Mendys brand on the FuzeFront
  instance would still share every account.
- **Hard tenancy** (a Postgres *schema* per tenant, authentik 2024.2+) does give
  real separation, but it is Enterprise-only, still alpha, requires a license
  per tenant, and is created only through the API — so it cannot be expressed
  as a blueprint in git, which is how every other authentik object here is
  managed.
- **A second instance on its own database** gives the same isolation property
  for free and stays fully declarative. That is what this directory serves.

## The boundary

MendysRobotics accounts exist only in this directory. A FuzeFront account
cannot sign in to the Mendys apps, a Mendys account cannot sign in to
FuzeFront, and the same email address may exist independently on both sides as
two unrelated accounts.

Because the directory *is* the tenant boundary, the applications here use
`policy_engine_mode: all` with no group bindings — there is no need to police
who may reach them, since users from the other side have no account here at
all.

The only applications in this silo are the two MendysRobotics products:

| Blueprint | client_id | Application slug |
|---|---|---|
| `provider-oidc-mendys-platform.yaml` | `mendys-platform-oidc-client` | `mendys-platform` |
| `provider-oidc-mendys-datasets.yaml` | `mendys-datasets-oidc-client` | `mendys-datasets` |

## Flows

`flow-enrollment.yaml` is a deliberate copy of FuzeFront's enrollment flow, not
a shared file: authentik objects are per-instance, so each directory needs its
own flow, stages and prompts, and the user-facing copy differs. **If you change
the security properties of one (password policy, stage order,
`create_users_as_inactive`), change the other to match.**

## Secrets

Client secrets are never stored here. Each provider reads its secret at
blueprint-apply time from the worker pod's environment via authentik's `!Env`
tag:

| Blueprint | env var | chart Secret key |
|---|---|---|
| platform | `AUTHENTIK_MENDYS_PLATFORM_CLIENT_SECRET` | `MENDYS_PLATFORM_CLIENT_SECRET` |
| datasets | `AUTHENTIK_MENDYS_DATASETS_CLIENT_SECRET` | `MENDYS_DATASETS_CLIENT_SECRET` |

The platform secret must be **byte-identical** to `MENDYS_AUTHENTIK_CLIENT_SECRET`
in the `mendys-secrets` sealed secret (namespace `mendys-prod`) — it is one
OAuth2 client credential shared by the two sides of the exchange.

**Rotation is not a value change.** The blueprint runner honours
`client_id`/`client_secret` only at provider *creation*; updating the secret
requires deleting the provider entry and re-applying the blueprint.

## Browser-facing exposure — there is none, by design

**This instance is never reachable from outside FuzeFront's boundary.**
`authentikMendys.ingress` is off, and it should stay off.

Authentik is an implementation detail of FuzeFront's **security-service**, which
is the single front door for every tenant. MendysRobotics does not talk to
Authentik, does not know its hostname, and holds no Authentik configuration —
its users reach `live.` / `marketplace.mendysrobotics.com`, those hosts route
`/api/v1/security/*` and `/api/auth/*` to security-service, and security-service
drives the correct Authentik instance in-cluster over ClusterIP
(`authentik-mendys-server:9000`).

This is the module's stated contract, not a new invention — see
`backend/security/src/providers/authentik/config.ts`: *"no vendor name leaks
past this boundary into the API surface"* and *"the browser is ALWAYS sent to a
same-host path … so the browser never sees an internal identity host."*

Consequences for this directory:

- **Password + enrollment** use the **server-side flow driver** — security-service
  calls Authentik's `/api/v3` flow-executor server-side and issues its own
  session. The browser never touches Authentik, so no Authentik paths are routed
  on the Mendys hosts at all (unlike `app.fuzefront.com`, which does route
  Authentik's native paths).
- **Social login** uses the **server-brokered** path, which already exists:
  Google redirects to `/api/v1/security/social/google/callback` on the tenant
  host — a security-service route — and security-service exchanges the code with
  Google itself and provisions the account into this silo via the admin API. It
  must never fall back to Authentik's `/source/oauth/*`, so
  `securityService.googleBrokered` must be `"true"` for this tenant. It
  currently defaults to `"false"`.
- **The issuer is not a MendysRobotics-facing value.** It is internal to
  security-service. Nothing in the MendysRobotics repo should contain an
  Authentik URL.

### Not yet true

security-service is currently **single-tenant**: it reads `AUTHENTIK_ISSUER_URL`,
`AUTHENTIK_BASE_URL`, `AUTHENTIK_CLIENT_ID/SECRET`, `AUTHENTIK_ADMIN_TOKEN` and
`AUTHENTIK_ENROLLMENT_FLOW_SLUG` directly from `process.env` at ~12 call sites
across 7 files, each defaulting to FuzeFront (`…/application/o/fuzefront/`,
`fuzefront-enrollment`). Until it resolves a tenant per request and threads that
through, **this silo cannot actually serve a login** — the blueprints here are
correct and inert, waiting on that work.

Either way the issuer is **not** `https://auth.fuzefront.com/application/o/mendys-platform/`
— that host belongs to the FuzeFront instance, which is a different directory.
The Mendys side must repoint its issuer at whichever surface is chosen.
