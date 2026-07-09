# Pending workflow changes — clock-app in the release image matrix

The bot that opened this PR **cannot edit `.github/workflows/`** (no `workflows`
permission — the push is rejected). The deploy/CI slice for the Federated App
Platform needs ONE workflow change a human (or an admin/App identity) must apply:
add the **clock-app** image to the `release.yml` build matrix so its container is
built + pushed to GHCR and the prod tag is bumped by GitOps.

Everything else in the slice (Helm template + values + ingress + Argo +
SealedSecret scaffolding + observability) is already in this PR and does NOT
depend on a workflow edit.

---

## Change 1 — `release.yml`: trigger on `clock-app/` changes

In `.github/workflows/release.yml`, add `clock-app/**` to the `on.push.paths`
list (so a clock-app source change triggers a rebuild):

```diff
   push:
     branches: [master]
     paths:
       - 'backend/**'
       - 'shared/**'
       - 'frontend/**'
       - 'services/email-service/**'
       - 'services/sms-service/**'
       - 'services/provisioning-service/**'
       - 'services/billing-service/**'
+      - 'clock-app/**'
       - 'deploy/helm/fuzefront/**'
       - '.github/workflows/release.yml'
```

## Change 2 — `release.yml`: build & push the clock-app image

Add a build step alongside the other services (e.g. right after the
"Build & push applications-service" step, BEFORE the "Bump image tags" step).

NOTE the **context**: the clock-app `Dockerfile` is self-contained
(`COPY package*.json ./` + `COPY . .`), so its build context is `clock-app/`
(NOT the repo root that the other services use), and the `file:` is
`clock-app/Dockerfile`. `continue-on-error: true` matches the other ancillary
services — a clock build failure must never block the core backend+frontend
deploy.

```diff
       - name: Build & push applications-service
         continue-on-error: true
         uses: docker/build-push-action@v5
         with:
           context: .
           file: backend/applications/Dockerfile
           push: true
           tags: |
             ghcr.io/izzywdev/fuzefront-applications-service:${{ steps.tag.outputs.sha }}
             ghcr.io/izzywdev/fuzefront-applications-service:latest
           cache-from: type=gha
           cache-to: type=gha,mode=max
+
+      - name: Build & push clock-app (built-in MF remote)
+        # Built-in reference Module-Federation remote, served same-origin at
+        # app.fuzefront.com/apps/clock/. Self-contained Dockerfile => context is
+        # clock-app/ (not repo root). Non-fatal like the other ancillary builds.
+        continue-on-error: true
+        uses: docker/build-push-action@v5
+        with:
+          context: clock-app
+          file: clock-app/Dockerfile
+          push: true
+          build-args: |
+            # Static MF remote; the host loads it same-origin so the API base is
+            # window.location.origin. Public host build-args for the federated build.
+            VITE_HUB_API_URL=https://app.fuzefront.com
+            VITE_PUBLIC_URL=https://app.fuzefront.com
+          tags: |
+            ghcr.io/izzywdev/fuzefront-clock-app:${{ steps.tag.outputs.sha }}
+            ghcr.io/izzywdev/fuzefront-clock-app:latest
+          cache-from: type=gha
+          cache-to: type=gha,mode=max
```

## Tag bump — NO change needed

The existing "Bump image tags in values-prod.yaml (GitOps)" step already rewrites
**every** `tag:` line:

```bash
sed -i -E "s/^(\s*tag:).*/\1 ${SHA}/" deploy/helm/fuzefront/values-prod.yaml
```

`clockApp.image.tag: ""` was added to `values-prod.yaml` in this PR, so the
existing sed bumps it to the built SHA automatically — no extra bump step.

---

## After applying

1. Apply Changes 1 + 2 to `.github/workflows/release.yml` and merge in the deploy
   window (`master` is deploy-on-push; commits to `master` must be signed).
2. The next release builds `ghcr.io/izzywdev/fuzefront-clock-app:<sha>`, the bump
   step writes that SHA into `clockApp.image.tag`, and Argo rolls out the clock
   remote. `clockApp.enabled: true` is already set in `values-prod.yaml`.
3. Seal `FEATURE_FLAGS_CLIENT_TOKEN` into `fuzefront-secrets` only once the family
   Unleash deploy + scoped token exist (see deploy/contabo/SEAL_PROD_SECRETS.md);
   until then the app-registry flags use safe in-code defaults.
