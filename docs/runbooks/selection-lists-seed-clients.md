# Selection-lists seed clients — Authentik `client_credentials` scaffolding

> SCAFFOLDING / RUNBOOK ONLY. No client exists, no credential has been minted and
> nothing here has been executed. Per `docs/planning/selection-lists-events.md`
> §8 and §14 (`devops-engineer` row): each service that may publish
> `selection-lists.seed.requested` needs its own Authentik machine identity whose
> only scope is **`selection-lists:seed`**. This page is the procedure to follow
> when the first allowlisted source is onboarded.

Companion to `docs/runbooks/s2s-client-credentials.md` (the generic onboarding
recipe — read it first) and `docs/runbooks/per-service-database-and-role.md`
(the sealed-secret conventions this page borrows). The end-to-end enablement order
(flags, Kafka topics, monitoring, rollback) is in
`docs/runbooks/selection-lists-seeding-operations.md`.

## What a seed client is

`seed.requested` carries an `attestation` of `{ kind: 'service-token', token }`
(plan §8). The token is a short-lived `client_credentials` token minted by the
**requesting** service. The selection-list-service introspects it and requires
`active == true` and `scopes` containing `selection-lists:seed`; the introspected
`subject` must be in that source's `allowedSubjects` in
`services/selection-list-service/seed-sources.json`.

Rules that make this safe (plan §8):

- **One client per requesting service**, never shared (attribution + independent revocation).
- **Dedicated scope only.** The client is registered with `selection-lists:seed`
  and nothing else. The token sits in the Kafka log for the topic's retention
  (1 day for `selection-lists.seed.requested` and its `.dlq`, see
  `deploy/helm/fuzefront/values.yaml` `kafkaTopics.topics`), so a broader scope
  (`authz:admin`, ...) would turn a log read into a privilege escalation. Never
  reuse a token minted for another purpose.
- Tokens are short-lived (`DEFAULT_TOKEN_VALIDITY = 'hours=1'`); do not raise it.

## Per-source naming (convention, not yet instantiated)

| Item | Value for source `<app>` |
|---|---|
| Authentik service name (`register-s2s-cli.js` arg 1; `^[a-z][a-z0-9-]{0,63}$`) | `<app>-seed` (e.g. `fuzecall-seed`) |
| Authentik application slug (derived) | `s2s-<app>-seed` |
| Scope | `selection-lists:seed` |
| `seed-sources.json` entry | `app: "<app>"`, `allowedSubjects: [<introspected subject for this client>]`, `keyPrefixes` default `["<app>-"]` |
| Consumer-side Secret (in the requester's namespace) | `<app>-seed-client` with keys `CLIENT_ID`, `CLIENT_SECRET` (proposed) |

The `seed-sources.json` allowlist entry is a reviewed PR owned by
`backend-engineer`; it is the authorisation half. The Authentik client is only
the authentication half — a registered client with no allowlist row is rejected
with `SOURCE_NOT_ALLOWED`.

## Procedure (when onboarding a real source)

1. **Register the client — in-cluster only** (CLAUDE.md prod-GitOps rule; never
   from CI or a public host), where `AUTHENTIK_ADMIN_TOKEN` / `AUTHENTIK_BASE_URL`
   already exist on the backend pod:

   ```sh
   node dist/authentik/register-s2s-cli.js <app>-seed selection-lists:seed
   ```

   It prints the `client_id` (safe to share) and a masked `client_secret` (shape
   only). Re-running is an idempotent no-op against an existing provider.

2. **Deliver the secret to the requester's namespace as a SealedSecret.**
   Honest limitation: `rotate-sealed-secret.yml` has **no `value` input by
   design** (a `workflow_dispatch` input is recorded with the run, a disclosure
   hazard on a public repo) and only seals values it **generates** itself. The
   `client_secret` is **issued by Authentik**, so that workflow cannot seal it.
   Use FuzeInfra's `credential-handoff.json` mechanism instead (referenced in
   `docs/runbooks/s2s-client-credentials.md` step 1) — it lives in FuzeInfra, so
   the onboarding PR delegates via `@fuze` rather than editing it from here.
   Never paste the value into an issue, PR, log or workflow input.

   > **Only for a requester in ANOTHER namespace/repo.** These seed-source clients
   > are other services' identities and genuinely have to cross a boundary, so they
   > stay on the handoff. selection-list-service's **own** `authz:admin` identity
   > is NOT one of them: it lives in the `fuzefront` namespace and is minted
   > in-cluster by the `selection-list-s2s-register` PreSync Job
   > (`selectionListService.s2s.*`) into `Secret/selection-list-s2s` — no seal, no
   > handoff, no human sees the value. See `s2s-client-credentials.md`.

   `rotate-sealed-secret.yml` IS the right tool for any secret FuzeFront mints
   itself (it is how the selection-list-service DB password is sealed), e.g.:

   ```bash
   gh workflow run rotate-sealed-secret.yml \
     -f scope=fuzefront/selection-list-secrets \
     -f key=DB_PASSWORD \
     -f manifest=deploy/contabo/sealed/selection-list-secrets.yaml
   ```

   Seals offline against the committed public cert
   `deploy/sealed-secrets/sealing-cert.pem`, opens a PR of ciphertext only, not
   auto-merge-labelled (`master` is deploy-on-push).

3. **Requester mints a dedicated token** with `@fuzefront/service-auth`, scope
   `selection-lists:seed` only, immediately before producing the message; attach it
   as `attestation.token`. On `ATTESTATION_INVALID` with `retryable: true`, mint a
   fresh one and resend.

4. **Add the allowlist row** to `seed-sources.json` (reviewed PR, backend).

## Rotation / revocation

- Rotate: seal the new secret on the consumer side **before** deleting the old
  one in Authentik (no gap). Outstanding tokens expire within the hour.
- Revoke one source immediately: set `enabled: false` for its row in
  `seed-sources.json` (kill switch) and/or delete its Authentik provider.

## Not covered / still open

- Broker-level authn/ACLs for `selection-lists.seed.requested` are FuzeInfra's;
  the drafted, UNSENT request is in `docs/planning/selection-lists-events.md` §15.
- Which services are on the allowlist (and so need clients) is not decided here;
  the first one arrives with its own seed-source PR.
