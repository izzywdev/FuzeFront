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
    // Wait for the page to be fully loaded
    await this.page.waitForLoadState('networkidle')
  }

  async login(email: string, password: string) {
    // Fill form fields with small delays
    await this.emailInput.fill(email)
    await this.page.waitForTimeout(100)
    await this.passwordInput.fill(password)
    await this.page.waitForTimeout(100)
    
    // Wait for any potential API calls to complete before submitting
    await this.page.waitForLoadState('networkidle')
    
    // Click submit and wait for the request
    const responsePromise = this.page.waitForResponse(
      response => response.url().includes('/api/auth/login') && response.status() !== 0,
      { timeout: 10000 }
    )
    
    await this.submitButton.click()
    
    // Wait for the login API response
    try {
      await responsePromise
    } catch (error) {
      console.log('Login API response timeout, continuing with test...')
    }
  }

  async waitForResponse() {
    // Wait for any pending network requests and DOM updates
    await this.page.waitForLoadState('networkidle')
    
    // Additional wait for React state updates and potential redirects
    await this.page.waitForTimeout(2000)
    
    // Wait for any potential navigation/redirect
    await this.page.waitForLoadState('domcontentloaded')
  }

  async expectLoginFormVisible() {
    await expect(this.emailInput).toBeVisible({ timeout: 10000 })
    await expect(this.passwordInput).toBeVisible({ timeout: 10000 })
    await expect(this.submitButton).toBeVisible({ timeout: 10000 })
  }

  async expectErrorMessage() {
    try {
      await expect(this.errorMessage).toBeVisible({ timeout: 8000 })
      return true
    } catch {
      return false
    }
  }

  async isAuthenticated(): Promise<boolean> {
    // Wait a bit for localStorage to be updated
    await this.page.waitForTimeout(500)
    
    // Check localStorage for auth tokens (including the actual token name used by the app)
    return await this.page.evaluate(() => {
      return !!(
        localStorage.getItem('authToken') ||  // This is the actual token name used by the app
        localStorage.getItem('authToken') ||
        localStorage.getItem('access_token') ||
        localStorage.getItem('token') ||
        sessionStorage.getItem('authToken') ||
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
      '.app-layout',
      '.app-content:not(.login-page)',
      '.main-content',
      '.authenticated-content',
      '.top-bar',  // The top bar should appear after login
      '.side-panel', // The side panel should appear after login
    ]

    // Wait for any of these selectors to appear
    for (const selector of successSelectors) {
      try {
        await expect(this.page.locator(selector)).toBeVisible({ timeout: 8000 })
        return true
      } catch {
        continue
      }
    }
    
    // Also check if we're no longer on the login page
    try {
      // If login form is no longer visible, that's also a success indicator
      await expect(this.emailInput).not.toBeVisible({ timeout: 3000 })
      return true
    } catch {
      // Login form is still visible
    }
    
    return false
  }

  async waitForAuthenticationComplete() {
    // Wait for either authentication success or failure
    const maxWaitTime = 15000
    const startTime = Date.now()
    
    while (Date.now() - startTime < maxWaitTime) {
      // Check if authenticated
      if (await this.isAuthenticated()) {
        return true
      }
      
      // Check if we have success UI indicators
      if (await this.hasSuccessIndicators()) {
        return true
      }
      
      // Check if there's an error message
      if (await this.expectErrorMessage()) {
        return false
      }
      
      // Wait a bit before checking again
      await this.page.waitForTimeout(500)
    }
    
    // Timeout reached
    return false
  }
}
