# Sealing the production secrets for `app.fuzefront.com`

The `fuzefront` Argo app cannot sync until two secrets exist in the `fuzefront`
namespace. **Only the repo owner runs this** — real secret values must never be
committed in plaintext or pasted into chat/CI logs; `kubeseal` encrypts them so the
*sealed* output is safe to commit (only the in-cluster controller's private key can
decrypt it).

This is the **last blocker** to go-live. Everything else (Cloudflare route, tunnel,
Argo app-of-apps registration, FuzeInfra prod) is already live.

## Why the app is 404 without these
- `db-bootstrap-job.yaml` is an Argo **pre-sync hook** → needs `DB_SUPERUSER_PASSWORD`
  to create the `fuzefront` DB + role. Missing → the whole sync aborts → no Ingress.
- Backend/frontend images are private on GHCR → need `ghcr-pull` (`imagePullSecrets`)
  or pods sit in `ImagePullBackOff`.
- `oidc.enabled: true` + `permit.enabled: true` in `values-prod.yaml` make
  `AUTHENTIK_CLIENT_ID/SECRET` and `PERMIT_API_KEY` **non-optional** `secretKeyRef`s —
  the backend pod won't start if those keys are absent (a placeholder boots it; real
  values are only needed for SSO/authz to actually function).

## Recipe

```bash
# 0. Fetch the cluster's sealed-secrets public cert (once)
CERT=/tmp/ff-sealed.pem
curl -fsSL https://sealed-secrets.fuzeinfra.fuzefront.com/v1/cert.pem -o "$CERT"

# 1. fuzefront-secrets (Opaque) — fill every value with the REAL secret
#    DB_SUPERUSER_PASSWORD : the FuzeInfra Postgres superuser password (must be real)
#    DB_PASSWORD           : password the bootstrap will set for the fuzefront role
#    JWT_SECRET / SESSION_SECRET / INTERNAL_PROVISION_SECRET : fresh random (openssl rand -hex 32)
#    PERMIT_API_KEY        : from Permit.io (placeholder 'dev' boots the pod)
#    AUTHENTIK_CLIENT_ID / AUTHENTIK_CLIENT_SECRET : Authentik OIDC app creds
#                            (placeholders boot the pod; real values for SSO)
kubectl create secret generic fuzefront-secrets -n fuzefront \
  --from-literal=DB_SUPERUSER_PASSWORD='REPLACE' \
  --from-literal=DB_PASSWORD='REPLACE' \
  --from-literal=JWT_SECRET="$(openssl rand -hex 32)" \
  --from-literal=SESSION_SECRET="$(openssl rand -hex 32)" \
  --from-literal=INTERNAL_PROVISION_SECRET="$(openssl rand -hex 32)" \
  --from-literal=PERMIT_API_KEY='REPLACE' \
  --from-literal=AUTHENTIK_CLIENT_ID='REPLACE' \
  --from-literal=AUTHENTIK_CLIENT_SECRET='REPLACE' \
  --dry-run=client -o yaml \
| kubeseal --cert "$CERT" --format yaml \
  > deploy/contabo/sealed/fuzefront-secrets.yaml

# 2. ghcr-pull (dockerconfigjson) — GitHub PAT with read:packages
kubectl create secret docker-registry ghcr-pull -n fuzefront \
  --docker-server=ghcr.io \
  --docker-username=izzywdev \
  --docker-password='REPLACE_PAT_read_packages' \
  --docker-email=you@example.com \
  --dry-run=client -o yaml \
| kubeseal --cert "$CERT" --format yaml \
  > deploy/contabo/sealed/ghcr-pull.yaml

# 3. Commit + push the SEALED output (safe — encrypted)
git add deploy/contabo/sealed/fuzefront-secrets.yaml deploy/contabo/sealed/ghcr-pull.yaml
git commit -m "secrets(prod): seal fuzefront-secrets + ghcr-pull for app.fuzefront.com go-live"
git push
```

Then tell the agent **"sealed"** — it applies `deploy/contabo/sealed/` to the cluster via
FuzeInfra's `argocd-register.yml` (which holds the kubeconfig), the controller decrypts
them, Argo retries the `fuzefront` app (pre-sync hook passes, pods pull), the Ingress is
created, and `prod-smoke` flips `https://app.fuzefront.com/api/health` to 200.

> Billing/chat run as separate Argo apps; their secrets (`billing-secrets`, etc.) are not
> required for the host app's `/api/health` and can be sealed later the same way.

## Rotating a secret (automated — no manual reseal)

The recipe above is for **first seal / from-scratch** provisioning. To **rotate** a
single key thereafter, do not reseal by hand — use the rotation workflow
(`rotate-sealed-secret`, staged at `deploy/ci/rotate-sealed-secret.yml` until a
maintainer `git mv`s it into `.github/workflows/`; see `deploy/ci/README.md`):

> Actions → **Rotate sealed secret** → Run workflow → `key=AUTHENTIK_BOOTSTRAP_TOKEN`,
> `scope=fuzefront/fuzefront-secrets`, `value_mode=generate`.

It generates a fresh value, seals it **offline** via `deploy/scripts/seal-secret.sh`
(plaintext never logged), and opens an auto-merging PR. On merge the `fuzefront-sealed`
Argo app syncs the SealedSecret, the controller decrypts it, and **stakater/Reloader**
auto-restarts `authentik-server` + `authentik-worker` (see `authentik.reloader.enabled`
in the Helm values) — clearing the `invalid header field value for "Authorization"`
outpost loop with no human step.
