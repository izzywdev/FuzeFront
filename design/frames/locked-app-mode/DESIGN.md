# Locked App Mode — Detailed Design / Contract Freeze

> **Status:** contract-freeze (detailed design). This document + the frames it
> references are the **UX approval gate** for the Locked App Mode fan-out. No
> backend/UI/test/deploy code is written here — only the manifest-contract
> extension and the human-approval UX frames.
>
> Owner: `contract-designer`. Amend this PR (don't diverge) if implementation
> proves the contract wrong. Full architecture + phased plan:
> [`docs/planning/locked-app-mode.md`](../../../docs/planning/locked-app-mode.md).

## 1. What exists today (so we extend, not reinvent)

The app registry (`services/app-registry-service/openapi.yaml`, Zod mirror
`backend/applications/src/app-registry/manifest.schema.ts`, client
`@fuzefront/app-registry-client`) already models an `AppManifest` with:

- `mode: portal | standalone` — `standalone` renders **without portal chrome on
  its own host/path**, and `routing.host` already reserves a dedicated per-app
  host (the contract's own example is `clock.fuzefront.com`).
- `chrome.{menu,topbar}`, and `infra.{auth,billing,api,deployOnFuzeInfra}` — a
  per-app opt-in to platform infrastructure.
- The chrome-less render surface `frontend/src/components/StandaloneAppSurface.tsx`
  (`/standalone/:slug`) and the host-routing helpers in
  `frontend/src/platform/appManifest.ts` (`appHref`, `standaloneHost`).

The mobile precedent already ships: `shopify-nav/` is a complete, independently
signed second Trusted Web Activity (own `packageId`, keystore, `assetlinks.json`,
and workflow) — proving per-product native apps are a CI **matrix**, not a rebuild.

## 2. What locked mode adds

`standalone` renders without chrome but is **not** white-label and is
contractually required to keep a "return to portal" anti-trap control. Locked
mode is the missing third mode:

### Decision: `AppMode` gains `locked`

`enum: [portal, standalone, locked]`. A `locked` app:

- renders **white-label on its own `routing.host`** (e.g. `www.fuzesocial.com`),
- shows **no portal chrome, no 9-dots launcher, no org-switcher, and no
  return-to-portal** — nothing that reveals FuzeFront,
- opts into the **full platform infra** (authN, authZ, billing, payments,
  notifications, sockets) — all served **same-origin and hidden**.

### Decision: `AppManifest.branding` (new block)

Drives the white-label surface: `appName`, `logoUrl`, `faviconUrl`,
`themeColor`, `accentColor` (a DS `--accent-color` token override), and optional
`supportUrl` / `legalUrl` / `termsUrl` so the product owns its footer/links.
Required when `mode = locked`.

### Decision: `AppManifest.native` (new block)

Drives the per-product APK matrix: `packageId` (e.g.
`com.fuzefront.fuzesocial`), `host` (the locked domain), `iconUrls`,
`playBilling`, and `fingerprints[]` (the SHA-256 signing cert(s) — the same
values pinned in that host's `assetlinks.json`).

## 3. The four approval frames

Built in fuse-seam tokens (`tokens.css`). `frontend-test-engineer` drives
Playwright against the `data-frame` / `data-*` hooks below
(`frontend/tests/locked-app-mode-frames.spec.ts`), a self-contained `file://`
gate that needs no running stack.

| # | Frame | Demonstrates | Key hooks |
|---|-------|--------------|-----------|
| (a) | `01-white-label-login.html` | Locked-domain login, product brand only, auth hidden | `[data-mode='locked'][data-whitelabel='true']`, `[data-app='fuzesocial']` |
| (b) | `02-locked-shell.html` | Full-screen product, own chrome, **no** launcher / org-switcher / return-to-portal / FuzeFront wordmark | `[data-mode='locked'][data-chrome='none']`, `[data-launcher='absent']`, `[data-return-portal='absent']` |
| (c) | `03-locked-mobile.html` | 375px white-label surface, touch tab-bar, safe-area | `[data-mode='locked'][data-viewport='375']`, `.m-tabbar` |
| (d) | `04-native-app-home.html` | Each product its own installed app (distinct package id) | `[data-container='absent']`, `[data-app][data-packageid]` |

**White-label invariant (the gate's core assertion):** within the shipped
product surface (`.locked-login` / `.locked-app` / `.phone`) the string
"FuzeFront" never appears, and no launcher / org-switcher / return-to-portal
element is present. Design-review annotations that *do* name the platform live
strictly **outside** the product surface (`[data-role='design-annotation']`,
`.reviewer-note`) and are never shipped to end users.

## 4. Approval flow

Per `CLAUDE.md` §"Mobile design-review gate": open a GitHub Issue labeled
`design-review` linking these frames; `design-review-notify.yml` fires the
Telegram notice; the product owner comments `@claude approve`. Approving freezes
this manifest model; the Phase-1/Phase-2 fan-out in the plan then implements
against it, with the Playwright frames spec as the pre-production gate.
