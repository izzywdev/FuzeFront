import { test, expect } from '@playwright/test'

/**
 * Mobile layout e2e — runs under the `mobile` Playwright project (375×812, touch).
 *
 * Verifies the shell's responsive behaviour: hamburger button visible, drawer
 * sidebar opens/closes, content area is full-width when sidebar is closed.
 *
 * Login is required — the authenticated layout renders the hamburger/sidebar.
 *
 * Credentials come from the environment, mirroring auth-simple.spec.ts: sign-in is
 * brokered through the identity provider, so the account must exist in Authentik.
 */

const EMAIL = process.env.E2E_USER_EMAIL ?? 'admin@fuzefront.dev'
const PASSWORD = process.env.E2E_USER_PASSWORD ?? 'admin123'

test.describe('Mobile layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    // Log in so the authenticated shell (with hamburger + sidebar) renders
    await page.fill('input[type="email"]', EMAIL)
    await page.fill('input[type="password"]', PASSWORD)
    await Promise.all([
      // Login goes through the Security API (POST /api/v1/security/session);
      // match the method so GET /session ("me") cannot satisfy the wait early.
      page.waitForResponse(
        r =>
          r.url().includes('/api/v1/security/session') &&
          r.request().method() === 'POST' &&
          r.status() === 200,
        { timeout: 15000 }
      ),
      page.click('button[type="submit"]'),
    ])
    // Wait for the authenticated layout (incl. WorkspaceProvisioningGate) to render
    await expect(page.locator('input[type="email"]')).not.toBeVisible({ timeout: 10000 })
    // Allow WorkspaceProvisioningGate to resolve the personal-org poll
    await page.waitForSelector('.hamburger-btn', { timeout: 15000 })
  })

  test('hamburger button is visible on mobile', async ({ page }) => {
    const hamburger = page.locator('.hamburger-btn')
    await expect(hamburger).toBeVisible()
  })

  test('sidebar is hidden by default on mobile', async ({ page }) => {
    const sidebar = page.locator('.side-panel')
    // Sidebar should exist in DOM but not be in the open/translated-in position
    await expect(sidebar).not.toHaveAttribute('data-open', 'true')
  })

  test('sidebar opens when hamburger is clicked', async ({ page }) => {
    const hamburger = page.locator('.hamburger-btn')
    const sidebar = page.locator('.side-panel')

    await hamburger.click()
    await expect(sidebar).toHaveAttribute('data-open', 'true')
  })

  test('sidebar closes when scrim is clicked', async ({ page }) => {
    const hamburger = page.locator('.hamburger-btn')
    const sidebar = page.locator('.side-panel')
    const scrim = page.locator('.sidebar-scrim')

    await hamburger.click()
    await expect(sidebar).toHaveAttribute('data-open', 'true')

    await scrim.click()
    await expect(sidebar).toHaveAttribute('data-open', 'false')
  })

  test('content area is full-width when sidebar is closed', async ({ page }) => {
    const contentArea = page.locator('.content-area')
    const viewport = page.viewportSize()!

    const box = await contentArea.boundingBox()
    expect(box).not.toBeNull()
    // Content area should occupy essentially the full viewport width when sidebar is closed
    expect(box!.width).toBeGreaterThan(viewport.width * 0.9)
  })

  test('hamburger button meets 44x44 touch target requirement', async ({ page }) => {
    const hamburger = page.locator('.hamburger-btn')
    const box = await hamburger.boundingBox()

    expect(box).not.toBeNull()
    expect(box!.width).toBeGreaterThanOrEqual(44)
    expect(box!.height).toBeGreaterThanOrEqual(44)
  })
})
