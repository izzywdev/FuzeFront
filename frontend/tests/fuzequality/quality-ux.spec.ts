import { expect, test, type Page } from '@playwright/test'

const portfolio = {
  repositories: [{ id: 'repo-1', tenantId: 'tenant-1', owner: 'izzywdev', name: 'FuzeService', canonicalUrl: 'https://github.com/izzywdev/FuzeService', defaultBranch: 'main', kind: 'service', enabled: true, lastScanStatus: 'complete', lastScanRevision: 'abcdef123456', lastScanDetails: { sourceRevision: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', catalogRevision: 'abcdef123456', scannerVersion: '1.5.0', configVersion: 'config-1', partial: false, candidates: [], counts: { candidates: 0, operations: 1, frontendSurfaces: 1, tests: 0, diagnostics: 1 } }, jiraBindings: [] }],
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
  diagnostics: [{
    repositoryId: 'repo-1', revision: 'abcdef123456', sourcePath: 'docs/oversized-journey.md',
    category: 'repository', severity: 'error', code: 'unreadable-quality-evidence',
    message: 'File exceeds 5 MB scan limit: docs/oversized-journey.md',
  }],
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
  { id: 'story-artifact', repositoryId: 'repo-1', kind: 'story', title: 'App settings / Suspended', sourcePath: 'src/AppSettings.stories.tsx', summary: 'Storybook interaction surface', evidence: ['app-settings--suspended'] },
  { id: 'documentation-artifact', repositoryId: 'repo-1', kind: 'documentation', title: 'Application suspension journey', sourcePath: 'docs/suspension.md', summary: 'Repository documentation: Application suspension journey', evidence: ['An administrator suspends an application.'] },
  { id: 'test-plan-artifact', repositoryId: 'repo-1', kind: 'test-plan', title: 'administrator suspends an application', sourcePath: 'tests/suspension.spec.ts', summary: 'e2e playwright test discovered during repository analysis', evidence: ['test:suspension'] },
  { id: 'test-plan-artifact-retry', repositoryId: 'repo-1', kind: 'test-plan', title: 'administrator suspends an application', sourcePath: 'tests/suspension.spec.ts', summary: 'e2e playwright test discovered during repository analysis', evidence: ['test:suspension:retry'] },
  { id: 'policy-artifact', repositoryId: 'repo-1', kind: 'policy', title: 'Administrative suspension policy', sourcePath: 'docs/policies/apps.md', summary: 'Only administrators may suspend apps', evidence: ['role=administrator'] },
  { id: 'gate-artifact', repositoryId: 'repo-1', kind: 'gate', title: 'Suspension authorization gate', sourcePath: '.github/workflows/quality.yml', summary: 'Checks the administrator boundary', evidence: ['npm run test:authorization'] },
  { id: 'load-artifact', repositoryId: 'repo-1', kind: 'load-test', title: 'Application API load test', sourcePath: '.github/workflows/load.yml', summary: 'Sustained application API load', evidence: ['p95 < 500ms'], execution: { provider: 'github-actions', workflowPath: '.github/workflows/load.yml', trigger: 'workflow_dispatch' } },
]

const repositoryFlowCandidates = [{
  id: 'candidate-1', repositoryId: 'repo-1', tenantId: 'tenant-1', revision: 'abcdef123456', title: 'Suspend an application', confidence: 0.94,
  evidence: [],
  steps: [{ actor: 'administrator', action: 'selects Suspend', expectedOutcome: 'the application is suspended', targetIds: ['route-artifact'] }],
  wireframe: { kind: 'sequence', nodes: [{ label: 'App settings', targetIds: ['story-artifact'] }, { label: 'Confirm suspension', targetIds: ['route-artifact'] }, { label: 'Suspended state', targetIds: ['story-artifact'] }] },
  analysis: { provider: 'fuzeinfra-litellm', model: 'quality-analysis', promptVersion: 'fuzequality-repository-flow-v3', schemaVersion: '1.0' },
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
  branch: 'main', headRepository: 'izzywdev/FuzeService',
  workflowPath: '.github/workflows/post-prod.yml',
  sourceUrl: 'https://github.com/izzywdev/FuzeService/actions/runs/123', startedAt: '2026-10-08T11:00:00.000Z', completedAt: '2026-10-08T11:02:00.000Z',
  policyArtifactIds: ['policy-artifact'], gateArtifactIds: ['gate-artifact'], summary: 'Authorization assertion failed.',
  gateEvaluations: [{ policyArtifactId: 'policy-artifact', gateArtifactId: 'gate-artifact', status: 'failed', detail: 'The production authorization assertion failed.' }],
  thresholds: [], evidenceLinks: [],
}, {
  id: 'execution-load-1', repositoryId: 'repo-1', tenantId: 'tenant-1', revision: 'abcdef123456', kind: 'load', status: 'failed', name: 'Application API load test',
  provider: 'github-actions', externalRunId: '456', attempt: 1, workflowPath: '.github/workflows/load.yml',
  branch: 'main', headRepository: 'izzywdev/FuzeService',
  sourceUrl: 'https://github.com/izzywdev/FuzeService/actions/runs/456', startedAt: '2026-10-09T11:00:00.000Z', completedAt: '2026-10-09T11:05:00.000Z',
  policyArtifactIds: [], gateArtifactIds: [], summary: 'p95 latency exceeded the release threshold.', gateEvaluations: [], evidenceLinks: [],
  thresholds: [{ metric: 'p95 latency', observed: 640, unit: 'ms', operator: 'lte', target: 500, passed: false }],
}]

async function mockQualityApi(page: Page, fixture = portfolio) {
  let suggestionConfirmed = false
  let flowCandidates = repositoryFlowCandidates
  let flowReviewHistory = [{
    id: 'flow-review-initial',
    candidateId: 'candidate-1',
    tenantId: 'tenant-1',
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
    if (url.pathname.endsWith('/scan-history')) {
      const cursor = url.searchParams.get('cursor')
      return respond(cursor
        ? {
            items: [{ id: '00000000-0000-4000-8000-000000000001', revision: 'older123456789', branch: 'main', status: 'complete', scannedAt: '2026-10-09T09:00:00.000Z', trigger: 'push', counts: { operations: 1, surfaces: 1, tests: 2, diagnostics: 0 } }],
            page: { nextCursor: null, hasMore: false },
          }
        : {
            items: [{ id: '00000000-0000-4000-8000-000000000002', revision: 'latest12345678', branch: 'main', status: 'complete', scannedAt: '2026-10-10T10:00:00.000Z', trigger: 'manual', counts: { operations: 2, surfaces: 3, tests: 4, diagnostics: 0 } }],
            page: { nextCursor: 'scan-page-2', hasMore: true },
          })
    }
    if (url.pathname.endsWith('/quality-artifacts/by-ids')) {
      const ids = new Set(url.searchParams.getAll('id'))
      return respond({ items: qualityArtifacts.filter(artifact => ids.has(artifact.id)) })
    }
    if (url.pathname.endsWith('/quality-artifacts')) return respond(qualityArtifacts)
    if (url.pathname.endsWith('/flow-candidates')) {
      const filtered = flowCandidates.filter(flow =>
        (!url.searchParams.get('source') || flow.source === url.searchParams.get('source')) &&
        (!url.searchParams.get('status') || flow.status === url.searchParams.get('status')) &&
        (!url.searchParams.get('revision') || flow.revision === url.searchParams.get('revision')) &&
        (!url.searchParams.get('model') || flow.analysis?.model === url.searchParams.get('model')) &&
        (!url.searchParams.get('promptVersion') || flow.analysis?.promptVersion === url.searchParams.get('promptVersion')) &&
        (!url.searchParams.get('schemaVersion') || flow.analysis?.schemaVersion === url.searchParams.get('schemaVersion'))
      )
      return respond(filtered)
    }
    if (url.pathname.endsWith('/flow-candidates/candidate-1') && method === 'GET') {
      return respond(flowCandidates.find(flow => flow.id === 'candidate-1'))
    }
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
      flowReviewHistory = [{ id: 'flow-review-latest', candidateId: 'candidate-1', tenantId: 'tenant-1', status: payload.status, reviewedBy: 'quality-reviewer', reason: payload.reason, createdAt: reviewedAt }, ...flowReviewHistory]
      return respond(flowCandidates[0])
    }
    if (url.pathname.endsWith('/policy-gate-evaluations')) return respond(policyGateEvaluations)
    if (url.pathname.endsWith('/policy-gate-evaluations/evaluation-1/history')) return respond([
      { id: 'policy-review-2', evaluationId: 'evaluation-1', tenantId: 'tenant-1', status: 'accepted', reviewedBy: 'quality-owner', reason: 'Required for every production release.', createdAt: '2026-10-08T10:00:00.000Z' },
      { id: 'policy-review-1', evaluationId: 'evaluation-1', tenantId: 'tenant-1', status: 'dismissed', reviewedBy: 'platform-owner', reason: 'Initial evidence was incomplete.', createdAt: '2026-10-08T09:45:00.000Z' },
    ])
    if (url.pathname.endsWith('/performance-test-executions/latest')) {
      return respond({ items: testExecutions.filter(execution =>
        execution.kind === 'load' || execution.kind === 'stress'
      ) })
    }
    if (url.pathname.endsWith('/integration-test-executions/latest')) {
      return respond({ items: testExecutions.filter(execution => execution.kind === 'integration') })
    }
    if (url.pathname.endsWith('/post-production-test-executions/latest')) {
      return respond({ items: testExecutions.filter(execution => execution.kind === 'post-production') })
    }
    if (url.pathname.endsWith('/execution-trend')) return respond({
      items: [
        { date: '2026-10-09', passed: 0, failed: 1, cancelled: 0, running: 0 },
        { date: '2026-10-08', passed: 0, failed: 1, cancelled: 0, running: 0 },
      ],
      page: { nextCursor: null, hasMore: false },
    })
    if (url.pathname.endsWith('/test-executions/execution-1')) return respond({
      ...testExecutions[0],
      catalogRevision: 'execution-catalog-revision',
    })
    if (url.pathname.endsWith('/test-executions')) return respond(testExecutions)
    if (url.pathname.endsWith('/execution-performance')) return respond([{ repositoryId: 'repo-1', policyArtifactId: 'policy-artifact', policyTitle: 'Administrative suspension policy', policySourcePath: 'docs/policies/apps.md', gateArtifactId: 'gate-artifact', gateTitle: 'Admin authorization gate', gateSourcePath: '.github/workflows/authorization.yml', passed: 2, failed: 1, cancelled: 0, running: 0, revisionCount: 3, latestRevision: 'abcdef123456', latestCompletedAt: '2026-10-08T11:02:00.000Z' }])
    if (url.pathname.endsWith('/test-suites/load-artifact/execute') && method === 'POST') return respond({
      status: 'dispatched',
      artifactId: 'load-artifact',
      artifactKind: 'load-test',
      workflowPath: '.github/workflows/load.yml',
      ref: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      sourceRevision: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
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
  test.beforeEach(async ({ page }) => {
    await mockQualityApi(page)
    await page.goto('/', { waitUntil: 'domcontentloaded' })
  })

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
        navigate: (path: string) => window.history.pushState({}, '', path),
        menu: {
          add: (_appId: string, items: unknown[]) => menuItems.push(...items),
          remove: () => undefined,
        },
      }
    })
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: 'Manage' }).click()
    await expect(page).toHaveURL(/\/app\/fuzequality\/repositories$/)
    await expect(page.getByRole('heading', { name: 'Repository inventory' })).toBeVisible()
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
    await page.getByRole('button', { name: 'Manage' }).click()
    await expect(page).toHaveURL(/\/repositories$/)
    await expect(page.getByRole('heading', { name: 'Repository inventory' })).toBeVisible()

    await page.getByRole('button', { name: 'Operations' }).click()
    await expect(page).toHaveURL(/\/operations$/)
    await expect(page.getByRole('heading', { name: 'Operations', exact: true })).toBeVisible()
  })

  test('reviews repository flows, governance history, and execution evidence together', async ({ page }) => {
    await page.getByRole('button', { name: 'Quality intelligence' }).click()
    await expect(page.getByRole('heading', { name: 'Quality intelligence' })).toBeVisible()
    await expect(page.getByText('Repository analysis diagnostics')).toBeVisible()
    await expect(page.getByText('unreadable-quality-evidence')).toBeVisible()

    const originSummary = page.getByLabel('UX flow origin summary')
    await expect(originSummary).toContainText('1 deterministic flow')
    await expect(originSummary).toContainText('1 FuzeInfra LiteLLM proposal')
    await expect(page.getByText('Suspend an application', { exact: true })).toBeVisible()
    const flowCard = page.getByText('Suspend an application', { exact: true }).locator('..')
    await expect(flowCard.getByText('Repository izzywdev/FuzeService')).toBeVisible()
    await expect(page.getByText('FuzeInfra LiteLLM proposal', { exact: true })).toBeVisible()
    const analysisProvenance = page.getByLabel('Suspend an application analysis provenance')
    await expect(analysisProvenance).toContainText('fuzeinfra-litellm')
    await expect(analysisProvenance).toContainText('quality-analysis')
    await expect(analysisProvenance).toContainText('fuzequality-repository-flow-v3')
    await expect(analysisProvenance).toContainText('1.0')
    await expect(page.getByText('Deterministic repository evidence', { exact: true })).toBeVisible()
    await expect(page.getByText('Indexed suspension route', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Storybook states' })).toBeVisible()
    await expect(page.getByText('App settings / Suspended', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Repository documentation' })).toBeVisible()
    await expect(page.getByText('Application suspension journey', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Existing test plans' })).toBeVisible()
    await expect(page.getByText('administrator suspends an application', { exact: true })).toHaveCount(2)
    await expect(page.getByText('test:suspension', { exact: true })).toBeVisible()
    await expect(page.getByText('test:suspension:retry', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Suspend an application wireframe')).toContainText('App settings')
    const detailRequest = page.waitForRequest(request =>
      request.url().endsWith('/flow-candidates/candidate-1')
    )
    await flowCard.getByRole('button', { name: 'Inspect flow and wireframe' }).click()
    await detailRequest
    const flowInspector = page.getByRole('dialog', { name: 'Suspend an application' })
    await expect(flowInspector.getByLabel('Flow wireframe')).toContainText('Confirm suspension')
    await expect(flowInspector.getByLabel('Flow steps')).toContainText('the application is suspended')
    await expect(flowInspector.getByLabel('Flow provenance')).toContainText('fuzeinfra-litellm')
    await expect(flowInspector.getByLabel('Flow provenance')).toContainText('src/routes/apps.ts')
    await page.keyboard.press('Escape')
    await expect(flowInspector).toBeHidden()
    const modelRequest = page.waitForRequest(request =>
      new URL(request.url()).searchParams.get('model') === 'quality-analysis'
    )
    await page.getByLabel('Analysis model').fill('quality-analysis')
    await modelRequest
    const promptRequest = page.waitForRequest(request => {
      const url = new URL(request.url())
      return url.searchParams.get('model') === 'quality-analysis' &&
        url.searchParams.get('promptVersion') === 'fuzequality-repository-flow-v3'
    })
    await page.getByLabel('Prompt version').fill('fuzequality-repository-flow-v3')
    await promptRequest
    const schemaRequest = page.waitForRequest(request => {
      const url = new URL(request.url())
      return url.searchParams.get('promptVersion') === 'fuzequality-repository-flow-v3' &&
        url.searchParams.get('schemaVersion') === '1.0'
    })
    await page.getByLabel('Schema version').fill('1.0')
    await schemaRequest
    await expect(originSummary).toContainText('0 deterministic flows')
    await expect(originSummary).toContainText('1 FuzeInfra LiteLLM proposal')
    await flowCard.getByText('Source evidence', { exact: true }).click()
    await expect(flowCard.getByText('Revision abcdef123456')).toBeVisible()
    await expect(
      flowCard.getByText('route · src/routes/apps.ts', { exact: true })
    ).toBeVisible()
    await expect(flowCard.getByText('Artifact: Suspend app route')).toBeVisible()
    await expect(flowCard.getByLabel('selects Suspend targets')).toContainText(
      'route · src/routes/apps.ts · Suspend app route'
    )

    await flowCard.getByLabel('Optional review rationale').fill('Matches the protected suspension journey.')
    const flowReviewRequest = page.waitForRequest(request => request.url().endsWith('/flow-candidates/candidate-1/review'))
    await flowCard.getByRole('button', { name: 'Confirm' }).click()
    expect((await flowReviewRequest).postDataJSON()).toEqual({
      status: 'confirmed',
      reason: 'Matches the protected suspension journey.',
      expectedReviewedAt: null,
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
    const productionExecution = page.getByText('Production suspension journey', { exact: true }).locator('..')
    const executionMetadata = productionExecution.getByLabel('Execution provider metadata')
    await expect(executionMetadata.locator('[data-field="provider-run-id"]')).toContainText('github-actions · 123')
    await expect(executionMetadata.locator('[data-field="attempt"]')).toContainText('2')
    await expect(executionMetadata.locator('[data-field="workflow-path"]')).toContainText('.github/workflows/post-prod.yml')
    await expect(executionMetadata.locator('[data-field="duration"]')).toContainText('2m 0s')
    await expect(productionExecution.getByLabel('Policy gate linkage quality')).toContainText(
      'Explicit outcome linkage'
    )
    const gateEvidence = page.getByLabel('Policy gate evidence')
    await expect(gateEvidence.getByText('Administrative suspension policy')).toBeVisible()
    await expect(gateEvidence.getByText('Suspension authorization gate')).toBeVisible()
    await expect(gateEvidence).toContainText('docs/policies/apps.md → .github/workflows/quality.yml')
    await expect(productionExecution.getByRole('link', { name: 'Open CI run' })).toHaveAttribute('href', 'https://github.com/izzywdev/FuzeService/actions/runs/123')
    const executionDetailRequest = page.waitForRequest(request =>
      request.url().endsWith('/test-executions/execution-1')
    )
    const executionArtifactRequest = page.waitForRequest(request => {
      const url = new URL(request.url())
      return url.pathname.endsWith('/quality-artifacts/by-ids') &&
        url.searchParams.get('revision') === 'execution-catalog-revision'
    })
    await productionExecution.getByRole('button', { name: 'Inspect execution detail' }).click()
    await executionDetailRequest
    await executionArtifactRequest
    const executionInspector = page.getByRole('dialog', { name: 'Production suspension journey' })
    await expect(executionInspector.getByText('Administrative suspension policy')).toBeVisible()
    await expect(executionInspector.getByText('Suspension authorization gate')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(executionInspector).toBeHidden()
    const latestLoad = page.getByLabel('Latest execution for Application API load test')
    await expect(latestLoad).toContainText('failed · abcdef123456')
    await expect(latestLoad).toContainText('p95 latency exceeded the release threshold.')
    await expect(latestLoad.getByLabel('Execution evidence coverage')).toContainText(
      '1 thresholds · 0 artifacts · 0 policy–gate outcomes'
    )
    await expect(latestLoad.getByLabel('Policy gate linkage quality')).toContainText(
      'No policy–gate linkage'
    )
    await expect(latestLoad.getByLabel('Execution threshold evidence')).toContainText('640 ms ≤ 500 ms')
    await expect(latestLoad.getByText('Failed', { exact: true })).toBeVisible()
    const providerRequest = page.waitForRequest(request =>
      request.url().includes('/test-executions?provider=github-actions')
    )
    await page.getByLabel('Ingestion provider').selectOption('github-actions')
    await providerRequest
    const revisionRequest = page.waitForRequest(request => {
      const url = new URL(request.url())
      return url.pathname.endsWith('/test-executions') &&
        url.searchParams.get('provider') === 'github-actions' &&
        url.searchParams.get('revision') === 'abcdef123456'
    })
    await page.getByLabel('Source revision').fill('abcdef123456')
    await revisionRequest
    await expect(page.getByText('Administrative suspension policy → Admin authorization gate')).toBeVisible()
    await expect(page.getByLabel('Evidence repository')).toHaveText('izzywdev/FuzeService')
    await expect(page.getByText('docs/policies/apps.md → .github/workflows/authorization.yml')).toBeVisible()
    await expect(page.getByText('2 passed · 1 failed · 0 cancelled · 0 running')).toBeVisible()
    await expect(page.getByText('Observed across 3 source revisions')).toHaveAttribute('title', 'abcdef123456')
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

  test('continues bounded UX-flow and policy history pages', async ({ page }) => {
    const olderFlow = {
      ...repositoryFlowCandidates[0],
      id: 'candidate-older',
      title: 'Historical suspension flow',
      createdAt: '2026-10-07T09:00:00.000Z',
    }
    const olderEvaluation = {
      ...policyGateEvaluations[0],
      id: 'evaluation-older',
      title: 'Historical suspension policy finding',
      createdAt: '2026-10-07T09:30:00.000Z',
    }
    await page.route(
      url => url.pathname === '/api/v1/repositories/repo-1/flow-candidates',
      route => {
        const url = new URL(route.request().url())
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(url.searchParams.get('cursor')
            ? { items: [olderFlow], page: { nextCursor: null, hasMore: false } }
            : { items: [repositoryFlowCandidates[0]], page: { nextCursor: 'flow-page-2', hasMore: true } }),
        })
      }
    )
    await page.route(
      url => url.pathname === '/api/v1/repositories/repo-1/policy-gate-evaluations',
      route => {
        const url = new URL(route.request().url())
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(url.searchParams.get('cursor')
            ? { items: [olderEvaluation], page: { nextCursor: null, hasMore: false } }
            : { items: [policyGateEvaluations[0]], page: { nextCursor: 'policy-page-2', hasMore: true } }),
        })
      }
    )

    await page.getByRole('button', { name: 'Quality intelligence' }).click()
    await page.getByRole('button', { name: 'Load more UX-flow history' }).click()
    await expect(page.getByText(olderFlow.title, { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Load more policy and gate history' }).click()
    await expect(page.getByText(olderEvaluation.title, { exact: true })).toBeVisible()
  })

  test('continues immutable CI and post-production execution evidence', async ({ page }) => {
    const olderExecution = {
      ...testExecutions[0],
      id: 'execution-older',
      externalRunId: '654320',
      name: 'Historical production suspension journey',
      completedAt: '2026-10-07T09:00:00.000Z',
    }
    await page.route(
      url => url.pathname === '/api/v1/repositories/repo-1/test-executions',
      route => {
        const cursor = new URL(route.request().url()).searchParams.get('cursor')
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(cursor
            ? { items: [olderExecution], page: { nextCursor: null, hasMore: false } }
            : { items: [testExecutions[0]], page: { nextCursor: 'execution-page-2', hasMore: true } }),
        })
      }
    )

    await page.getByRole('button', { name: 'Quality intelligence' }).click()
    await page.getByRole('button', { name: 'Load more execution evidence' }).click()
    await expect(page.getByText(olderExecution.name, { exact: true })).toBeVisible()
  })

  test('renders the complete paginated execution outcome trend', async ({ page }) => {
    await page.route(
      url => url.pathname.endsWith('/execution-trend'),
      async route => {
        const cursor = new URL(route.request().url()).searchParams.get('cursor')
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(cursor
            ? {
                items: [{ date: '2026-09-01', passed: 4, failed: 2, cancelled: 0, running: 0 }],
                page: { nextCursor: null, hasMore: false },
              }
            : {
                items: [{ date: '2026-10-01', passed: 8, failed: 1, cancelled: 0, running: 0 }],
                page: { nextCursor: 'older-days', hasMore: true },
              }),
        })
      }
    )

    await page.getByRole('button', { name: 'Quality intelligence' }).click()

    const trend = page.getByLabel('Execution outcome trend')
    await expect(trend).toContainText('2026-10-01')
    await expect(trend).toContainText('8 passed')
    await expect(trend).not.toContainText('2026-09-01')
    await page.getByRole('button', { name: 'Load more outcome trend' }).click()
    await expect(trend).toContainText('2026-09-01')
    await expect(trend).toContainText('2 failed')
  })

  test('discards an obsolete outcome-trend page after the filter changes', async ({ page }) => {
    let releaseOlderPage: () => void = () => undefined
    const olderPageRequested = new Promise<void>(resolve => {
      releaseOlderPage = resolve
    })
    await page.route(
      url => url.pathname.endsWith('/execution-trend'),
      async route => {
        const url = new URL(route.request().url())
        if (url.searchParams.get('cursor')) {
          await olderPageRequested
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              items: [{ date: '2026-09-01', passed: 4, failed: 2, cancelled: 0, running: 0 }],
              page: { nextCursor: null, hasMore: false },
            }),
          })
        }
        const filtered = url.searchParams.get('status') === 'passed'
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: [{ date: filtered ? '2026-10-11' : '2026-10-01', passed: filtered ? 3 : 8, failed: filtered ? 0 : 1, cancelled: 0, running: 0 }],
            page: { nextCursor: filtered ? null : 'older-days', hasMore: !filtered },
          }),
        })
      }
    )

    await page.getByRole('button', { name: 'Quality intelligence' }).click()
    const trend = page.getByLabel('Execution outcome trend')
    await expect(trend).toContainText('2026-10-01')
    await page.getByRole('button', { name: 'Load more outcome trend' }).click()
    await page.getByRole('combobox', { name: /^Outcome/ }).selectOption('passed')
    await expect(trend).toContainText('2026-10-11')
    releaseOlderPage()
    await expect(trend).not.toContainText('2026-09-01')
  })

  test('continues bounded policy-gate performance aggregates', async ({ page }) => {
    const currentPair = { repositoryId: 'repo-1', policyArtifactId: 'policy-current', gateArtifactId: 'gate-current', failed: 3, passed: 1, cancelled: 0, running: 0 }
    const olderPair = { repositoryId: 'repo-1', policyArtifactId: 'policy-historical', gateArtifactId: 'gate-historical', failed: 1, passed: 4, cancelled: 0, running: 0 }
    await page.route(
      url => url.pathname === '/api/v1/repositories/repo-1/execution-performance',
      route => {
        const cursor = new URL(route.request().url()).searchParams.get('cursor')
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(cursor
            ? { items: [olderPair], page: { nextCursor: null, hasMore: false } }
            : { items: [currentPair], page: { nextCursor: 'performance-page-2', hasMore: true } }),
        })
      }
    )

    await page.getByRole('button', { name: 'Quality intelligence' }).click()
    await page.getByRole('button', { name: 'Load more policy-gate performance' }).click()
    await expect(page.getByText('policy-historical → gate-historical', { exact: true })).toBeVisible()
  })

  test('continues immutable UX-flow and governance review audit pages', async ({ page }) => {
    await page.route(
      url => url.pathname === '/api/v1/repositories/repo-1/flow-candidates/candidate-1/history',
      route => {
        const cursor = new URL(route.request().url()).searchParams.get('cursor')
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(cursor
            ? { items: [{ id: 'flow-review-1', candidateId: 'candidate-1', tenantId: 'tenant-1', status: 'confirmed', reviewedBy: 'flow-reviewer-1', createdAt: '2026-10-08T08:00:00.000Z' }], page: { nextCursor: null, hasMore: false } }
            : { items: [{ id: 'flow-review-2', candidateId: 'candidate-1', tenantId: 'tenant-1', status: 'rejected', reviewedBy: 'flow-reviewer-2', createdAt: '2026-10-08T09:00:00.000Z' }], page: { nextCursor: 'flow-review-page-2', hasMore: true } }),
        })
      }
    )
    await page.route(
      url => url.pathname === '/api/v1/repositories/repo-1/policy-gate-evaluations/evaluation-1/history',
      route => {
        const cursor = new URL(route.request().url()).searchParams.get('cursor')
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(cursor
            ? { items: [{ id: 'policy-review-1', evaluationId: 'evaluation-1', tenantId: 'tenant-1', status: 'accepted', reviewedBy: 'governance-reviewer-1', createdAt: '2026-10-08T08:00:00.000Z' }], page: { nextCursor: null, hasMore: false } }
            : { items: [{ id: 'policy-review-2', evaluationId: 'evaluation-1', tenantId: 'tenant-1', status: 'dismissed', reviewedBy: 'governance-reviewer-2', createdAt: '2026-10-08T09:00:00.000Z' }], page: { nextCursor: 'policy-review-page-2', hasMore: true } }),
        })
      }
    )

    await page.getByRole('button', { name: 'Quality intelligence' }).click()
    const flowCard = page.getByText('Suspend an application', { exact: true }).locator('..')
    await flowCard.getByText('UX flow review history', { exact: true }).click()
    await expect(page.getByText('flow-reviewer-2', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Load more UX flow decisions' }).click()
    await expect(page.getByText('flow-reviewer-1', { exact: true })).toBeVisible()

    await page.getByText('Review history', { exact: true }).click()
    await expect(page.getByText('governance-reviewer-2', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Load more governance decisions' }).click()
    await expect(page.getByText('governance-reviewer-1', { exact: true })).toBeVisible()
  })

  test('bounds historical UX-flow evidence and resolves referenced artifact IDs', async ({ page }) => {
    const historicalCandidates = Array.from({ length: 22 }, (_, index) => ({
      ...repositoryFlowCandidates[0],
      id: `historical-candidate-${index}`,
      revision: `historical-revision-${String(index).padStart(2, '0')}`,
      title: `Historical flow ${index}`,
      evidence: [`historical-artifact-${index}`],
      steps: repositoryFlowCandidates[0].steps.map(step => ({
        ...step,
        targetIds: [`historical-artifact-${index}`],
      })),
      createdAt: new Date(Date.UTC(2026, 9, 10) - index * 86_400_000).toISOString(),
    }))
    await page.route(
      url => url.pathname === '/api/v1/repositories/repo-1/flow-candidates',
      route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(historicalCandidates),
      })
    )
    const requestedArtifactIds: string[] = []
    await page.route(
      url => url.pathname === '/api/v1/repositories/repo-1/quality-artifacts/by-ids',
      route => {
        const url = new URL(route.request().url())
        requestedArtifactIds.push(...url.searchParams.getAll('id'))
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: url.searchParams.getAll('id')
              .filter(id => id.startsWith('historical-artifact-'))
              .map(id => ({
                ...qualityArtifacts[2],
                id,
                title: `Resolved ${id}`,
                sourcePath: `docs/${id}.md`,
              })),
          }),
        })
      }
    )

    await page.getByRole('button', { name: 'Quality intelligence' }).click()

    const historyLimit = page.getByRole('status').filter({
      hasText: 'Historical evidence is prefetched for the 20 newest revisions',
    })
    await expect(historyLimit).toContainText(
      'Historical evidence is prefetched for the 20 newest revisions'
    )
    await expect(historyLimit).toContainText('2 older revisions remain visible')
    await expect(page.getByText('Historical flow 21', { exact: true })).toBeVisible()
    await expect.poll(() => requestedArtifactIds.includes('historical-artifact-19')).toBe(true)
    expect(requestedArtifactIds).not.toContain('historical-artifact-20')
    expect(requestedArtifactIds).not.toContain('historical-artifact-21')
    const flowCard = page.getByText('Historical flow 19', { exact: true }).locator('..')
    await flowCard.getByText('Source evidence', { exact: true }).click()
    await expect(flowCard.getByText('documentation · docs/historical-artifact-19.md', { exact: true })).toBeVisible()
  })

  test('loads artifact context for governance revisions introduced by continuation', async ({ page }) => {
    const historicalEvaluation = {
      ...policyGateEvaluations[0],
      id: 'evaluation-historical',
      revision: 'historical-governance-revision',
      title: 'Historical suspension policy finding',
      policyArtifactIds: ['historical-policy-artifact'],
      createdAt: '2026-10-07T09:30:00.000Z',
    }
    const historicalArtifact = {
      ...qualityArtifacts[5],
      id: 'historical-policy-artifact',
      title: 'Historical administrative suspension policy',
      sourcePath: 'docs/policies/historical-apps.md',
    }
    await page.route(
      url => url.pathname === '/api/v1/repositories/repo-1/policy-gate-evaluations',
      route => {
        const url = new URL(route.request().url())
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(url.searchParams.get('revision')
            ? policyGateEvaluations
            : url.searchParams.get('cursor')
              ? { items: [historicalEvaluation], page: { nextCursor: null, hasMore: false } }
              : { items: policyGateEvaluations, page: { nextCursor: 'policy-page-2', hasMore: true } }),
        })
      }
    )
    await page.route(
      url => url.pathname === '/api/v1/repositories/repo-1/quality-artifacts/by-ids',
      route => {
        const url = new URL(route.request().url())
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: url.searchParams.getAll('id').includes(historicalArtifact.id)
              ? [historicalArtifact]
              : qualityArtifacts.filter(artifact => url.searchParams.getAll('id').includes(artifact.id)),
          }),
        })
      }
    )

    await page.getByRole('button', { name: 'Quality intelligence' }).click()
    await page.getByLabel('Governance revision').selectOption('all')
    await page.getByRole('button', { name: 'Load more policy and gate history' }).click()

    const evidence = page.getByLabel(`${historicalEvaluation.title} evidence`)
    await expect(evidence.getByText(historicalArtifact.title, { exact: true })).toBeVisible()
    await expect(evidence.getByText(`policy · ${historicalArtifact.sourcePath}`, { exact: true })).toBeVisible()
    await expect(evidence.getByText(historicalArtifact.id, { exact: true })).toHaveCount(0)
  })

  test('preserves a completed governance review while history continuation resolves', async ({ page }) => {
    const proposed = {
      ...policyGateEvaluations[0],
      reviewStatus: 'proposed',
      reviewedAt: undefined,
      reviewedBy: undefined,
      reviewReason: undefined,
    }
    const continued = {
      ...proposed,
      id: 'evaluation-page-2',
      title: 'Continued governance finding',
    }
    let releaseContinuation = () => undefined
    const continuation = new Promise<void>(resolve => {
      releaseContinuation = resolve
    })
    await page.route(
      url => url.pathname === '/api/v1/repositories/repo-1/policy-gate-evaluations',
      async route => {
        const url = new URL(route.request().url())
        if (url.searchParams.get('cursor')) {
          await continuation
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ items: [proposed, continued], page: { nextCursor: null, hasMore: false } }),
          })
        }
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ items: [proposed], page: { nextCursor: 'policy-page-2', hasMore: true } }),
        })
      }
    )
    await page.route(
      url => url.pathname === '/api/v1/repositories/repo-1/policy-gate-evaluations/evaluation-1/review',
      route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...proposed,
          reviewStatus: 'accepted',
          reviewedAt: '2026-10-11T12:00:00.000Z',
          reviewedBy: 'quality-reviewer',
        }),
      })
    )

    await page.getByRole('button', { name: 'Quality intelligence' }).click()
    await page.getByRole('button', { name: 'Load more policy and gate history' }).click()
    await page.getByLabel('Governance rationale required to accept anomaly').fill('The policy needs an explicit release gate.')
    await page.getByRole('button', { name: 'Accept recommendation' }).click()
    await expect(page.getByText('high · unguarded-policy · accepted', { exact: true })).toBeVisible()
    releaseContinuation()

    await expect(page.getByText(continued.title, { exact: true })).toBeVisible()
    await expect(page.getByText('high · unguarded-policy · accepted', { exact: true })).toBeVisible()
  })

  test('continues bounded repository evidence only after explicit review', async ({ page }) => {
    const cursors: Array<string | null> = []
    await page.route(
      url => url.pathname === '/api/v1/repositories/repo-1/quality-artifacts',
      route => {
        const url = new URL(route.request().url())
        const cursor = url.searchParams.get('cursor')
        cursors.push(cursor)
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(cursor
            ? {
                items: [{ ...qualityArtifacts[2], id: 'documentation-page-2', title: 'Continuation evidence' }],
                page: { nextCursor: null, hasMore: false },
              }
            : {
                items: Array.from({ length: 12 }, (_, index) => ({
                  ...qualityArtifacts[2],
                  id: `documentation-page-1-${index}`,
                  title: index === 0 ? 'Initial evidence' : `Initial evidence ${index + 1}`,
                })),
                page: { nextCursor: 'artifact-page-2', hasMore: true },
              }),
        })
      }
    )

    await page.getByRole('button', { name: 'Quality intelligence' }).click()

    await expect(page.getByText('Initial evidence', { exact: true })).toBeVisible()
    await expect(page.getByText('Continuation evidence', { exact: true })).toHaveCount(0)
    expect(cursors.length).toBeGreaterThan(0)
    expect(cursors.every(cursor => cursor === null)).toBe(true)
    await page.getByRole('button', { name: 'Load more repository evidence' }).click()
    await expect(page.getByText('Continuation evidence', { exact: true })).toBeVisible()
    expect(cursors[0]).toBeNull()
    expect(cursors).toContain('artifact-page-2')
  })

  test('keeps discovered tests and governance visible when latest performance evidence is unavailable', async ({ page }) => {
    await page.route(
      url => url.pathname.endsWith('/performance-test-executions/latest'),
      route => route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Execution history temporarily unavailable' }),
      })
    )

    await page.getByRole('button', { name: 'Quality intelligence' }).click()

    await expect(page.getByText('Application API load test', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Suspension policy requires a protected gate', { exact: true })).toBeVisible()
    await expect(page.getByRole('alert').filter({ hasText: 'Latest execution evidence is temporarily unavailable' })).toBeVisible()
  })

  test('retains execution and policy-gate evidence when the outcome trend is unavailable', async ({ page }) => {
    await page.route(
      url => url.pathname.endsWith('/execution-trend'),
      route => route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Execution trend temporarily unavailable' }),
      })
    )

    await page.getByRole('button', { name: 'Quality intelligence' }).click()

    await expect(page.getByText('Production suspension journey', { exact: true })).toBeVisible()
    await expect(page.getByText('Administrative suspension policy → Admin authorization gate')).toBeVisible()
    await expect(page.getByRole('alert').filter({ hasText: 'Execution outcome trend is temporarily unavailable for 1 repository' })).toBeVisible()
  })

  test('keeps historical UX-flow proposals visible but review-locked', async ({ page }) => {
    await page.route(
      url =>
        url.pathname ===
        '/api/v1/repositories/repo-1/flow-candidates',
      route =>
        route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify([
            {
              ...repositoryFlowCandidates[0],
              revision: 'historical-revision',
            },
          ]),
        })
    )

    await page.getByRole('button', { name: 'Quality intelligence' }).click()

    const flowCard = page
      .getByText('Suspend an application', { exact: true })
      .locator('..')
    await expect(flowCard.getByText(/Historical proposal/)).toBeVisible()
    await expect(flowCard.getByRole('button', { name: 'Confirm' })).toBeDisabled()
    await expect(flowCard.getByRole('button', { name: 'Reject' })).toBeDisabled()
    await expect(
      flowCard.getByLabel('Optional review rationale')
    ).toBeDisabled()
  })

  test('dispatches a reviewed load workflow with visible execution handoff', async ({ page }) => {
    await page.getByRole('button', { name: 'Quality intelligence' }).click()
    page.once('dialog', dialog => dialog.accept())
    const dispatchRequest = page.waitForRequest(request =>
      request.url().endsWith('/test-suites/load-artifact/execute')
    )

    await page.getByRole('button', { name: 'Run analyzed revision aaaaaaaaaaaa' }).click()

    expect((await dispatchRequest).method()).toBe('POST')
    const dispatchStatus = page.getByRole('status').filter({
      hasText: 'Dispatched .github/workflows/load.yml',
    })
    await expect(dispatchStatus).toContainText(
      'Dispatched .github/workflows/load.yml from aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa at analyzed commit aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    )
    await expect(dispatchStatus).toContainText(
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
    const rationale = page.getByLabel('Governance rationale required to accept anomaly')
    await rationale.fill('The gate owner is not identified.')

    await page.getByRole('button', { name: 'Dismiss' }).click()

    await expect(page.getByRole('alert')).toHaveText(
      'Governance review service unavailable'
    )
    await expect(rationale).toHaveValue('The gate owner is not identified.')
    await expect(page.getByRole('button', { name: 'Dismiss' })).toBeEnabled()
  })

  test('keeps historical governance findings visible but review-locked', async ({ page }) => {
    const historicalEvaluation = {
      ...policyGateEvaluations[0],
      revision: 'historical-revision',
      reviewStatus: 'proposed',
      reviewedAt: undefined,
      reviewedBy: undefined,
      reviewReason: undefined,
    }
    await page.route(
      url =>
        url.pathname ===
        '/api/v1/repositories/repo-1/policy-gate-evaluations',
      route =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([historicalEvaluation]),
        })
    )

    await page.getByRole('button', { name: 'Quality intelligence' }).click()
    await page.getByLabel('Governance revision').selectOption('all')

    await expect(
      page.getByText(/Historical governance finding/)
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Accept recommendation' })
    ).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Dismiss' })).toBeDisabled()
    await expect(
      page.getByLabel('Governance rationale required to accept anomaly')
    ).toBeDisabled()
  })

  test('scopes governance findings to the current analysis by default', async ({ page }) => {
    const currentRequest = page.waitForRequest(request => {
      const url = new URL(request.url())
      return (
        url.pathname.endsWith('/policy-gate-evaluations') &&
        url.searchParams.get('revision') === 'abcdef123456'
      )
    })

    await page.getByRole('button', { name: 'Quality intelligence' }).click()
    await currentRequest

    const historyRequest = page.waitForRequest(request => {
      const url = new URL(request.url())
      return (
        url.pathname.endsWith('/policy-gate-evaluations') &&
        !url.searchParams.has('revision')
      )
    })
    await page.getByLabel('Governance revision').selectOption('all')
    await historyRequest
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

  test('continues bounded repository analysis history', async ({ page }) => {
    await page.getByRole('button', { name: 'Repositories' }).click()
    await page.getByText('Scan history', { exact: true }).click()
    await expect(page.getByText(/latest123456/)).toBeVisible()

    const continuation = page.waitForRequest(request => {
      const url = new URL(request.url())
      return url.pathname.endsWith('/scan-history') && url.searchParams.get('cursor') === 'scan-page-2'
    })
    await page.getByRole('button', { name: 'Load more scan history' }).click()
    await continuation

    await expect(page.getByText(/older123456/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Load more scan history' })).toHaveCount(0)
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

test.describe('FuzeQuality standalone Security session', () => {
  test('completes MFA before loading tenant-scoped quality evidence', async ({ page }) => {
    let portfolioHeaders: Record<string, string> = {}
    await page.route('**/api/v1/**', async route => {
      const url = new URL(route.request().url())
      const method = route.request().method()
      const respond = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
      if (url.pathname.endsWith('/security/session') && method === 'POST') {
        return respond({ status: 'mfa_required', challengeId: 'challenge-1', factors: [{ factorId: 'totp-1', type: 'totp' }] })
      }
      if (url.pathname.endsWith('/security/mfa/challenge')) {
        return respond({ challengeId: 'challenge-1', factorId: 'totp-1', delivered: false }, 202)
      }
      if (url.pathname.endsWith('/security/mfa/verify')) {
        return respond({ token: 'verified-token', sessionId: 'session-1' })
      }
      if (url.pathname.endsWith('/security/session') && method === 'GET') {
        return respond({ identity: { tenantId: 'tenant-mfa' } })
      }
      if (url.pathname.endsWith('/portfolio')) {
        portfolioHeaders = route.request().headers()
        return respond(portfolio)
      }
      return respond({})
    })

    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.getByLabel('Email').fill('mfa@example.com')
    await page.getByLabel('Password').fill('secret')
    await page.getByRole('button', { name: 'Sign in securely' }).click()
    await expect(page.getByRole('heading', { name: 'Verify your identity' })).toBeVisible()
    await expect(page.getByText('Enter the current code from your authenticator app.')).toBeVisible()
    await page.getByLabel('Verification code').fill('123456')
    await page.getByRole('button', { name: 'Verify and continue' }).click()

    await expect(page.getByRole('heading', { name: /See what the platform promises/i })).toBeVisible()
    expect(portfolioHeaders.authorization).toBe('Bearer verified-token')
    expect(portfolioHeaders['x-fuzefront-tenant-id']).toBe('tenant-mfa')
  })
})
