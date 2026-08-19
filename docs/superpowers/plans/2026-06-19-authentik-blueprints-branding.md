# Plan E — Authentik Blueprints + Fuse-Seam Branding

**Date:** 2026-06-19  
**Branch:** plan-e-authentik-blueprints  
**Status:** Implemented

## Goal

Convert the imperative `scripts/seed-authentik-fuzefront.py` seeder into
version-controlled Authentik blueprints (declarative `version: 3 / entries:`
YAML), and brand the hosted Authentik pages with the fuse-seam design system.

## Blueprint Files

All blueprints land under `deploy/helm/fuzefront/authentik/blueprints/`:

| File | Purpose |
|------|---------|
| `brand-fuseseam.yaml` | Authentik Brand: fuse-seam CSS (gradient, dark shell, fonts via Google Fonts CDN), title, logo/favicon via stable data-URI (survives emptyDir `/media` restarts) |
| `flow-enrollment.yaml` | Self-service sign-up: captcha → email-verify → prompt (email/username/password) → password-policy → user-write → user-login |
| `flow-recovery.yaml` | Password recovery: email identifier → email challenge → password prompt → user-write → user-login |
| `stages-mfa.yaml` | TOTP authenticator + WebAuthn/passkey setup stages + authenticator validation stage; SMS stage defined but unbound (deferred to a later plan) |
| `source-google.yaml` | Google OAuth2 source, `link on verified email` de-dupe strategy |
| `provider-oidc.yaml` | FuzeFront OIDC provider + Application with **deterministic** `client_id`/`client_secret` baked in via blueprint `attrs:` — eliminates the out-of-band patch step |

## Chart Changes

- `deploy/helm/fuzefront/templates/authentik-blueprints.yaml` — ConfigMap built
  via `.Files.Glob "authentik/blueprints/*.yaml"` mounted at
  `/blueprints/fuzefront/` on **both** `authentik-server` and `authentik-worker`
  pods. Authentik worker auto-applies all YAML files under `/blueprints/` on
  startup, idempotently.
- `deploy/helm/fuzefront/templates/authentik.yaml` — add `blueprints` volume +
  volumeMount to both pods.
- `deploy/helm/fuzefront/values.yaml` — add `authentik.blueprints.clientId` /
  `clientSecret` deterministic dev defaults; update OIDC comment to remove
  seeder reference; note seeder is retired.
- `deploy/helm/fuzefront/values-local.yaml` — update comment (seeder retired,
  blueprints auto-apply).
- `scripts/seed-authentik-fuzefront.py` — marked SUPERSEDED at top of file.

## Branding Strategy

Authentik's `/media` mount is `emptyDir` (ephemeral). To survive pod restarts,
the logo and favicon are embedded as data-URIs in `branding_custom_css` (a
simple SVG flame/seam icon, base64-encoded). No file copy required.

Custom CSS is injected via `branding_custom_css` on the Brand entry:
- Google Fonts `@import` for Space Grotesk + Inter
- CSS variables for fuse-seam palette (`#6e5cff` → `#29d3e6` gradient, dark
  shell `#0b0e15`, card `#141a26`, text `#e7ecf5`)
- Override Authentik's `.pf-*` PatternFly classes for the login/enrollment
  shell, header, and card

## Deterministic Client Credentials

The OIDC provider blueprint uses `attrs: {client_id: ..., client_secret: ...}`
with dev-placeholder values also written to `values.yaml`. For production,
override via Helm values (backed by SealedSecrets). The backend reads
`AUTHENTIK_CLIENT_ID` / `AUTHENTIK_CLIENT_SECRET` from the chart Secret — these
must match the blueprint values.

Values paths: `authentik.blueprints.clientId` / `authentik.blueprints.clientSecret`
(rendered into the blueprint ConfigMap via the Helm template).

> **Note:** The blueprint `attrs:` field sets the value at creation time only.
> If you need to rotate, delete the provider entry and let Authentik re-create it.

## Verification Plan

Static verification (no live Authentik required):

```bash
# Lint the chart (catches template errors)
helm lint deploy/helm/fuzefront -f deploy/helm/fuzefront/values-local.yaml

# Render and check ConfigMap + volumeMounts appear
helm template fuzefront deploy/helm/fuzefront \
  -f deploy/helm/fuzefront/values-local.yaml | grep -A5 "kind: ConfigMap"

# Check both pods get the blueprints volumeMount
helm template fuzefront deploy/helm/fuzefront \
  -f deploy/helm/fuzefront/values-local.yaml | grep -B2 "mountPath: /blueprints"

# YAML-lint blueprints (python-yamllint or yamllint CLI)
yamllint deploy/helm/fuzefront/authentik/blueprints/
```

Full functional verification (blueprint auto-apply, Google OAuth flow, TOTP
enrollment, branding render) requires a running Authentik instance — out of
scope for this PR.

## Concerns / Known Gaps

1. **Blueprint `attrs:` for client_id/secret** — Authentik 2024.12 supports
   `attrs:` on `authentik_providers_oauth2.oauth2provider` entries. The field
   names `client_id` and `client_secret` are confirmed in the Authentik source
   and API schema for 2024.x. If the blueprint runner silently ignores unknown
   attrs, the creds fall back to Authentik-generated ones and the backend will
   need the old out-of-band patch. Add a post-install hook or check logs if the
   backend fails OIDC discovery.

2. **Google OAuth source** — `consumer_key` / `consumer_secret` are placeholder
   `GOOGLE_CLIENT_ID_PLACEHOLDER` / `GOOGLE_CLIENT_SECRET_PLACEHOLDER`. Real
   creds must be overridden via Helm values before enabling the source in prod.

3. **Captcha stage** — Authentik's captcha stage requires a real reCAPTCHA
   site/secret key. The blueprint ships with `public_key: ""` / `private_key: ""`
   (effectively disabled) so enrollment still works in dev. Set real keys via
   values in prod.

4. **Idempotency** — All entries use `state: present` and a stable `identifer:
   fuzefront-*` slug. Re-running blueprints will not re-create existing objects.
   The brand entry uses `identifer: fuzefront-brand` (domain-based lookup on
   `default` domain).

5. **SMS stage** — Defined in `stages-mfa.yaml` as a `TwilioSMSStage` stub but
   left unbound to any flow. Binding is deferred to a later plan when Twilio
   creds are available.
