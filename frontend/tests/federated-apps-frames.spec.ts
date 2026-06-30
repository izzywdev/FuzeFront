import { test, expect } from '@playwright/test'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

/**
 * PRE-PROD APPROVED-FRAMES GATE (acceptance criterion #2).
 *
 * Loads each of the four APPROVED static design frames in
 * `design/frames/federated-apps/` and asserts the key structures each frame is
 * the source of truth for. This is an INDEPENDENT structural/visual gate that
 * runs NOW with no live stack — it pins the built UI to the approved design:
 *
 *   01-app-menu          → the application menu (Apps section + launcher cards,
 *                          incl. the activated "Market" app and the "Add
 *                          application" CTA).
 *   02-register-activate → the register → activate form (manifest fields) with
 *                          the registered → activated lifecycle.
 *   03-menu-substitution → the substituted side menu (app-owned) PLUS the
 *                          host-owned, non-removable "Return to portal" control.
 *   04-standalone        → the chrome-less standalone surface (no side menu,
 *                          no topbar) with the standalone/infra markers.
 *
 * These frames are HTML fixtures, not the React app; this spec verifies the
 * APPROVED design contract. The `*.frontend.spec.ts` suite verifies the React
 * app renders the same structures against the (mocked/live) registry.
 *
 * NOTE: this spec is self-contained (file:// URLs), so it ignores the config
 * baseURL and needs no running server.
 */

// design/frames/federated-apps relative to this spec (frontend/tests/).
const FRAMES_DIR = path.resolve(
  __dirname,
  '..',
  '..',
  'design',
  'frames',
  'federated-apps'
)

function frameUrl(file: string): string {
  return pathToFileURL(path.join(FRAMES_DIR, file)).href
}

test.describe('Approved frames gate — design/frames/federated-apps', () => {
  test('01-app-menu: Apps section + launcher cards (Market activated) + Add application CTA', async ({
    page,
  }) => {
    await page.goto(frameUrl('01-app-menu.html'))

    // Frame identity.
    await expect(page.locator('body[data-frame="01-app-menu"]')).toBeAttached()

    // The page is the "Applications" menu page.
    await expect(page.locator('.page-title')).toHaveText('Applications')

    // Side-nav "Apps" section lists the registered apps incl. Market.
    await expect(page.locator('nav.side .nav-item[data-app="market"]')).toContainText(
      'Market'
    )
    await expect(page.locator('nav.side .nav-item[data-app="clock"]')).toContainText(
      'Clock'
    )

    // Launcher grid: an activated Market card with its manifest icon + label,
    // shown as a module-federation, activated app.
    const marketCard = page.locator('.launcher .app-card[data-app="market"]')
    await expect(marketCard.locator('h3')).toHaveText('Market')
    await expect(marketCard.locator('.icon')).toContainText('🛒')
    await expect(marketCard.locator('.badge.activated')).toContainText('activated')
    await expect(marketCard.locator('.badge.mf')).toContainText('module-federation')

    // The built-in Clock reference app is also present and activated.
    const clockCard = page.locator('.launcher .app-card[data-app="clock"]')
    await expect(clockCard.locator('h3')).toHaveText('Clock')
    await expect(clockCard.locator('.badge.builtin')).toContainText('built-in')

    // The "Add application" CTA opens the register → activate flow (frame 02).
    const addCta = page.locator('.launcher a.app-card[href="02-register-activate.html"]')
    await expect(addCta).toContainText('Add application')
  })

  test('02-register-activate: manifest form + registered→activated lifecycle + Register & activate action', async ({
    page,
  }) => {
    await page.goto(frameUrl('02-register-activate.html'))

    await expect(page.locator('body[data-frame="02-register-activate"]')).toBeAttached()
    await expect(page.locator('.page-title')).toHaveText('Add application')

    // The lifecycle steps: Manifest → Registered → Activated.
    const steps = page.locator('.steps .step')
    await expect(steps).toHaveCount(3)
    await expect(steps.nth(0)).toContainText('Manifest')
    await expect(steps.nth(1)).toContainText('Registered')
    await expect(steps.nth(2)).toContainText('Activated')

    // Required manifest fields are present in the form (the FuzeMarket shape).
    const labels = (await page.locator('.form-card .field label').allInnerTexts()).map(
      t => t.trim()
    )
    for (const required of [
      'Slug',
      'Menu label',
      'Display name',
      'Mode',
      'Integration type',
      'Remote entry URL',
      'Scope',
      'Module',
    ]) {
      expect(
        labels.some(l => l.startsWith(required)),
        `frame 02 form is missing the "${required}" manifest field`
      ).toBe(true)
    }

    // Pre-filled with the Market manifest (menuLabel "Market").
    await expect(
      page.locator('.form-card .field input[value="Market"]').first()
    ).toBeAttached()

    // The lifecycle strip ends in "activated → appears in the application menu".
    const lifecycle = page.locator('.lifecycle')
    await expect(lifecycle.locator('.badge.registered')).toContainText('registered')
    await expect(lifecycle.locator('.badge.activated')).toContainText('activated')
    await expect(lifecycle).toContainText('appears in the application menu')

    // The single register→activate action exists.
    await expect(
      page.locator('button[data-action="activate"]')
    ).toContainText('Register & activate')

    // The preview shows the same-origin POST endpoint.
    await expect(page.locator('.preview h4').first()).toContainText(
      '/api/v1/app-registry/apps'
    )
  })

  test('03-menu-substitution: app-owned side menu + HOST-owned non-removable Return to portal control', async ({
    page,
  }) => {
    await page.goto(frameUrl('03-menu-substitution.html'))

    await expect(page.locator('body[data-frame="03-menu-substitution"]')).toBeAttached()

    // The side menu is the APP's (substituted), marked as such.
    const side = page.locator('nav.side.substituted[data-substituted="true"]')
    await expect(side).toBeVisible()

    // App identity header is the active app (Studio) with its glyph.
    await expect(side.locator('.app-menu-head .name')).toHaveText('Studio')

    // The app's OWN menu items replace the portal menu.
    const items = side.locator('.nav-item')
    await expect(items).toHaveCount(4)
    await expect(items.nth(0)).toContainText('Files')
    await expect(items.nth(1)).toContainText('Build')
    await expect(items.nth(2)).toContainText('Deploy')
    await expect(items.nth(3)).toContainText('Settings')

    // ANTI-TRAP GUARANTEE: a host-owned, non-removable "Return to portal"
    // control is always present (marked "host", supplied by the host not the app).
    const returnControl = side.locator('.return-portal[data-app="__host_return"]')
    await expect(returnControl).toBeVisible()
    await expect(returnControl).toContainText('Return to portal')
    await expect(returnControl.locator('.lock')).toContainText('host')

    // The portal menu (Organizations / Billing …) is NOT rendered while substituted.
    await expect(side).not.toContainText('Organizations')
    await expect(side).not.toContainText('Billing')
  })

  test('04-standalone: chrome-less surface (no side menu, no topbar) + standalone/infra markers', async ({
    page,
  }) => {
    await page.goto(frameUrl('04-standalone.html'))

    await expect(page.locator('body[data-frame="04-standalone"]')).toBeAttached()

    // The standalone surface declares mode=standalone, chrome=none.
    const surface = page.locator(
      '.standalone-page[data-mode="standalone"][data-chrome="none"]'
    )
    await expect(surface).toBeVisible()

    // NO portal chrome: no side menu, no portal topbar (the shell header).
    await expect(page.locator('nav.side')).toHaveCount(0)
    await expect(page.locator('header.topbar')).toHaveCount(0)

    // It's an actual app surface (hero + CTA), edge to edge.
    await expect(page.locator('.hero h1')).toBeVisible()
    await expect(page.locator('.hero .cta button')).toHaveCount(2)

    // Infra opt-in markers: deployOnFuzeInfra ON, auth/billing/api opted out.
    await expect(page.locator('.infra-strip .infra-chip.on')).toContainText(
      'deployOnFuzeInfra'
    )
    await expect(page.locator('.infra-strip .infra-chip.off')).toHaveCount(3)
  })
})
