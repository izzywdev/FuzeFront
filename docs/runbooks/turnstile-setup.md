# Runbook — Cloudflare Turnstile for signup

Turnstile is the captcha on the redesigned signup. This runbook covers the
**owner** step (create the widget), the **FuzeInfra** step (the secret key as a
SealedSecret), and how the security-service surfaces the result. Background:
[`docs/guides/AUTH_EXPERIENCE_SIGNUP.md`](../guides/AUTH_EXPERIENCE_SIGNUP.md);
sequencing with the flag: [`auth-experience-rollout.md`](./auth-experience-rollout.md).

**Status of this document: AUTHORED, NOT YET APPLIED.** No production Turnstile
widget exists as far as this repo shows. **Production keys are pending.**

> **NEVER put a real secret key (or a real site key you do not intend to
> publish) in this repo, a PR, an issue, chat or CI logs.** The only key values
> that appear below are Cloudflare's published test fixtures.

## What "not configured" means (read this first)

Captcha is **opt-in by configuration**. Until BOTH `TURNSTILE_SITE_KEY` and
`TURNSTILE_SECRET_KEY` are non-blank in the security-service's environment
(`backend/security/src/services/turnstile.ts`, `getCaptchaConfig()`):

- `GET /v1/security/methods` has **no `captcha` property**, so the signup UI
  renders **no widget** and sends **no `turnstileToken`**.
- `POST /v1/security/signup` performs **no server-side verification** and makes
  **no call to Cloudflare**; a request with or without a token is treated the
  same.
- Signup works exactly as it does today, protected only by the other controls
  (rate limits, password policy, provider-side checks). This is the intended
  state until the owner provisions keys; it is not an error.

A site key without a secret (or the reverse) also counts as **not configured**:
the server will not advertise a widget it cannot verify.

Once configured (and the backend flag `fuzefront.auth.experience` is ON, since
`captcha` is only advertised then):

- `methods.captcha` is `{ "provider": "turnstile", "siteKey": "<site key>" }`
  (never the secret).
- `POST /signup` requires a valid `turnstileToken`, verified against Cloudflare
  `siteverify` **after** the password-policy check. Missing/invalid/expired/
  replayed token -> `400 CAPTCHA_FAILED`; Cloudflare unreachable, slow
  (default 5 s, `TURNSTILE_VERIFY_TIMEOUT_MS`) or answering garbage -> `503
  PROVIDER_UNAVAILABLE` with `Retry-After: 5` (fail-closed).

## Helm wiring (shipped)

The security chart wires these variables, **defaulting to captcha OFF** (empty
`siteKey`, so the env vars don't render and the pod boots unchanged):

- `deploy/helm/fuzefront/values.yaml` declares a `securityService.turnstile`
  block with explicit empty defaults (`siteKey: ""`, `secretName: ""`,
  `secretKey: "TURNSTILE_SECRET_KEY"`, `verifyTimeoutMs: ""`).
- `deploy/helm/fuzefront/templates/security.yaml` renders the three env vars
  **only when `turnstile.siteKey` is non-empty**: `TURNSTILE_SITE_KEY` (plain),
  `TURNSTILE_SECRET_KEY` (a `secretKeyRef` with `optional: true`, so a missing
  Secret/key leaves captcha off and never wedges the pod), and
  `TURNSTILE_VERIFY_TIMEOUT_MS` (only when `verifyTimeoutMs` is set).
- `deploy/contabo/sealed/turnstile-secrets.yaml.template` is the SealedSecret
  scaffold (ciphertext intentionally not committed — see Step 2).

So with the chart in place, turning captcha on is a values change
(`securityService.turnstile.siteKey` + `secretName`) plus the sealed secret —
no further template work. `helm template` output is byte-identical to before
while `siteKey` is empty, so merging this is a safe no-op in every environment
until the owner configures the keys below.

## Step 1 - Owner: create the Turnstile widget

In the Cloudflare dashboard (Turnstile section), as the account owner:

1. Add a widget. Name it e.g. `fuzefront-signup`.
2. Hostnames: the exact hosts that serve the signup page (for example
   `app.fuzefront.com`; add any other host that mounts the host shell and serves
   signup, such as the `app.prod.fuzefront.com` alias if it is used). A widget
   only works on the hostnames you list.
3. Widget mode: the UI requests `appearance: interaction-only`, `size:
   flexible` (set in `packages/auth-ui/src/components/fields/TurnstileField.tsx`);
   choose a Cloudflare widget mode compatible with that.
4. Create it. Cloudflare shows a **site key** (public) and a **secret key**
   (private).

Hand the two values over through a secure channel only. Do not paste the secret
anywhere it is logged.

## Step 2 - Site key to configuration

The site key is public (it ships to every browser inside `methods.captcha`).
It reaches the service as the env var `TURNSTILE_SITE_KEY` and surfaces as
`AuthMethods.captcha.siteKey`. Where it is stored (chart values vs. the same
Secret) is part of the chart change above; either way it is not sensitive.

## Step 3 - Secret key as a SealedSecret (FuzeInfra)

The secret key (`TURNSTILE_SECRET_KEY`) must be provisioned as a SealedSecret;
FuzeInfra holds the controller's private key and owns the secrets methodology.
Per this repo's rules, infra work is delegated, not done from here:

> `@fuze` FuzeInfra: please seal `TURNSTILE_SECRET_KEY` (value supplied by the
> owner out-of-band) into the `fuzefront` namespace so the security-service pod
> can read it, merging into the existing secret without dropping any other key
> (compare `deploy/scripts/check-sealed-key-regression.sh`, which fails CI if a
> key disappears). Also confirm the pod env wiring above is applied.

This repo's vendored helper, `deploy/scripts/seal-secret.sh <KEY>` (its default
scope is `billing-secrets`; the target here would need
`--scope fuzefront/fuzefront-secrets`), seals one value and merges it into the
manifest in place with a hidden prompt, so the plaintext never enters version
control or shell history; it is documented as interim, with FuzeInfra canonical. Commit only the sealed output, never the plaintext.

Rotation: the server reads the variables at call time (never cached in code),
but environment variables are fixed for a running container, so rotating the
secret takes effect on the next pod rollout.

## Step 4 - Verify

After the chart change, the sealed key and the backend flag are all live:

```bash
curl -s https://app.fuzefront.com/api/v1/security/methods | python3 -m json.tool
# expect:  "captcha": { "provider": "turnstile", "siteKey": "<your site key>" }
# the secret key must NEVER appear anywhere in this response
```

Then, in a real browser, load `/signup`: the widget should render (it is
`interaction-only`, so it may show nothing until Cloudflare needs a challenge),
submit stays disabled until a token exists, and a signup succeeds. Check the
console is clean, including that the Cloudflare script loads. This repo's nginx
sets no Content-Security-Policy today (`frontend/nginx.conf`); if one is added,
Cloudflare's Turnstile guidance is that it must allow `challenges.cloudflare.com`
for scripts and frames.

## Dev / CI: Cloudflare test keys

Cloudflare publishes dummy keys for testing; they are public fixtures, not
secrets (documented in `backend/security/src/services/turnstile.ts` and
https://developers.cloudflare.com/turnstile/troubleshooting/testing/):

| Env var | Value | Behaviour |
|---|---|---|
| `TURNSTILE_SITE_KEY` | `1x00000000000000000000AA` | widget always passes |
| `TURNSTILE_SECRET_KEY` | `1x0000000000000000000000000000000AA` | server verification always succeeds |
| `TURNSTILE_SECRET_KEY` | `2x0000000000000000000000000000000AA` | server verification always fails (exercises `CAPTCHA_FAILED`) |

The UI also exports `TURNSTILE_TEST_SITE_KEY` (`1x00000000000000000000AA`) from
`@fuzefront/auth-ui` as the fallback used when no site key is passed. Local
example:

```bash
export FUZE_FLAGS_PROVIDER=offline FUZE_FLAGS_OFFLINE_ON=fuzefront.auth.experience
export TURNSTILE_SITE_KEY=1x00000000000000000000AA
export TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
```

Never use the test keys in production: the always-pass pair verifies nothing.

## Rollback / turning captcha off

Removing either `TURNSTILE_*` variable (or its sealed key) and rolling the
security pod returns signup to the "not configured" state: no `captcha` in
`methods`, no widget, no verification. Turning the backend flag OFF also stops
`captcha` being advertised and stops verification.

Order matters at the other end: **do not configure Turnstile while the frontend
flag is OFF** - the legacy signup form has no widget, so every signup would be
rejected `400 CAPTCHA_FAILED`. See the rollout runbook.

## Not done / tracked

- Production Turnstile widget and keys: **pending (owner)**.
- Chart wiring of `TURNSTILE_*` into the security pod: **not done
  (`devops-engineer`)**.
- SealedSecret key: **not provisioned (FuzeInfra via `@fuze`)**.
- Real-browser verification of the widget under production TLS: **not done**.
