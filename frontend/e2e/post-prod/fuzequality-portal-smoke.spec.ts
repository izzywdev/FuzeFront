import { test, expect } from '@playwright/test'
import { seedMockSession } from '../../tests/support/account-vault'
import { loginSyntheticViaApi } from '../../tests/support/post-prod-auth'

/**
 * Release evidence for FuzeQuality itself, not merely any healthy remote.
 *
 * This read-only test signs in through production Security, proves the portal
 * registry exposes FuzeQuality, then mounts the exact route users select.
 * Playwright records every run; CI publishes its WebM separately.
 */
const EMAIL = process.env.POST_PROD_EMAIL || 'postprod-smoke@fuzefront.com'
const PASSWORD = process.env.POST_PROD_PASSWORD

test.describe('FuzeQuality portal — live post-production', () => {
  test('registered Quality app mounts and renders repository intelligence', async ({ page, request }, testInfo) => {
    // This is a release gate, not optional coverage: without a dedicated
    // production synthetic there can be no trustworthy successful video.
    expect(
      PASSWORD,
      'POST_PROD_PASSWORD is not set — FuzeQuality cannot be released without authenticated production video evidence.'
    ).toBeTruthy()

    const { token, via } = await loginSyntheticViaApi(request, {
      email: EMAIL,
      password: PASSWORD!,
      internalSecret: process.env.INTERNAL_PROVISION_SECRET,
      firstName: 'Post-prod',
      lastName: 'Quality',
    })
    testInfo.annotations.push({ type: 'authentication', description: `synthetic session via ${via}` })

    const registry = await request.get('/api/apps', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(registry.status(), `/api/apps -> ${registry.status()}`).toBe(200)
    const body = await registry.json()
    const apps: Array<{ id: string; name: string; integrationType?: string; isHealthy?: boolean }> =
      Array.isArray(body) ? body : body?.apps ?? body?.data ?? []
    const quality = apps.find(app => app.id === 'fuzequality')
    expect(quality, 'FuzeQuality must be registered in the production portal').toBeTruthy()
    expect(quality?.integrationType, 'FuzeQuality must be a federated portal app').toBe('module-federation')
    expect(quality?.isHealthy, 'FuzeQuality registration must be healthy').not.toBe(false)

    const pageErrors: string[] = []
    const failedRemoteRequests: string[] = []
    page.on('pageerror', error => pageErrors.push(error.message))
    page.on('requestfailed', req => {
      if (/fuzequality|remoteEntry/i.test(req.url())) failedRemoteRequests.push(`${req.method()} ${req.url()}`)
    })

    await page.addInitScript(seedMockSession, token)
    await page.goto('/app/fuzequality')
    await expect(page.getByText('Loading application...')).toBeHidden({ timeout: 45_000 }).catch(() => {})
    await expect(page.getByText('Failed to Load App')).toHaveCount(0)
    await expect(page.getByText('FuzeQuality', { exact: true })).toBeVisible({ timeout: 45_000 })
    await page.getByRole('button', { name: 'Quality intelligence' }).click()
    await expect(page.getByText('Repository analysis', { exact: true })).toBeVisible({ timeout: 45_000 })
    await expect(page.getByRole('heading', { name: 'Quality intelligence' })).toBeVisible({ timeout: 45_000 })

    // A mounted shell is not feature evidence. Require live, repository-derived
    // records for every FuzeQuality backlog slice before a release can pass.
    const flowWireframes = page.locator('.flow-wireframe')
    expect(await flowWireframes.count(), 'Production must contain at least one detected UX-flow wireframe').toBeGreaterThan(0)
    await page.locator('.flow-provenance').first().getByText('Source evidence').click()
    await expect(page.locator('.flow-provenance').first()).toContainText('Revision')

    const governanceHistory = page.locator('.policy-review-history')
    expect(await governanceHistory.count(), 'Production must contain policy/gate evaluation evidence').toBeGreaterThan(0)
    await governanceHistory.first().getByText('Review history').click()
    await expect(governanceHistory.first().locator('li').first()).toBeVisible()

    for (const inventory of ['Load tests', 'Stress tests']) {
      const panel = page.locator('section.catalog-panel').filter({ has: page.getByRole('heading', { name: inventory, exact: true }) })
      await expect(panel).toBeVisible()
      await expect(panel.locator('.eyebrow')).not.toHaveText('0 discovered')
      await expect(panel.locator('.catalog-row').first()).toBeVisible()
    }

    const executionPanel = page.locator('section.catalog-panel').filter({ has: page.getByRole('heading', { name: 'CI and post-production results', exact: true }) })
    const suiteFilter = executionPanel.getByLabel('Suite')
    for (const suite of ['integration', 'post-production']) {
      await suiteFilter.selectOption(suite)
      await expect(executionPanel.locator('.catalog-row').first(), `Production must contain ${suite} execution evidence`).toBeVisible()
    }
    await suiteFilter.selectOption('')

    const performancePanel = page.locator('section.catalog-panel').filter({ has: page.getByRole('heading', { name: 'Observed outcomes', exact: true }) })
    await expect(performancePanel.locator('.catalog-row').first(), 'Production must contain an observed policy–gate outcome').toBeVisible()
    await page.screenshot({ path: 'test-results-post-prod/fuzequality-portal-live.png', fullPage: true })

    expect(pageErrors, `uncaught errors mounting FuzeQuality: ${pageErrors.join(' | ')}`).toEqual([])
    expect(failedRemoteRequests, `failed FuzeQuality remote requests: ${failedRemoteRequests.join(' | ')}`).toEqual([])
  })
})
