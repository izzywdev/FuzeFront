---
title: Deployment
description: How FuzeFront and its remotes reach production through Helm and ArgoCD, for both in-repo and external remotes.
audience: developer
order: 9
owner: "@izzywdev"
lastReviewed: 2026-10-26
status: published
---

# Deployment

FuzeFront deploys to **Kubernetes with Helm, synced by ArgoCD** (GitOps) on FuzeInfra: a kind cluster locally and a Contabo k3s cluster in production. There is no static-host path (no Netlify, Vercel, or object-storage-plus-CDN publishing) and nothing is deployed by hand.

## The rules

- **Merging to `master` is the deploy.** `master` deploys on push, so a merge here is a production deploy. Argo reconciles the cluster from Git.
- **Never hand-deploy to production.** No `kubectl apply`, no `helm upgrade` against the production cluster. Change Git; Argo does the rest.
- **Infrastructure changes are not made from this repository.** Cluster, ingress, and shared-service changes belong to FuzeInfra and are requested from that team.
- **Gates are the safety net.** Pull requests must clear CI (design-system conformance, frames-first, authorization, identifier, Helm validation, and the full test matrix) before they merge.
- **Run Helm and ArgoCD config checks locally** with `helm lint` and `helm template` for every values overlay before you open a pull request. A schema check only proves a value has the right shape, not that it is valid; do not paper over a missing value with a cast such as `| int` or `| default`. Declare the default in `values.yaml`.

## Path A: a remote inside this repository

The reference is `clock-app/`, deployed by `deploy/helm/fuzefront/templates/clock-app.yaml` as part of the umbrella `fuzefront` chart:

1. Build the remote as a static image (`clock-app/Dockerfile`, served by nginx). Use a `node:24` base image for the build stage.
2. Add its Deployment, Service, and `/apps/<slug>/` Ingress mount to the chart, gated by an `enabled` value, and keep the four serve-path layers in agreement (see [Registering your app](registering-your-app.md)).
3. Open a pull request. On merge, Argo syncs the chart and the remote appears under the shell's origin.

The reference nginx config (`clock-app/nginx.conf`) serves `remoteEntry.js` with `no-cache` so a stale entry never points at removed chunks, marks hashed assets immutable, sends permissive CORS headers, and answers `/health` for the Kubernetes probes. Keep every `add_header` at server level: nginx drops inherited headers in any `location` that sets one of its own.

## Path B: an external remote in your own repository

Most products deploy their own remote and **register** it with the shell:

1. Build and ship your remote from your own repository, on your own Helm chart and Argo Application. `deploy/argocd/applications/fuzequality.yaml` shows an Argo Application that syncs a product chart from Git into its own namespace with `prune` and `selfHeal` enabled (that chart happens to be vendored in this repository; yours lives in your repository).
2. Serve it under the shell's origin where you can. An Ingress in **your app's own namespace** can publish `/apps/<slug>/*` on the shell's host and proxy to your Service. Only a remote hosted outside the cluster uses an absolute URL, and then it must send CORS headers.
3. Register it with the onboarding kit's init container ([Registering your app](registering-your-app.md)). The pod will not start unless registration succeeds, so an unregistered app never serves traffic.
4. Seal and distribute the registration token as a Kubernetes SealedSecret named `fuzefront-registration`. Never commit a plaintext secret.

## Feature flags: ship dark

Wrap new or risky work in a flag, **default OFF**, and gate both server logic and UI. FuzeFront hosts the family flag service (**Unleash**), consumed through OpenFeature with `@fuzefront/feature-flags`:

```ts
import { init, getBoolean } from '@fuzefront/feature-flags'

await init({
  url: process.env.UNLEASH_URL!,
  clientToken: process.env.UNLEASH_CLIENT_TOKEN!,
  appName: 'my-app',
})

if (await getBoolean('my-app.checkout.new-flow', false)) {
  // new behavior
}
```

Reads never throw: if Unleash is unreachable they return the default you pass. Flag names follow `<repo>.<domain>.<flag>`. Test both flag states and retire flags you no longer need. A permission flag is a rollout convenience only; real authorization stays in Permit. The browser entry is `@fuzefront/feature-flags/web` with a front-end token.

## After you deploy

- Check that `GET /api/v1/app-registry/apps/{slug}` shows your app as `activated`.
- Load the app in the shell and confirm the browser console is clean: no errors, no failed requests, no mixed-content or CSP blocks.
- If something is off, go to [Troubleshooting](troubleshooting.md).

Next: [Developer Portal](developer-portal.md) for the API catalog.
