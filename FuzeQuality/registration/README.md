# FuzeFront registration — FuzeQuality

This directory is what makes FuzeQuality appear in the FuzeFront portal's
applications list.

| File | Purpose |
|---|---|
| `manifest.json` | The portal registration — slug, tile, surfaces, routing |
| `policy.json` | The product's Permit resources and roles, submitted to `PUT /apps/{slug}/policy` |

Both are checked by `@fuzefront/onboarding-kit`:

```bash
node packages/onboarding-kit/bin/validate-registration.mjs FuzeQuality/registration
node packages/onboarding-kit/bin/validate-policy.mjs --slug quality FuzeQuality/registration/policy.json
```

## What was wrong before, and why none of it produced an error

The manifest was valid against every schema and would have registered cleanly.
It was also, in three separate ways, a product that could never work properly —
and each failure is invisible by construction: no 4xx, no log line, no red build.

**1. `slug: "fuzequality"`, `name: "FuzeQuality"` → `quality`, `Quality`.**
A Fuze product registers on FuzeFront *without* the `Fuze` prefix. The prefix is
implied by registering on FuzeFront at all, and the slug is user-visible in
`/app/<slug>` URLs, Permit keys and billing product keys. This is worth fixing
now rather than later because **`slug` is immutable**: there is no rename, so the
only correction after the fact is register-the-new-one-then-delete-the-old, which
orphans the product's Permit grants and CASCADE-deletes its installation rows.
Free to prevent, expensive to undo.

> If a `fuzequality` row somehow already exists in the registry, do **not** just
> deploy this — run `packages/onboarding-kit/bin/migrate-slug.mjs`. Nothing in
> this chart has ever registered anything (see below), so it almost certainly
> does not exist; check before assuming.

**2. `mode: "portal"` with no `modes`.**
Legal — an absent `modes` falls back to `[mode]` — and it silently means
FuzeQuality could never ship a mobile app, because a TWA can only wrap a
`standalone` surface with a URL that stands on its own. Now
`modes: ["portal", "standalone"]`, with a real `routing.host`. A `standalone`
mode with no host is the same failure wearing a disguise.

**3. `integration.type: "module-federation"` pointing at a `remoteEntry.js` that
is never built.**
`apps/web/vite.config.ts` is a plain Vite SPA build — no `@originjs/vite-plugin-federation`,
no `exposes`, output `dist/web`. There is no `remoteEntry.js` and no
`./FuzeQualityApp` module anywhere in this tree, so the portal would have fetched
a 404 and rendered an empty tile. Corrected to `iframe` against
`https://quality.prod.fuzefront.com`, which is the host
`deploy/helm/fuzequality/values-prod.yaml` actually serves. When a federated
remote is genuinely built, this flips back — but the manifest should describe
what exists, not what was intended.

## Turning registration on

`deploy/helm/fuzequality/templates/registration.yaml` runs `register.sh` from
`@fuzefront/onboarding-kit` as a **post-install/post-upgrade Job**, and it
defaults to `registration.enabled: false`.

That default is deliberate and differs from every sibling product. Their charts
are gated off and deploy nothing, so defaulting registration ON costs them
nothing. **This chart is live** — `values-prod.yaml` pins real image tags and
Argo syncs it with `prune` + `selfHeal`. `register.sh` exits non-zero when it
cannot read its bearer token, by design, so wiring it as an `initContainer` with
the default ON would CrashLoopBackOff the **running** frontend on the next sync
if the Secret were absent. Cluster state cannot be inspected from this repo, so
the default is the one that cannot break what is already serving.

Provision both prerequisites, then flip the flag in the same change:

```bash
# 1. the manifest + policy, as a ConfigMap the Job mounts
kubectl -n fuzequality create configmap fuzequality-registration \
  --from-file=manifest.json=FuzeQuality/registration/manifest.json \
  --from-file=policy.json=FuzeQuality/registration/policy.json \
  --dry-run=client -o yaml | kubectl apply -f -

# 2. register.sh itself, from the onboarding kit
kubectl -n fuzequality create configmap fuzefront-onboarding-kit \
  --from-file=register.sh=packages/onboarding-kit/bin/register.sh \
  --dry-run=client -o yaml | kubectl apply -f -
```

…plus the `fuzefront-registration` Secret (key `token`, an `apps:register`
bearer) — **sealed**, committed under `deploy/sealed-secrets/`, never a plain
`Secret` and never a literal in a values file.

Then set `registration.enabled: true` in `values-prod.yaml`.

## A pre-existing mismatch, deliberately not changed here

`apps/api/src/index.ts` asks the platform for permissions on resource types
spelled `fuzequality.Repository`, `fuzequality.Evidence`, and so on. The platform
namespaces a product's **bare** policy keys as `<slug>_<BareKey>` — so this
policy's `Repository` becomes `quality_Repository`, which matches neither the old
`fuzequality.Repository` nor a renamed `quality.Repository`.

That mismatch predates the slug change and is not introduced by it. Reconciling
the two is an authorization change on a live service and belongs in its own PR,
with `appsec-reviewer` on it — not folded into a registration fix.
