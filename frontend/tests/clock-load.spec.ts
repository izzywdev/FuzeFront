import { test, expect } from '@playwright/test'

// Real user path: sign in, open the 9-dots launcher, click FuzeClock, and verify
// the federated remote renders inside the host (no "app unavailable" alert).
test('FuzeClock loads from the launcher at runtime', async ({ page }) => {
  let dialogMessage = ''
  page.on('dialog', d => {
    dialogMessage = d.message()
    d.dismiss().catch(() => {})
  })
  const consoleErrors: string[] = []
  page.on('console', m => {
    if (m.type() === 'error') consoleErrors.push(m.text())
  })

  // --- sign in ---
  await page.goto('/')
  await page.waitForLoadState('domcontentloaded')
  await page.fill('input[type="email"]', 'admin@fuzefront.dev')
  await page.fill('input[type="password"]', 'admin123')
  await Promise.all([
    page.waitForResponse(
      r => r.url().includes('/api/auth/login') && r.status() === 200
    ),
    page.click('button[type="submit"]'),
  ])
  await expect(page.locator('input[type="email"]')).not.toBeVisible({
    timeout: 10000,
  })

  // --- open the 9-dots launcher and click FuzeClock (the real path) ---
  await page.locator('button.app-grid-button').click()
  await page.getByText('FuzeClock', { exact: true }).first().click()

  // The launcher must NOT have blocked it with an "unavailable" alert.
  await page.waitForTimeout(500)
  expect(dialogMessage, `unexpected dialog popup: "${dialogMessage}"`).toBe('')

  // Surface any console errors collected so far before the slow assertion —
  // if the MF load itself fails, these errors explain why.
  await page.waitForTimeout(3000)
  if (consoleErrors.length > 0) {
    console.log('[DIAG] Console errors before MF render check:\n  - ' + consoleErrors.join('\n  - '))
  }

  // The remote's own content (unique to clock-app) must render — proving the
  // runtime Module Federation load succeeded inside the host, not the error UI.
  await expect(
    page.getByText('No build-time knowledge of the host')
  ).toBeVisible({ timeout: 20000 })
  await expect(page.getByText('Failed to Load App')).toHaveCount(0)
})