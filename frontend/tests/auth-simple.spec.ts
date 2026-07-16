import { test, expect } from '@playwright/test'

// Credentials come from the environment so this spec can run against the FULL
// stack, where the account must exist in the identity provider. Sign-in is
// brokered through that provider — a bcrypt row seeded straight into the
// platform DB is NOT a credential it will accept, which is why the hardcoded
// admin@fuzefront.dev default only works against a local-auth stack.
const EMAIL = process.env.E2E_USER_EMAIL ?? 'admin@fuzefront.dev'
const PASSWORD = process.env.E2E_USER_PASSWORD ?? 'admin123'

test.describe('Authentication - Simple', () => {
  test('should successfully authenticate', async ({ page }) => {
    // Navigate to the app
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    // Verify login form is present
    await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 10000 })
    await expect(page.locator('input[type="password"]')).toBeVisible({ timeout: 10000 })

    // Fill credentials
    await page.fill('input[type="email"]', EMAIL)
    await page.fill('input[type="password"]', PASSWORD)

    // Wait for login response and submit.
    // The SPA logs in via the provider-agnostic Security API (POST
    // /api/v1/security/session), not the deprecated /api/auth/login. Match the
    // METHOD too — GET /session ("me") hits the same URL and would otherwise
    // satisfy this wait before the login round-trip completes.
    const responsePromise = page.waitForResponse(
      response =>
        response.url().includes('/api/v1/security/session') &&
        response.request().method() === 'POST' &&
        response.status() === 200,
      { timeout: 15000 }
    )

    await page.click('button[type="submit"]')
    
    // Wait for successful login response
    const response = await responsePromise
    expect(response.status()).toBe(200)

    // Wait for authentication to complete
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(3000)

    // Verify authentication token is set
    const hasToken = await page.evaluate(() => !!localStorage.getItem('authToken'))
    expect(hasToken).toBeTruthy()

    // Verify we're no longer on login page
    await expect(page.locator('input[type="email"]')).not.toBeVisible({ timeout: 5000 })

    // Verify authenticated UI is present (any of these indicates success)
    const uiElements = [
      page.locator('.app-layout'),
      page.locator('.top-bar'),
      page.locator('.main-content')
    ]

    let uiFound = false
    for (const element of uiElements) {
      try {
        await expect(element).toBeVisible({ timeout: 5000 })
        uiFound = true
        break
      } catch {
        // Continue to next element
      }
    }

    expect(uiFound).toBeTruthy()

    // Take screenshot for verification
    await page.screenshot({ path: 'test-results/auth-simple-success.png', fullPage: true })
  })
}) 