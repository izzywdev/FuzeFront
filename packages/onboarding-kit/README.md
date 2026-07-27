# `@fuzefront/onboarding-kit`

Everything a product repo needs to register itself with the FuzeFront portal at
deploy time — **with no manual step and no FuzeFront-side edit**.

Before this kit, [`docs/mfe-self-registration.md`](../../docs/mfe-self-registration.md)
described the pattern but nothing implemented it: there was no script, no template,
and no schema. Apps were registered by hand-editing a `builtins.ts` array inside
FuzeFront, their authorization policy by hand-editing a `*.policy.ts` file *and*
adding it to a hardcoded sync list, and their billing key by editing a Helm values
env var. This kit replaces all four.

## What "registered" means

| Concern | How the kit handles it |
|---|---|
| App registry entry | `POST /apps` from `registration/manifest.json` |
| Activation | `POST /apps/{slug}/activate` — until this, the app is not in the menu |
| **Side-menu placement** | `manifest.nav.section` + `nav.order` — see below |
| AuthN | Implied by registration; the platform brokers identity (see [`docs/consumers/onboarding-authn-authz.md`](../../docs/consumers/onboarding-authn-authz.md)) |
| AuthZ policy | `PUT /apps/{slug}/policy` from `registration/policy.json` |
| Billing profile | `PUT /apps/{slug}/billing-profile` from `registration/billing-profile.json` |

## Quick start

1. **Copy the templates** into your repo as `registration/`:

   ```
   registration/
     manifest.json          # required
     policy.json            # optional — omit if the app has no roles of its own
     billing-profile.json   # optional — omit if the app never takes payment
   ```

   `templates/` holds a valid starting point for each. They are valid **as shipped** —
   no placeholder keys to strip — so you can copy, edit the values, and register.

2. **Declare where you sit in the menu.** This is the bit people forget:

   ```jsonc
   "nav": { "section": "build", "order": 10 }
   ```

   `section` is the company lifecycle stage; `order` ranks you within it. The
   sections render in this order:

   | Section | Stage |
   |---|---|
   | `executive` | Steer |
   | `plan` | Plan |
   | `build` | Build |
   | `revenue` | Sell |
   | `customer` | Serve |
   | `insight` | Measure |
   | `platform` | Operate |

   Omit `nav` and you land in `platform` at order 999 — i.e. **last**. The script
   warns loudly when `nav.section` is missing, because sorting last is almost never
   what anyone intended.

3. **Wire the init container.** Paste `helm/initcontainer.yaml` into your
   Deployment's pod spec and create the two prerequisites it documents (a sealed
   `fuzefront-registration` Secret, and a ConfigMap of your `registration/` files).

4. **Deploy.** The init container registers the app before your container starts.

## Why an init container, and why it hard-fails

The app depends on FuzeFront for AuthN, AuthZ, org/user context, and billing. An
unregistered app cannot work correctly, so `register.sh` **exits non-zero on any
unexpected result** and the pod CrashLoopBackOffs until it is fixed.

That is deliberate. The alternative — registering best-effort and starting anyway —
produces an app that is up, serving, and subtly broken, which is far harder to
diagnose than a pod that refuses to start with a clear reason in its logs.

Transient failures (connection refused, 5xx) are retried five times with backoff, so
a platform that is still starting up does not trip this.

## Idempotence

Safe to run on every pod start, every restart, and concurrently across replicas:

- already registered + activated → refreshes the manifest, does nothing else
- already registered, not activated → activates
- not registered → registers, then activates
- another replica registers first (`409`) → treated as success, not a failure

Because it re-`PUT`s the manifest on every run, a redeploy picks up manifest changes
(a new `remoteEntry` after a version bump, a changed `nav` placement). Without that,
the first registration would be frozen forever and later edits would be silent no-ops.

## `manifest.schema.json` is generated

It is derived from the frozen contract
(`services/app-registry-service/openapi.yaml`) by `scripts/build-schema.mjs`, and
CI re-checks it with `--check`. A hand-maintained second copy would drift from the
copy the server enforces, and the failure would surface at deploy time in someone
else's repo.

```bash
node scripts/build-schema.mjs           # regenerate
node scripts/build-schema.mjs --check   # fail if stale
```

## Tests

```bash
sh tests/register.test.sh
```

Runs `register.sh` against a fake registry and asserts the properties the init
container depends on: cold-start registers **and** activates, a re-run is idempotent,
policy and billing are submitted, a bad token **exits non-zero**, and transient 5xx
responses are retried rather than fatal.
