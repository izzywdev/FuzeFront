import { expect, test, type Page } from '@playwright/test'

const portfolio = {
  repositories: [{ id: 'repo-1', tenantId: 'tenant-1', owner: 'izzywdev', name: 'FuzeService', canonicalUrl: 'https://github.com/izzywdev/FuzeService', defaultBranch: 'main', kind: 'service', enabled: true, lastScanStatus: 'complete', lastScanRevision: 'abcdef123456', jiraBindings: [] }],
  operations: [{ id: 'api-1', repositoryId: 'repo-1', method: 'post', path: '/apps/{slug}/suspend', tags: ['apps'], summary: 'Suspend app' }],
  surfaces: [{ id: 'ui-1', repositoryId: 'repo-1', name: 'PlanPicker', packageName: '@fuze/ui', sourcePath: 'src/PlanPicker.tsx', kind: 'component', stories: [] }],
  tests: [],
  expectations: [
    { id: 'api-gap', subjectId: 'api-1', subjectType: 'api-operation', label: 'Missing authentication is rejected', rule: 'api.security.authentication', priority: 'required', coverage: 'gap' },
    { id: 'ui-gap', subjectId: 'ui-1', subjectType: 'frontend-surface', label: 'Default render is covered', rule: 'ui.default', priority: 'required', coverage: 'gap' },
  ],
  findings: [{ id: 'finding-1', title: 'Unauthenticated endpoint', detail: 'Add an authentication test', severity: 'high', status: 'open' }],
  requirements: [{ id: 'req-1', jiraKey: 'FQ-1', issueType: 'Story', summary: 'Protect app access', description: 'A user can suspend an app.', status: 'To Do' }],
  flows: [{ id: 'flow-1', requirementId: 'req-1', title: 'Suspend application' }],
  suggestions: [{ id: 'suggestion-1', requirementId: 'req-1', type: 'flow', title: 'Confirm authorization boundary', confidence: 0.91, evidence: ['Only administrators may suspend an app.'], state: 'proposed' }],
  diagnostics: [],
}

async function mockQualityApi(page: Page) {
  let suggestionConfirmed = false
  await page.addInitScript(() => { (window as any).__FRONTFUSE_CONTEXT__ = { getAccessToken: () => 'e2e-token' } })
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url())
    const method = route.request().method()
    const respond = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (url.pathname.endsWith('/portfolio')) return respond({
      ...portfolio,
      suggestions: suggestionConfirmed ? [] : portfolio.suggestions,
    })
    if (url.pathname.endsWith('/admin/organizations')) return respond([{ organizationId: 'tenant-1', repositories: 1, apiOperations: 1, frontendSurfaces: 1, tests: 0, expectations: 2, coveredExpectations: 0, gaps: 2, coveragePercent: 0, openFindings: 1, failedScans: 0, staleScans: 0 }])
    if (url.pathname.endsWith('/organization/members')) return respond([{ id: 'member-1', email: 'owner@example.com', role: 'owner' }])
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
    for (const [nav, heading] of [['Repositories', 'Repository inventory'], ['API catalog', 'API catalog'], ['Frontend inventory', 'Frontend inventory'], ['Requirements & flows', 'Requirements & inferred flows'], ['AI review queue', 'AI review queue'], ['Organization', 'Organization access & integrations'], ['Organizations', 'Organization QA portfolio']] as const) {
      await page.getByRole('button', { name: nav }).click()
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

  test('shows the frontend visual-reference gap and supports review decisions', async ({ page }) => {
    await page.getByRole('button', { name: 'Frontend inventory' }).click()
    await page.getByRole('button', { name: 'Visual reference' }).click()
    await expect(page.getByText('No Storybook visual reference found')).toBeVisible()
    await page.getByRole('button', { name: 'Close component preview' }).click()
    await page.getByRole('button', { name: 'AI review queue' }).click()
    await page.getByRole('button', { name: 'Confirm' }).click()
    await expect(page.getByText('Review queue cleared')).toBeVisible()
  })
})
