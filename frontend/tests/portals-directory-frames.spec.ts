import { test, expect } from '@playwright/test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

// `frontend/package.json` sets `"type": "module"`, so this file runs as ESM
// under Playwright's transform — `__dirname` is not defined here (unlike the
// pre-existing sibling frame specs, which reference it and fail the same way
// when actually invoked; see this spec's PR description). Derive the same
// thing from `import.meta.url` instead.
const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * PRE-PROD APPROVED-FRAMES GATE (frontend-test-engineer, INDEPENDENT of the
 * implementer) — Portals Directory.
 *
 * Loads the two APPROVED static design frames in
 * `design/frames/portals-directory/` and asserts the structures they are the
 * source of truth for:
 *
 *   01-portals-list         → the populated directory: tier/status badges,
 *                             domain, cursor pagination ("Load more"), and the
 *                             real `<a target="_blank" rel="noopener noreferrer">`
 *                             launch anchor to the portal's OWN host.
 *   02-portals-list-states  → all six contract states: loading (aria-busy),
 *                             empty, error+retry, the explicit new-tab launch
 *                             hint, suspended (no enabled launch), and the
 *                             fail-closed permission-denied/read-only case.
 *
 * Self-contained (file:// URLs) — ignores the config baseURL, needs no
 * running server. Picked up automatically by the ROOT `playwright.config.ts`
 * frames gate (`testMatch: /-frames\.spec\.ts$/`).
 */

const FRAMES_DIR = path.resolve(
  __dirname,
  '..',
  '..',
  'design',
  'frames',
  'portals-directory'
)

function frameUrl(file: string): string {
  return pathToFileURL(path.join(FRAMES_DIR, file)).href
}

test.describe('Approved frames gate — design/frames/portals-directory', () => {
  test('01-portals-list: directory panel, tier/status badges, domains, launch anchors, pagination', async ({
    page,
  }) => {
    await page.goto(frameUrl('01-portals-list.html'))

    await expect(page.locator('[data-frame="01-portals-list"]')).toBeAttached()
    await expect(page.locator('[data-panel="portals-directory"]')).toBeVisible()
    await expect(page.locator('h2')).toHaveText('Portals you manage')

    // Search field is the real testHook.
    await expect(page.locator('[data-input="search"]')).toBeVisible()

    // The directory list.
    const list = page.locator('[data-list="portals"][role="list"]')
    await expect(list).toBeVisible()
    const rows = list.locator('[role="listitem"]')
    await expect(rows).toHaveCount(4)

    // --- soft tier, custom domain (Northwind) ---
    const northwind = page.locator('[data-portal="prt_northwind"]')
    await expect(northwind).toHaveAttribute('data-tier', 'soft')
    await expect(northwind).toHaveAttribute('data-status', 'active')
    await expect(northwind.locator('[data-portal-status="active"]')).toContainText('Active')
    await expect(northwind.locator('[data-domain="primary"]')).toHaveText(
      'portal.northwind.example'
    )
    const northwindLink = northwind.locator('[data-action="open-portal"]')
    await expect(northwindLink).toHaveAttribute('href', 'https://portal.northwind.example/')
    await expect(northwindLink).toHaveAttribute('target', '_blank')
    await expect(northwindLink).toHaveAttribute('rel', 'noopener noreferrer')
    // Real anchor, never a button / never window.open.
    await expect(northwindLink).toHaveJSProperty('tagName', 'A')

    // --- soft tier, no custom domain -> root host /p/{slug} path route ---
    const initech = page.locator('[data-portal="prt_initech"]')
    await expect(initech).toHaveAttribute('data-tier', 'soft')
    await expect(initech.locator('[data-domain="primary"]')).toHaveText(
      'app.fuzefront.com/p/initech'
    )
    await expect(initech).toContainText('no custom domain')
    await expect(initech.locator('[data-action="open-portal"]')).toHaveAttribute(
      'href',
      'https://app.fuzefront.com/p/initech'
    )

    // --- hard tier (own Authentik instance) ---
    const mendys = page.locator('[data-portal="prt_mendys"]')
    await expect(mendys).toHaveAttribute('data-tier', 'hard')
    await expect(mendys).toContainText('own IdP')
    const mendysLink = mendys.locator('[data-action="open-portal"]')
    await expect(mendysLink).toHaveAttribute('href', 'https://live.mendysrobotics.com/')
    await expect(mendysLink).toHaveAttribute('target', '_blank')
    await expect(mendysLink).toHaveAttribute('rel', 'noopener noreferrer')

    // --- suspended: NO enabled launch anchor, a disabled button instead ---
    const acme = page.locator('[data-portal="prt_acme"]')
    await expect(acme).toHaveAttribute('data-status', 'suspended')
    await expect(acme.locator('[data-portal-status="suspended"]')).toContainText('Suspended')
    const acmeAction = acme.locator('[data-action="open-portal"]')
    await expect(acmeAction).toHaveJSProperty('tagName', 'BUTTON')
    await expect(acmeAction).toBeDisabled()

    // Cursor pagination — "Load more" testHook.
    await expect(page.locator('[data-action="load-more"]')).toContainText('Load more')
  })

  test('02-portals-list-states: loading / empty / error+retry / launch-hint / suspended / fail-closed 403', async ({
    page,
  }) => {
    await page.goto(frameUrl('02-portals-list-states.html'))
    await expect(page.locator('[data-frame="02-portals-list-states"]')).toBeAttached()

    // d1 · loading — aria-busy skeleton.
    const loading = page.locator('[data-state="loading"]')
    await expect(loading.locator('.panel[aria-busy="true"]')).toBeAttached()

    // d2 · empty — a REAL non-error state (no [role="alert"] inside it).
    const empty = page.locator('[data-state="empty"]')
    await expect(empty).toContainText('No portals to manage')
    await expect(empty.locator('[role="alert"]')).toHaveCount(0)

    // d3 · error + retry — never a sign-in redirect; session-intact copy.
    const error = page.locator('[data-state="error"]')
    await expect(error.locator('[role="alert"]')).toContainText("Couldn't load your portals")
    await expect(error).toContainText('this is a load error, not a sign-out')
    await expect(error.locator('[data-action="retry"]')).toContainText('Retry')

    // d4 · the launch action is unmistakably external (new tab + explicit hint).
    const launchHint = page.locator('[data-state="launch-hint"]')
    const hintLink = launchHint.locator('[data-action="open-portal"]')
    await expect(hintLink).toHaveAttribute('target', '_blank')
    await expect(hintLink).toHaveAttribute('rel', 'noopener noreferrer')
    await expect(launchHint).toContainText('opens portal.northwind.example in a new tab')

    // d5 · suspended row — no ENABLED launch affordance anywhere in the block.
    const suspended = page.locator('[data-state="suspended"]')
    await expect(suspended.locator('a[data-action="open-portal"]')).toHaveCount(0)
    const suspendedBtn = suspended.locator('button[data-action="open-portal"]')
    await expect(suspendedBtn).toBeDisabled()

    // d6 · fail-closed permission-denied / read-only.
    const forbidden = page.locator('[data-state="forbidden"]')
    await expect(forbidden).toHaveAttribute('data-http', '403')
    await expect(forbidden).toHaveAttribute('data-error-code', 'FORBIDDEN')
    await expect(forbidden.locator('[data-panel="permission-denied"]')).toContainText(
      "You don't have permission to open portals"
    )
    await expect(forbidden).toContainText('you have')
    await expect(forbidden).toContainText('not')
    await expect(forbidden).toContainText('been signed out')
    // ZERO launch anchors/buttons anywhere in the fail-closed block — the
    // launch column is the read-only "— no access —" hook, never an
    // anchor/button.
    await expect(forbidden.locator('a[data-action="open-portal"]')).toHaveCount(0)
    await expect(forbidden.locator('button[data-action="open-portal"]')).toHaveCount(0)
    await expect(forbidden.locator('[data-action-absent="open-portal"]')).toHaveCount(2)
    // The frame's read-only projection: rows stay visible (name/domain/tier)
    // but flagged read-only — this is `manifest.json`'s `[data-readonly='true']`
    // testHook. See portals-directory.frontend.spec.ts for whether the BUILT
    // app reproduces this (it does not — reported as a frame/build mismatch).
    await expect(forbidden.locator('[data-list="portals"][data-readonly="true"]')).toBeVisible()
    await expect(forbidden.locator('[data-can-open="false"]')).toHaveCount(2)
  })
})
