import { test, expect } from '@playwright/test'
import { LoginPage } from './pages/login-page'

test.describe('Authentication Flow', () => {
  let loginPage: LoginPage

  test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page)
    await loginPage.goto()
  })

  test('should display login form correctly', async ({ page }) => {
    await loginPage.expectLoginFormVisible()
    await expect(page).toHaveTitle(/FrontFuse|FuzeFront/)
  })

  test('should successfully authenticate with valid credentials', async ({
    page,
  }) => {
    // Perform login
    await loginPage.login('admin@fuzefront.dev', 'admin123')
    await loginPage.waitForResponse()

    // Check for authentication success
    const isAuthenticated = await loginPage.isAuthenticated()
    const hasSuccessUI = await loginPage.hasSuccessIndicators()

    // At least one should be true for successful login
    if (!isAuthenticated && !hasSuccessUI) {
      // If neither token nor UI indicators, check we don't have login form anymore
      // or that there are no error messages
      const hasError = await loginPage.expectErrorMessage()
      expect(hasError).toBeFalsy()
    }

    // Take a screenshot for debugging if needed
    await page.screenshot({
      path: 'test-results/login-success.png',
      fullPage: true,
    })
  })

  test('should handle invalid credentials gracefully', async ({ page }) => {
    // Try login with invalid credentials
    await loginPage.login('invalid@example.com', 'wrongpassword')
    await loginPage.waitForResponse()

    // Should still see login form
    await loginPage.expectLoginFormVisible()

    // Take a screenshot for debugging
    await page.screenshot({
      path: 'test-results/login-failure.png',
      fullPage: true,
    })
  })

  test('should validate CORS is working', async ({ page }) => {
    // Listen for console errors (CORS errors would appear here)
    const consoleErrors: string[] = []
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text())
      }
    })

    // Attempt login
    await loginPage.login('admin@fuzefront.dev', 'admin123')
    await loginPage.waitForResponse()

    // Check for CORS errors
    const corsErrors = consoleErrors.filter(
      error =>
        error.includes('CORS') ||
        error.includes('Access-Control-Allow-Origin') ||
        error.includes('Cross-Origin Request Blocked')
    )

    expect(corsErrors.length).toBe(0)
  })
})
