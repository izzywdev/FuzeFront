import { test, expect } from '@playwright/test'

test.describe('Authentication - Simple', () => {
  test('should successfully authenticate', async ({ page }) => {
    // Navigate to the app
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Verify login form is present
    await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 10000 })
    await expect(page.locator('input[type="password"]')).toBeVisible({ timeout: 10000 })

    // Fill credentials
    await page.fill('input[type="email"]', 'admin@fuzefront.dev')
    await page.fill('input[type="password"]', 'admin123')

    // Wait for login response and submit
    const responsePromise = page.waitForResponse(
      response => response.url().includes('/api/auth/login') && response.status() === 200,
      { timeout: 15000 }
    )

    await page.click('button[type="submit"]')
    
    // Wait for successful login response
    const response = await responsePromise
    expect(response.status()).toBe(200)

    // Wait for authentication to complete
    await page.waitForLoadState('networkidle')
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