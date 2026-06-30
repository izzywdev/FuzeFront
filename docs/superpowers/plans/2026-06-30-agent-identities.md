# Machine/Service-Account (Agent) Identities — Contract & Implementation Plan

> **Status: PROPOSED — awaiting contract-freeze.** This is the freeze artifact for
> GitHub issue #113 (originator: FuzeKeys MCP Secrets-Broker). The Permit-side
> model + delegation helpers + tests in this PR are the *contract*. The
> deploy-sensitive wiring (Authentik provider, JWKS verification middleware, the
> agent-binding migration) is the **post-freeze implementation phase** and must
> land only inside a **deploy window** (`master` is deploy-on-push; never
> bot-merge — see repo `CLAUDE.md`).
>
> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:executing-plans`
> to implement the post-freeze tasks task-by-task. Steps use `- [ ]` syntax.

**Goal:** Bless **Authentik service accounts + the OAuth2 client-credentials
grant** as the family-standard machine-identity primitive, sync a machine
identity into **Permit** as a *distinct principal*, and define the
**`Agent —delegate_of→ User`** relationship so an agent's authorization derives
from the single user it acts on behalf of, scoped to a single tenant — denying
cross-user and cross-tenant access by construction.

**Originating asks (issue #113):**
1. Bless Authentik service accounts + client-credentials; document registration + rotation.
2. Helpers to sync a machine identity into Permit as a distinct principal (not a human user).
3. Define `Agent —delegate_of→ User` ReBAC in the shared Permit environment.

**Acceptance criteria:**
- Documented way to register an agent service account in Authentik + obtain a client-credentials token. → §1, §6.
- A Permit `delegate_of` relationship/role model in the shared env, with a worked `permit.check(agent, …)` that denies cross-user/cross-tenant. → §2, §3, and the delivered code/tests.
- No bespoke bearer-token scheme required of consumers. → §1 (standard OAuth2 client-credentials access token; FuzeFront validates via Authentik JWKS).

---

## 0. What this PR delivers (testable, non-deploy-sensitive)

| Artifact | File |
|---|---|
| `Agent` + `User` resource types + `delegate_of` relation (Permit IaC) | `backend/src/permit/schema.ts` |
| Idempotent relation sync (extends the existing resource/role sync) | `backend/src/permit/sync-permit-schema.ts` |
| Distinct-principal sync + the **worked delegated check** | `backend/src/utils/permit/agent-identity.ts` |
| Schema/relation tests | `backend/tests/permit-agent-schema.test.ts` |
| Delegation enforcement tests (cross-user / cross-tenant denials) | `backend/tests/agent-delegation.test.ts` |
| This contract + `docs/AUTHENTICATION_SETUP.md` update | docs |

The actual *application* of the schema to the **shared Permit environment** runs
through the existing `npm run permit:schema` / the `fuzefront-permit-schema-sync`
Helm post-install hook (see `2026-06-18-permit-pdp-policy-iac.md`) — a
deploy-window action, not part of merging this PR.

---

## 1. Identity primitive — Authentik service account + client-credentials

An **agent** is an Authentik **service account** backed by its own **OAuth2/OIDC
provider configured for the `client_credentials` grant**. It is a *first-class
OAuth2 client* — there is **no bespoke FuzeFront bearer scheme**:

- The agent authenticates server-to-server at the Authentik token endpoint with
  its `client_id` + `client_secret` (or a `client_assertion` JWT) and receives a
  standard **access token (RS256 JWT)**.
- FuzeFront validates that token like any resource server: verify the signature
  against the issuer **JWKS**, and verify `iss`, `exp`, and the **`aud`/`azp`**
  (audience-bound to the FuzeFront API — otherwise *any* Authentik-issued token
  for any app would validate).
- The token's `sub` identifies the service account; the agent's binding to a
  delegating user + tenant is held **authoritatively in FuzeFront** (§4), not
  trusted from a self-asserted token claim.

**Why a separate provider:** the human SSO client (`oidc.ts`) is created with
`grant_types: ['authorization_code']` only; a client-credentials token request
against it is rejected. Each agent gets its **own** Authentik OAuth2 provider,
distinct from the human SSO provider.

### Registration (operator runbook)
1. In Authentik: **Directory → Users → Create Service Account** (e.g. `agent-fuzekeys-broker`). Note its `sub`.
2. **Applications → Providers → Create → OAuth2/OpenID Provider**:
   - Client type: **Confidential**; **Grant type: Client Credentials** (Authentik: "Client Credentials" / RFC 6749 §4.4).
   - Bind the provider to the service account; set the **audience** to the FuzeFront API.
   - Access-token lifetime: **short** (≤ 10 min); no refresh token for client-credentials.
3. Create an **Application** wrapping the provider and assign access to the service account only.
4. Hand the `client_id` + `client_secret` to the agent workload **via its own k8s Secret** — never to the FuzeFront backend (the backend only needs the issuer/JWKS to verify; see rotation below).
5. Register the binding in FuzeFront (§4): `(agent_sub, delegating_user_id, tenant_id)`.

### Rotation
- The agent's `client_secret` lives in the **agent's** k8s Secret (SealedSecret in prod), rotated in Authentik. **Rotating it never touches FuzeFront** — FuzeFront holds no agent secret, only the issuer/JWKS. This is the clean rotation story.
- Revoke an agent instantly by flipping its binding `status` in FuzeFront (§4) and/or disabling the service account/provider in Authentik. Access tokens are short-lived, so revocation converges within the token TTL even without introspection.

---

## 2. Permit model — distinct principal + recorded `delegate_of` relation

Delivered in `backend/src/permit/schema.ts`:

- Resource type **`User`** and resource type **`Agent`** — deliberately
  **action-less**; they exist only to host the relation. (An agent is never
  authorized through its own resource roles.)
- Relation **`delegate_of`**: `Agent —delegate_of→ User`.

The agent is synced as a **distinct Permit principal** keyed `agent:<sub>` with
attributes `{ type: 'agent', delegate_of: <userId>, tenant: <tenantId> }`
(`syncAgentToPermit`). This keeps it visibly separate from human users in the
Permit dashboard and queryable for audit — but it is **not** granted roles.

> **Why not native role-derivation?** The real authorization gates in this repo
> are **tenant-scoped top roles** (`admin`/`editor`/`viewer`) assigned per-org
> (`utils/permit/role-assignment.ts`), checked as `permit.check(user, action,
> { type, tenant, key })`. Permit's role *derivation* is designed for
> resource-instance ReBAC, not for deriving tenant-level top roles across a
> relationship; doing so cleanly in the permitio 2.4.0 SDK is fragile and would
> tend toward "agent gets everything the user has in *every* tenant." We
> therefore **record** the relationship in Permit (audit) but **enforce**
> app-side (§3). If a future Permit version makes tenant-role derivation
> first-class and load-tested, the enforcement target can be flipped without
> changing the binding model.

---

## 3. Enforcement — resolve agent → bound (user, tenant), check AS the user

Delivered in `backend/src/utils/permit/agent-identity.ts` —
`checkDelegatedPermission(permit, delegation, check)`:

1. **Cross-tenant guard:** if the requested `resource.tenant` ≠ the agent's bound
   `tenant`, **deny before Permit is consulted**. Request-supplied tenants are
   never trusted.
2. Otherwise run `permit.check(delegation.delegatesUser, action, resource)` —
   i.e. **as the delegating user**. The agent's reach is *exactly* the user's.

This makes both required denials **structural, not policy-dependent**:
- **Cross-user escalation is impossible** — the agent has no grants of its own and resolves to exactly one fixed user.
- **Cross-tenant is impossible** — the bound tenant is pinned; a differing tenant is rejected outright.

Worked example (matches `backend/tests/agent-delegation.test.ts`):

```ts
const delegation = { agentKey: 'agent:svc-account-sub', delegatesUser: 'user-1111', tenant: 'org-aaaa' }

// ✅ allowed iff user-1111 has Organization:read in org-aaaa
await checkDelegatedPermission(permit, delegation, { action: 'read',   resource: { type: 'Organization', tenant: 'org-aaaa' } })

// ❌ cross-tenant: denied before Permit even runs, even if user-1111 can read org-bbbb
await checkDelegatedPermission(permit, delegation, { action: 'read',   resource: { type: 'Organization', tenant: 'org-bbbb' } })

// ❌ cross-user: only ever evaluated as user-1111, never another user, even if that other user is granted it
await checkDelegatedPermission(permit, delegation, { action: 'manage', resource: { type: 'Organization', tenant: 'org-aaaa' } })
```

---

## 4. Post-freeze implementation phase (deploy-window only)

These tasks complete the runtime path. They are intentionally **not** in the
freeze PR (new dependency decision, DB migration, Authentik provider, and direct
deploy sensitivity). Treat agent identities as a **third token type** alongside
the `api-tokens` plan (`2026-06-19-api-tokens.md`) — same DB-bound principal,
instant revocation, audit shape; the only difference is the verification
mechanism (Authentik RS256 vs opaque hash) and that the principal resolves to a
delegating user.

- [ ] **Agent-binding migration** `0NN_create_agent_identities_table.ts`:
      `(id, agent_sub UNIQUE, agent_key, delegating_user_id FK→users, tenant_id FK→organizations, status, created_by, revoked_at, timestamps)`. Stores **no secret**. (Knex `loadExtensions: ['.js']` in prod — match the existing migrations.)
- [ ] **`oidcService.verifyAccessToken(token)`**: lazily build a cached JWKS verifier from the discovered issuer's `jwks_uri` (reuse `Issuer.discover` already in `oidc.ts`); verify `iss`/`aud`/`azp`/`exp`. Decide the verify lib (prefer reusing `openid-client`'s issuer keystore over adding `jose`; if `jose` is needed, pin it exactly — zero-new-dep is preferred). Degrade gracefully if Authentik is unreachable (don't hard-fail boot).
- [ ] **`authenticateAgentToken` middleware** (separate from `authenticateToken`) + a thin dispatcher that routes `alg: RS256` / issuer-matching tokens to it and `HS256` local session JWTs to the existing path. It must load the binding, set `req.user.id = delegating_user_id`, pin `req.agent = { agentKey, delegatesUser, tenant }`, and **override request-derived tenant** with the bound tenant in `requirePermission` for agent requests.
- [ ] **Agent admin routes** to register/list/revoke bindings (mirror `routes/api-tokens.ts`), calling `syncAgentToPermit` / `removeAgentFromPermit`.
- [ ] **Authentik provider provisioning** for the client-credentials grant — delegate infra to **FuzeInfra via `@claude`**; do not operate the cluster from here.
- [ ] Verify Permit accepts **action-less** `Agent`/`User` resources during the schema-sync apply; confirm the `delegate_of` relation appears in the dashboard.
- [ ] e2e: register an agent for `(user, org)`, mint a client-credentials token, call a protected API → behaves exactly as the user in that org; a token for org B → 403.

---

## 5. Constraints (carried from repo `CLAUDE.md` + sibling plans)
- Same-origin API base — agents call the API host directly; do **not** add a cross-origin agent base URL to the frontend; keep token issuance server-to-server (out of the browser).
- `@types/express` v4 is pinned via root `overrides`; install from repo root. Extend the `Request` augmentation in `backend/src/types/express.d.ts` for `req.agent`.
- `master` is deploy-on-push + signature-required: **never bot-merge**; squash-merge must be signed; merge inside a **deploy window**. Prod is GitOps — no hand-deploys.
- Backend strict mode is off; mock `db`/`permit` (inject) in unit tests — no `PERMIT_API_KEY` needed (the delivered helpers/sync take an injectable client).

## 6. Consumer guidance (FuzeKeys)
Until the post-freeze runtime path ships, the interim hashed-token fallback
stands. After it ships: the broker authenticates its agent service account at
Authentik's token endpoint (client-credentials), presents the resulting access
token as a normal `Authorization: Bearer` to the FuzeFront API, and the agent's
reach is automatically that of its bound user within its bound tenant. No
FuzeFront-specific token format is required of consumers.

---

## Notifications (per issue #113)
- **@izzywdev on contract-freeze** of this agent-identity model — this PR is the freeze candidate.
- **@izzywdev on deployment** — when the §4 runtime path is merged in a deploy window and applied to the shared Permit env.
