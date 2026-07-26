# Runbook — Unleash on the Cloudflare Access launcher + "developers see all features"

Two related asks:

1. **Expose Unleash (and, deliberately, *not* Authentik) on the Cloudflare Access
   App Launcher** at `https://fuzefront.cloudflareaccess.com/#/Launcher`.
2. **Make every feature flag default ON for the developer audience** (including the
   platform owner) without weakening the fail-safe defaults for everyone else.

Most of the work is **outside this repo**: the launcher tile is a Cloudflare Access
*Application* (Cloudflare dashboard + FuzeInfra tunnel), and the "developers on"
targeting is runtime config in the live Unleash instance. This runbook is the
execution guide for those steps.

---

## Why Unleash and Authentik have no launcher tile by default

The launcher only shows **Cloudflare Access Applications**. A service appears there
only if it has (a) a public hostname fronted by the CF tunnel and (b) an Access
Application with "Show in App Launcher" enabled. Neither service had that:

- **Authentik** is intentionally never given a browser-facing hostname. It is
  reverse-proxied *under* the app host (`app.fuzefront.com/api/auth/idp/*` →
  `authentik-server`, ClusterIP) and `auth.fuzefront.com` is meant to be invisible
  (`deploy/helm/fuzefront/templates/ingress.yaml`). This is the provider-agnostic
  IdP boundary. **Recommendation: leave Authentik off the launcher** — putting the
  IdP behind Access is a chicken-and-egg (Access needs an IdP to authenticate you),
  and a public IdP host cuts against the security design.
- **Unleash's** admin UI is cluster-internal by default. The chart ships an optional
  ingress (`deploy/helm/unleash/templates/unleash.yaml`) for a CF-Access-gated host.

---

## Part 1 — Put Unleash on the launcher

### Step 1 (this repo) — Helm ingress: **DONE on `master`**

`deploy/helm/unleash/values-prod.yaml` already sets:

```yaml
  ingress:
    enabled: true
    host: unleash.prod.fuzefront.com
```

so the cluster Ingress host-matches `unleash.prod.fuzefront.com` → the Unleash
Service. This alone does **not** make Unleash reachable or add a launcher tile — it
only wires the in-cluster route. Steps 2–3 are the remaining, out-of-repo work.

### Step 2 (FuzeInfra — delegated `@claude`) — Cloudflare tunnel + Access Application

FuzeInfra-owned (Cloudflare dashboard / Terraform); cannot be done from this repo.

> **@claude (FuzeInfra):** please expose the FuzeFront Unleash admin UI on the
> `fuzefront` Cloudflare Access team, gated to the developer group.
>
> 1. **Tunnel public-hostname route:** `unleash.prod.fuzefront.com` → the cluster
>    ingress entrypoint (the same `traefik.kube-system:80` target used for the other
>    `*.prod.fuzefront.com` admin hosts). Proxied.
> 2. **DNS:** proxied CNAME `unleash.prod.fuzefront.com` → the tunnel.
> 3. **Cloudflare Access → Applications → Add → Self-hosted:**
>    - Application domain: `unleash.prod.fuzefront.com`
>    - Policy: **Allow** the developer group (emails or IdP group), including
>      `izzy.weinberg@gmail.com`.
>    - **App Launcher → "Show in App Launcher": ON** (this is the step that creates
>      the tile; a tunnel route alone does NOT add one).

> Note: this delegation cannot be filed as a FuzeInfra issue from a FuzeFront
> session (GitHub scope is `izzywdev/fuzefront` only). Forward the block above into
> FuzeInfra, or trigger `@claude` there directly.

### Verify

- `https://unleash.prod.fuzefront.com` prompts Cloudflare Access, then loads Unleash
  after auth.
- A tile appears at `https://fuzefront.cloudflareaccess.com/#/Launcher` for members
  of the developer group.

---

## Part 2 — Developers see all features ON

### Principle: keep the fail-safe defaults; add a targeting layer

The in-code / global defaults must **stay** at their fail-safe values — release
flags OFF, kill-switches ON (`.claude/skills/feature-flags/SKILL.md`;
`backend/applications/src/app-registry/flags.ts`). Those are the values used when
Unleash is unreachable; flipping the *global* default ON would mean an Unleash
outage silently turns every dark feature on in prod.

"Developers see everything" is therefore an **Unleash targeting layer on top** of
those defaults, not a change to them. This is runtime config in the live Unleash
instance (there is no flag/segment config-as-code in this repo); it is owned by
`feature-flags-engineer`.

### EXECUTED — 2026-07-26

| What | Value |
|---|---|
| Segment | `developers`, **id `1`** |
| Constraint | context field `userId` **IN** `[<owner users.id UUID>]` |
| Environment touched | **`production`** only (`development` and `default` untouched) |
| Flags given the developer strategy | 3 release flags (below) |
| Kill-switches given the developer strategy | **0 — deliberately excluded**, see note |

> **Correction to the "fast path" text below:** the value to constrain on is the
> owner's **`users.id` UUID**, *not* their email. `@fuzefront/feature-flags` maps
> `userId` → OpenFeature `targetingKey` → the Unleash built-in `userId` context
> field (`packages/feature-flags/src/context.ts`), and `users.id` is a UUID
> (`shared/src/kafka/schemas/identity.session.issued.ts` types it `z.string().uuid()`).
> A segment keyed on an email would never match.

**Kill-switches are excluded from the segment on purpose.** An `ops-kill-switch`
is already ON for everyone, so a developer strategy adds nothing — and during a
break-glass incident it would keep the killed path **ON for developers** while OFF
for everyone else, defeating the switch. Kill-switches get a plain 100% strategy
with no segment.

#### Verified (Unleash `/api/frontend` server-side evaluation, production env)

| Flag | type | owner (developer) | other real user | non-existent user |
|---|---|---|---|---|
| `fuzefront.app-registry.v1-registry-write` | release | **ON** | OFF | OFF |
| `fuzefront.account-security.hub` | release | **ON** | OFF | OFF |
| `fuzefront.billing.invoice-history` | release | **ON** | OFF | OFF |
| `fuzefront.app-registry.kafka-events-kill-switch` | kill-switch | ON | ON | ON |

Non-developer behaviour is unchanged in every case. Verification used a temporary
`frontend`-type API token, **revoked immediately afterwards**.

### Making the segment actually reach runtime — what was broken

The segment was correct inside Unleash but observable by nothing. Five defects
stood between it and a running service; all are fixed in the same PR.

**0. The provider package did not exist.** `packages/feature-flags/src/server.ts`
dynamically imported `unleash-openfeature-provider-server` — **not a package on
npm**, and never a declared dependency. The import therefore *always* threw, the
`catch` degraded to OpenFeature's no-op default provider, and every server-side
flag silently resolved to its in-code default. No Unleash targeting was ever
applied, and nothing logged an error. This was the root cause; the rest are the
reasons it was never noticed.

Fixed by an in-repo OpenFeature `Provider` over the stable, Unleash-maintained
`unleash-client` (`src/unleash-provider.ts`). The only published Unleash
OpenFeature Node provider is `@unleash/openfeature-node-provider@0.1.0-alpha`,
which is not fit for a production path. OpenFeature stays the public surface, so
Unleash remains swappable.

**1. The client was in no image.** `packages/feature-flags` was absent from every
Dockerfile, so the workspace symlink resolved to a package with no `dist/`.
Fixed: added to the build + production stages of `backend/Dockerfile` and
`backend/applications/Dockerfile`, declared as a dependency of both services, and
initialized at startup.

**2. `getClient` was never exported.** `backend/applications/src/app-registry/flags.ts`
resolves the client via `require('@fuzefront/feature-flags').getClient()`, but the
package exported only `init`/`setContext`/`getBoolean`/`getString`/`getNumber`/
`close`. `resolveClient()` therefore returned `null` and flags always took their
default. Fixed: `getClient()` added and pinned by tests.

**3. The chart read a key that exists in no Secret.** The env block was gated on
`applicationsService.featureFlags.unleashUrl`, which was `""` in prod so nothing
rendered; and it sourced the token from `fuzefront-secrets` under
`FEATURE_FLAGS_CLIENT_TOKEN`, a key present in neither Secret. Fixed: prod values
set the in-cluster URL and point at `unleash-secrets` / `UNLEASH_CLIENT_TOKEN` —
the token the Unleash chart already seals, so nothing needs re-sealing. The same
block was added to the backend, which had none.

**4. The frontend flags were build-time constants.** `AccountSecurityPage.tsx`
and `BillingPage.tsx` read `import.meta.env.VITE_FF_*`, baked into the bundle and
identical for every user, so no per-user segment could ever affect them. Fixed:
both read `useFlag(...)` from `frontend/src/platform/featureFlags.tsx`, which
fetches `GET /api/flags` once per session.

### Why the browser does NOT talk to Unleash directly

A frontend token + the Unleash frontend API was the obvious route. It is the
wrong one here: **Unleash's frontend API takes its evaluation context from
client-supplied query params**, so any user could pass the platform owner's
`userId` and enrol themselves into the `developers` segment. Flags gate
visibility rather than authorization (Permit still owns authz), so the blast
radius is bounded — but a cohort anyone can join is not a cohort.

Instead the backend serves `GET /api/flags`, evaluating the catalog against the
**authenticated session**. This also means no Unleash token reaches the browser,
no `frontend`-type token has to be minted and sealed, and no new public host or
Cloudflare Access carve-out is needed — `/api/*` is already same-origin routed.
Only `WEB_EXPOSED_FLAGS` are returned, so server-only flags are never disclosed.

**5. `packages/**` did not trigger a release.** The images compile the flag
client, yet `release.yml` only watched `backend/**`, `shared/**`, `frontend/**`,
… — a change confined to `packages/**` would merge green and ship nothing. Path
added.

Local/e2e stacks have no Unleash to target, so the backend accepts
`FLAGS_FORCE_ON=<comma-separated keys>`, **hard-gated to non-production** so a
stray env var can never light up dark features in prod. `docker-compose.e2e.yml`
uses it in place of the removed `VITE_FF_ACCOUNT_SECURITY_HUB` build arg.

### Step 1. Create a `developers` segment

Unleash → **Configure → Segments → New segment**, name `developers`. Populate the
cohort by one of:

- **Fast path (works today, no code):** a constraint on context field `userId`
  (the OpenFeature `targetingKey`, which `@fuzefront/feature-flags` already sets
  from the caller's user id) — operator `STR_CONTAINS` / `IN`, values = the
  developer user ids, including the platform owner's. Needs only **your stable user
  id** (the security-service / Authentik user id passed as `userId` in the flag
  context).
- **Durable path (optional follow-up):** target a group/role instead of a hand-kept
  id list. This needs a small addition to the evaluation context
  (`packages/feature-flags/src/types.ts` already allows extra fields; add a
  first-class `groups`/`roles` field and populate it from the Authentik group /
  Permit role on the authenticated principal), then constrain the segment on that
  field. Prefer this once more than a couple of developers need coverage.

### Step 2. Turn every flag ON for that segment (production env)

For each existing flag, in the **production** environment, add a strategy:
**Standard → 100% → Segments: `developers`**. Because the segment gates it, the flag
is ON for developers and continues to follow its deliberate rollout for everyone
else. New flags: add the same `developers`-segment strategy at creation so the
"developers on by default" policy holds going forward (make it part of the flag
template / `feature-flags-engineer`'s creation checklist).

> This does **not** relax the rules for real users: a release flag is still OFF for
> non-developers until rolled out, and a **permission** flag is still enforced by
> **Permit** server-side — the segment only changes who sees the *flag*, never who is
> *authorized*.

### Step 3. Add yourself

Put the owner's user id (fast path) or add the owner to the developer group (durable
path) so the platform owner is inside the `developers` cohort.

### Verify

With the developer's session, previously-dark features render / previously-gated
endpoints respond; with a non-developer session, they still follow the normal
rollout. Both states remain covered by the flag tests
(`.claude/skills/feature-flags/SKILL.md` — test BOTH states).

---

## Status summary

| Item | Where | Status |
|---|---|---|
| Unleash prod ingress (`enabled: true`, CF-Access host) | `deploy/helm/unleash/values-prod.yaml` | **Done on `master`** |
| CF tunnel route + CNAME + **Access Application** (the launcher tile) | Cloudflare / FuzeInfra | **Delegated** — Part 1, Step 2 |
| `developers` segment + per-flag ON strategy in Unleash | live Unleash instance | **Done** — segment id 1, 3 release flags, production env (2026-07-26) |
| Owner's user id / dev group membership | Unleash / Authentik | **Done** — owner `users.id` UUID in the segment constraint |
| `developers`-segment step in the flag-creation checklist | `.claude/skills/feature-flags/SKILL.md` | **Done** |
| Real OpenFeature provider (phantom package replaced) | `packages/feature-flags/src/unleash-provider.ts` | **Done** |
| Flag client built into the images + declared dep | `backend/Dockerfile`, `backend/applications/Dockerfile` | **Done** |
| `getClient` export | `packages/feature-flags/src/index.ts` | **Done** |
| Helm env: URL + CLIENT token from `unleash-secrets` | `deploy/helm/fuzefront/**` | **Done** |
| Frontend flags read per-user (`GET /api/flags`) | `frontend/src/platform/featureFlags.tsx` | **Done** |
| `packages/**` triggers a release build | `.github/workflows/release.yml` | **Done** |
| `frontend`-type Unleash token (SealedSecret) | — | **Not needed** — the browser never talks to Unleash |

Part 2 is complete within Unleash **and** wired end-to-end in code. Runtime effect
lands when the images build and Argo syncs; verify in-cluster after the deploy
(merging is not deploying — check the running pods, not the merge).
