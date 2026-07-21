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

## Adding `FEATURE_FLAGS_CLIENT_TOKEN` (app-registry / family flags)

The `applications-service` (app-registry) evaluates family feature flags via the
`@fuzefront/feature-flags` (Unleash) client. The scoped client token is a SECRET,
sealed into the SAME `fuzefront-secrets` SealedSecret under the key
`FEATURE_FLAGS_CLIENT_TOKEN` (matches `applicationsService.featureFlags.tokenSecretKey`
in `values-prod.yaml`). It is **optional**: while `applicationsService.featureFlags.unleashUrl`
is empty the env var is NOT mounted and the in-code flag defaults (safe) apply — so
the key can be sealed AFTER the Unleash deploy lands, without blocking go-live.

Seal it in place (does not disturb the other keys) once feature-flags-engineer
provisions the scoped token:

```bash
printf '%s' 'REPLACE_UNLEASH_CLIENT_TOKEN' | tr -d '[:space:]' > /tmp/ff-token.txt
deploy/scripts/seal-secret.sh FEATURE_FLAGS_CLIENT_TOKEN \
  --in /tmp/ff-token.txt \
  --scope fuzefront/fuzefront-secrets \
  --manifest deploy/contabo/sealed/fuzefront-secrets.yaml
rm -f /tmp/ff-token.txt
git add deploy/contabo/sealed/fuzefront-secrets.yaml && git commit && git push
```

> Token PROVISIONING (creating the scoped Unleash client token + the flag taxonomy)
> is owned by **feature-flags-engineer**; the Unleash DEPLOY (Helm/Argo) is devops.
> This recipe only SEALS the token feature-flags-engineer hands over.

## Adding the SMTP credentials (signup email-verification + password reset) — REQUIRED before enabling verification

`email-service` is **enabled** in prod and its pod is **healthy — and it delivers
nothing.** The service reads `SMTP_HOST` with an in-code fallback to
`localhost:1025` (a dev mailhog). No host was wired, so every message — signup
verification *and* password reset — was accepted and silently dropped. Green
`/health`, zero delivery. Both features have been live-dead in prod since they
shipped.

The chart now wires SMTP from `emailService.email.smtp` (host/port/secure — NOT
secret, they live in values) plus these two keys from the SealedSecret:

| Key | Where to get it | Used by |
|-----|-----------------|---------|
| `SMTP_USER` | Zoho mailbox / app-specific user for the sending domain (e.g. `noreply@fuzefront.com`) | email-service → SMTP relay |
| `SMTP_PASS` | Zoho **app-specific password** (not the account password; generate one per app) | email-service → SMTP relay |

Both are mounted with **hard** `secretKeyRef`s (no `optional: true`) on the SMTP
provider path — deliberately. An authenticated relay like Zoho rejects anonymous
mail, so a missing credential must stop the pod at start rather than degrade back
into silently dropping mail. Sealing these keys and setting the host go together.

**The chart will not let you enable verification without a sender.** Setting
`securityService.requireEmailVerification: true` while
`emailService.email.smtp.host` is empty makes `helm template` **fail** — because
turning verification on with no deliverable sender locks out *every* new signup
(created unverified, never mailed). Verified in all three directions: off+no-host
renders, on+no-host fails, on+host renders with SMTP env.

```bash
# Seal the two SMTP credentials in place (does not disturb other keys).
for KEY in SMTP_USER SMTP_PASS; do
  read -rsp "value for ${KEY}: " V; echo
  printf '%s' "$V" | tr -d '[:space:]' > /tmp/smtp-val.txt
  deploy/scripts/seal-secret.sh "$KEY" \
    --from-file /tmp/smtp-val.txt \
    --into deploy/contabo/sealed/fuzefront-secrets.yaml
done
rm -f /tmp/smtp-val.txt
```

**Go-live for email verification + password reset — in this order:**
1. **Owner** seals `SMTP_USER` + `SMTP_PASS` (above).
2. Set `emailService.email.smtp.host` (e.g. `smtp.zoho.com`), `port: 587`,
   `secure: false` in `values-prod.yaml` via GitOps.
3. **Prove the sender end-to-end** — a real message delivered to a real inbox.
   Password reset starts working at this step (it needs no flag; it only needs
   `EMAIL_SERVICE_URL`, which is already wired).
4. Only then flip `securityService.requireEmailVerification: true` via GitOps in a
   deploy window. Not before — step 3 is the proof the flag depends on.

`SMTP_USER`/`SMTP_PASS` are credentials for a real mailbox and must be sealed by
the **owner**; never paste them into values, a PR, or an issue.

## Adding the Twilio keys (phone 2FA / `sms-service`) — REQUIRED before enabling SMS

`smsService.enabled` is **false** in `values-prod.yaml` and **must stay false until
these four keys are sealed**. Unlike `FEATURE_FLAGS_CLIENT_TOKEN` above, these are
NOT optional: `templates/sms-service.yaml` mounts `SMS_AUTH_SECRET` via a hard
`secretKeyRef` (no `optional: true`), so a missing key means the pod never starts —
kubelet holds the container in `CreateContainerConfigError` / `CrashLoopBackOff`.

Seal all four into the SAME `fuzefront-secrets` SealedSecret. The key names below
are what the chart reads — they must match EXACTLY:

| Key | Where to get it | Used by |
|-----|-----------------|---------|
| `TWILIO_ACCOUNT_SID` | Twilio console → Account Info (starts `AC…`) | sms-service → Twilio Verify |
| `TWILIO_AUTH_TOKEN` | Twilio console → Account Info (rotate-able) | sms-service → Twilio Verify |
| `TWILIO_VERIFY_SERVICE_SID` | Twilio console → Verify → Services (starts `VA…`) | sms-service → Twilio Verify |
| `SMS_AUTH_SECRET` | **Generate a fresh random value** — `openssl rand -hex 32` | Authentik + security-service authenticating TO sms-service |

`SMS_AUTH_SECRET` is not issued by any vendor: it is an internal shared secret you
mint yourself. It is consumed by the Authentik SMS stage blueprint
(`deploy/helm/fuzefront/authentik/blueprints/stages-sms.yaml`), so the value sealed
here must be the same one that stage uses.

```bash
# Seal each key in place (does not disturb the other keys in the manifest).
for KEY in TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN TWILIO_VERIFY_SERVICE_SID; do
  read -rsp "value for ${KEY}: " V; echo
  printf '%s' "$V" | tr -d '[:space:]' > /tmp/sms-val.txt
  deploy/scripts/seal-secret.sh "$KEY" \
    --in /tmp/sms-val.txt \
    --scope fuzefront/fuzefront-secrets \
    --manifest deploy/contabo/sealed/fuzefront-secrets.yaml
  rm -f /tmp/sms-val.txt
done

# SMS_AUTH_SECRET — minted here, not copied from a vendor.
openssl rand -hex 32 | tr -d '\n' > /tmp/sms-auth.txt
deploy/scripts/seal-secret.sh SMS_AUTH_SECRET \
  --in /tmp/sms-auth.txt \
  --scope fuzefront/fuzefront-secrets \
  --manifest deploy/contabo/sealed/fuzefront-secrets.yaml
rm -f /tmp/sms-auth.txt

git add deploy/contabo/sealed/fuzefront-secrets.yaml
git commit -m "secrets(prod): seal Twilio + SMS_AUTH_SECRET for phone 2FA"
git push
```

Then, as a SEPARATE GitOps commit in a deploy window, flip
`smsService.enabled: true` in `values-prod.yaml`. Keep the two steps apart so the
secret is provably present before the Deployment renders.

> Only the **owner** can perform this sealing — it needs the real Twilio credentials
> and the cluster's sealing cert. Agents scaffold the wiring and the key names; they
> never hold or commit the values.

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
