import { test, expect } from '@playwright/test'

// Real user path proving the built-in Clock federated app actually MOUNTS (issue
// #132): sign in, open the 9-dots launcher, click the Clock card, and verify the
// federated remote renders its own UI inside the host — i.e. the shell is NOT
// stuck on the "Loading application…" spinner and did NOT fall back to the
// "Failed to Load App" error.
//
// The menu card shows the manifest `menuLabel` ("Clock"); the remote's mounted
// content shows its own heading ("🕒 FuzeClock") + a note unique to clock-app.
test('Clock mounts from the launcher at runtime', async ({ page }) => {
  let dialogMessage = ''
  page.on('dialog', d => {
    dialogMessage = d.message()
    d.dismiss().catch(() => {})
  })
  const consoleErrors: string[] = []
  const consoleLogs: string[] = []
  page.on('console', m => {
    if (m.type() === 'error') consoleErrors.push(m.text())
    // Capture all logs for diagnostic output on failure
    consoleLogs.push(`[${m.type()}] ${m.text()}`)
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

  // The activated-apps list MUST resolve same-origin (the host /api/v1/app-registry
  // proxy → applications-service). A 404 here is the #132 root cause and leaves
  // the launcher empty.
  await page.waitForResponse(
    r =>
      r.url().includes('/api/v1/app-registry/apps') && r.status() === 200,
    { timeout: 10000 }
  )

  // Dump org API response for diagnostics — before trying to click the launcher
  const orgsResp = await page.evaluate(async () => {
    try {
      const token = localStorage.getItem('authToken')
      const r = await fetch('http://localhost:3001/api/organizations', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      const text = await r.text()
      return { status: r.status, body: text.substring(0, 500) }
    } catch (e: any) {
      return { status: -1, body: String(e) }
    }
  })
  console.log('[DIAG] /api/organizations response:', JSON.stringify(orgsResp))
  console.log('[DIAG] authToken in localStorage:', await page.evaluate(() => {
    const t = localStorage.getItem('authToken')
    return t ? t.substring(0, 30) + '...' : 'null'
  }))

  // --- open the 9-dots launcher and click the Clock card (the real path) ---
  // The CI workflow registers the app as "FuzeClock" (name → manifest.menuLabel).
  await page.locator('button.app-grid-button').click()
  await page.getByText('FuzeClock', { exact: true }).first().click()

  // Gate opened — dump recent console logs for visibility
  const recentLogs = consoleLogs.slice(-20)
  if (recentLogs.length > 0) {
    console.log('[DIAG] Last 20 console messages before launcher click:\n  ' + recentLogs.join('\n  '))
  }

  // The launcher must NOT have blocked it with an "unavailable" alert.
  await page.waitForTimeout(500)
  expect(dialogMessage, `unexpected dialog popup: "${dialogMessage}"`).toBe('')

  // Surface any console errors collected so far — if the MF load failed, these show why.
  await page.waitForTimeout(3000)
  if (consoleErrors.length > 0) {
    console.log('[DIAG] Console errors before MF render check:\n  - ' + consoleErrors.join('\n  - '))
  }

  // The remote's own content (unique to clock-app) must render — proving the
  // runtime Module Federation load + shared-React singleton succeeded inside the
  // host, not the spinner or the error UI.
  await expect(
    page.getByText('No build-time knowledge of the host')
  ).toBeVisible({ timeout: 20000 })
  await expect(page.getByText('Failed to Load App')).toHaveCount(0)
  await expect(page.getByText('Loading application...')).toHaveCount(0)

  // Surface any console errors for visibility (not a hard failure here).
  if (consoleErrors.length) {
    console.log('Console errors during load:\n - ' + consoleErrors.join('\n - '))
  }
})
