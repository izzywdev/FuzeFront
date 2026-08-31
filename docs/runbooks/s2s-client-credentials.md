# Platform S2S identity — onboarding a new client_credentials consumer

> izzywdev/FuzeFront#648 — "Authentik M2M client_credentials — platform S2S
> identity foundation". This runbook covers the FuzeFront-side primitives this
> issue delivered. It does **not** cover migrating any specific pre-shared-token
> channel (LiteLLM, custom-hostname-api, ChromaDB tenant tokens, FuzeCall's
> control-plane key) — those are separate, deliberately out-of-scope follow-ups
> (see "What this does NOT cover" below).

## Why

Every existing S2S channel uses one pre-shared opaque bearer token per endpoint.
All callers share one identity: no per-caller attribution, no per-caller
Permit.io policy, no audit trail linking a call to an owning service. FuzeFront
is the platform's identity authority — this runbook is how a new S2S
relationship gets its own Authentik service-account identity and Permit.io
grant instead of joining the shared-token pool.

## The three pieces

| Piece | File | What it does |
|---|---|---|
| Provisioning template | `backend/src/authentik/provision-s2s-clients.ts` (`registerS2SClient`) | Idempotently creates an Authentik `client_credentials` OAuth2 provider + Application for a named service, with a scope mapping that emits `{"aud": "s2s", "service": <name>, "scopes": [...]}` |
| CLI entry point | `backend/src/authentik/register-s2s-cli.ts` | One-shot Job / `kubectl exec` entry point — run in-cluster only (never from CI or a public host; see CLAUDE.md's prod-GitOps rule) |
| Permit grant | `backend/src/utils/permit/machine-roles.ts` (`grantServiceInvoke` / `revokeServiceInvoke`) | Grants/revokes `invoke` on a named `ServiceEndpoint` Permit resource instance to the service account |
| JWKS verification | `backend/src/services/jwks-verify.ts` (`verifyMachineTokenViaJwks`) | Local, signature-based token verification against the issuer's published JWKS — an alternative to introspection for callers that need to avoid a per-request round-trip |

## Onboarding recipe

1. **Register the service account** (in-cluster, where `AUTHENTIK_ADMIN_TOKEN` +
   `AUTHENTIK_BASE_URL` are already set on the backend pod):

   ```sh
   node dist/authentik/register-s2s-cli.js fuzecall-backend fuzecall:control-plane:auth
   ```

   Prints the `client_id` (safe to share) and a masked `client_secret`. Retrieve
   the full secret from the Authentik Admin UI (or the unmasked provider API
   response) and seal it into the consumer's namespace — **never commit or echo
   it into logs.** How a consumer's `client_id` + sealed `client_secret` flows
   into its namespace as a SealedSecret is documented in FuzeInfra's
   `credential-handoff.json` — that mechanism lives in FuzeInfra and any change
   to it must be delegated via `@claude`, never edited from this repo.

2. **Grant the Permit invoke permission** for the specific endpoint this service
   is allowed to call:

   ```ts
   import { grantServiceInvoke } from '../utils/permit/machine-roles'
   await grantServiceInvoke(clientId, 'fuzecall_control_plane')
   ```

   `endpointKey` is free-form and chosen per S2S relationship — it does not need
   to be declared anywhere in advance; the `ServiceEndpoint` resource *type*
   (with its `invoke` action) already exists in the base schema
   (`backend/src/permit/schema.ts`), so onboarding a new consumer never requires
   a schema change, only a new grant.

3. **The consuming service obtains a token** via the standard `client_credentials`
   grant against Authentik's token endpoint:

   ```sh
   curl -X POST https://auth.fuzefront.com/application/o/s2s-fuzecall-backend/token/ \
     -d grant_type=client_credentials \
     -d client_id=$CLIENT_ID \
     -d client_secret=$CLIENT_SECRET
   ```

4. **The receiving service validates the token** either by introspection
   (`introspectMachineToken` / `authenticateMachineToken` — respects revocation
   in real time, one round-trip per check) or, once the caller has opted in via
   the `fuzefront.platform.s2s-jwks-auth` release flag (default **OFF**), by
   local JWKS verification (`verifyMachineTokenViaJwks` — no round-trip, but a
   revoked token still verifies until it naturally expires). See
   `src/utils/s2sJwksFlag.ts` for why this is flag-gated.

5. **A service OUTSIDE FuzeFront asks the authorization decision over HTTP.**
   Step 2 above created the `ServiceEndpoint:invoke` grant in Permit, but until
   now nothing exposed "may caller X invoke endpoint Y?" as a reachable HTTP
   route — the check lived only as internal TypeScript
   (`checkMachinePermission` in `backend/src/utils/permit/machine-roles.ts`).
   It is now live at `POST /api/v1/security/authz/check` (the same
   provider-agnostic, contract-frozen route documented in
   `docs/consumers/onboarding-authn-authz.md`), authenticated with the SAME
   machine token from step 3 — no separate credential:

   ```sh
   curl -X POST https://app.fuzefront.com/api/v1/security/authz/check \
     -H "Authorization: Bearer $ACCESS_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
           "tenant": "default",
           "resource": { "type": "ServiceEndpoint", "key": "fuzecall_control_plane" },
           "action": "invoke"
         }'
   # => { "allow": true }
   ```

   `subject` may be omitted — it then defaults to the CALLER's own identity
   (`svc:<your client_id>`), i.e. "am I allowed to invoke this endpoint",
   which is the common case. `tenant` is required by the contract; platform
   S2S grants use the fixed tenant `"default"` (`PLATFORM_TENANT` in
   `machine-roles.ts`) unless a specific customer tenant is intended.
   Fail-closed: an unreachable/erroring PDP resolves to `{ "allow": false }`,
   never a 500 and never an allow.

   **Grant/revoke over the same API are more tightly gated than check.** Any
   authenticated caller (human or machine) may `check` — it can only ever
   answer a question, never change what's true. `POST`/`DELETE
   /api/v1/security/authz/grants` mutate the authorization graph, so a
   MACHINE caller must additionally hold the `authz:admin` scope (a normal
   Authentik scope, granted the same way as any other — see
   `registerS2SClient(service, scopes)` in step 1) or the request is rejected
   with `403 FORBIDDEN`. In practice this means: provision the small number of
   trusted platform-operator service accounts that are allowed to grant/revoke
   S2S invoke permissions with `authz:admin` in their `scopes` list; every
   other S2S client only ever needs to `check`.

   ```ts
   // grantServiceInvoke / revokeServiceInvoke (machine-roles.ts) remain the
   // in-process way to grant from WITHIN the security-service or backend.
   // An external operator without in-cluster access instead calls:
   //   POST /api/v1/security/authz/grants
   //     { "subject": "svc:fuzecall-backend", "tenant": "default",
   //       "role": "s2s-caller",
   //       "resource": { "type": "ServiceEndpoint", "key": "fuzecall_control_plane" } }
   //   DELETE /api/v1/security/authz/grants
   //     { "subject": "svc:fuzecall-backend", "tenant": "default", "role": "s2s-caller" }
   // authenticated as a machine identity holding the authz:admin scope.
   ```

## JWKS endpoint + token TTL

- **JWKS document**: `<issuer>/jwks/`, where `<issuer>` is the Authentik
  application's OIDC issuer URL (`https://auth.fuzefront.com/application/o/<app-slug>/`
  in prod). `jwks-verify.ts` derives this automatically from the `issuer` you
  pass it.
- **Cache TTL**: the JWKS document is cached in-memory for 10 minutes per
  issuer (`JWKS_CACHE_TTL_MS` in `jwks-verify.ts`) — long enough to avoid
  hammering the IdP under load, short enough that a key rotation propagates
  quickly. A transient fetch failure serves the last-known-good cached keys
  rather than failing every in-flight verification outright.
- **Token TTL**: `DEFAULT_TOKEN_VALIDITY = 'hours=1'` in
  `provision-s2s-clients.ts`, overridable per registration via
  `registerS2SClient(service, scopes, { tokenValidity })`. Keep this short —
  see rotation below.

## Rotation

Rotating a service's `client_secret` in Authentik does **not** retroactively
invalidate tokens already issued under the old secret. Nothing needs to: a
short `token_validity` means every pre-rotation token expires naturally within
the hour (or whatever TTL was configured), with no revocation step required.
The only operational requirement is to seal the new secret on the consumer side
*before* deleting the old one from Authentik, so there is no gap where the
consumer holds a secret Authentik no longer recognizes.

`registerS2SClient` / `register-s2s-cli.ts` are **not** how you rotate a
secret — re-running them is a no-op against an existing provider (idempotent
lookup by name). Rotating requires deleting and recreating the provider (or
using Authentik's own secret-regeneration action), the same operational
pattern documented in
`deploy/helm/fuzefront/authentik/blueprints/provider-oidc-fuzeinfra-admin.yaml`'s
"SECRET ROTATION LOG" for the human-SSO providers.

## What this does NOT cover (deliberately out of scope)

- **Migrating FuzeCall's control-plane key** onto this pattern — tracked as a
  companion issue on FuzeCall; explicitly excluded from #648's scope by the
  issue itself ("The FuzeCall auth.js migration is tracked separately and is
  NOT in scope here").
- **Migrating FuzeX's design-frames write auth** — companion issue, TBD.
- **Migrating the existing shared-token channels** (LiteLLM, custom-hostname-api,
  ChromaDB tenant tokens) — #648 explicitly defers these to "a later pass once
  the pattern is proven".
- **FuzeInfra's `credential-handoff.json`** — owned by FuzeInfra; any change
  needed there is delegated via `@claude` in the PR that actually onboards a
  consumer, never edited from this repo.
