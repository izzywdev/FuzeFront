# Locked App Mode — serve one product white-label on its own domain (web + native), FuzeFront hidden

## Context

**The ask.** A product built on FuzeFront (worked example: **FuzeSocial**) must be reachable at
its **own domain** — `www.fuzesocial.com` — where the visitor sees **only FuzeSocial**. No
FuzeFront logo, wordmark, 9-dots app launcher, org switcher, or "return to portal" affordance —
**nothing that indicates FuzeFront is the framework underneath.** Yet the product keeps consuming
FuzeFront's platform services transparently: **authN, authZ, billing, payments, notifications,
sockets, and the app registry.** FuzeFront becomes an invisible substrate; the product owns the
brand and the front door.

**On mobile the same, harder.** App stores forbid an app that dynamically loads other apps, so a
single "container" app that mounts many products is a rejection risk. Instead, **each product ships
as its own signed native app**, locked to that one product — exactly the Google / Zoho / Atlassian
pattern: on desktop all their apps live behind one 9-dots menu; on the phone you install a *folder
of separate apps*. FuzeFront must publish one locked native app **per product**.

**The vision, restated as a platform capability.** "Locked app mode" is a **third app mode** for a
registered product: like `standalone` it renders with no portal chrome, but unlike `standalone` it
is **fully white-labeled, bound to its own domain, and offers no way back to the portal** — while
still opting into the full platform infra. The web surface and the native app are two arms of the
same mode.

### What already exists (so this design EXTENDS, not reinvents)

The platform is already close. The mounting model, the chrome-less surface, and the mobile
precedent all exist — the gaps are per-domain bootstrapping and de-branding, not the core model.

- **A frozen app-registry contract.** `services/app-registry-service/openapi.yaml` (source of truth)
  + its Zod mirror `backend/applications/src/app-registry/manifest.schema.ts`, exposed as the
  generated client `@fuzefront/app-registry-client` (repo package `apps-client/`). The `AppManifest`
  already carries: `mode` (`portal | standalone`), **`routing.host`** — a dedicated per-app host,
  the contract's own example is `clock.fuzefront.com` — `chrome.{menu,topbar}`, and
  `infra.{auth,billing,api,deployOnFuzeInfra}` (per-app infra opt-in). This is the seam locked mode
  extends.
- **A chrome-less render surface.** `frontend/src/components/StandaloneAppSurface.tsx` (routed at
  `/standalone/:slug` in `frontend/src/App.tsx`) already mounts a remote **edge-to-edge with no
  TopBar and no SidePanel**. `frontend/src/platform/appManifest.ts` `appHref()` / `standaloneHost()`
  already route a `routing.host` app to `https://{host}{path}` — its own origin.
- **A working per-product native app precedent.** `shopify-nav/` is a **complete, independently
  signed second TWA** already in the repo: its own `shopify-nav/android/twa-manifest.json`
  (`packageId com.fuzefront.shopifynav`, host `nav.velogearpremium.com`, own theme, own keystore
  alias `shopifynav`, own fingerprint), its own `shopify-nav/.well-known/assetlinks.json`, its own
  icons/PWA manifest, and its own workflow `.github/workflows/shopify-nav-apk.yml` (which even
  builds a Play-ready AAB with separate secrets `SHOPIFY_NAV_KEYSTORE_B64` / `_STORE_PASSWORD` /
  `_KEY_PASSWORD`, and — unlike the main workflow — *skips* rather than falls back to a default
  password when a secret is missing). This proves per-product APKs are a **matrix**, not a rebuild.
  The main app is `android/twa-manifest.json` + `.github/workflows/build-android-apk.yml` +
  `frontend/public/.well-known/assetlinks.json`.
- **A multi-tenant data layer + same-origin API.** The `organizations` table
  (`backend/src/migrations/004_create_organizations_table.ts`) has a self-referential hierarchy and a
  `settings` JSONB (currently unused for branding). The frontend already assumes a **same-origin API
  base** — `frontend/src/platform/appRegistry.tsx` uses `window.location.origin` + `/api/v1/app-registry`
  — and `frontend/nginx.conf` proxies `/api/*`, `/chat-api/`, and `/socket.io/` to the split backends.
  Nothing hard-codes an absolute API host, which is exactly what makes serving under a new domain
  viable.

### Gaps this design must close

1. **Domain → app boot resolution.** Nothing today keys off `window.location.host`; the shell always
   boots `/` → `/dashboard` with full chrome. A locked domain must resolve to exactly one product and
   render only it.
2. **De-brand the static shell + login.** `frontend/index.html` (title, favicon, meta, theme-color)
   and `frontend/src/pages/LoginPage.tsx` are hardcoded FuzeFront and load **before** any app logic —
   so even a perfect runtime resolver would flash FuzeFront branding first.
3. **Per-app branding.** There is no plumbing to load a product's logo/name/accent. The DS token
   system (`--accent-color`, `--bg-primary`, … in `design-system/tokens/colors.css`) can be overridden
   at runtime, but no loader reads a per-domain brand and applies it.
4. **Suppress cross-app affordances.** The 9-dots `frontend/src/components/AppSelector.tsx`, the org
   selector in `frontend/src/components/TopBar.tsx`, and the SidePanel "Apps" / "return to portal"
   controls must be *absent* in locked mode (they already are on `/standalone/`, but the login/topbar
   and menu-substitute paths need auditing).
5. **Per-product native app.** `AppManifest` has no native/APK fields; the two APK workflows are
   copy-pasted rather than matrixed; each product needs its own keystore + fingerprint + assetlinks in
   lockstep.
6. **Same-origin infra under the new domain.** The locked domain's ingress must replicate the nginx
   `/api | /chat-api | /socket.io` proxying (plus TLS + Cloudflare tunnel route) so authN/authZ/
   billing/notifications/sockets keep working transparently. This is a **FuzeInfra `@claude`
   delegation**, not a change in this repo.

### Decisions (defaults — flagged for owner review)

An interactive confirmation could not be delivered while authoring this; the design adopts these and
they remain revisitable in the contract-freeze PR:

1. **Model locked mode as a new `AppMode` value `locked`** (a third value alongside `portal` and
   `standalone`), plus new manifest `branding` and `native` blocks. Rationale: `standalone` is
   contractually required to *always* retain a "return to portal" anti-trap control and is documented
   as "renders without portal chrome on its own host/path" — but it is **not** white-label and is not
   meant to hide the platform. Overloading it with a `whiteLabel` flag makes locked-vs-standalone
   ambiguous in the registry and in `appManifest.ts` predicates. A distinct `mode: locked` reads
   cleanly everywhere the code already branches on `mode`.
2. **Runtime Host-header lookup** (one shared frontend build). At boot the shell reads
   `window.location.host`, asks the registry for the app whose `manifest.routing.host` matches, and
   renders only that product. Rationale: registry-driven, no per-app build/pipeline, scales to N
   products by registering them. (Alternative — a per-domain build/env injection — trades runtime
   simplicity for N build pipelines and build-time-frozen branding; rejected as the default.)
3. **Deliverable scope of the first change = this design doc only.** The contract change, the code
   fan-out, and the design-review gate issue are the follow-up ADLC steps sequenced below.

---

## Target architecture

```
Browser at www.fuzesocial.com ──▶ same-origin FuzeFront shell (single shared build)
   boot: window.location.host ──▶ GET /api/v1/app-registry  (resolve app where manifest.routing.host == host)
   render: ONLY that product's white-label surface  (branding from manifest.branding)
           NO launcher · NO org switcher · NO return-to-portal · NO FuzeFront wordmark
        │  same-origin ▼  (locked domain's ingress replicates nginx /api · /chat-api · /socket.io — FuzeInfra @claude)
   authN · authZ · billing / payments · notifications · sockets · app-registry     (unchanged, hidden)

Mobile: ONE signed TWA APK per locked product  (the shopify-nav precedent), driven off manifest.native
   → matrixed workflow · per-app keystore + fingerprint + assetlinks in lockstep · optional Play AAB
```

Two arms, one mode:

- **Web arm** — the locked domain serves the *same* shared shell build, which self-configures from the
  incoming host into a white-label single-product surface. FuzeFront infra continues to answer
  same-origin, so the product code changes nothing about how it calls authN/billing/sockets.
- **Native arm** — each locked product gets its own installable app that is just a Trusted Web
  Activity wrapping its locked web domain, signed with its own key, verified by its own Digital Asset
  Links. The phone shows a folder of distinct products; each opens locked to itself.

The **app registry is the single source of truth** for both arms: `mode: locked` + `routing.host` +
`branding` drive the web surface, and the new `native` block drives the APK matrix.

---

## Phase 0 — Freeze the contract (the gate) · `contract-designer`

Everything else fans out only after this PR is merged. This is UI-bearing, so the **design-review
gate** attaches here (see below). Deliverables:

1. **Extend `AppManifest`** in `services/app-registry-service/openapi.yaml` (and keep the Zod mirror
   `backend/applications/src/app-registry/manifest.schema.ts` in lockstep):
   - `AppMode` — add the value **`locked`** (enum becomes `portal | standalone | locked`). Update the
     schema description: `locked` = rendered white-label on its own `routing.host`, no portal chrome,
     **no return-to-portal affordance**, full platform infra opt-in.
   - **`branding`** block (used by `locked`, optional for others): `appName`, `logoUrl`, `faviconUrl`,
     `themeColor`, `accentColor` (DS token override), plus optional `supportUrl` / `legalUrl` /
     `termsUrl` so the white-label surface owns its own footer/links.
   - **`native`** block: `packageId` (e.g. `com.fuzefront.fuzesocial`), `host` (the locked domain),
     `iconUrls` (192/512/maskable), `playBilling` (bool), and `fingerprints[]` (the SHA-256 signing
     cert(s) — the same values that must appear in that host's `assetlinks.json`).
   - Constrain: `mode: locked` **requires** `routing.host` and `branding.appName`; a `locked` app's
     `chrome` is ignored (no host chrome exists to configure).
2. **Regenerate the client** `@fuzefront/app-registry-client` (`openapi-typescript`), so UI / backend /
   tests share one `mode: 'locked'` + `branding` + `native` type. Spectral-lint the spec clean.
3. **Add a reference fixture** to `services/app-registry-service/seed/examples.manifests.json` — a
   `fuzesocial` locked manifest (own host, branding, native block) as executable documentation of the
   shape, mirroring the existing `market` / `studio` / `landing` fixtures.
4. **Design-review gate.** Per `CLAUDE.md` §"Mobile design-review gate", produce PenPot frames (or the
   static-HTML fallback at 375 px) of (a) the white-label **login** on a locked domain and (b) the
   locked **product shell** (no launcher / no wordmark), open a GitHub Issue labeled **`design-review`**
   (`design-review-notify.yml` fires the Telegram notice), and wait for `@claude approve` before any
   Phase-1 UI code. The frames + `manifest.json` `testHooks` become the pre-prod Playwright target.

PR = the gate. Amend this PR if implementation proves the contract wrong — never diverge from it.

---

## Phase 1 — Web white-label domain

Fan out, all gated on the Phase-0 contract.

**`frontend-engineer`** — `frontend/src/`
- **Boot resolver.** Early in `App.tsx` (before the `/dashboard` redirect and before `Layout`),
  resolve the active locked app by `window.location.host` against the registry
  (`platform/appRegistry.tsx`); add a `platform/appManifest.ts` predicate `isLocked(manifest)` and a
  `resolveLockedAppByHost(host)` helper alongside the existing `standaloneHost()` / `appHref()`.
- **Locked surface.** Render only the resolved product — extend `StandaloneAppSurface.tsx` (or add a
  sibling `LockedAppSurface.tsx`) that reuses its edge-to-edge remote/iframe mount but drops the
  FuzeFront-tinted canvas gradient in favor of `branding` colors.
- **Branding loader.** Apply `manifest.branding` at runtime: override DS tokens (`--accent-color`,
  `--bg-primary`, theme-color) via a `:root` style injection, and set `document.title` + favicon from
  `branding`. This replaces the static FuzeFront values from `index.html` on locked hosts.
- **De-brand the static entry.** `frontend/index.html` — make the FuzeFront title/favicon/meta a
  neutral default that the branding loader overrides on first paint (or template per-host at serve
  time) so no FuzeFront branding flashes.
- **Suppress cross-app affordances.** Ensure `AppSelector` (9-dots), the org switcher in `TopBar`, and
  the SidePanel "Apps" / return-to-portal controls never render under `isLocked`.
- **White-label login.** `pages/LoginPage.tsx` — strip FuzeFront branding on locked hosts; show the
  product's brand. AuthN still runs against the same-origin platform API.

**`backend-engineer`** — `backend/applications/src/app-registry/`
- Add host→app resolution (`service.ts`, `routes/app-registry.ts`): a filter/endpoint returning the
  `activated` app whose `manifest.routing.host` matches a given host, respecting existing visibility /
  BOLA rules (`caller.ts`, `permit.ts`).
- Persist + serve `mode: 'locked'`, `branding`, and `native` (manifest is already stored JSONB; extend
  the migration/validation, not the storage model).
- Ensure `infra` semantics extend cleanly to **notifications, sockets, and payments** for locked apps
  (today `infra` documents `auth | billing | api | deployOnFuzeInfra`; confirm sockets/notifications
  are covered or add explicit flags in Phase 0).

**`devops-engineer`** — **delegate to FuzeInfra via `@claude`** (never edit FuzeInfra or operate the
cluster from here)
- Per-locked-domain ingress that replicates `frontend/nginx.conf`'s `/api | /chat-api | /socket.io`
  proxy rules + TLS + the Cloudflare tunnel route, so same-origin infra works under the new host. Open
  a cross-repo `@claude` issue on FuzeInfra with the host list + acceptance criteria.

**`test-engineer`** (independent) — contract/integration vs the frozen spec
- `mode: locked` manifest validation (host + branding required); host-resolution correctness (right
  product for a host, 404/neutral for an unknown host); a served-manifest assertion that a locked app
  carries no FuzeFront-only launcher routes.

**`frontend-test-engineer`** (independent) — Playwright vs the approved frames
- **White-label regression (the key one):** on a locked host, assert the DOM contains **no** FuzeFront
  logo/wordmark, **no** 9-dots launcher, **no** org switcher, and **no** return-to-portal control —
  while authN and a billing surface still function same-origin. A FuzeFront-branding hit fails the test.

---

## Phase 2 — Per-product native app

Fan out, gated on the Phase-0 `native` block. Follow the `shopify-nav/` precedent.

**`devops-engineer`** — CI/signing
- **Matrix the two duplicated APK workflows into one** driven by the registry's locked apps: a matrix
  over `{ dir, packageId, host, keyAlias, keystoreSecretPrefix }`. Each product supplies its own
  secrets `<APP>_KEYSTORE_B64` / `<APP>_KEYSTORE_STORE_PASSWORD` / `<APP>_KEYSTORE_KEY_PASSWORD` and its
  own committed `twa-manifest.json` + `.well-known/assetlinks.json`.
- **No insecure fallback.** Mirror `shopify-nav-apk.yml` (skip-with-warning when a signing secret is
  missing), *not* the main `build-android-apk.yml` which falls back to the committed default password
  `fuzefront2024`. Harden that default out as part of this work.
- Optionally build a Play AAB per product (as `shopify-nav-apk.yml` already does) for store submission.

**`mobile-frontend-engineer`** — per-app mobile web
- Per-product PWA manifest + icon set + TWA viewport/safe-area handling, served at each product host so
  Bubblewrap and the installed TWA pick up the product's identity (not FuzeFront's).

**`security`** — key + boundary review
- Per-app keystore/fingerprint **isolation** (a compromise is blast-radius-limited to one product —
  treat isolation as a feature); enforce the `twa-manifest.json` ↔ `assetlinks.json` fingerprint
  lockstep and document rotation (mirror `shopify-nav/android/generate-keystore.sh`).
- Review cross-domain **cookie / CORS / session** behavior for same-origin auth under each new host so
  the "hidden platform" boundary can't leak (e.g. no FuzeFront host ever appears to the browser).

---

## Feature flag

Wrap the whole capability behind the release flag **`fuzefront.platform.locked-app-mode`** (default
**OFF**), per the `feature-flags` skill and `CLAUDE.md` §"Feature flags". Gate **both** the server-side
`mode: locked` / host-resolution handling **and** the frontend boot resolver, and **test both states**
(flag off = today's portal behavior unchanged; flag on = locked domains resolve). This is a rollout
convenience only — real access control stays in Permit, never the flag. Record the owner + removal
criterion (retire once the first locked product — FuzeSocial — is GA on its domain).

---

## Migration & risk (deploy-sensitive)

- **`master` is deploy-on-push + `required_signatures`.** Land every implementation PR via a **signed
  squash-merge in a deploy window**; never hand-deploy; prod is GitOps. This *design doc* PR is
  docs-only and carries no deploy risk.
- **Per-domain TLS / ingress / Cloudflare tunnel are FuzeInfra `@claude` delegations** — never edited
  or operated from this repo.
- **White-label billing depth is an open product decision.** "Billing/payments served behind the
  scenes" still raises *whose brand* appears on the Stripe checkout / invoice / customer portal. Fully
  white-label billing implies Stripe Connect or custom-domain checkout; a lighter option is neutral
  (un-FuzeFront-branded) payment pages. This is called out for the owner + `billing-payments-engineer`
  to decide before Phase 1 billing work; the default assumption is *neutral, non-FuzeFront* surfaces.
- **Native signing blast-radius is per-app by design.** N products ⇒ N keystores, N fingerprint pairs,
  3N secrets. Losing one key affects only that product. Keep each `twa-manifest.json` /
  `assetlinks.json` fingerprint pair in lockstep or Chrome shows the URL bar (TWA verification fails).
- **First-paint branding flash.** Because `index.html` is static, a naive runtime override can flash
  FuzeFront branding before the resolver runs — the de-brand step (neutral static defaults +
  serve-time templating) is load-bearing, not cosmetic.

---

## Critical files

- **Contract / client:** `services/app-registry-service/openapi.yaml`,
  `backend/applications/src/app-registry/manifest.schema.ts`, `apps-client/src/` (`@fuzefront/app-registry-client`),
  `services/app-registry-service/seed/examples.manifests.json`.
- **Frontend boot / surface / branding:** `frontend/src/App.tsx`, `frontend/src/main.tsx`,
  `frontend/src/platform/appManifest.ts` (`appHref`, `standaloneHost`, new `isLocked` / host-resolve),
  `frontend/src/platform/appRegistry.tsx`, `frontend/src/components/StandaloneAppSurface.tsx`
  (→ `LockedAppSurface`), `frontend/src/components/Layout.tsx` / `TopBar.tsx` / `SidePanel.tsx` /
  `AppSelector.tsx`, `frontend/src/pages/LoginPage.tsx`, `frontend/index.html`,
  `design-system/tokens/colors.css`.
- **Backend resolution:** `backend/applications/src/app-registry/{service.ts,routes/app-registry.ts,caller.ts,permit.ts}`.
- **Serving / infra (delegated):** `frontend/nginx.conf` (the proxy rules to replicate on locked hosts).
- **Native:** `android/twa-manifest.json`, `.github/workflows/build-android-apk.yml`,
  `frontend/public/.well-known/assetlinks.json`, and the precedent `shopify-nav/` tree
  (`android/twa-manifest.json`, `.well-known/assetlinks.json`, `android/generate-keystore.sh`,
  `.github/workflows/shopify-nav-apk.yml`).

---

## Verification (end-to-end)

1. **Contract:** `spectral lint services/app-registry-service/openapi.yaml` clean; the regenerated
   `@fuzefront/app-registry-client` type-checks; the Zod mirror accepts the `fuzesocial` locked
   fixture and rejects a `locked` manifest missing `routing.host` / `branding.appName`.
2. **Web white-label (the key one):** boot the shell locally against a locked host (override
   `window.location.host` / a hosts entry) and assert **only** FuzeSocial renders — branded from
   `manifest.branding`, with working same-origin login and a billing surface, and **zero** FuzeFront
   logo/wordmark/launcher/org-switcher/return-to-portal in the DOM. Run the Playwright white-label
   regression against the approved frames.
3. **Host resolution:** an unknown host resolves to a neutral 404 (never the FuzeFront portal); a known
   host resolves to exactly its product.
4. **Native:** register a second product, run the matrixed workflow, install the produced APK, and
   confirm Digital Asset Links verification succeeds (Chrome suppresses the URL bar) and the app opens
   locked to that product only.
5. **Flag both states:** with `fuzefront.platform.locked-app-mode` OFF, the portal and all existing
   `/app/:slug` + `/standalone/:slug` behavior is unchanged; ON, locked domains resolve as above.
