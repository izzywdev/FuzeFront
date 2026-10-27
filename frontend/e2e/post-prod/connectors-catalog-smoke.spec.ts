import { test, expect } from '@playwright/test'
import { seedMockSession } from '../../tests/support/account-vault'

// Release floor independent of the live API: comparing the UI only to a stale
// one-provider API would let the original Gmail-only production defect pass.
const EXPECTED_IDS = [
  'google-drive', 'google-calendar', 'google-contacts',
  'microsoft-outlook', 'microsoft-onedrive', 'microsoft-teams',
  'slack', 'notion', 'github', 'dropbox',
  'google-sheets', 'google-docs', 'google-slides', 'google-tasks',
  'microsoft-sharepoint', 'microsoft-todo', 'jira-cloud', 'confluence-cloud',
  'linear', 'trello', 'openai', 'anthropic', 'gemini', 'vercel', 'lovable',
]

interface CatalogEntry {
  id: string
  name: string
  authentication: 'oauth' | 'api-key'
  configured: boolean
}

// Keep successful visual proof too. Traces can contain session headers;
// this credentialed journey publishes screenshots/video and a safe inventory.
test.use({ video: 'on', trace: 'off', navigationTimeout: 30_000, actionTimeout: 20_000 })

test.describe('Connectors — live post-production UX', () => {
  test('all released connectors appear with working status controls', async ({ page, request }, testInfo) => {
    test.setTimeout(180_000)
    const password = process.env.POST_PROD_PASSWORD
    expect(password, 'POST_PROD_PASSWORD is required: missing connector coverage must fail, not skip').toBeTruthy()
    // Existing synthetic only: no signup, password reset, grants, or provider mutations.
    const session = await request.post('/api/v1/security/session', {
      timeout: 30_000,
      data: { email: process.env.POST_PROD_EMAIL || 'postprod-smoke@fuzefront.com', password },
    })
    expect(session.status(), 'production synthetic sign-in failed').toBe(200)
    const { token } = await session.json() as { token?: string }
    expect(typeof token, 'production sign-in returned no session token').toBe('string')
    expect(token?.length).toBeGreaterThan(0)
    await page.addInitScript(seedMockSession, token!)

    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('/dashboard')
    const nav = page.getByText('Connectors', { exact: true })
    await expect(nav).toBeVisible()
    const [response] = await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/connectors/catalog' && response.request().method() === 'GET'),
      nav.click(),
    ])
    await page.waitForURL('**/connectors')
    await expect(page.getByRole('heading', { name: 'Connectors', level: 1, exact: true })).toBeVisible()

    expect(response.status(), 'live connector catalog failed').toBe(200)
    const { connectors } = await response.json() as { connectors: CatalogEntry[] }
    expect(Array.isArray(connectors), 'catalog must return a connector array').toBe(true)
    const ids = connectors.map(entry => entry.id)
    expect(new Set(ids).size, 'duplicate connector IDs').toBe(ids.length)
    expect(EXPECTED_IDS.filter(id => !ids.includes(id)), 'production catalog is missing released providers').toEqual([])

    // Gmail uses its original dedicated route and is deliberately absent from
    // the generic catalog. Assert it in addition to every catalog provider.
    const inventory = [{ id: 'google-gmail', name: 'Google Gmail', authentication: 'oauth', configured: true },
      ...connectors.filter(entry => entry.id !== 'google-gmail')]
    expect(new Set(inventory.map(entry => entry.name)).size, 'connector names must identify unique cards').toBe(inventory.length)
    const statuses: Array<{ id: string; configured: boolean; status: string }> = []
    for (const entry of inventory) {
      await test.step(`${entry.id}: visible card, metadata, and controls`, async () => {
        const heading = page.getByRole('heading', { name: entry.name, level: 2, exact: true })
        await expect(heading).toHaveCount(1)
        await heading.scrollIntoViewIfNeeded()
        await expect(heading).toBeVisible()
        const card = page.locator('section').filter({ has: heading })
        const metadata = await request.get(`/api/v1/connectors/${encodeURIComponent(entry.id)}`, {
          timeout: 15_000,
          headers: { Authorization: `Bearer ${token}` },
        })
        expect(metadata.status(), `${entry.id} status route failed`).toBe(200)
        const { status } = await metadata.json() as { status: string }
        expect(['connected', 'disconnected', 'authorization_pending']).toContain(status)
        statuses.push({ id: entry.id, configured: entry.configured, status })
        if (status === 'connected') {
          await expect(card.getByText(/^Connected/)).toBeVisible()
          await expect(card.getByRole('button', { name: 'Disconnect', exact: true })).toBeEnabled()
        } else {
          const button = card.getByRole('button', { name: entry.authentication === 'api-key' ? 'Save key' : 'Connect', exact: true })
          await expect(button).toBeVisible()
          await expect(card.getByText('Status unavailable', { exact: true })).toHaveCount(0)
          if (!entry.configured) {
            await expect(card.getByText('Provider setup pending', { exact: true })).toBeVisible()
            await expect(button).toBeDisabled()
          } else if (entry.authentication === 'api-key') {
            await expect(card.getByLabel(`${entry.name} API key`, { exact: true })).toBeVisible()
            await expect(button).toBeDisabled() // no credentials entered by a read-only smoke
          } else {
            await expect(button).toBeEnabled()
          }
          if (entry.configured) {
            await expect(card.getByText(status === 'authorization_pending'
              ? 'Awaiting approval — connect again after approval' : 'Not connected', { exact: true })).toBeVisible()
          }
        }
        await page.screenshot({ path: testInfo.outputPath(`${entry.id}.png`) })
      })
    }
    await expect(page.locator('main h2')).toHaveCount(inventory.length)
    await expect(page.getByRole('alert')).toHaveCount(0)
    expect(errors, 'uncaught browser errors during connector journey').toEqual([])
    await page.screenshot({ path: testInfo.outputPath('all-connectors.png'), fullPage: true })
    await testInfo.attach('connector-inventory', {
      body: JSON.stringify({ baseURL: testInfo.project.use.baseURL, expectedMinimum: 26, displayed: inventory.length, connectors: statuses }, null, 2),
      contentType: 'application/json',
    })
  })
})
