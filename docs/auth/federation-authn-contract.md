# Fuze family AuthN federation contract

> **Contract version:** `v1.0.0` &nbsp;•&nbsp; **Status:** 🟡 **DRAFT — pending freeze**
> (awaiting maintainer sign-off; see [Freeze status](#freeze-status))
>
> Originator: [izzywdev/FuzeFront#112](https://github.com/izzywdev/FuzeFront/issues/112)
> — _"Expose a federated AuthN contract for sibling apps (FuzeKeys)."_

This document is the **authoritative, versioned** specification for how a sibling
Fuze-family service (FuzeKeys, and any future product) authenticates requests in
a way that is interoperable with FuzeFront and the rest of the family. A FastAPI
(or any-language) service can implement this contract from this document alone.

---

## 1. The canonical federation model (decision)

There were two candidate models in the originating issue. This is the decision.

> **Sibling apps are independent OIDC resource servers of the _shared Authentik
> issuer_. They validate Authentik-issued RS256 JWTs via the shared JWKS, scoped
> to their own `aud`. They DO NOT consume FuzeFront's minted token, and the
> `JWT_SECRET` is NEVER shared.**

```
                         ┌──────────────────────────┐
                         │      Authentik (IdP)      │
                         │  family issuer + JWKS     │
                         │  RS256 signing keys       │
                         └────────────┬──────────────┘
              OIDC client    ┌────────┴────────┐   OIDC client
              (aud=fuzefront)│                 │(aud=fuzekeys)
                  ┌──────────▼──────┐   ┌───────▼──────────┐
                  │   FuzeFront     │   │     FuzeKeys     │
                  │  (host shell /  │   │  (sibling app /  │
                  │   BFF backend)  │   │  resource srv.)  │
                  └──────────┬──────┘   └──────────────────┘
                             │ private HS256 session token
                             │ (NEVER leaves FuzeFront)
                       ┌─────▼──────┐
                       │  Browser   │
                       └────────────┘
```

### Why this model

- **FuzeFront's minted token is a private BFF session artifact, not a family
  token.** `backend/src/routes/auth.ts` does
  `jwt.sign({ userId, sessionId }, JWT_SECRET, { expiresIn: '24h' })` (HS256) and
  `backend/src/middleware/auth.ts` verifies it with the same symmetric secret. It
  has **no `iss`, no `aud`**, is bound to FuzeFront's `sessions` table, and is
  symmetric — verifying it elsewhere would require **sharing `JWT_SECRET`**, which
  is a non-starter. It must not cross a service boundary.
- **Authentik is already the family IdP.** Standard OIDC says each app is its own
  client / resource server with its own `aud`, validating **RS256** signatures via
  the issuer's published **JWKS**. This gives us: zero shared secrets, automatic
  key rotation via JWKS, and first-class library support in every language
  (`jose` for TS, `PyJWT` for Python).
- **It unblocks `AUTH_MODE=authentik` for FuzeKeys** without coupling FuzeKeys to
  any FuzeFront internal (session table, secret, or minting logic).

### Explicitly rejected (for v1): "consume FuzeFront's token"

We are **not** exposing `POST /api/auth/introspect` and we are **not** asking
siblings to validate FuzeFront's HS256 token. That path would make FuzeFront a
hard runtime dependency on every sibling's auth path and either leak `JWT_SECRET`
or require building a second token service. If a future requirement genuinely
needs FuzeFront to _issue_ family tokens (e.g. FuzeFront-specific claims not in
Authentik), the migration is: FuzeFront becomes its own OIDC provider OR mints
**RS256** tokens and publishes a JWKS — **never** HS256 with a shared secret. That
is a separate, future contract version.

---

## 2. Token-validation contract (normative)

A sibling validates an incoming bearer token as follows. Numbered items are
**MUST** unless stated otherwise.

### 2.1 Discovery

1. Each app is registered in Authentik as its **own** OAuth2/OIDC provider with
   its own application slug, client id, and client secret.
2. The **issuer** is the provider's issuer URL, e.g.
   `https://auth.fuzefront.dev/application/o/<app-slug>/` (note the **trailing
   slash** — it is part of the `iss` claim and string comparison is exact).
3. Resolve the OIDC discovery document at
   `${issuer}.well-known/openid-configuration`. **Read `jwks_uri` from discovery —
   do NOT hardcode the JWKS path** (Authentik's JWKS endpoint is per-provider and
   may change between versions).
4. Fetch and **cache** the JWKS from `jwks_uri`. Refresh on `kid` miss and on a
   bounded TTL. Standard libraries (`jose` `createRemoteJWKSet`, `PyJWKClient`) do
   this for you.

### 2.2 Verification

For each request bearing `Authorization: Bearer <token>`:

| # | Check | Requirement |
|---|-------|-------------|
| 1 | **Signature** | Verify against a JWKS key selected by the token's `kid`. |
| 2 | **`alg`** | MUST be in the allow-list `["RS256"]`. **Reject `HS*` / `none` unconditionally** (defends against algorithm-confusion). |
| 3 | **`iss`** | MUST equal the configured issuer exactly. |
| 4 | **`aud`** | MUST contain **this app's own** audience (its Authentik client id). A FuzeFront-audience token MUST be rejected by FuzeKeys, and vice-versa. |
| 5 | **`exp`** | MUST be present and in the future (± clock skew). |
| 6 | **`iat`** | MUST be present. `nbf` enforced if present. |
| 7 | **`sub`** | MUST be present and non-empty. |
| 8 | **Clock skew** | Allow **±60 s** leeway on time-based claims. |

If any check fails, reject with **HTTP 401** and a stable machine-readable error
code (e.g. `invalid_token`, `missing_bearer_token`). Never 500 on a bad token.

### 2.3 `sub` → user mapping

- **`sub`** is the stable Authentik user identifier (a UUID). It is the **primary
  key** for federating identity across the family. FuzeFront already treats it as
  such — `backend/src/services/oidc.ts` persists the local user `id` as
  `userinfo.sub`. Siblings SHOULD key their local user records on `sub`.
- `email` MAY be used for human display / first-time linking, but MUST NOT be the
  primary join key (emails change; `sub` does not).
- Standard claims a sibling can rely on (subject to the app's Authentik scope
  config): `email`, `email_verified`, `name`, `preferred_username`, `groups`.

### 2.4 Audience model & service-to-service

- Each app validates its **own** `aud` only. This isolates blast radius: a token
  stolen from FuzeFront's audience is useless against FuzeKeys.
- For **service-to-service** calls where service A must call service B on a user's
  behalf, A obtains a token whose `aud` is B (via Authentik token exchange /
  requesting B's audience). Defining the token-exchange flow is **out of scope for
  v1.0.0** and will be a follow-up contract version; v1 covers the
  user→app validation path that unblocks `AUTH_MODE=authentik`.

---

## 3. Per-app registry

Each consuming app declares its issuer + audience. Values below are the **shape**;
the live issuer host is environment-specific (`auth.fuzefront.dev` in prod,
`auth.fuzefront.local:9000` locally).

| App | Authentik app slug | `aud` (client id) | Issuer (`iss`) |
|-----|--------------------|-------------------|----------------|
| FuzeFront | `fuzefront` | `fuzefront-client` | `${AUTHENTIK_HOST}/application/o/fuzefront/` |
| FuzeKeys  | `fuzekeys`  | `fuzekeys-client`  | `${AUTHENTIK_HOST}/application/o/fuzekeys/`  |

> New family apps append a row here in the same PR that registers them in
> Authentik. This table is part of the versioned contract.

### Environment variables (sibling side)

```bash
# The exact issuer string (must equal the `iss` claim, trailing slash included)
FUZE_AUTHN_ISSUER=https://auth.fuzefront.dev/application/o/fuzekeys/
# This app's own audience (its Authentik client id)
FUZE_AUTHN_AUDIENCE=fuzekeys-client
# Optional: pin the JWKS uri; otherwise resolved from discovery
FUZE_AUTHN_JWKS_URI=
```

---

## 4. Reference validators

Two reference implementations ship with this contract and are kept in lock-step
with it:

- **TypeScript / Node:** [`@fuzefront/authn`](../../packages/authn/README.md) —
  `createAuthnValidator()` + `requireFamilyAuth()` Express middleware (built on
  `jose`).
- **Python / FastAPI:** [`examples/fuzekeys-fastapi`](../../examples/fuzekeys-fastapi/README.md)
  — `FamilyAuthValidator` + a FastAPI dependency (built on `PyJWT`), with an
  end-to-end worked example.

Both enforce the §2 checks identically (RS256-only, exact `iss`, per-app `aud`,
`exp`/`iat`/`sub` required, 60 s skew).

---

## 5. Versioning & change policy

- This contract is **SemVer-versioned** in the header.
- **Patch:** clarifications, no behavioural change for implementers.
- **Minor:** additive (new optional claim, new app row, new optional config).
- **Major:** any change that can break an existing validator (new required claim,
  algorithm change, audience-model change, introducing token exchange as
  mandatory). A major bump requires re-freeze and re-notification of consumers.
- Reference validators MUST be updated in the same PR as any normative change.

---

## 6. Freeze status

| Milestone | State | Notes |
|-----------|-------|-------|
| Contract drafted | ✅ | This document, `v1.0.0`. |
| **Contract frozen** | ⏳ **pending** | Requires maintainer (@izzywdev) sign-off. Until frozen, fields above may change without a major bump. |
| Deployed to cluster | ⏳ pending | Requires Authentik per-app providers registered in the cluster (FuzeInfra change, delegated via `@claude`). |

**Freeze procedure:** maintainer reviews this PR, confirms the model + the §3
registry values, and merges in a deploy window. On merge, this section flips to
**frozen** and consumers (FuzeKeys) may pin to `v1.0.0`.
