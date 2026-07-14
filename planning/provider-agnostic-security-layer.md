# Provider-Agnostic Security Layer — Wrap Authentik & Permit behind FuzeFront's own Security API

## Context

**The flaw.** FuzeFront's internal identity/authz providers leak across its own boundary. Concretely, today:

- The browser is **302-redirected to `auth.fuzefront.com` (Authentik's own hosted UI)** for social login, SSO, and enrollment (`backend/security/src/routes/auth.ts:402` `/oidc/login`, `:463` `/oidc/signup`). This is what lands the user on Authentik's raw enrollment page instead of a FuzeFront-branded flow.
- `auth.fuzefront.com` is a **dedicated public Ingress** (`deploy/helm/fuzefront/templates/authentik.yaml:281-311`) — the IdP is a first-class public host, not an implementation detail.
- The **consumer contract itself names the vendors**: `docs/consumers/onboarding-authn-authz.md` and `docs/planning/epics/EPIC-05-multi-product-authn-authz.md` instruct consumers to run OIDC against the shared **Authentik** issuer directly and to call the **Permit.io** SDK directly (`checkProductPermission`, `syncPermitSchemaWithProducts`, Permit tenants/ReBAC).
- The published `@fuzefront/auth` client leaks Authentik in its **types/config/docs** (`packages/auth/src/types.ts:68` `AuthMode='oidc-jwks'`, `:137-161` `OidcJwksConfig` naming Authentik; `packages/auth/openapi.yaml:83-100` names Authentik in endpoint descriptions).
- There is **no FuzeFront-owned AuthZ API at all** — authorization is exposed only as direct Permit SDK usage.

**The vision (confirmed with the owner).** FuzeFront must expose its **own** provider-agnostic Security API for both **AuthN and AuthZ**, wrapping the selected providers (Authentik, Permit) behind an internal adapter. Consumers, the frontend, and federated remotes know only the FuzeFront Security API + the `@fuzefront/auth` client. This keeps the *value* of Authentik (federation, MFA, enrollment engine) and Permit (policy/ReBAC engine) while making them **swappable** — we can switch providers for features/cost, or blend our own flows, without any consumer change.

**Decisions locked:**
1. **IdP hiding = Model 1** (reverse-proxy Authentik under the app host + adapter interface). Not a full IdP rebuild — we keep Authentik's value behind our interface.
2. **Delivery = full program in one plan**, but **implement the AuthN boundary first** (it fixes the acute live leak), then AuthZ.
3. **Scope = design both AuthN + AuthZ** into the frozen contract; sequence AuthZ consumer rollout after AuthN.

**The one hard constraint.** Google social login *requires* the real user's browser to reach `accounts.google.com` — that hop is Google's, unavoidable, and not an internal detail. "Abstract completely" therefore means: **no FuzeFront-internal host (`auth.fuzefront.com`) is ever visible to the browser or named in any consumer contract.** The browser only ever sees `app.fuzefront.com` and (briefly, for Google) `accounts.google.com`.

**Naming rule for the whole effort:** no `authentik` or `permit` in any consumer-facing path, type, field, config key, or doc. Open-standard protocol terms (OIDC/OAuth2/JWKS/PKCE) are acceptable but kept internal/server-side where practical. Provider names live only inside the adapter implementations and server-only env.

---

## Target architecture

```
Consumers · Frontend SPA · Federated remotes
        │  see ONLY ▼
FuzeFront Security API   →  app.fuzefront.com/api/v1/security/*   (+ @fuzefront/auth client, provider-neutral)
        │
security-service (backend/security)
   ├── IdentityProvider   (interface)  ──►  AuthentikIdentityProvider   (impl, swappable)
   └── AuthorizationProvider (interface) ─►  PermitAuthorizationProvider (impl, swappable)
        │  cluster-internal only (NO public ingress) ▼
   Authentik (ClusterIP)                 Permit PDP (ClusterIP)
```

The **adapter interfaces are the keystone** — they are what make providers swappable and are the internal contract the concrete Authentik/Permit impls satisfy. The existing server-side code becomes the *first implementation* of these interfaces (no logic thrown away):

- `authentikPassword.ts` (server-brokered flow-executor) → the model for `AuthentikIdentityProvider.passwordLogin` and, extended, for social-login brokering.
- `oidc.ts` (discovery/callback/userinfo/sync) → `AuthentikIdentityProvider` internals.
- `machine-identity.ts` + `provision-m2m-clients.ts` → `AuthentikIdentityProvider.provisionM2MClient`.
- `utils/permit/*`, `permit/*`, `config/permit.ts` → `PermitAuthorizationProvider`.

---

## Phase 0 — Freeze the contract (the gate) · `contract-designer`

Everything else fans out only after this PR is merged. Deliverables:

1. **`packages/security/openapi.yaml`** — the FuzeFront Security API (OpenAPI 3.1), provider-neutral. Supersedes/absorbs `packages/auth/openapi.yaml`. Endpoints under `/api/v1/security`:
   - **AuthN:** `POST /session` (password login), `GET /session` (current identity / “me”), `DELETE /session` (logout), `POST /session/exchange` (opaque-code → token), `GET /social/{provider}/start` (begin social login — 302, provider ∈ enum `google|…`), `GET /social/callback` (broker), `POST /signup`, `GET /methods` (neutral capability descriptor — replaces `oidcConfigured`).
   - **AuthZ:** `POST /authz/check`, `POST /authz/bulk-check`, `GET /authz/permissions`; role/tenant/membership: `.../roles`, `.../tenants`, `.../members` (neutralized from today’s org routes + Permit primitives).
   - **M2M:** `POST /tokens` (issue), `POST /tokens/introspect` — FuzeFront-owned, Authentik hidden.
2. **Provider-neutral shared types** — evolve `@fuzefront/auth` types: rename `AuthMode='oidc-jwks'` → neutral (e.g. `federated-jwks`); make `OidcJwksConfig` **server-internal** (drop it from the consumer surface or strip Authentik naming); neutralize error codes/docs. Keep the stable `Identity` shape.
3. **Adapter interfaces** — `IdentityProvider` + `AuthorizationProvider` TS interfaces (in `backend/security/src/providers/` or a shared package), documented as the internal swap contract.
4. Lint (Spectral) + generate the client (`openapi-typescript`) → the `@fuzefront/security-client` (or fold into `@fuzefront/auth`). PR = the gate.

---

## Phase 1 — AuthN boundary (implement FIRST; fixes the live leak)

Fan out, all gated on the Phase-0 contract:

**`backend-engineer`** — `backend/security/src/`
- Introduce `providers/IdentityProvider.ts` (interface) + `providers/authentik/AuthentikIdentityProvider.ts` (impl absorbing `oidc.ts` / `authentikPassword.ts` / `machine-identity.ts`).
- Replace the browser-facing redirects with **server-brokered social login**: `GET /api/v1/security/social/google/start` initiates the OAuth handshake and 302s the browser **to Google via the internally-reverse-proxied authorize endpoint under `app.fuzefront.com`** — never to `auth.fuzefront.com`. Configure the Authentik source/flows for **pure 302 passthrough** (no Authentik identification/enrollment UI rendered). `signup` becomes server-brokered like `/oidc/password` already is (`auth.ts:520`), not a redirect to Authentik's enrollment page.
- Keep the clean parts: FuzeFront-minted opaque `?code=` → `POST /session/exchange` (`auth.ts:802`) and FuzeFront JWT/session. Old `/api/auth/*` routes become thin deprecated shims to the new `/api/v1/security/*` for one release.

**`frontend-engineer`** — `frontend/src/` (design-system-first)
- De-vendor `services/api.ts:199-293`: `loginWithOIDC`→`startSocialLogin('google')`, `signupWithOIDC`→`signup`, `loginWithAuthentikPassword`→`login`, `handleOIDCCallback`→`handleAuthCallback`, `oidcConfigured`→`socialLoginEnabled`. Point at `/api/v1/security/*`.
- `pages/LoginPage.tsx`: strip Authentik from code/comments/labels; the FuzeFront-branded login/consent screen is the only UI the user sees (no Authentik page).

**`devops-engineer`** — `deploy/helm/fuzefront/`
- **Remove the public `auth.fuzefront.com` Ingress** (`templates/authentik.yaml:281-311`); Authentik → ClusterIP only.
- Add a reverse-proxy path under the app Ingress (`templates/ingress.yaml`) for the OAuth authorize/source endpoints the browser must transit, e.g. `app.fuzefront.com/api/auth/idp/*` → `authentik-server` (internal), so the issuer/redirect become FuzeFront-owned hosts.
- Update `values-prod.yaml:216-229`: issuer/redirect move under `app.fuzefront.com`. **Delegate the Cloudflare-tunnel change (drop the `auth.fuzefront.com` public route) to FuzeInfra via `@claude`** — never edit FuzeInfra here.

**`test-engineer`** (independent) — contract/integration tests vs the frozen spec, incl. a **mock IdentityProvider** proving swappability, and assertions that no response/redirect references `auth.fuzefront.com`.

**`frontend-test-engineer`** (independent) — extend the existing Playwright prod suite (`frontend/tests/prod-full-auth-flow.spec.ts`, T1/T2/T3). New hard assertion: during the whole Google flow the browser visits **only** `app.fuzefront.com` and `accounts.google.com` — a navigation to `auth.fuzefront.com` fails the test. This turns the current T3 work into the boundary regression gate.

---

## Phase 2 — AuthZ boundary (implement second)

**`backend-engineer`** — `providers/AuthorizationProvider.ts` + `providers/permit/PermitAuthorizationProvider.ts` (absorbing `utils/permit/*`, `permit/*`, `config/permit.ts`). Expose `/api/v1/security/authz/*` + role/tenant/membership endpoints. `requirePermission` middleware calls the interface, not Permit directly.

**`docs-maintainer`** — rewrite `docs/consumers/authn-authz-integration.md`, `docs/consumers/onboarding-authn-authz.md`, and `docs/planning/epics/EPIC-05-multi-product-authn-authz.md` to target the FuzeFront Security API + client. Remove every instruction to hit the Authentik issuer or Permit SDK directly.

**`test-engineer`** — authz contract tests incl. a **mock AuthorizationProvider** (swap proof); fail-closed behavior preserved.

---

## Migration & risk (deploy-sensitive)

- **OIDC issuer URL changes** from `auth.fuzefront.com/application/o/fuzefront/` to an `app.fuzefront.com`-hosted issuer, breaking the `iss` claim for old-model clients. **FuzeSocial is the only bound consumer and is not yet rolled out to clients**, so we do a **clean cutover — no dual-issuer soak.** Instead: land the new model in FuzeFront prod first, then **open a GitHub issue on FuzeSocial that `@claude` adapts it to the new FuzeFront Security API / issuer** (embed acceptance criteria + a `STATE:` block per the cross-repo delegation protocol). By the time that PR is green, prod already accepts the new model. Verify the deliverable (branch + PR exist, CI green), not the "done" claim; auto-re-nudge once if missing.
- **`master` is deploy-on-push + `required_signatures`** — land via signed squash-merge in a deploy window; never hand-deploy; the CF-tunnel change (drop the `auth.fuzefront.com` public route) is a FuzeInfra `@claude` delegation.
- **Docs are a first-class deliverable** — `docs/consumers/*` + EPIC-05 must be fully rewritten to the new model (the owner called this out explicitly), so the FuzeSocial `@claude` issue can point at accurate onboarding docs.
- **Dual-backend duplication** (`backend/src` monolith vs `backend/security`): implement in `backend/security` (the live service); leave monolith shims deprecated to avoid a second migration mid-flight.

---

## Critical files

- Backend AuthN: `backend/security/src/routes/auth.ts` (:368 `/oidc/login`, :437 `/oidc/signup`, :520 `/oidc/password`, :631 callback, :802 token-exchange); `services/oidc.ts`; `services/authentikPassword.ts`; new `providers/`.
- Backend AuthZ / M2M: `backend/security/src/utils/permit/*`, `permit/*`, `config/permit.ts`, `middleware/permissions.ts`; `backend/src/services/machine-identity.ts`, `backend/src/authentik/provision-m2m-clients.ts`.
- Frontend: `frontend/src/services/api.ts:199-293`, `frontend/src/pages/LoginPage.tsx`.
- Deploy: `deploy/helm/fuzefront/templates/authentik.yaml:281-311`, `templates/ingress.yaml`, `values-prod.yaml:190-229`.
- Contract/SDK: `packages/auth/openapi.yaml`, `packages/auth/src/types.ts`, `packages/auth/README.md`, `packages/auth/docs/TOKEN_CONTRACT.md`; new `packages/security/` (or extended `@fuzefront/auth`).
- Docs: `docs/consumers/authn-authz-integration.md`, `docs/consumers/onboarding-authn-authz.md`, `docs/planning/epics/EPIC-05-multi-product-authn-authz.md`.

---

## Verification (end-to-end)

1. **Contract:** `spectral lint packages/security/openapi.yaml` clean; client generates and type-checks; both mock providers satisfy the adapter interfaces (unit).
2. **Boundary regression (the key one):** run the prod Playwright suite —
   `GOOGLE_TEST_EMAIL=izzy.weinberg@gmail.com npx playwright test --config playwright.prod.config.ts --project chrome --headed --grep "T3"` —
   and assert the browser navigates only `app.fuzefront.com` + `accounts.google.com`; any hit to `auth.fuzefront.com` fails. T1 (signup) and T2 (password) stay green with the neutral endpoints and land on `/dashboard`.
3. **Provider-swap proof:** integration test points the adapter at the mock IdentityProvider/AuthorizationProvider and the full login + authz-check path passes unchanged — demonstrating no consumer-visible coupling to Authentik/Permit.
4. **AuthZ:** `POST /api/v1/security/authz/check` returns correct allow/deny (fail-closed on PDP/adaptor error); no consumer path imports `permitio`.
5. **Deploy check:** `helm template` shows no `auth.fuzefront.com` Ingress; issuer/redirect are `app.fuzefront.com`-hosted; `/api/v1/security/*` routes to `fuzefront-security`.
