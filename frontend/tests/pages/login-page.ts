import { type Page, type Locator, expect } from '@playwright/test'

export class LoginPage {
  readonly page: Page
  readonly emailInput: Locator
  readonly passwordInput: Locator
  readonly submitButton: Locator
  readonly errorMessage: Locator

  constructor(page: Page) {
    this.page = page
    this.emailInput = page.locator('input[type="email"]')
    this.passwordInput = page.locator('input[type="password"]')
    this.submitButton = page.locator('button[type="submit"]')
    this.errorMessage = page.locator(
      '.error, .alert-error, [data-testid="login-error"], .login-error'
    )
  }

  async goto() {
    await this.page.goto('/')
  }

  async login(email: string, password: string) {
    await this.emailInput.fill(email)
    await this.passwordInput.fill(password)
    await this.submitButton.click()
  }

  async waitForResponse() {
    // Wait for login API response
    await this.page.waitForTimeout(3000)
  }

  async expectLoginFormVisible() {
    await expect(this.emailInput).toBeVisible()
    await expect(this.passwordInput).toBeVisible()
    await expect(this.submitButton).toBeVisible()
  }

  async expectErrorMessage() {
    try {
      await expect(this.errorMessage).toBeVisible({ timeout: 5000 })
      return true
    } catch {
      return false
    }
  }

  async isAuthenticated(): Promise<boolean> {
    // Check localStorage for auth tokens
    return await this.page.evaluate(() => {
      return !!(
        localStorage.getItem('auth_token') ||
        localStorage.getItem('access_token') ||
        localStorage.getItem('token') ||
        sessionStorage.getItem('auth_token') ||
        sessionStorage.getItem('access_token') ||
        sessionStorage.getItem('token')
      )
    })
  }

  async hasSuccessIndicators(): Promise<boolean> {
    const successSelectors = [
      '[data-testid="dashboard"]',
      '[data-testid="user-menu"]',
      '.dashboard',
      '.user-profile',
      'nav.main-navigation',
      '.app-content:not(.login-page)',
      '.main-content',
      '.authenticated-content',
    ]

    for (const selector of successSelectors) {
      try {
        await expect(this.page.locator(selector)).toBeVisible({ timeout: 5000 })
        return true
      } catch {
        continue
      }
    }
    return false
  }
}
