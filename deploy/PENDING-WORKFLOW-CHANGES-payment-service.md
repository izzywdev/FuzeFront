# Pending workflow changes — payment-service in the release image matrix

The bot that opened this PR **cannot edit `.github/workflows/`** (no `workflows`
permission — the push is rejected), and workflow files are outside this slice's
allowed paths. The deploy/CI slice for the vendor-neutral **payment-service**
gateway needs ONE workflow change a human (or an admin/App identity) must apply:
add the **payment-service** image to the `release.yml` build matrix + its path
trigger, so its container is built + pushed to GHCR and the prod tag is bumped by
GitOps.

Everything else in the slice (Helm template + values + Argo umbrella wiring +
SealedSecret scaffold + observability alerts + docker-compose) is already in this
PR and does NOT depend on a workflow edit. The service is `enabled: false` in
`values-prod.yaml`, so nothing renders (zero freeze surface) until go-live.

---

## Change 1 — `release.yml`: trigger on `services/payment-service/` changes

In `.github/workflows/release.yml`, add `services/payment-service/**` to the
`on.push.paths` list:

```diff
   push:
     branches: [master]
     paths:
       - 'services/billing-service/**'
+      - 'services/payment-service/**'
       - 'clock-app/**'
       - 'deploy/helm/fuzefront/**'
       - '.github/workflows/release.yml'
```

## Change 2 — `release.yml`: build & push the payment-service image

Add a build step alongside the other services (e.g. right after the
"Build and push billing-service" step, BEFORE the "Bump image tags" step).

NOTE the **context**: payment-service is SELF-CONTAINED (no `@fuzefront/shared`
dependency — its `Dockerfile` does `COPY package.json` + `COPY src/`), so its
build context is `services/payment-service` (NOT the repo root the workspace
services use), and the `file:` is `services/payment-service/Dockerfile`.
`continue-on-error: true` matches the other ancillary services — a payment build
failure must never block the core backend+frontend deploy.

```diff
       - name: Build and push billing-service
         continue-on-error: true
         uses: docker/build-push-action@v5
         with:
           context: .
           file: services/billing-service/Dockerfile
           push: true
           tags: |
             ghcr.io/izzywdev/fuzefront-billing-service:${{ steps.tag.outputs.sha }}
             ghcr.io/izzywdev/fuzefront-billing-service:latest
           cache-from: type=gha
           cache-to: type=gha,mode=max
+
+      - name: Build and push payment-service (vendor-neutral payment gateway)
+        # Self-contained Dockerfile => context is services/payment-service
+        # (not repo root). Non-fatal like the other ancillary builds.
+        continue-on-error: true
+        uses: docker/build-push-action@v5
+        with:
+          context: services/payment-service
+          file: services/payment-service/Dockerfile
+          push: true
+          tags: |
+            ghcr.io/izzywdev/fuzefront-payment-service:${{ steps.tag.outputs.sha }}
+            ghcr.io/izzywdev/fuzefront-payment-service:latest
+          cache-from: type=gha
+          cache-to: type=gha,mode=max
```

## Tag bump — NO change needed

The existing "Bump image tags in values-prod.yaml (GitOps)" step already rewrites
**every** `tag:` line:

```bash
sed -i -E "s/^(\s*tag:).*/\1 ${SHA}/" deploy/helm/fuzefront/values-prod.yaml
```

`paymentService.image.tag: ""` was added to `values-prod.yaml` in this PR, so the
existing sed bumps it to the built SHA automatically — no extra bump step. Because
`paymentService.enabled: false`, the bumped tag is inert until go-live.

---

## Go-live (a later, deliberate step — NOT this PR)

1. Apply Changes 1 + 2 to `.github/workflows/release.yml` and merge in the deploy
   window (`master` is deploy-on-push; commits to `master` must be signed).
2. Seal the real `STRIPE_SECRET_KEY` + `PAYMENT_INTERNAL_TOKEN` into
   `payment-secrets` (`deploy/scripts/seal-secret.sh <KEY> --scope
   fuzefront/payment-secrets`; scaffold placeholder in
   `deploy/contabo/sealed/payment-secrets.yaml`).
3. Flip `paymentService.enabled: true` in `values-prod.yaml` in a deploy window.
   Argo rolls out the gateway; the neutral Payment Provider API returns 501 for
   the still-unwired calls until the money path is absorbed from billing-service.
