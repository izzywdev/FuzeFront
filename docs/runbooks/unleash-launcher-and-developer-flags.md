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

### ⚠ This targeting layer is currently INERT at runtime — three blockers

The segment is correct and verified *inside Unleash*, but no running service can
observe it yet. Until these are fixed, developers will **not** see flags flip:

1. **The flag client is not installed in any running service.** `@fuzefront/feature-flags`,
   `unleash-openfeature-provider-server`, and `unleash-client` are all absent from
   `fuzefront-backend`, `fuzefront-applications`, and `fuzefront-security`. Every
   server-side read therefore falls through to the in-code fail-safe default.
2. **`@fuzefront/feature-flags` does not export `getClient`.** `backend/applications/src/app-registry/flags.ts`
   resolves the client via `require('@fuzefront/feature-flags').getClient()`, but
   `packages/feature-flags/src/index.ts` exports only `init`/`setContext`/`getBoolean`/
   `getString`/`getNumber`/`close`. Even once installed, `resolveClient()` returns
   `null` and flags always take their default. (Owner: `backend-engineer`.)
3. **The two frontend flags are build-time constants, not Unleash reads.**
   `AccountSecurityPage.tsx` and `BillingPage.tsx` read `import.meta.env.VITE_FF_*`,
   which is baked at build time and identical for every user — no per-user segment
   can ever affect them. They must be switched to the web client before the
   developer cohort has any effect. (Owner: `frontend-engineer`.)

Also missing: **no `frontend`-type Unleash API token exists** (only a `client` and an
`admin` token). The browser path will need one, provisioned as a SealedSecret by
`devops-engineer` — not the `client` token, which must never reach the browser.

Also note `flags.ts` builds its context with `organizationId`, while the client's
context contract (`packages/feature-flags/src/types.ts`) specifies **`orgId`**; any
future org-targeted constraint would silently miss. (Owner: `backend-engineer`.)

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
| Flag client installed in running services | `fuzefront-backend` / `-applications` / `-security` | **BLOCKER** — absent, all reads hit in-code defaults |
| `getClient` export on `@fuzefront/feature-flags` | `packages/feature-flags/src/index.ts` | **BLOCKER** — `backend-engineer` |
| Frontend flags read Unleash (not `VITE_FF_*`) | `frontend/src/pages/{AccountSecurity,Billing}Page.tsx` | **BLOCKER** — `frontend-engineer` |
| `frontend`-type Unleash token (SealedSecret) | Unleash / `deploy/contabo/sealed` | **TODO** — `devops-engineer` |

Part 2 is complete **within Unleash** and verified there. It has **no runtime effect
yet** — see the three blockers above; the flag layer is not wired into any running
service, so developers will not observe flipped flags until those are closed.
