# App registration troubleshooting decision tree

Your app isn't showing up in the FuzeFront portal after registration. Start here.
This page is a flow, not a reference — it links out to the deeper docs for each
failure instead of repeating them. See [`mfe-self-registration.md`](../mfe-self-registration.md)
for how registration works end to end and
[`packages/onboarding-kit/README.md`](../../packages/onboarding-kit/README.md)
for the kit that implements it (`register.sh`, templates, validators).

```
Is the init container's pod CrashLoopBackOff / register.sh exiting non-zero?
├─ YES → go to "1. Init container won't complete" below
└─ NO, pod is Running but the app isn't in the menu
   ├─ Is GET /api/v1/app-registry/apps/{slug} returning the app with
   │  status "activated"?
   │  ├─ NO → go to "2. Registered but not activated"
   │  └─ YES → go to "3. Activated but the portal shows nothing / blank panel"
```

## 1. Init container won't complete

`register.sh` exits non-zero on anything it doesn't recognize **on purpose** — see
"Why an init container, and why it hard-fails" in the onboarding-kit README. Read
the pod log; it is a one-line, specific reason by design (`[fuzefront-register]
FATAL: ...`), not a generic failure.

### 1a. Connectivity — `register.sh` keeps retrying, or `FATAL: unexpected response`

- `register.sh` retries `000` (connection refused/DNS/timeout) and `5xx` five times
  with backoff before giving up — a platform that is still starting does not trip
  this. If it still fails after retries, the applications-service is unreachable
  from the init container's network, not merely slow.
- Confirm `FUZEFRONT_API_URL` resolves and is reachable from inside the cluster
  (`fuzefront-applications:3003` in-cluster; a port-forward for a local check).
  A typo here reads identically to the service being down.
- Confirm the Secret/ConfigMap the init container mounts actually exist —
  `packages/onboarding-kit/helm/initcontainer.yaml` documents both prerequisites, and a missing one fails
  before any HTTP call happens at all.

### 1b. Auth/token issues — `FATAL: auth rejected (HTTP 401/403)`

This is the registration bearer, `FUZEFRONT_REGISTRATION_TOKEN`, not a user JWT. It
is one pre-shared platform-wide secret (`CONSUMER_REGISTRATION_SECRET`), not a
per-product service account — there is nothing to mint one of. The middleware
tells you exactly which of two problems you have (see
`backend/applications/src/middleware/consumer-auth.ts`), both logged server-side:

| Response | Meaning | Who can fix it |
|---|---|---|
| `503 { "error": "consumer_registration_unavailable" }` | The platform pod has no `CONSUMER_REGISTRATION_SECRET` configured at all | Platform side — not something your token value can fix |
| `401 { "error": "invalid_registration_token" }` | The secret IS configured, but your `FUZEFRONT_REGISTRATION_TOKEN` doesn't match it | Your side — re-check the hand-off in step 2 of "Auth token" in `mfe-self-registration.md` |

Full distribution/rotation procedure and the "don't probe `fuzefront-secrets` for a
likely-looking key" warning: `mfe-self-registration.md` § "Auth token".

### 1c. Payload validation — `FATAL: register failed: HTTP 400 ...`

The body echoes which field failed and why:

```json
{ "error": "validation_error", "message": "Request body failed validation",
  "fields": [{ "path": "manifest.integration.remoteEntry", "message": "..." }] }
```

Common causes:

- `manifest.json` isn't valid JSON, or has no `.slug` — `register.sh` catches both
  locally before making any HTTP call (`$MANIFEST is not valid JSON` /
  `manifest has no .slug`).
- The manifest doesn't match the frozen contract
  (`services/app-registry-service/openapi.yaml`). Validate it before you deploy:
  `npx fuzefront-validate-registration registration` catches fleet-policy problems
  a schema can't express (see the onboarding-kit README's "Validating the whole
  `registration/` directory" section) — missing `nav.section`, a `standalone`
  mode with no `routing.host`, a `Fuze`-prefixed display name, a `policy.json`
  that exists but isn't wired into `register.sh`.
- `policy.json` is malformed or references an action/resource it never declares —
  validate separately with `npx fuzefront-validate-policy registration/policy.json`.
  A policy the platform *accepts* but that grants nothing is worse than one it
  rejects: nothing errors anywhere, and the symptom looks like "our users have no
  permissions" in your own app, not a registration failure. See the README's
  "Validating `policy.json`" section.

### 1d. Duplicate registration — `409`

`register.sh` treats a `409` on the initial `POST /apps` as **success, not
failure** — it means another replica of your own pod won the startup race, which
is expected under a multi-replica rollout. A `409` is only a real problem if it
comes from registering a **different** app under a slug you already used; slugs
are immutable (see the root `CLAUDE.md` § "`slug`, display name, and the
federated serve path are THREE INDEPENDENT questions"), so there is no cheap fix —
don't try to "rename" by re-registering, it strands the first row's Permit grants
and app-installations.

## 2. Registered but not activated

`GET /apps/{slug}` returns `200` with `"status": "registered"` (not
`"activated"`): the app exists but was never flipped into the menu.

- If you deliberately set `SKIP_ACTIVATE=true` (staged rollout), this is expected —
  the log line says so (`leaving app in 'registered' — it will NOT appear in the
  menu`). Unset it and redeploy when you're ready.
- Otherwise, the `POST /apps/{slug}/activate` step itself failed. Re-run with
  `SKIP_ACTIVATE` unset and read the init container log for the activate call's
  status — `register.sh` dies loudly on anything other than `200`/`204`.

## 3. Activated but the portal shows nothing / blank panel

The registry says `activated`, but nothing mounts, or the panel is blank while the
tile itself appears. This is almost always the **remote URL reachability**
problem, and it is deceptive: a healthcheck can be green while the UI is broken,
because "entry file returns 200" and "the module actually loads" are different
facts. See `scripts/check-portal-federation-health.mjs`'s header comment for the
full mechanism; the short version:

**The host resolves your `integration.remoteEntry` against its own origin and
loads it — nothing else.** (`frontend/src/utils/loadFederatedApp.ts:71`.) Four
layers must agree on the same path, or `remoteEntry.js` returns 200 while every
chunk it references 404s:

| Layer | Where it's declared |
|---|---|
| `integration.remoteEntry` | `registration/manifest.json` **and** its vendored Helm copy (must be byte-identical) |
| Vite/webpack `base` | your remote's `vite.config.*` (with `assetsDir: ''`) |
| Ingress `path` | your chart's federated-mount Ingress |
| nginx `location`/`alias` | your chart's nginx ConfigMap or baked `nginx.conf` |

Convention (not a rule — see the root `CLAUDE.md`): serve at
`/apps/<your-slug>/`, matching all four layers to that same path.

Checks, cheapest first:

1. `curl -I <remoteEntry URL>` from outside the cluster (the same origin a real
   browser uses) — confirm `200` and a JS content type, not an HTML fallback page
   (a `200` with HTML is the host's own SPA answering for a path that doesn't
   exist, and it is the single most common disguised failure here).
2. Load the same URL in a browser devtools Network tab and check the chunks it
   imports resolve `200` too — a healthy entry file with 404ing chunks is the
   "signature failure" this whole section exists to catch.
3. Run `node scripts/check-portal-federation-health.mjs` (or let
   `.github/workflows/portal-federation-health.yml` run it) against your
   environment — it probes every registered app's remote exactly the way the
   browser does and reports per-app pass/fail, not just "something answered".

If you're using `iframe`/`spa`/`web-component` integration instead of
module-federation, the health probe instead requires your app's own URL to
answer `< 400` — a `404` on your own root means nothing is served there at all;
see `backend/src/routes/appHealth.ts`.

### Heartbeat / health problems

Once mounted, your app should call `POST /apps/{slug}/heartbeat` — authenticated
by the **per-app heartbeat token** (returned out-of-band in the
`X-App-Heartbeat-Token` response header on your original `POST /apps` /
`register.sh`'s registration call), not a user session or the registration
secret. Symptoms and causes:

| Symptom | Cause |
|---|---|
| `401 { "error": "unauthorized", "message": "Invalid app heartbeat token" }` | Wrong/stale token presented — re-capture it from the registration response, don't reuse `FUZEFRONT_REGISTRATION_TOKEN` |
| `404` from the heartbeat endpoint | The slug has no registry row at all — register first |
| `400 validation_error` | Heartbeat body doesn't match the schema (`status` must be a recognized value) |
| App shows "unhealthy" in the portal despite answering heartbeats | You're posting `status` other than `"online"` — only `"online"` is recorded as healthy |

## Still stuck?

Open an issue with the exact HTTP status + body from the failing call (not just
"it doesn't work") and whether you're on the local (`docker-compose.e2e.yml`) or
Kubernetes (Helm) path — see
[`ADOPTION_QUICKSTART.md`](../ADOPTION_QUICKSTART.md).
