# Runbook — Roll out the auth-experience signup (`fuzefront.auth.experience`)

**Status of this document: AUTHORED, NOT YET APPLIED.** Nothing here has been
run against a live environment. The Unleash steps are copy-paste commands for an
operator with Unleash admin access; the flag has no `prod-unleash-ops` dispatch
set yet (`grep auth.experience .github/workflows/prod-unleash-ops.yml` returns
nothing), so there is no one-click workflow for it.

What the feature is and the contract it ships:
[`docs/guides/AUTH_EXPERIENCE_SIGNUP.md`](../guides/AUTH_EXPERIENCE_SIGNUP.md).
Captcha is a separate, later step:
[`docs/runbooks/turnstile-setup.md`](./turnstile-setup.md).

## The one rule

> **Turn the frontend half ON together with, or after, the backend half. Never
> before it. Never leave the backend ON while a frontend that still sends
> `firstName`/`lastName` is being served.**

Why, verified against `backend/security/src/routes/security.ts` and
`packages/auth-ui`:

| Combination | Result |
|---|---|
| Backend ON, a **stale frontend** sending `firstName`/`lastName` (an older bundle, a cached tab, or another consumer) | Signup is rejected `400 MALFORMED` ("Request body contains unsupported field(s)"). |
| Backend ON + Turnstile configured, **frontend flag OFF** | The legacy form has no captcha widget and sends no `turnstileToken`, so every signup is rejected `400 CAPTCHA_FAILED`. |
| Backend ON, frontend flag OFF, weak password | `422 PASSWORD_POLICY` from the server; the legacy form has no checklist. |
| Backend OFF, **frontend flag ON** | Degraded, not broken: `GET /signup/email-available` is `404` (UI shows "couldn't check", submit not blocked); `methods` has no `passwordPolicy` (UI falls back to the 12/upper/lower/digit/symbol defaults) and no `captcha` (no widget); the server does not enforce the policy. |
| Both ON | The intended experience. |

The current frontend code sends the single `name` field whichever way the
frontend flag is set (it no longer sends `firstName`/`lastName`), and the
backend-OFF path accepts `name`. That is what makes the ordering below safe.

## The two halves are switched in different places

| Half | Where the flag lives | How it flips | Takes effect |
|---|---|---|---|
| **Backend** (security-service) | Unleash flag `fuzefront.auth.experience`, evaluated per request with context `{ app: 'security-service', environment }` (no user/org, so a segment on `userId`/`orgId` never matches: use plain on/off or a 100% rollout). Any client error -> OFF. | Unleash admin | Immediately, no deploy. |
| **Frontend** (the host SPA) | **Build-time**: the Docker build arg `VITE_FF_AUTH_EXPERIENCE` (default `false` in `frontend/Dockerfile`), set in `release.yml` from the GitHub repository **variable** `VITE_FF_AUTH_EXPERIENCE` (`${{ vars.VITE_FF_AUTH_EXPERIENCE \|\| 'false' }}`). Read pre-auth by `isAuthExperienceEnabled()` in `@fuzefront/auth-ui` because `GET /api/flags` needs a session. | Change the repo variable, then rebuild the frontend image | Only after a new image is built, merged through the GitOps bump PR and rolled out. |

The default for both halves is OFF. `fuzefront.auth.experience` is declared in
[`packages/feature-flags/flag-registry.yaml`](../../packages/feature-flags/flag-registry.yaml)
(`type: release`, `default: false`).

## Preconditions

1. The security-service image and the frontend image containing the
   auth-experience code are deployed to the target environment, with both flags
   still OFF. Confirm the deployed frontend sends `name` (not
   `firstName`/`lastName`) and the security-service serves
   `GET /api/v1/security/signup/email-available` as `404` while OFF.
2. Nothing else you operate still calls `POST /api/v1/security/signup` with
   `firstName`/`lastName`. Those callers must be migrated first (see the
   migration section of the guide); they will get `400` once the backend is ON.
3. The flag exists in Unleash. If unsure, step 1 below creates it idempotently
   (`409` = already exists).
4. Owner decision recorded (who, which environment, date).
5. **Do not set up Turnstile yet.** Do it after step 4, once the new frontend is
   serving (see the table above).

## Rollout (production)

### 1. Backend flag ON (Unleash)

Needs an admin token (`INIT_ADMIN_API_TOKENS` from the `unleash-secrets` Secret)
and a route to Unleash: the Access-gated `unleash.prod.fuzefront.com`, or

```bash
kubectl -n fuzefront port-forward svc/fuzefront-unleash 4242:4242
```

```bash
UNLEASH="http://localhost:4242"            # or https://unleash.prod.fuzefront.com
TOKEN="<admin token>"                      # never commit or paste a real token
FLAG="fuzefront.auth.experience"
PROJECT="default"; ENVIRONMENT="production"

# create (409 = already exists, fine)
curl -sS -X POST "$UNLEASH/api/admin/projects/$PROJECT/features" \
  -H "Authorization: $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"name\":\"$FLAG\",\"type\":\"release\",\"description\":\"Auth-experience signup (default OFF). Owner: backend-engineer (security) / frontend-engineer. Removal: when GA in 100% of environments.\"}"

# enable the environment
curl -sfX POST "$UNLEASH/api/admin/projects/$PROJECT/features/$FLAG/environments/$ENVIRONMENT/on" \
  -H "Authorization: $TOKEN"

# 100% strategy, no segment (the flag is evaluated pre-auth)
curl -sfX POST "$UNLEASH/api/admin/projects/$PROJECT/features/$FLAG/environments/$ENVIRONMENT/strategies" \
  -H "Authorization: $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"name\":\"flexibleRollout\",\"parameters\":{\"rollout\":\"100\",\"stickiness\":\"default\",\"groupId\":\"$FLAG\"}}"
```

These are the same admin-API calls `prod-unleash-ops.yml` uses for other flags;
re-running the strategy `POST` creates a duplicate, so check
`.../strategies` first if you are not sure. Adding a `fuzefront.auth.experience`
set to `prod-unleash-ops.yml` is `devops-engineer` work and is not done.

Verify (replace the host as appropriate):

```bash
curl -s https://app.fuzefront.com/api/v1/security/methods | python3 -m json.tool
# expect "passwordPolicy": { "minLength": 12, ... }   ("captcha" absent until Turnstile is set up)

curl -s -o /dev/null -w '%{http_code}\n' \
  'https://app.fuzefront.com/api/v1/security/signup/email-available?email=nobody%40example.com'
# expect 200 (it was 404 while OFF). A 429 means you hit the 20/min/IP limit.
```

Allow a short propagation delay (the Unleash client refreshes on an interval)
before judging a "still OFF" result.

### 2. Frontend flag ON (build, then GitOps)

```bash
gh variable set VITE_FF_AUTH_EXPERIENCE --body true -R izzywdev/FuzeFront
gh workflow run release.yml -R izzywdev/FuzeFront -f reason='enable fuzefront.auth.experience frontend'
```

`release.yml` builds and pushes the frontend image, then opens the checked PR
that bumps the tag in `values-prod.yaml`; Argo rolls out only after that PR
merges. Per this repo's policy prod is GitOps: do not hand-deploy or touch the
cluster. Setting a repository variable needs repo-admin rights.

Verify in a real browser after rollout: `/signup` renders `SignUpFlow` (single
name field, requirements checklist, confirm field); the browser console is
clean (see "Not yet verified" below).

### 3. Then, and only then: Turnstile

Follow [`turnstile-setup.md`](./turnstile-setup.md).

## Rollback

Fastest and safe: **step 1 in reverse** - set the Unleash flag/environment OFF.

```bash
curl -sfX POST "$UNLEASH/api/admin/projects/$PROJECT/features/$FLAG/environments/$ENVIRONMENT/off" \
  -H "Authorization: $TOKEN"
```

This takes effect without a deploy and returns signup to the pre-1.0.0 behaviour
(`name` and legacy `firstName`/`lastName` accepted, no policy/captcha gate, the
availability alias back to `404`). An already-rolled-out ON frontend then runs
in the degraded mode in the table above, which still signs users up. To also
retire the new UI, set the repo variable back to `false` and rebuild:

```bash
gh variable set VITE_FF_AUTH_EXPERIENCE --body false -R izzywdev/FuzeFront
gh workflow run release.yml -R izzywdev/FuzeFront -f reason='disable fuzefront.auth.experience frontend'
```

A release flag gates the code path going forward; accounts already created stay.

## Local development and CI

| Half | How to force ON |
|---|---|
| Backend | `FUZE_FLAGS_PROVIDER=offline FUZE_FLAGS_OFFLINE_ON=fuzefront.auth.experience` in the security-service environment. The offline provider is refused in production and is ignored when Unleash is configured (`packages/feature-flags/src/server.ts`). |
| Frontend | `VITE_FF_AUTH_EXPERIENCE=true` when building/serving, or, for local/QA only, `window.__FF_AUTH_EXPERIENCE__ = true` (a same-origin runtime override that wins over the build default). It changes only what the browser renders; the server enforces regardless. |

For captcha in dev/CI use Cloudflare's published test keys (see the Turnstile
runbook).

## Removal

When the flow is GA in 100% of environments, delete the flag (both halves) in one
PR: the legacy `firstName`/`lastName` shim and OFF branches in
`backend/security/src/routes/security.ts`, `isAuthExperienceEnabled()`, the
flag-OFF branches in `frontend/src/App.tsx` and `LoginPage.tsx`, the
`VITE_FF_AUTH_EXPERIENCE` build arg, and the registry entry (its
`removal_criterion`).

## Not yet verified (tracked, not done)

- **Real-browser runtime validation** (Chrome DevTools MCP, console clean under
  TLS with the Module-Federation shell) of the new signup has not been recorded.
  Do it between steps 2 and 3 and report the console result.
- **Playwright e2e** for the new signup flow does not exist yet.
- **Turnstile production keys are pending** (owner action; see the Turnstile
  runbook).
- This runbook has not been exercised against a live Unleash or a real release.
