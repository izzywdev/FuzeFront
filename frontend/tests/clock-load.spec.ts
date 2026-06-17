import { test, expect } from '@playwright/test'

// Verifies a registered microfrontend (FuzeClock) loads at runtime via Module
// Federation and renders inside the host shell.
test('FuzeClock loads at runtime via Module Federation', async ({ page }) => {
  // sign in
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

  // find FuzeClock in the registry
  const appId = await page.evaluate(async () => {
    const token = localStorage.getItem('authToken')
    const res = await fetch('/api/apps', {
      headers: { Authorization: `Bearer ${token}` },
    })
    return (await res.json()).find((x: any) => x.name === 'FuzeClock')?.id
  })
  expect(appId, 'FuzeClock must be registered').toBeTruthy()

  // load the federated remote
  await page.goto(`/app/${appId}`)

  // The remote's own content (unique to clock-app) must render — proving the
  // runtime Module Federation load succeeded, not the error boundary.
  await expect(
    page.getByText('No build-time knowledge of the host')
  ).toBeVisible({ timeout: 20000 })
  await expect(page.getByText('Failed to Load App')).toHaveCount(0)
})
