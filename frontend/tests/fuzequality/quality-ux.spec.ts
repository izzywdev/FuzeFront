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
  findings: [
    { id: 'finding-1', repositoryId: 'repo-1', subjectId: 'api-1', title: 'Unauthenticated endpoint', detail: 'Add an authentication test', severity: 'high', status: 'open' },
    { id: 'flow-finding-1', subjectId: 'req-1', type: 'story-without-flow', title: 'FQ-1 has no confirmed user flow', detail: 'The active story has no accepted flow.', severity: 'high', status: 'open', sourceRevision: 'FQ-1@2026-09-11T00:00:00.000Z', policyVersion: 'flow-orphans-v1', schemaVersion: '1.0', evidenceStrength: 'deterministic', evidence: ['FQ-1'], generatedAt: '2026-09-11T00:01:00.000Z' },
    { id: 'requirement-finding-1', subjectId: 'req-1', type: 'conflicting-requirement-outcome', title: 'FQ-1 contains conflicting outcomes', detail: 'Criteria 1 and 2 express opposite results.', severity: 'high', status: 'open', sourceRevision: 'FQ-1@2026-09-11T00:00:00.000Z', policyVersion: 'requirement-review-v1', schemaVersion: '1.0', evidenceStrength: 'deterministic', sourcePassages: ['Administrators can suspend an app.', 'Administrators cannot suspend an app.'], affectedFlowIds: ['flow-1'], affectedTargetIds: ['api-1'], remediation: 'Resolve the contradiction in Jira.', remediationOptions: ['Keep criterion 1', 'Keep criterion 2', 'Rewrite both criteria in Jira'], generatedAt: '2026-09-11T00:01:00.000Z' },
  ],
  requirements: [{ id: 'req-1', jiraKey: 'FQ-1', issueType: 'Story', summary: 'Protect app access', description: 'A user can suspend an app.', status: 'To Do', updatedAt: '2026-09-14T05:00:00.000Z', acceptanceCriteria: [{ fingerprint: 'admin-suspend', position: 1, text: 'An administrator can suspend an app in the active organization.' }] }],
  flows: [{ id: 'flow-1', requirementId: 'req-1', title: 'Suspend application' }],
  suggestions: [{
    id: 'suggestion-1', requirementId: 'req-1', type: 'flow', title: 'Confirm authorization boundary',
    confidence: 0.91, evidence: ['Only administrators may suspend an app.'], state: 'proposed',
    payload: {
      actors: ['administrator'], trigger: 'Suspend an app',
      preconditions: ['The application exists'],
      authorizationBoundaries: ['Administrator role is required'],
      tenantBoundaries: ['App belongs to the active organization'],
      steps: [{ id: 'flow-1:step:1', position: 1, actor: 'administrator', action: 'submits suspension', expectedOutcome: 'the app is suspended', variant: 'main', targetIds: ['api-1', 'criterion:admin-suspend'] }],
      analysis: { promptVersion: 'fuzequality-flow-v1', schemaVersion: '1.0', model: 'quality-analysis' },
    },
  }],
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

const qualityArtifacts = [
  { id: 'route-artifact', repositoryId: 'repo-1', kind: 'route', title: 'Suspend app route', sourcePath: 'src/routes/apps.ts', summary: 'Authenticated suspension route', evidence: ['POST /apps/{slug}/suspend'] },
  { id: 'policy-artifact', repositoryId: 'repo-1', kind: 'policy', title: 'Administrative suspension policy', sourcePath: 'docs/policies/apps.md', summary: 'Only administrators may suspend apps', evidence: ['role=administrator'] },
  { id: 'gate-artifact', repositoryId: 'repo-1', kind: 'gate', title: 'Suspension authorization gate', sourcePath: '.github/workflows/quality.yml', summary: 'Checks the administrator boundary', evidence: ['npm run test:authorization'] },
  { id: 'load-artifact', repositoryId: 'repo-1', kind: 'load-test', title: 'Application API load test', sourcePath: '.github/workflows/load.yml', summary: 'Sustained application API load', evidence: ['p95 < 500ms'], execution: { provider: 'github-actions', workflowPath: '.github/workflows/load.yml', trigger: 'workflow_dispatch' } },
]

const repositoryFlowCandidates = [{
  id: 'candidate-1', repositoryId: 'repo-1', tenantId: 'tenant-1', revision: 'abcdef123456', title: 'Suspend an application', confidence: 0.94,
  evidence: ['src/routes/apps.ts:42', 'frontend/src/pages/AppSettings.tsx:88'],
  steps: [{ actor: 'administrator', action: 'selects Suspend', expectedOutcome: 'the application is suspended', targetIds: ['POST /apps/{slug}/suspend'] }],
  wireframe: { kind: 'sequence', nodes: [{ label: 'App settings', targetIds: ['AppSettings'] }, { label: 'Confirm suspension', targetIds: ['SuspendDialog'] }, { label: 'Suspended state', targetIds: ['AppStatus'] }] },
  analysis: { provider: 'fuzeinfra-litellm', model: 'quality-analysis', promptVersion: 'repository-flow-v1', schemaVersion: '1.0' },
  status: 'proposed', source: 'litellm', createdAt: '2026-10-08T09:00:00.000Z',
}, {
  id: 'candidate-deterministic', repositoryId: 'repo-1', tenantId: 'tenant-1', revision: 'abcdef123456', title: 'Indexed suspension route', confidence: 1,
  evidence: ['route-artifact', 'POST /apps/{slug}/suspend'],
  steps: [{ actor: 'User or service', action: 'reaches the indexed suspension route', expectedOutcome: 'the route is available for testing', targetIds: ['route-artifact'] }],
  wireframe: { kind: 'sequence', nodes: [{ label: 'Indexed route', targetIds: ['route-artifact'] }] },
  status: 'proposed', source: 'deterministic', createdAt: '2026-10-08T08:55:00.000Z',
}]

const policyGateEvaluations = [{
  id: 'evaluation-1', repositoryId: 'repo-1', tenantId: 'tenant-1', revision: 'abcdef123456', kind: 'unguarded-policy', severity: 'high',
  title: 'Suspension policy requires a protected gate', detail: 'The policy is not enforced on every production path.', policyArtifactIds: ['policy-artifact'], gateArtifactIds: [],
  confidence: 0.75, scope: { sourcePaths: ['docs/policies/apps.md'], subjects: ['suspension'] }, evidencePassages: [{ artifactId: 'policy-artifact', sourcePath: 'docs/policies/apps.md', text: 'Only administrators may suspend apps.', signal: 'obligation' }],
  recommendation: 'Require the authorization suite before production deployment.', reviewStatus: 'accepted', reviewedAt: '2026-10-08T10:00:00.000Z', reviewedBy: 'quality-owner', reviewReason: 'Required for every production release.', createdAt: '2026-10-08T09:30:00.000Z',
}]

const testExecutions = [{
  id: 'execution-1', repositoryId: 'repo-1', tenantId: 'tenant-1', revision: 'abcdef123456', kind: 'post-production', status: 'failed', name: 'Production suspension journey',
  provider: 'github-actions', externalRunId: '123', attempt: 2,
  workflowPath: '.github/workflows/post-prod.yml',
  sourceUrl: 'https://github.com/izzywdev/FuzeService/actions/runs/123', startedAt: '2026-10-08T11:00:00.000Z', completedAt: '2026-10-08T11:02:00.000Z',
  policyArtifactIds: ['policy-artifact'], gateArtifactIds: ['gate-artifact'], summary: 'Authorization assertion failed.',
  gateEvaluations: [{ policyArtifactId: 'policy-artifact', gateArtifactId: 'gate-artifact', status: 'failed', detail: 'The production authorization assertion failed.' }],
}]

async function mockQualityApi(page: Page, fixture = portfolio) {
  let suggestionConfirmed = false
  let flowCandidates = repositoryFlowCandidates
  let flowReviewHistory = [{
    status: 'rejected' as const,
    reviewedBy: 'platform-owner',
    reason: 'The first analysis missed the administrator boundary.',
    createdAt: '2026-10-08T08:45:00.000Z',
  }]
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
    if (url.pathname.endsWith('/requirements/freshness')) return respond({ freshnessStatus: 'fresh', lastSuccessAt: '2026-09-14T00:00:00.000Z' })
    if (url.pathname.endsWith('/quality-artifacts')) return respond(qualityArtifacts)
    if (url.pathname.endsWith('/flow-candidates')) return respond(flowCandidates)
    if (url.pathname.endsWith('/flow-candidates/candidate-1/history')) return respond(flowReviewHistory)
    if (url.pathname.endsWith('/flow-candidates/candidate-1/review') && method === 'POST') {
      const payload = route.request().postDataJSON() as { status: 'confirmed' | 'rejected', reason?: string }
      const reviewedAt = '2026-10-08T12:00:00.000Z'
      flowCandidates = flowCandidates.map(flow => flow.id === 'candidate-1' ? {
        ...flow,
        status: payload.status,
        reviewedAt,
        reviewedBy: 'quality-reviewer',
        reviewReason: payload.reason,
      } : flow)
      flowReviewHistory = [{ status: payload.status, reviewedBy: 'quality-reviewer', reason: payload.reason, createdAt: reviewedAt }, ...flowReviewHistory]
      return respond(flowCandidates[0])
    }
    if (url.pathname.endsWith('/policy-gate-evaluations')) return respond(policyGateEvaluations)
    if (url.pathname.endsWith('/policy-gate-evaluations/evaluation-1/history')) return respond([
      { status: 'accepted', reviewedBy: 'quality-owner', reason: 'Required for every production release.', createdAt: '2026-10-08T10:00:00.000Z' },
      { status: 'dismissed', reviewedBy: 'platform-owner', reason: 'Initial evidence was incomplete.', createdAt: '2026-10-08T09:45:00.000Z' },
    ])
    if (url.pathname.endsWith('/test-executions')) return respond(testExecutions)
    if (url.pathname.endsWith('/execution-performance')) return respond([{ repositoryId: 'repo-1', policyArtifactId: 'policy-artifact', policyTitle: 'Administrative suspension policy', policySourcePath: 'docs/policies/apps.md', gateArtifactId: 'gate-artifact', gateTitle: 'Admin authorization gate', gateSourcePath: '.github/workflows/authorization.yml', passed: 2, failed: 1, cancelled: 0, running: 0, latestCompletedAt: '2026-10-08T11:02:00.000Z' }])
    if (url.pathname.endsWith('/performance-tests/load-artifact/execute') && method === 'POST') return respond({
      status: 'dispatched',
      artifactId: 'load-artifact',
      workflowPath: '.github/workflows/load.yml',
      ref: 'main',
    }, 202)
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

  test('uses host-owned chrome when mounted as a federated portal remote', async ({ page }) => {
    await page.addInitScript(() => {
      const menuItems: unknown[] = []
      ;(window as any).__QUALITY_PORTAL_MENU__ = menuItems
      ;(window as any).__FUZEFRONT__ = {
        menu: {
          add: (_appId: string, items: unknown[]) => menuItems.push(...items),
          remove: () => undefined,
        },
      }
    })
    await page.goto('/')
    await page.evaluate(() => {
      window.history.pushState({}, '', '/app/fuzequality/operations')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })

    await expect(page.locator('aside.sidebar')).toHaveCount(0)
    await expect(page.locator('.topbar')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Operations', exact: true })).toBeVisible()
    await expect.poll(() => page.evaluate(() => (window as any).__QUALITY_PORTAL_MENU__.map((item: any) => item.id))).toContain('operations')
  })

  test('keeps standalone navigation deep-linkable', async ({ page }) => {
    await page.getByRole('button', { name: 'Operations' }).click()
    await expect(page).toHaveURL(/\/operations$/)
    await expect(page.getByRole('heading', { name: 'Operations', exact: true })).toBeVisible()
  })

  test('reviews repository flows, governance history, and execution evidence together', async ({ page }) => {
    await page.getByRole('button', { name: 'Quality intelligence' }).click()
    await expect(page.getByRole('heading', { name: 'Quality intelligence' })).toBeVisible()

    const originSummary = page.getByLabel('UX flow origin summary')
    await expect(originSummary).toContainText('1 deterministic flow')
    await expect(originSummary).toContainText('1 FuzeInfra LiteLLM proposal')
    await expect(page.getByText('Suspend an application', { exact: true })).toBeVisible()
    const flowCard = page.getByText('Suspend an application', { exact: true }).locator('..')
    await expect(page.getByText('FuzeInfra LiteLLM proposal', { exact: true })).toBeVisible()
    const analysisProvenance = page.getByLabel('Suspend an application analysis provenance')
    await expect(analysisProvenance).toContainText('fuzeinfra-litellm')
    await expect(analysisProvenance).toContainText('quality-analysis')
    await expect(analysisProvenance).toContainText('repository-flow-v1')
    await expect(analysisProvenance).toContainText('1.0')
    await expect(page.getByText('Deterministic repository evidence', { exact: true })).toBeVisible()
    await expect(page.getByText('Indexed suspension route', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Suspend an application wireframe')).toContainText('App settings')
    await flowCard.getByText('Source evidence', { exact: true }).click()
    await expect(flowCard.getByText('Revision abcdef123456')).toBeVisible()
    await expect(flowCard.getByText('src/routes/apps.ts:42')).toBeVisible()

    await flowCard.getByLabel('Optional review rationale').fill('Matches the protected suspension journey.')
    const flowReviewRequest = page.waitForRequest(request => request.url().endsWith('/flow-candidates/candidate-1/review'))
    await flowCard.getByRole('button', { name: 'Confirm' }).click()
    expect((await flowReviewRequest).postDataJSON()).toEqual({
      status: 'confirmed',
      reason: 'Matches the protected suspension journey.',
    })
    await expect(flowCard.getByLabel('Current UX flow review')).toContainText('quality-reviewer')
    await expect(flowCard.getByLabel('Current UX flow review')).toContainText('Matches the protected suspension journey.')
    await expect(flowCard.getByLabel('Current UX flow review')).toContainText('Reviewed')
    const flowHistory = flowCard.getByText('UX flow review history', { exact: true }).locator('..')
    await flowHistory.getByText('UX flow review history', { exact: true }).click()
    await expect(flowHistory.getByText('Recorded decisions are immutable.')).toBeVisible()
    await expect(flowHistory.getByText('quality-reviewer', { exact: true })).toBeVisible()
    await expect(flowHistory.getByText('Matches the protected suspension journey.')).toBeVisible()
    await expect(flowHistory.getByText('The first analysis missed the administrator boundary.')).toBeVisible()

    await expect(page.getByText('Suspension policy requires a protected gate', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Decisive policy passages')).toContainText('Only administrators may suspend apps.')
    await page.getByText('Review history', { exact: true }).click()
    await expect(page.getByText('quality-owner', { exact: true })).toBeVisible()
    await expect(page.getByText('Initial evidence was incomplete.')).toBeVisible()

    await expect(page.getByText('Production suspension journey', { exact: true })).toBeVisible()
    await expect(page.getByText('Authorization assertion failed.', { exact: true })).toBeVisible()
    const executionMetadata = page.getByLabel('Execution provider metadata')
    await expect(executionMetadata.locator('[data-field="provider-run-id"]')).toContainText('github-actions · 123')
    await expect(executionMetadata.locator('[data-field="attempt"]')).toContainText('2')
    await expect(executionMetadata.locator('[data-field="workflow-path"]')).toContainText('.github/workflows/post-prod.yml')
    await expect(executionMetadata.locator('[data-field="duration"]')).toContainText('2m 0s')
    const gateEvidence = page.getByLabel('Policy gate evidence')
    await expect(gateEvidence.getByText('Administrative suspension policy')).toBeVisible()
    await expect(gateEvidence.getByText('Suspension authorization gate')).toBeVisible()
    await expect(gateEvidence).toContainText('docs/policies/apps.md → .github/workflows/quality.yml')
    await expect(page.getByRole('link', { name: 'Open CI run' })).toHaveAttribute('href', 'https://github.com/izzywdev/FuzeService/actions/runs/123')
    const providerRequest = page.waitForRequest(request =>
      request.url().includes('/test-executions?provider=github-actions')
    )
    await page.getByLabel('Ingestion provider').selectOption('github-actions')
    await providerRequest
    await expect(page.getByText('Administrative suspension policy → Admin authorization gate')).toBeVisible()
    await expect(page.getByLabel('Evidence repository')).toHaveText('izzywdev/FuzeService')
    await expect(page.getByText('docs/policies/apps.md → .github/workflows/authorization.yml')).toBeVisible()
    await expect(page.getByText('2 passed · 1 failed · 0 cancelled · 0 running')).toBeVisible()
  })

  test('keeps deterministic UX-flow evidence useful without AI proposals', async ({ page }) => {
    await page.route(url => url.pathname === '/api/v1/repositories/repo-1/flow-candidates', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([repositoryFlowCandidates[1]]),
    }))
    await page.getByRole('button', { name: 'Quality intelligence' }).click()
    const originSummary = page.getByLabel('UX flow origin summary')
    await expect(originSummary).toContainText('1 deterministic flow')
    await expect(originSummary).toContainText('0 FuzeInfra LiteLLM proposals')
    await expect(originSummary).toContainText('No AI proposals are available for this revision.')
    await expect(page.getByText('Indexed suspension route', { exact: true })).toBeVisible()
    await expect(page.getByText('Suspend app route', { exact: true })).toBeVisible()
  })

  test('dispatches a reviewed load workflow with visible execution handoff', async ({ page }) => {
    await page.getByRole('button', { name: 'Quality intelligence' }).click()
    page.once('dialog', dialog => dialog.accept())
    const dispatchRequest = page.waitForRequest(request =>
      request.url().endsWith('/performance-tests/load-artifact/execute')
    )

    await page.getByRole('button', { name: 'Run on default branch' }).click()

    expect((await dispatchRequest).method()).toBe('POST')
    await expect(page.getByRole('status')).toContainText(
      'Dispatched .github/workflows/load.yml on main'
    )
    await expect(page.getByRole('status')).toContainText(
      'GitHub Actions will report the run as execution evidence.'
    )
  })

  test('keeps failed policy-gate review rationale available for retry', async ({ page }) => {
    const proposedEvaluation = {
      ...policyGateEvaluations[0],
      reviewStatus: 'proposed',
      reviewedAt: undefined,
      reviewedBy: undefined,
      reviewReason: undefined,
    }
    await page.route(
      url => url.pathname === '/api/v1/repositories/repo-1/policy-gate-evaluations',
      route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([proposedEvaluation]),
      })
    )
    await page.route('**/api/v1/repositories/repo-1/policy-gate-evaluations/evaluation-1/review', route => route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Governance review service unavailable' }),
    }))
    await page.getByRole('button', { name: 'Quality intelligence' }).click()
    const rationale = page.getByLabel('Optional governance rationale')
    await rationale.fill('The gate owner is not identified.')

    await page.getByRole('button', { name: 'Dismiss' }).click()

    await expect(page.getByRole('alert')).toHaveText(
      'Governance review service unavailable'
    )
    await expect(rationale).toHaveValue('The gate owner is not identified.')
    await expect(page.getByRole('button', { name: 'Dismiss' })).toBeEnabled()
  })

  test('keeps a failed UX flow review actionable', async ({ page }) => {
    await page.route('**/api/v1/repositories/repo-1/flow-candidates/candidate-1/review', route => route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Review service unavailable' }),
    }))
    await page.getByRole('button', { name: 'Quality intelligence' }).click()
    const flowCard = page.getByText('Suspend an application', { exact: true }).locator('..')
    await flowCard.getByLabel('Optional review rationale').fill('Evidence is incomplete.')
    await flowCard.getByRole('button', { name: 'Reject' }).click()
    await expect(flowCard.getByRole('alert')).toHaveText('Review service unavailable')
    await expect(flowCard.getByRole('button', { name: 'Reject' })).toBeEnabled()
  })

  test('refetches tenant-scoped evidence when the portal switches organization or personal context', async ({ page }) => {
    let workspaceName = 'OrganizationOne'
    await page.route('**/api/v1/portfolio', route => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...portfolio, repositories: [{ ...portfolio.repositories[0], name: workspaceName }] }),
      })
    })
    await page.addInitScript(() => {
      type Context = { user: { id: string } | null; activeOrganization: { id: string } | null }
      let context: Context = { user: { id: 'user-1' }, activeOrganization: { id: 'org-1' } }
      const listeners = new Set<(value: typeof context) => void>()
      ;(window as any).__FUZEFRONT__ = {
        version: 2,
        getContext: () => context,
        subscribe: (listener: (value: typeof context) => void) => {
          listeners.add(listener)
          listener(context)
          return () => listeners.delete(listener)
        },
        menu: { add: () => {}, remove: () => {} },
        __switchContext: (value: typeof context) => {
          context = value
          listeners.forEach(listener => listener(context))
        },
      }
    })
    await page.reload()
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('fuzefront:navigate', {
      detail: { id: 'repositories', section: 'repositories', route: '/repositories' },
    })))
    await expect(page.getByRole('heading', { name: 'OrganizationOne' })).toBeVisible()

    const personalReload = page.waitForRequest(request => request.url().endsWith('/api/v1/portfolio'))
    workspaceName = 'PersonalWorkspace'
    await page.evaluate(() => (window as any).__FUZEFRONT__.__switchContext({ user: { id: 'user-1' }, activeOrganization: null }))
    await personalReload
    await expect(page.getByRole('heading', { name: 'PersonalWorkspace' })).toBeVisible()

    const organizationReload = page.waitForRequest(request => request.url().endsWith('/api/v1/portfolio'))
    workspaceName = 'OrganizationTwo'
    await page.evaluate(() => (window as any).__FUZEFRONT__.__switchContext({ user: { id: 'user-1' }, activeOrganization: { id: 'org-2' } }))
    await organizationReload
    await expect(page.getByRole('heading', { name: 'OrganizationTwo' })).toBeVisible()
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

  test('shows Jira-backed product intent separately from confirmed flows and AI proposals', async ({ page }) => {
    await page.getByRole('button', { name: 'Requirements & flows' }).click()
    await expect(page.locator('.requirement-key').getByText('FQ-1', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Protect app access' })).toBeVisible()
    await expect(page.getByText('1 confirmed flows')).toBeVisible()
    await expect(page.getByText('1 proposals')).toBeVisible()
    await expect(page.getByText('Jira fresh')).toBeVisible()
    await expect(page.getByText('2 quality findings')).toBeVisible()
    await page.getByText('FQ-1 has no confirmed user flow').click()
    await expect(page.getByText(/deterministic evidence · policy flow-orphans-v1 · schema 1.0/)).toBeVisible()
    await expect(page.locator('.requirement-findings code').getByText('FQ-1', { exact: true })).toBeVisible()
    await page.getByText('FQ-1 contains conflicting outcomes').click()
    await expect(page.getByText('Administrators cannot suspend an app.')).toBeVisible()
    await expect(page.getByLabel('Remediation choices').getByText('Rewrite both criteria in Jira')).toBeVisible()
    await expect(page.getByText('flow-1', { exact: true })).toBeVisible()
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
    await expect(page.getByLabel('Jira source')).toContainText('An administrator can suspend an app in the active organization.')
    await expect(page.getByLabel('Proposed flow graph')).toContainText('submits suspension')
    await expect(page.getByLabel('Proposed flow graph')).toContainText('POST /apps/{slug}/suspend')
    await expect(page.getByLabel('Jira source')).toContainText('Source revision: FQ-1@2026-09-14T05:00:00.000Z')
    await expect(page.getByLabel('Review evidence and provenance')).toContainText('Administrator role is required')
    await expect(page.getByText(/Prompt fuzequality-flow-v1/)).toBeVisible()
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
