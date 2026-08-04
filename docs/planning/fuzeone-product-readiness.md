# FuzeOne product readiness — the seven end-states

Seven end-states define "a product is fully onboarded to FuzeOne". This document records
**measured** state per goal (not assumed), what blocks each, and who can unblock it.

Evidence was gathered by inspecting all ten product repos at their merged default
branches on 2026-07-29. Where a claim is unverified, it says so.

## Scoreboard

| # | End-state | State | Blocker |
|---|---|---|---|
| 1 | All products appear in the portal | **~90%** | FuzeHub's 5 surfaces; suite rendering needs frames |
| 2 | Mobile products install as standalone APKs | **0%** | Per-product signing keystores (owner-only) |
| 3 | MCP products have a remote SSE MCP pod in prod | **0%** | No server code exists anywhere; depends on #7 |
| 4 | Products use FuzeFront security, know nothing of Authentik | **0% adopted** | Platform side EXISTS; zero consumers |
| 5 | Products init AuthZ into Permit via the security service | **~80%** | Architecturally done; sync unverified in prod |
| 6 | Products support the FuzeOne admin app | **0%** | Needs `product-designer` frames first (design gate) |
| 7 | Products deployed — backend + frontend pod | **partial** | Prod is GitOps; FuzeInfra delegation required |

---

## 1. Portal presence — nearly there

Every product now registers itself: `registration/manifest.json` with `nav`, `policy.json`,
`modes: ["portal","standalone"]`, and `routing.host`. All ten validate against the merged
`AppManifest`.

**Remaining:**
- **FuzeHub ships five surfaces, registers one.** `packages/fuzehub-{talent,recruiter,ventures,marketplace}`
  are real Vite MF remotes; a fifth (admin) does not exist. The legacy
  `register-apps-job.yaml` is still what registers those four in prod. **Migration order is
  load-bearing: five manifests with `nav.suite` FIRST, retire the legacy job SECOND.**
  Reversed, four surfaces vanish from the portal.
- **The shell does not render `nav.suite` groups** — siblings show as flat entries. This is
  feature UI, so it needs a `product-designer` frames PR before implementation.
- **The backend still derives mode** from `integration_type` rather than reading `modes`
  (`backend/src/routes/appRegistry.ts`). Needs a column migration.

## 2. Mobile APKs — nothing yet, and partly owner-gated

Ten products declare `mobile` (`strategy: pwa`, `targets: [android, mobile-web]`) per the
canonical `mobile-requirements.schema.json`. Nothing builds them.

FuzeFront's own `build-android-apk.yml` is the reference: Bubblewrap TWA over
`app.fuzefront.com`, signed, published as a GitHub Release.

**What generalizing it needs:**
1. A reusable workflow parameterised by product slug + standalone host.
2. **Per-product signing keystore** — `ANDROID_KEYSTORE_B64`, `..._STORE_PASSWORD`,
   `..._KEY_PASSWORD` as repo secrets. **Only the owner can create these.** A keystore is
   the app's identity on the Play Store; losing or rotating it orphans every install.
3. `assetlinks.json` served at `https://<slug>.fuzefront.com/.well-known/` with the
   matching SHA-256 fingerprint. Digital Asset Links is what makes it a TWA rather than a
   browser in a box — a fingerprint mismatch silently degrades it to a Chrome tab with
   address bar.
4. A **pair gate**: `mobile.required: true` must fail unless the product's registration
   manifest declares `standalone` in `modes` AND a `routing.host`. Without a URL there is
   nothing to wrap.

**Blocked on owner:** keystore generation and secret installation. Everything else is
`devops-engineer` work.

## 3. Remote SSE MCP pods — nothing exists

All ten declare an `mcp` block with **`enabled: false`** and a note describing the intended
surface. **No repo has an `mcp/` directory. There is no server code, and no `tools.json`
anywhere.** The blocks are scaffolds, correctly marked as such.

Per product this needs: an SSE MCP server, a `tools.json` declaring `mutates` per tool, a
container image, and a Helm deployment. Each carries a product-specific irreversibility
constraint already recorded in its manifest note — e.g. FuzeService: an approval decision
is irreversible; FuzeSocial: publishing a post is public and irreversible. Those must be
`mutates: true` and unreachable as a side effect of a read.

**Depends on #7** — a pod cannot be deployed to a product with no deployment.

## 4. Security via FuzeFront — the platform is built, nobody uses it

This is the biggest gap between "built" and "adopted".

**`@fuzeone/security-client` v0.2.0 already exists** and is exactly the right
abstraction — products never name Authentik:

| Concern | Endpoint |
|---|---|
| session | `/v1/security/session`, `/session/exchange` |
| signup / methods | `/v1/security/signup`, `/methods`, `/email-available` |
| social | `/v1/security/social/{provider}/start`, `/social/callback` |
| password | `/v1/security/password`, `/session/password/reset-*` |

Plus `@fuzeone/identity-ui` for the sign-in/sign-up redirect surface.

**Measured adoption: zero.** No product depends on `@fuzeone/security-client` or
`@fuzeone/identity-ui`. Worse, three reference Authentik or Permit **directly** — the
precise coupling this goal forbids:

| repo | files naming authentik/permit |
|---|---|
| FuzeKeys | 10 |
| FuzeHub | 4 |
| FuzeAgent | 3 |

The other seven have no auth integration at all.

**Recommended shape:** migrate ONE product end-to-end as the reference (FuzeService is the
cleanest — no existing Authentik coupling to unpick), prove it against a running stack,
then apply the recipe. Do not fan out ten migrations before one is proven; a wrong auth
recipe replicated ten times is worse than none.

## 5. AuthZ into Permit via the security service — architecturally done

This one is further along than it looks, and the design is already correct:

- Each product ships `registration/policy.json` declaring resources + roles with **bare
  keys**. All ten are merged.
- `register.sh` PUTs it to `/apps/{slug}/policy` at deploy time.
- `backend/src/permit/sync-permit-schema.ts` calls `loadRegisteredProductPolicies()` and
  syncs registry-registered policies into Permit, with **registered superseding the legacy
  in-tree copy**.

So a product declares roles and never names Permit. That is goal 5.

**Unverified:** that the sync actually runs in prod and the policies land in Permit. The
sync fails soft by design (a missing role denies rather than crashing), which is correct
but means a silent failure looks like "no permissions" rather than an error. **Worth an
explicit check before calling this done.**

## 6. FuzeOne admin app — not started

Two distinct surfaces are being conflated and should not be:

- **Actor apps** — what FuzeHub's talent/recruiter/ventures/marketplace remotes are.
  Per-surface registry rows, grouped by `nav.suite`. Contract exists (#444).
- **The FuzeOne admin surface** — cross-org, cross-user management *of* the product. This
  is a different authority level: it manages tenants, not domain objects.

`@fuzeone/security-client` already exposes what it needs:
`/v1/security/tenants`, `/tenants/{id}/members`, `/tenants/{id}/roles`,
`/tenants/{id}/members/{userId}/roles`.

So the admin app should be a **shared FuzeFront UI package** consuming those endpoints,
mounted per product as an additional registered surface with `roles: ["platform-admin"]` —
not ten hand-built admin panels. Ten copies of a tenant-management UI is ten places for an
authorization bug to hide.

**Blocked by the design-first gate:** this is feature UI, so `product-designer` must land
approved frames in `design/frames/` before implementation. That gate is the point — six
Security backends previously shipped with no UI and nothing caught it.

## 7. Deployment — partial, and not ours to execute

Measured per repo:

| repo | helm | argo app | Dockerfile |
|---|---|---|---|
| FuzeService, FuzeSales, FuzeKeys, FuzeAgent, FuzePlan, FuzeHub, FuzeSocial | yes | yes | yes |
| FuzeMarket | yes | **NO** | yes |
| FuzeExecutive | yes | **NO** | **NO** |
| FuzeDeploy | **NO** | **NO** | yes |

**Hard constraint:** prod is GitOps. Per this repo's own governance, hand-deploying to prod
is forbidden and infra changes are delegated to FuzeInfra via `@claude`. So the deliverable
from here is *chart + Argo Application + image build*, and the actual rollout is a FuzeInfra
delegation plus an Argo sync. Nobody working in this repo can complete goal 7 alone.

---

## Ordering

Dependencies make most of the ordering for us:

```
7 (deploy) ──→ 3 (MCP pods)
4 (security adoption) ──→ 6 (admin app, needs tenants API + frames)
1 (FuzeHub suites) ──→ retire register-apps-job.yaml
2 (APK) ──→ needs owner-supplied keystores
```

Recommended sequence:

1. **Finish #1** — FuzeHub's five manifests, then retire the legacy job. Smallest change,
   removes a live prod inconsistency.
2. **Verify #5** — confirm policies actually reached Permit. Cheap, and it either closes a
   goal or exposes a silent failure.
3. **Close #7's gaps** — Argo apps for FuzeMarket/FuzeExecutive/FuzeDeploy, chart for
   FuzeDeploy, Dockerfile for FuzeExecutive. Then delegate the rollout.
4. **#4 reference migration** — one product, proven, then fan out.
5. **#2 workflow** — build the reusable workflow so it is ready the moment keystores exist.
6. **#6 frames** — `product-designer` on the shared admin surface.
7. **#3** — MCP servers, once products are deployed.

## What needs the owner

Three things cannot be done from this repo, by anyone:

1. **Android signing keystores + GitHub Secrets** per mobile product (#2).
2. **FuzeInfra delegation** for prod rollout, and the Argo syncs (#7, therefore #3).
3. **A decision on the admin app's shape** — one shared package (recommended) vs
   per-product. This determines whether #6 is one frames PR or ten.

Also outstanding and unrelated to these goals: `gate-code-review` has been reporting
"Credit balance is too low" on every PR in this programme, so **no automated review has run
on any of it**.
