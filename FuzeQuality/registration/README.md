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

The registered product is a same-origin Module Federation remote. Its registry
entry must keep the `fuzequality` slug, `/apps/fuzequality/assets/remoteEntry.js`
entry point, `fuzequality` scope, and `./App` exposed module in lock-step with
`apps/web/vite.config.ts` and the chart's `federatedMount` settings. Replacing
this with the standalone host or an iframe makes the portal either load a
Cloudflare Access HTML response or render a second application shell instead of
the shared-host remote.

## Registration history and invariant checks

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

**3. The remote must describe the built federation artifact, not a fallback
standalone page.** The application now builds `remoteEntry.js` and exposes
`./App` through `apps/web/vite.config.ts`; the production ingress mounts that
artifact below `/apps/fuzequality/` on the portal origin. The manifest therefore
uses `module-federation` rather than an iframe against the standalone host.
Changing either side without the other can still produce a schema-valid but
unloadable app, so validate the manifest and exercise the portal route before
enabling registration.

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

Provision all three prerequisites through their GitOps resources, then flip the
flag in the same reviewed change:

1. `fuzequality-registration` ConfigMap from this directory's manifest and
   policy;
2. `fuzefront-onboarding-kit` ConfigMap carrying the versioned `register.sh`;
3. `fuzefront-registration` Secret (key `token`, an `apps:register` bearer)
   delivered by the FuzeInfra credential-handoff workflow — **sealed** and
   Argo-managed for the `fuzequality` namespace, never a plain `Secret` and
   never a literal in a values file.

Do not apply any of those resources imperatively to a chart-managed cluster.
FuzeInfra #988 establishes the secret hand-off; the FuzeQuality chart then owns
the non-secret ConfigMaps and the idempotent registration Job.

Then set `registration.enabled: true` in `values-prod.yaml`.

## Policy keys and API authorization

The API asks the platform for the same keys emitted by FuzeFront's ProductPolicy
registry: `<slug>_<BareKey>`. For this policy, `Repository` is
`quality_Repository`, `Evidence` is `quality_Evidence`, and so on. The constants
in `apps/api/src/platform-permissions.ts` make this relationship explicit and
prevent a hand-written key from silently producing a permanent 403.
