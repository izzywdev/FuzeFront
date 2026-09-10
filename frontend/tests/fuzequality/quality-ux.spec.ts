import { expect, test, type Page } from '@playwright/test'

const portfolio = {
  repositories: [{ id: 'repo-1', tenantId: 'tenant-1', owner: 'izzywdev', name: 'FuzeService', canonicalUrl: 'https://github.com/izzywdev/FuzeService', defaultBranch: 'main', kind: 'service', enabled: true, lastScanStatus: 'complete', lastScanRevision: 'abcdef123456', jiraBindings: [] }],
  operations: [{ id: 'api-1', repositoryId: 'repo-1', documentPath: 'openapi.yaml', method: 'post', path: '/apps/{slug}/suspend', tags: ['apps'], summary: 'Suspend app', security: true, parameters: [], responses: ['200'] }],
  surfaces: [{ id: 'ui-1', repositoryId: 'repo-1', name: 'PlanPicker', packageName: '@fuze/ui', sourcePath: 'src/PlanPicker.tsx', kind: 'component', public: true, states: ['default'], hasStory: false, stories: [] }],
  tests: [],
  expectations: [
    { id: 'api-gap', subjectId: 'api-1', subjectType: 'api-operation', kind: 'authentication-missing', label: 'Missing authentication is rejected', rule: 'api.security.authentication', priority: 'required', coverage: 'gap' },
    { id: 'ui-gap', subjectId: 'ui-1', subjectType: 'frontend-surface', kind: 'state-default', label: 'Default render is covered', rule: 'ui.default', priority: 'required', coverage: 'gap' },
  ],
  findings: [{ id: 'finding-1', repositoryId: 'repo-1', subjectId: 'api-1', title: 'Unauthenticated endpoint', detail: 'Add an authentication test', severity: 'high', status: 'open' }],
  requirements: [{ id: 'req-1', jiraKey: 'FQ-1', issueType: 'Story', summary: 'Protect app access', description: 'A user can suspend an app.', status: 'To Do' }],
  flows: [{ id: 'flow-1', requirementId: 'req-1', title: 'Suspend application' }],
  suggestions: [{ id: 'suggestion-1', requirementId: 'req-1', type: 'flow', title: 'Confirm authorization boundary', confidence: 0.91, evidence: ['Only administrators may suspend an app.'], state: 'proposed' }],
  diagnostics: [],
}

const documentedStoryPortfolio = {
  ...portfolio,
  repositories: [{ ...portfolio.repositories[0], storybookBaseUrl: 'https://storybook.example.test' }],
  surfaces: [{
    ...portfolio.surfaces[0],
    hasStory: true,
    stories: [{ id: 'plan-picker--default', title: 'UI/PlanPicker', name: 'Default', exportName: 'Default', sourcePath: 'src/PlanPicker.stories.tsx', hasPlay: false, previewPath: 'iframe.html?id=plan-picker--default' }],
  }],
}

async function mockQualityApi(page: Page, fixture = portfolio) {
  let suggestionConfirmed = false
  let members = [{ id: 'member-1', email: 'owner@example.com', role: 'owner' }]
  await page.addInitScript(() => { (window as any).__FRONTFUSE_CONTEXT__ = { getAccessToken: () => 'e2e-token' } })
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url())
    const method = route.request().method()
    const respond = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (url.pathname.endsWith('/portfolio')) return respond({
      ...fixture,
      suggestions: suggestionConfirmed ? [] : fixture.suggestions,
    })
    if (url.pathname.endsWith('/admin/organizations')) return respond([{ organizationId: 'tenant-1', repositories: 1, apiOperations: 1, frontendSurfaces: 1, tests: 0, expectations: 2, coveredExpectations: 0, gaps: 2, coveragePercent: 0, openFindings: 1, failedScans: 0, staleScans: 0 }])
    if (url.pathname.endsWith('/admin/organizations/tenant-1/context') && method === 'POST') return respond({ organizationId: 'tenant-1', mode: 'read-only', auditId: 'audit-12345678', enteredAt: '2026-09-10T00:00:00.000Z', portfolio })
    if (url.pathname.endsWith('/organization/members') && method === 'GET') return respond(members)
    if (url.pathname.endsWith('/organization/invitations') && method === 'POST') {
      const payload = route.request().postDataJSON() as { email: string, role: string }
      members = [...members, { id: 'member-invited', email: payload.email, role: payload.role }]
      return respond({ ok: true }, 202)
    }
    const memberId = url.pathname.match(/\/organization\/members\/([^/]+)$/)?.[1]
    if (memberId && method === 'PUT') {
      const payload = route.request().postDataJSON() as { role: string }
      members = members.map(member => member.id === memberId ? { ...member, role: payload.role } : member)
      return respond({ ok: true }, 202)
    }
    if (memberId && method === 'DELETE') {
      members = members.filter(member => member.id !== memberId)
      return respond({ ok: true }, 202)
    }
    if (url.pathname.includes('/test-implementations') && method === 'POST') return respond({ id: 'impl-1', status: 'queued', agentProfile: 'FuzeSDLC QA agent', skills: ['playwright'] }, 202)
    if (url.pathname.includes('/suggestions/') && url.pathname.endsWith('/decision') && method === 'POST') {
      suggestionConfirmed = true
      return respond({ id: 'suggestion-1', state: 'confirmed' })
    }
    if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') return respond({ ok: true }, 202)
    return respond({})
  })
}

test.describe('FuzeQuality implemented UX flows', () => {
  test.beforeEach(async ({ page }) => { await mockQualityApi(page); await page.goto('/') })

  test('loads the portfolio and navigates every implemented workspace', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /See what the platform promises/i })).toBeVisible()
    for (const [nav, heading] of [['Repositories', 'Repository inventory'], ['API catalog', 'API coverage matrix'], ['Frontend inventory', 'Frontend coverage matrix'], ['Requirements & flows', 'Requirements & inferred flows'], ['AI review queue', 'AI review queue'], ['Organization', 'Organization access & integrations'], ['Organizations', 'Organization QA portfolio']] as const) {
      const navigationButton = nav === 'AI review queue'
        ? page.getByRole('button', { name: /^AI review queue/ })
        : page.getByRole('button', { name: nav, exact: true })
      await navigationButton.click()
      await expect(page.getByRole('heading', { name: heading })).toBeVisible()
    }
  })

  test('opens an API gap plan and queues selected test implementation', async ({ page }) => {
    await page.getByRole('button', { name: 'API catalog' }).click()
    await page.getByRole('button', { name: /Gap: Missing authentication/i }).click()
    await expect(page.getByRole('heading', { name: /tests to close this gap/i })).toBeVisible()
    await expect(page.getByText('Arrange')).toBeVisible()
    await page.getByRole('button', { name: /Implement 1 selected/i }).click()
    await expect(page.getByText('Cloud Codex: queued')).toBeVisible()
  })

  test('filters the API matrix and keeps remediation findings scoped to the visible contract set', async ({ page }) => {
    await page.getByRole('button', { name: 'API catalog' }).click()
    const filters = page.locator('.catalog-filters')
    await filters.getByLabel('Tag').selectOption('apps')
    await filters.getByLabel('Coverage').selectOption('gap')
    await expect(page.getByText('/apps/{slug}/suspend')).toBeVisible()
    await expect(page.getByText('Unauthenticated endpoint')).toBeVisible()
    await filters.getByLabel('Coverage').selectOption('covered-explicit')
    await expect(page.getByText('No catalog entries match')).toBeVisible()
    await expect(page.getByText('No findings in this view')).toBeVisible()
  })

  test('keeps the gap plan selection explicit before launching cloud implementation', async ({ page }) => {
    await page.getByRole('button', { name: 'API catalog' }).click()
    await page.getByRole('button', { name: /Gap: Missing authentication/i }).click()
    const plannedTest = page.getByRole('checkbox', { name: /Select POST/i })
    await plannedTest.uncheck()
    await expect(page.getByRole('button', { name: /Implement 0 selected/i })).toBeDisabled()
    await plannedTest.check()
    await expect(page.getByRole('button', { name: /Implement 1 selected/i })).toBeEnabled()
  })

  test('onboards a repository only after GitHub App verification and can request a scan', async ({ page }) => {
    await page.getByRole('button', { name: 'Repositories' }).click()
    await page.getByRole('button', { name: 'Add repository' }).click()
    await page.getByLabel('Repository name').fill('FuzeCatalog')
    await page.getByLabel('GitHub App installation ID').fill('123')
    const verify = page.waitForRequest(request => request.url().endsWith('/api/v1/repositories/verify') && request.method() === 'POST')
    const add = page.waitForRequest(request => request.url().endsWith('/api/v1/repositories') && request.method() === 'POST')
    await page.getByRole('button', { name: 'Verify and add' }).click()
    await expect((await verify).postDataJSON()).toMatchObject({ name: 'FuzeCatalog', installationId: '123' })
    await expect((await add).postDataJSON()).toMatchObject({ name: 'FuzeCatalog', installationId: '123' })
    await expect(page.getByRole('heading', { name: 'Add repository' })).not.toBeVisible()

    const scan = page.waitForRequest(request => request.url().endsWith('/api/v1/repositories/repo-1/scans') && request.method() === 'POST')
    await page.getByRole('button', { name: 'Scan now' }).click()
    await expect((await scan).postDataJSON()).toEqual({})
  })

  test('shows the frontend visual-reference gap and supports review decisions', async ({ page }) => {
    await page.getByRole('button', { name: 'Frontend inventory' }).click()
    await page.getByRole('button', { name: 'Visual reference' }).click()
    await expect(page.getByText('No Storybook visual reference found')).toBeVisible()
    await page.getByRole('button', { name: 'Close component preview' }).click()
    await page.getByRole('button', { name: 'AI review queue' }).click()
    await page.getByRole('button', { name: 'Confirm' }).click()
    await expect(page.getByText('Review queue cleared')).toBeVisible()
  })

  test('renders a discovered Storybook state in a sandboxed visual preview', async ({ page }) => {
    await page.unroute('**/api/v1/**')
    await mockQualityApi(page, documentedStoryPortfolio)
    await page.reload()
    await page.getByRole('button', { name: 'Frontend inventory' }).click()
    await page.getByRole('button', { name: '1 visual state' }).click()
    await expect(page.getByTitle('PlanPicker: Default')).toHaveAttribute('src', 'https://storybook.example.test/iframe.html?id=plan-picker--default')
    await expect(page.getByRole('link', { name: /Open Storybook/ })).toHaveAttribute('href', 'https://storybook.example.test/iframe.html?id=plan-picker--default')
  })

  test('invites, changes a role, and removes an organization member through FuzeFront security', async ({ page }) => {
    await page.getByRole('button', { name: 'Organization', exact: true }).click()
    await expect(page.locator('.member-row').filter({ hasText: 'owner@example.com' })).toBeVisible()
    await page.getByPlaceholder('teammate@example.com').fill('qa@example.com')
    const invite = page.waitForRequest(request => request.url().endsWith('/api/v1/organization/invitations') && request.method() === 'POST')
    await page.getByRole('button', { name: 'Invite' }).click()
    await expect((await invite).postDataJSON()).toEqual({ email: 'qa@example.com', role: 'member' })
    const invitedMember = page.locator('.member-row').filter({ hasText: 'qa@example.com' })
    await expect(invitedMember).toBeVisible()
    const roleUpdate = page.waitForRequest(request => request.url().endsWith('/api/v1/organization/members/member-invited') && request.method() === 'PUT')
    await invitedMember.getByRole('combobox').selectOption('viewer')
    await expect((await roleUpdate).postDataJSON()).toEqual({ role: 'viewer' })
    page.once('dialog', dialog => dialog.accept())
    const removal = page.waitForRequest(request => request.url().endsWith('/api/v1/organization/members/member-invited') && request.method() === 'DELETE')
    await invitedMember.getByRole('button', { name: 'Remove member' }).click()
    await removal
    await expect(page.locator('.member-row').filter({ hasText: 'qa@example.com' })).not.toBeVisible()
  })

  test('lets a platform administrator review and exit a read-only tenant context', async ({ page }) => {
    await page.getByRole('button', { name: 'Organizations', exact: true }).click()
    await expect(page.getByText('tenant-1')).toBeVisible()
    const contextRequest = page.waitForRequest(request => request.url().endsWith('/api/v1/admin/organizations/tenant-1/context') && request.method() === 'POST')
    await page.getByRole('button', { name: 'Review', exact: true }).click()
    await expect((await contextRequest).postDataJSON()).toEqual({ reason: 'Platform QA portfolio review' })
    await expect(page.getByRole('status')).toContainText('Read-only organization context')
    await expect(page.getByRole('heading', { name: 'Organization tenant-1' })).toBeVisible()
    await page.getByRole('button', { name: 'Exit context' }).click()
    await expect(page.getByRole('heading', { name: 'Organization QA portfolio' })).toBeVisible()
  })

  test('rejects an AI proposal without presenting it as authoritative coverage', async ({ page }) => {
    await page.getByRole('button', { name: 'AI review queue' }).click()
    await page.getByRole('button', { name: 'Reject' }).click()
    await expect(page.getByText('Review queue cleared')).toBeVisible()
  })
})
