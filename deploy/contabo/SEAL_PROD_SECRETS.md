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

## ⚠️ Resealing a single value (e.g. `AUTHENTIK_BOOTSTRAP_TOKEN`)

To rotate or repair ONE key without retyping the rest, use the offline merge helper —
it scrubs **all** whitespace from the value before sealing, so a stray trailing
newline can never reach the cluster:

```bash
# regenerate a clean, newline-free token and seal it into fuzefront-secrets in place
openssl rand -hex 32 | tr -d '[:space:]' > /tmp/ak-token.txt
deploy/scripts/seal-secret.sh AUTHENTIK_BOOTSTRAP_TOKEN \
  --in /tmp/ak-token.txt \
  --scope fuzefront/fuzefront-secrets \
  --manifest deploy/contabo/sealed/fuzefront-secrets.yaml
rm -f /tmp/ak-token.txt
git add deploy/contabo/sealed/fuzefront-secrets.yaml && git commit && git push
```

> **Why this matters (incident FuzeInfra#103 / FuzeFront#104):** the embedded authentik
> outpost authenticates to the API with this token. If the sealed value carries a
> trailing newline/whitespace, authentik stores it on the Token object and the outpost
> emits it in the `Authorization` header — Go's HTTP client then rejects it with
> `net/http: invalid header field value for "Authorization"` and loops
> "Failed to fetch outpost configuration, retrying in 3 seconds" forever. **Never**
> seal a token with `echo "$TOK" | kubeseal` (echo appends `\n`); always go through
> `seal-secret.sh` (or `printf '%s'` + `tr -d '[:space:]'`). After resealing, authentik
> must be **redeployed** so the bootstrap blueprint rewrites the Token object with the
> clean value. This is GitOps prod — Argo syncs on push; do not hand-apply.

Then tell the agent **"sealed"** — it applies `deploy/contabo/sealed/` to the cluster via
FuzeInfra's `argocd-register.yml` (which holds the kubeconfig), the controller decrypts
them, Argo retries the `fuzefront` app (pre-sync hook passes, pods pull), the Ingress is
created, and `prod-smoke` flips `https://app.fuzefront.com/api/health` to 200.

> Billing/chat run as separate Argo apps; their secrets (`billing-secrets`, etc.) are not
> required for the host app's `/api/health` and can be sealed later the same way.
