# FuzeFront — in-cluster deployment (minimal first cut)

Deploys the FuzeFront **backend + frontend** into the same local `kind` cluster as
FuzeInfra, wired to FuzeInfra's shared Postgres/Redis. Local JWT auth only;
Authentik (OIDC) and Permit (PDP) are added in a later overlay.

```
browser ──http──▶ ingress-nginx (host :80)
                    └─▶ fuzefront-frontend (nginx :8080)
                          ├─ serves the React host shell (Module Federation container)
                          └─ proxies /api and /socket.io ─▶ fuzefront-backend (:3001)
                                                              └─▶ postgres.fuzeinfra.svc / redis.fuzeinfra.svc
```

## Prerequisites (install once — modifies your machine, run these yourself)

```
winget install Kubernetes.kind RedHat.Helm    # kind + helm (kubectl/docker already present)
```

## 1. Bring up FuzeInfra in kind

```
cd FuzeInfra
make kind-up            # creates kind cluster "fuzeinfra" + ingress-nginx + deploys the infra chart
kubectl -n fuzeinfra get pods        # wait until postgres/redis are Running
```

This creates kind cluster **`fuzeinfra`** (kube-context `kind-fuzeinfra`) with host
ports 80/443 mapped to the ingress controller.

## 2. Build the FuzeFront images and load them into kind

`kind` can't pull `fuzefront/*:local` from a registry, so build locally and load:

```
# from the repo root (D:\source\FuzeFront)
docker build -t fuzefront/backend:local ./backend
docker build -t fuzefront/frontend:local \
  --build-arg VITE_API_URL=http://fuzefront.dev.local ./frontend

kind load docker-image fuzefront/backend:local fuzefront/frontend:local --name fuzeinfra
```

> The `VITE_API_URL` build-arg is baked into the frontend bundle, so the browser
> calls `http://fuzefront.dev.local/api/...`, which the ingress routes to the
> frontend nginx, which proxies to the backend.

## 3. Deploy FuzeFront

```
helm upgrade --install fuzefront deploy/helm/fuzefront \
  -n fuzefront --create-namespace \
  -f deploy/helm/fuzefront/values-local.yaml
```

For real secrets (instead of the dev placeholders), either:

```
helm upgrade --install fuzefront deploy/helm/fuzefront -n fuzefront --create-namespace \
  -f deploy/helm/fuzefront/values-local.yaml \
  --set secret.jwtSecret="$JWT" --set secret.sessionSecret="$SESSION" \
  --set secret.dbPassword="$DBPASS"
```

…or create a Secret yourself and set `secret.existingSecret=fuzefront-secrets`.

## 4. Resolve the hostname

Add to your hosts file (`C:\Windows\System32\drivers\etc\hosts`):

```
127.0.0.1 fuzefront.dev.local
```

## 5. Verify

```
kubectl -n fuzefront get pods,svc,ingress
curl http://fuzefront.dev.local/api/health      # {"status":"ok",...}
# open http://fuzefront.dev.local
```

## 6. Plug an app in at runtime

```
curl -X POST http://fuzefront.dev.local/api/apps/register \
  -H 'Content-Type: application/json' \
  -d '{"name":"My App","url":"http://my-app:8080",
       "integrationType":"module-federation",
       "remoteUrl":"http://my-app:8080/remoteEntry.js",
       "scope":"myApp","module":"./App"}'
```

The app appears in the 9-dots launcher and is loaded via Module Federation at
runtime — no rebuild of the host.

## Notes / known follow-ups

- **DB bootstrap vs. runtime (least-privilege):** a privileged Helm
  `pre-install,pre-upgrade` Job (`templates/db-bootstrap-job.yaml`, running
  `node dist/scripts/db-bootstrap.js`) connects as the FuzeInfra Postgres
  superuser (`fuzeinfra`) and idempotently creates the `fuzefront_platform` DB,
  a least-privilege `fuzefront_user` role (no CREATEDB/CREATEROLE), and grants
  it ownership of the `public` schema. The backend then runs as `fuzefront_user`
  and only verifies the DB exists — it never creates databases or roles.
  Superuser creds come from a Secret in this namespace: by default
  `DB_SUPERUSER_PASSWORD` in the chart Secret (set `secret.dbSuperuserPassword`,
  or seal it in prod), or point `database.bootstrap.superuser.secretName` at an
  existing Secret. The runtime role's password is `DB_PASSWORD`
  (`secret.dbPassword`).
- **No seed data:** `NODE_ENV=production` (required so the image's compiled `.js`
  migrations are found) skips seeds. The platform starts empty; apps self-register
  at runtime. Run seeds as a one-off Job if you want the demo apps.
- **Auth/AuthZ:** Authentik + Permit PDP are intentionally out of this first cut.
- Validate the chart before deploying: `helm lint deploy/helm/fuzefront` and
  `helm template fuzefront deploy/helm/fuzefront -f deploy/helm/fuzefront/values-local.yaml`.

## Unleash (feature flags)

Self-hosted **Unleash** (OSS feature-flag server) runs inside this umbrella chart,
gated by `unleash.enabled` (default **false**). It is an **external upstream image**
(`unleashorg/unleash-server`, pinned to `5.12.0`) — it is NOT built by `release.yml`
and NOT in the CI build matrix, so its tag is bumped deliberately in a deploy window,
never auto-bumped by CI. There is **no separate Argo Application**: like billing, the
templates live in this umbrella chart and a second Argo app on the same chart path
would double-claim the Deployment.

When `unleash.enabled=true` the chart renders, in order:

1. **`unleash-db-bootstrap` Job** (`pre-install,pre-upgrade`, hook-weight `-4`):
   connects as the FuzeInfra Postgres **superuser** and idempotently creates a
   least-privilege `unleash_svc` LOGIN role and a **dedicated `unleash` database that
   `unleash_svc` OWNS**. Unleash self-migrates its own schema on boot as `unleash_svc`
   (that is why the role must own the database). `CREATE DATABASE` is guarded with the
   `SELECT … WHERE NOT EXISTS … \gexec` idiom (it can't run in a DO block / txn), and
   the role password is round-tripped through a session GUC (psql `:var` doesn't
   interpolate inside dollar-quoted blocks) — same pattern as billing.
2. **`fuzefront-unleash` Deployment + Service** (`unleashorg/unleash-server`, port
   `4242`, `/health` probes). The Service is **cluster-internal only**.

### `unleash-secrets` (per-service SealedSecret)

Unleash reads three keys from the `unleash-secrets` SealedSecret (placeholders in
`deploy/contabo/sealed/unleash-secrets.yaml` — they will NOT decrypt; seal the real
values before enabling):

| Key | Used for |
| --- | --- |
| `UNLEASH_DB_PASSWORD` | password for the `unleash_svc` role (set by the bootstrap Job; used in `DATABASE_URL`) |
| `INIT_ADMIN_API_TOKENS` | admin/bootstrap API token, format `*:*.<hex>` |
| `UNLEASH_CLIENT_TOKEN` | client/SDK token (format `[project]:[env].<hex>`), fed to the server as `INIT_CLIENT_API_TOKENS` — this is the token the `@fuzefront/feature-flags` package authenticates with |

Seal each (offline, credential-free — FuzeInfra holds the decrypt key):

```
deploy/scripts/seal-secret.sh UNLEASH_DB_PASSWORD   --scope fuzefront/unleash-secrets
deploy/scripts/seal-secret.sh INIT_ADMIN_API_TOKENS --scope fuzefront/unleash-secrets
deploy/scripts/seal-secret.sh UNLEASH_CLIENT_TOKEN  --scope fuzefront/unleash-secrets
```

### Client connection endpoint

The `@fuzefront/feature-flags` package (owned by another agent) connects in-cluster to:

```
http://fuzefront-unleash.fuzefront.svc.cluster.local:4242/api
```

authenticated with the **`UNLEASH_CLIENT_TOKEN`** (the `INIT_CLIENT_API_TOKENS` value).

### Admin UI access (NOT public)

The Unleash admin UI is **not** exposed via the public app ingress. Two admin-gated
options:

- **(a) Port-forward (default, no infra needed):**
  `kubectl port-forward svc/fuzefront-unleash 4242:4242`, then open
  `http://localhost:4242` and log in with the `INIT_ADMIN_API_TOKENS` admin token.
- **(b) Optional admin-gated host:** set `unleash.ingress.enabled=true` +
  `unleash.ingress.host=<host>` to render an Ingress for the admin UI. This is **off
  by default** and does **not** make Unleash public on its own: the host MUST sit under
  the `*.prod.fuzefront.com` **Cloudflare-Access** zone (admin Zero-Trust). The CF
  tunnel ingress rule (`<host> → traefik.kube-system:80`) and the proxied CNAME are
  **FuzeInfra-owned (Terraform) — delegated to FuzeInfra** (see the values-prod ingress
  comment / `izzywdev/FuzeInfra#43`). The Ingress here only host-matches once FuzeInfra
  has wired that CF-Access host.
