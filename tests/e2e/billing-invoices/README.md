# Billing "Invoice history" — independent front-end verification

Owned by `frontend-test-engineer` (independent of the UI implementer). This is
the **INDEPENDENT** e2e verification for the vendor-neutral, DB-backed invoice
history UI (`@fuzefront/billing-ui → InvoiceHistoryPanel`, flag
`fuzefront.billing.invoice-history`).

The React component now **exists** (`InvoiceHistoryPanel`, verified by billing-ui
vitest), so this directory ships all three verification phases:

| Phase | Spec | Runs against | Status |
|-------|------|--------------|--------|
| Pre-production (frozen frames) | `frames.spec.ts` | `design/frames/billing-invoices/*.html` over `file://` | **active — GREEN** |
| Built-app pre-production | `built-component.spec.ts` | the REAL React `InvoiceHistoryPanel` (esbuild bundle + mocked `listInvoices`) over `file://` | **active — GREEN** (skips cleanly if harness deps absent) |
| Post-production smoke | `postprod.smoke.spec.ts` | live `BASE_URL` (e.g. `https://app.fuzefront.com`) | `@postprod`, skips w/o creds |

The stable selectors are the manifest `testHooks` / `data-*` attributes in
`design/frames/billing-invoices/manifest.json` — the frozen visual/structural
contract the implementation is checked against.

## Setup

This is a **self-contained** package (it does NOT depend on a root
`npm install`). Install its deps once:

```bash
cd tests/e2e/billing-invoices
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install   # @playwright/test + built-component harness deps
```

Chromium is preinstalled (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`) — do NOT
run `playwright install`.

The built-component harness (`built-component.spec.ts`) needs `esbuild` + `react`
+ `react-dom` (declared in this package's `devDependencies`). If they cannot be
resolved, that spec **skips cleanly** with the exact install command — it never
hard-fails.

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

## Built-app pre-production — the REAL React component

`built-component.spec.ts` mounts the actual `@fuzefront/billing-ui →
InvoiceHistoryPanel` (imported from source, bundled by esbuild) with a stubbed
`listInvoices`, over `file://`, and asserts the SAME `data-*` acceptance contract
the frames assert — proving the implementation matches the approved frames.

```bash
cd tests/e2e/billing-invoices
npx playwright test -c playwright.config.ts built-component.spec.ts
```

It exercises the live component states via `harness/entry.tsx` (scenario chosen
from `location.hash`): `populated` (rows, paid/open/void/uncollectible status
pills, accessible download links, load-more present), `loadmore` (fetch +
append next cursor page), `empty`, `loading`, and `error` + retry recovery — and
asserts **no vendor name** (`stripe`/`link`) leaks in any state. React is
force-aliased to a single copy so billing-ui's local `node_modules` React cannot
trigger a duplicate-React "invalid hook call".

The build output (`.harness/`) is git-ignored. The frames gate stays as the
static design-conformance check alongside this built-app check.
