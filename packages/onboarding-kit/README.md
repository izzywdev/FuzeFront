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

## Validating `policy.json` in your CI

```bash
npx fuzefront-validate-policy registration/policy.json
# or, from a checkout of the kit:
node bin/validate-policy.mjs registration/policy.json
```

**Run this in your own repo's CI.** Zero dependencies, exits non-zero on a bad policy.

A policy problem is uniquely hard to notice at runtime, which is why it is worth a
build step:

- A policy the platform **rejects** (`400`) is rejected inside an init container at
  deploy time — the error is in a pod log nobody is tailing.
- A policy the platform **accepts** but whose role references an action the document
  never declares is worse: nothing errors anywhere. Permit creates the role and it
  simply grants nothing, so the symptom is *"our users have no permissions"*, which
  reads as a bug in your app.

## Validating the whole `registration/` directory in your CI

```bash
npx fuzefront-validate-registration registration
# or, from a checkout of the kit:
node bin/validate-registration.mjs registration
```

Where `validate-policy` checks that one file is **well-formed**, this checks that your
registration satisfies **fleet policy** — the rules the platform requires of every
product but that no schema can express. Also zero dependencies.

It enforces four things:

| Rule | Why |
|---|---|
| **`slug` and `name` must NOT start with `Fuze`** | Family convention: register as `service` / `Service`, not `fuzeservice` / `FuzeService`. `slug` is **immutable**, so getting it wrong is not a one-line edit — it costs a register-then-delete migration that orphans Permit grants and CASCADE-deletes install rows. See below. |
| Effective modes include `portal` **and** `standalone` | `standalone` is the only surface a mobile TWA/APK can wrap, because an app store needs a URL that stands on its own. |
| `standalone` implies a non-empty `routing.host` | A standalone surface with no host has no URL to serve or to wrap. |
| `policy.json` exists, and a vendored `register.sh` actually submits it | A pre-kit script that skips the policy step leaves the product with no roles. |

**Why this is not a schema rule.** `mode: "portal"` with `modes` omitted is entirely
valid — the contract says an absent `modes` falls back to `[mode]`. Such a product
registers cleanly, appears in the portal, passes every existing gate, and is silently
incapable of ever shipping a mobile app. Nothing is malformed; a capability simply
never exists. That is precisely the class of failure a schema cannot catch and this
gate can.

### The no-`Fuze`-prefix slug convention

Register as `service`, not `fuzeservice`. The prefix is already implied by the fact that
you are registering on FuzeFront at all, and the slug is user-visible — it appears in
`/app/<slug>` URLs, in Permit keys (`<slug>_<Resource>`), and in billing product keys.
FuzePicker already registered as `picker`, so the convention existed; it was simply never
enforced, and twelve products registered against it.

```jsonc
"slug": "service",   // not "fuzeservice"
"name": "Service"    // not "FuzeService"
```

**Why this is a build-time gate and not a `pattern` on the contract's `Slug`.** Adding
`(?!fuze)` to `Slug` in `openapi.yaml` would be actively harmful. Twelve live rows hold
prefixed slugs, and `slug` is immutable — correcting one means *register the short slug,
then delete the prefixed one*. Both steps talk to the registry **about** the prefixed
slug, and `register.sh` re-`PUT`s the manifest on every pod start. A contract-level ban
would reject the very requests that repair the damage. Banning a value at the API is only
safe when no existing row holds it. So the registry keeps **accepting** the old value
while the migration is in flight, and this gate stops anyone **authoring** a new one — in
their own repo, at build time, where it is a one-character fix.

### Already registered with the prefix? `fuzefront-migrate-slug`

Because `slug` is immutable there is no rename. `register.sh` performs only the first half
of the correction, so a product that de-prefixes its manifest and redeploys ends up
registered **twice**, with the prefixed row still activated and still in the launcher.

```bash
# DRY RUN by default — reads, plans, prints, changes nothing.
npx fuzefront-migrate-slug --from fuzeservice --to service \
  --api https://app.fuzefront.com --token "$TOKEN" \
  --registration ./registration
```

It registers the short slug, re-submits `policy.json` / `billing-profile.json` under it,
matches the old app's status, **re-reads the registry to verify** the replacement is
present and correct, and only then deletes the prefixed row. Every failure path aborts
*before* the delete, so the worst outcome it can produce is a duplicate tile — never an
unregistered product. It is idempotent and resumes a half-finished run.

`--apply` **refuses** to delete without `--permit-grants` and `--installs`, because two
losses are silent and it cannot repair either (a dry run warns and still prints the plan —
the flags gate the delete, not the preview):

- **Permit grants.** Product roles are namespaced by the *registry slug*
  (`sync-permit-schema.ts` forces `product: row.slug`), so migrating renames every key.
  Existing assignments keep pointing at `fuzeservice_agent`, the old role is never deleted,
  nothing errors — affected users just lose the role.
- **Install rows.** `app_installations.app_id` references `apps.id` `ON DELETE CASCADE`,
  and installs are not in the frozen contract at all.

**This is an owner tool, not an init-container tool**, and suite parents like FuzeHub are
deliberately scoped out. Full procedure, the grant-remap and the ordering:
[`docs/runbooks/app-slug-deprefix-migration.md`](../../docs/runbooks/app-slug-deprefix-migration.md).

**Embed-only products are exempt** from the surface rules. Per the contract an embed
renders inside a third-party page with neither portal chrome nor FuzeFront navigation,
is not a portal destination, and may not register a menu entry at all — so requiring a
portal surface of it would be wrong.

The validator enforces the frozen `ProductPolicy` contract:

- keys are **bare** (`Ticket`, not `fuzeservice_Ticket`) and contain **no `_`** — `_`
  is the `<slug>_<Key>` namespace separator the platform adds
- the document is **strict**: an unknown top-level key (even `$comment`) is a `400`
- every `Resource:action` in every role resolves to a resource **and** an action
  declared in the same file
- `product`, if present, agrees with the sibling `manifest.json` slug

It also warns (without failing) about actions or whole resources that no role grants.

## Tests

```bash
npm test                                # every suite
node --test tests/validate-policy.test.mjs
node --test tests/validate-registration.test.mjs
node --test tests/migrate-slug.test.mjs
sh tests/register.test.sh
```

`register.test.sh` runs `register.sh` against a fake registry and asserts the
properties the init container depends on: cold-start registers **and** activates, a
re-run is idempotent, policy and billing are submitted, a bad token **exits
non-zero**, and transient 5xx responses are retried rather than fatal.

`migrate-slug.test.mjs` drives the migration end to end against that same fake registry.
Every failure case asserts not just that the tool reported failure but that **the old app
is still registered afterwards** — the one property that makes the tool safe to point at
production.
