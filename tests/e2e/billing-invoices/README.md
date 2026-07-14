# Billing "Invoice history" — independent front-end verification

Owned by `frontend-test-engineer` (independent of the UI implementer). This is
the **INDEPENDENT** e2e verification for the vendor-neutral, DB-backed invoice
history UI (`@fuzefront/billing-ui → InvoiceHistoryPanel`, flag
`fuzefront.billing.invoice-history`).

The React component is **not built yet** (gated on UX approval), so today this
directory ships two of the three verification phases:

| Phase | Spec | Runs against | Status |
|-------|------|--------------|--------|
| Pre-production (frozen frames) | `frames.spec.ts` | `design/frames/billing-invoices/*.html` over `file://` | **active — GREEN** |
| Built-app pre-production | _(added when the component ships)_ | React panel on an ephemeral kind stack / contract mock | pending component |
| Post-production smoke | `postprod.smoke.spec.ts` | live `BASE_URL` (e.g. `https://app.fuzefront.com`) | skeleton — `@postprod`, skips w/o creds |

The stable selectors are the manifest `testHooks` / `data-*` attributes in
`design/frames/billing-invoices/manifest.json` — the frozen visual/structural
contract the implementation is checked against.

## Setup

This is a **self-contained** package (it does NOT depend on a root
`npm install`). Install its Playwright once:

```bash
cd tests/e2e/billing-invoices
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install   # @playwright/test only; Chromium is preinstalled
```

Chromium is preinstalled (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`) — do NOT
run `playwright install`.

## Pre-production (frozen frames) — no stack, no server

```bash
cd tests/e2e/billing-invoices
npx playwright test -c playwright.config.ts frames.spec.ts
# or, from the repo root:
npx playwright test -c tests/e2e/billing-invoices/playwright.config.ts frames.spec.ts
```

> The repo-root `playwright.config.ts` is dedicated to the **federated-apps**
> frames gate (`testMatch: federated-apps-frames`) and deliberately does not pick
> up this feature's specs — always pass `-c` to this directory's config.

This asserts the frozen contract via the `data-*` hooks:

- `01-invoice-history`: `[data-panel='invoice-history']` present; exactly 4
  `[data-invoice]` rows; `FF-2026-0042` is `[data-status='paid']`; every row has a
  `[data-download]` link with an accessible name; `[data-action='load-more']`
  present; **no vendor name** (`stripe`/`link`) anywhere in the panel DOM.
- `02-states`: `[data-state='loading']`, `[data-state='empty']` (+ `[data-empty]`),
  `[data-state='error']` (+ `[data-action='retry']`), and
  `[data-status='uncollectible']` all present.
- Manifest-driven: every declared `testHook` selector resolves in its frame, and
  the entry `index.html` links to both frames in order.

## Post-production smoke — live app

Skips cleanly unless `BASE_URL` **and** credentials are set:

```bash
BASE_URL=https://app.fuzefront.com \
E2E_USER_EMAIL=… E2E_USER_PASSWORD=… \
npx playwright test -c tests/e2e/billing-invoices/playwright.config.ts -g @postprod
```

Flow: sign-in (server-side password → platform JWT → `localStorage.authToken`,
the repo's existing convention) → navigate to `/billing` → assert the invoice
panel renders → a download link points at an `https://` provider-hosted URL →
no vendor name leaks. `BACKEND_URL` defaults to `BASE_URL` (same-origin API
base in prod); override only for split hosts.

## Once the built app lands

Add a `built-app.spec.ts` here that drives the real React `InvoiceHistoryPanel`
against the mounted app (contract mock until the backend lands, then the
ephemeral kind stack), using the same `data-*` hooks. The frames gate stays as
the design-conformance check.
