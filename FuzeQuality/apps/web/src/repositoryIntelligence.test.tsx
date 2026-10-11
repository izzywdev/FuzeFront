// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type {
  Portfolio,
  QualityArtifact,
  Repository,
  RepositoryFlowCandidate,
  PolicyGateEvaluation,
  TestExecution,
} from '@fuzequality/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  flowCandidateMatchesInventory,
  policyGateEvaluationMatchesInventory,
  RepositoryIntelligence,
} from './App'
import { api, CatalogApiError } from './api'

const repository: Repository = {
  id: 'repo-1',
  owner: 'fuze',
  name: 'front',
  canonicalUrl: 'https://example.test/fuze/front',
  defaultBranch: 'main',
  kind: 'application',
  includeGlobs: [],
  excludeGlobs: [],
  jiraProjects: [],
  jiraBindings: [],
  enabled: true,
  lastScanRevision: 'revision-1',
  lastScanStatus: 'complete',
  lastScanDetails: {
    sourceRevision: 'a'.repeat(40),
    catalogRevision: 'revision-1',
    scannerVersion: '1.5.0',
    configVersion: 'config-1',
    partial: false,
    candidates: [],
    counts: { candidates: 0, operations: 0, frontendSurfaces: 0, tests: 0, diagnostics: 0 },
  },
}

const candidate: RepositoryFlowCandidate = {
  id: 'flow-1',
  repositoryId: repository.id,
  tenantId: 'tenant-1',
  revision: 'revision-1',
  title: 'Checkout flow',
  confidence: 0.9,
  evidence: ['src/checkout.ts:10'],
  steps: [
    {
      actor: 'Customer',
      action: 'Completes checkout',
      expectedOutcome: 'Order created',
      targetIds: [],
    },
  ],
  wireframe: {
    kind: 'sequence',
    nodes: [{ label: 'Checkout', targetIds: [] }],
  },
  status: 'proposed',
  source: 'litellm',
  createdAt: '2026-10-09T00:00:00.000Z',
}

const portfolio = {
  repositories: [repository],
  operations: [],
  surfaces: [],
  tests: [],
  expectations: [],
  findings: [],
  diagnostics: [],
  requirements: [],
  flows: [],
  suggestions: [],
} satisfies Portfolio

const storyArtifact: QualityArtifact = {
  id: 'artifact-story-1',
  repositoryId: repository.id,
  kind: 'story',
  title: 'Checkout / Complete',
  sourcePath: 'src/Checkout.stories.tsx',
  summary: 'Storybook interaction surface',
  evidence: ['checkout--complete'],
}

const documentationArtifact: QualityArtifact = {
  id: 'artifact-documentation-1',
  repositoryId: repository.id,
  kind: 'documentation',
  title: 'Checkout journey',
  sourcePath: 'docs/checkout.md',
  summary: 'Repository documentation: Checkout journey',
  evidence: ['The buyer completes checkout.'],
}

const testPlanArtifact: QualityArtifact = {
  id: 'artifact-test-plan-1',
  repositoryId: repository.id,
  kind: 'test-plan',
  title: 'customer completes checkout',
  sourcePath: 'tests/checkout.spec.ts',
  summary: 'e2e playwright test discovered during repository analysis',
  evidence: ['test:checkout'],
}

const loadArtifact: QualityArtifact = {
  id: 'artifact-load-1',
  repositoryId: repository.id,
  kind: 'load-test',
  title: 'Load test',
  sourcePath: '.github/workflows/nightly-benchmark.yml',
  summary: 'Load workflow',
  evidence: ['workflow_dispatch'],
  execution: {
    provider: 'github-actions',
    workflowPath: '.github/workflows/nightly-benchmark.yml',
    trigger: 'workflow_dispatch',
  },
}

const governanceEvaluation: PolicyGateEvaluation = {
  id: 'evaluation-1',
  repositoryId: repository.id,
  tenantId: 'tenant-1',
  revision: 'revision-1',
  kind: 'unguarded-policy',
  severity: 'high',
  title: 'Authentication policy has no gate',
  detail: 'No required check was linked to the authentication policy.',
  policyArtifactIds: ['policy-auth'],
  gateArtifactIds: [],
  confidence: 0.9,
  scope: { sourcePaths: ['governance/auth.md'], subjects: ['authentication'] },
  recommendation: 'Add an authentication gate.',
  reviewStatus: 'proposed',
  createdAt: '2026-10-09T00:00:00.000Z',
}

const loadExecution: TestExecution = {
  id: 'execution-load-1', repositoryId: repository.id, tenantId: 'tenant-1',
  provider: 'github-actions', externalRunId: '12345', attempt: 1,
  revision: 'revision-1', kind: 'load', status: 'failed', name: 'Load test',
  workflowPath: loadArtifact.sourcePath,
  sourceUrl: 'https://github.com/fuze/front/actions/runs/12345',
  completedAt: '2026-10-09T12:00:00.000Z',
  policyArtifactIds: [], gateArtifactIds: [], gateEvaluations: [], evidenceLinks: [],
  thresholds: [{ metric: 'p95 latency', observed: 420, unit: 'ms', operator: 'lte', target: 300, passed: false }],
  summary: 'Latency threshold exceeded.',
}

function mockEvidenceApis() {
  vi.spyOn(api, 'qualityArtifacts').mockResolvedValue([])
  vi.spyOn(api, 'policyGateEvaluations').mockResolvedValue([])
  vi.spyOn(api, 'testExecutions').mockResolvedValue([])
  vi.spyOn(api, 'executionTrend').mockResolvedValue([])
  vi.spyOn(api, 'executionPerformance').mockResolvedValue([])
  vi.spyOn(api, 'repositoryFlowReviewHistory').mockResolvedValue([])
  vi.spyOn(api, 'policyGateReviewHistory').mockResolvedValue([])
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('RepositoryIntelligence flow inventory', () => {
  it('continues immutable flow and governance review audit pages', async () => {
    mockEvidenceApis()
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([candidate])
    vi.mocked(api.policyGateEvaluations).mockResolvedValue([governanceEvaluation])
    const flowHistory = vi.mocked(api.repositoryFlowReviewHistory)
      .mockResolvedValueOnce({
        items: [{ id: 'flow-review-2', candidateId: candidate.id, tenantId: candidate.tenantId, status: 'rejected', reviewedBy: 'reviewer-2', createdAt: '2026-10-10T02:00:00.000Z' }],
        page: { nextCursor: 'flow-review-page-2', hasMore: true },
      })
      .mockResolvedValueOnce({
        items: [{ id: 'flow-review-1', candidateId: candidate.id, tenantId: candidate.tenantId, status: 'confirmed', reviewedBy: 'reviewer-1', createdAt: '2026-10-10T01:00:00.000Z' }],
        page: { nextCursor: null, hasMore: false },
      })
    const policyHistory = vi.mocked(api.policyGateReviewHistory)
      .mockResolvedValueOnce({
        items: [{ id: 'policy-review-2', evaluationId: governanceEvaluation.id, tenantId: governanceEvaluation.tenantId, status: 'dismissed', reviewedBy: 'governance-2', createdAt: '2026-10-10T02:00:00.000Z' }],
        page: { nextCursor: 'policy-review-page-2', hasMore: true },
      })
      .mockResolvedValueOnce({
        items: [{ id: 'policy-review-1', evaluationId: governanceEvaluation.id, tenantId: governanceEvaluation.tenantId, status: 'accepted', reviewedBy: 'governance-1', createdAt: '2026-10-10T01:00:00.000Z' }],
        page: { nextCursor: null, hasMore: false },
      })

    render(<RepositoryIntelligence data={portfolio} />)
    await screen.findByText(candidate.title)

    fireEvent.click(screen.getByText('UX flow review history'))
    expect(await screen.findByText('reviewer-2')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Load more UX flow decisions' }))
    expect(await screen.findByText('reviewer-1')).toBeVisible()
    expect(flowHistory).toHaveBeenLastCalledWith(repository.id, candidate.id, 'flow-review-page-2')

    fireEvent.click(screen.getByText('Review history'))
    expect(await screen.findByText('governance-2')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Load more governance decisions' }))
    expect(await screen.findByText('governance-1')).toBeVisible()
    expect(policyHistory).toHaveBeenLastCalledWith(repository.id, governanceEvaluation.id, 'policy-review-page-2')
  })

  it('continues UX-flow and policy history from opaque repository cursors', async () => {
    mockEvidenceApis()
    const olderFlow = {
      ...candidate,
      id: 'flow-older',
      title: 'Older checkout flow',
      createdAt: '2026-10-08T00:00:00.000Z',
    }
    const olderEvaluation = {
      ...governanceEvaluation,
      id: 'evaluation-older',
      title: 'Older authentication policy finding',
      createdAt: '2026-10-08T00:00:00.000Z',
    }
    const flowRequest = vi.spyOn(api, 'repositoryFlowCandidates')
      .mockResolvedValueOnce({ items: [candidate], page: { nextCursor: 'flow-page-2', hasMore: true } })
      .mockResolvedValueOnce({ items: [olderFlow], page: { nextCursor: null, hasMore: false } })
    vi.mocked(api.policyGateEvaluations)
      .mockResolvedValueOnce({ items: [governanceEvaluation], page: { nextCursor: 'policy-page-2', hasMore: true } })
      .mockResolvedValueOnce({ items: [olderEvaluation], page: { nextCursor: null, hasMore: false } })

    render(<RepositoryIntelligence data={portfolio} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Load more UX-flow history' }))
    expect(await screen.findByText(olderFlow.title)).toBeVisible()
    expect(flowRequest).toHaveBeenLastCalledWith(repository.id, expect.objectContaining({
      cursor: 'flow-page-2',
    }))

    fireEvent.click(screen.getByRole('button', { name: 'Load more policy and gate history' }))
    expect(await screen.findByText(olderEvaluation.title)).toBeVisible()
    expect(api.policyGateEvaluations).toHaveBeenLastCalledWith(
      repository.id,
      expect.objectContaining({
        cursor: 'policy-page-2',
        revision: repository.lastScanRevision,
      })
    )
  })

  it('loads bounded artifact context for governance revisions introduced by continuation', async () => {
    mockEvidenceApis()
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])
    const historicalEvaluation: PolicyGateEvaluation = {
      ...governanceEvaluation,
      id: 'evaluation-historical',
      revision: 'revision-historical',
      title: 'Historical authentication finding',
      policyArtifactIds: ['policy-historical'],
      createdAt: '2026-10-08T00:00:00.000Z',
    }
    const historicalArtifact: QualityArtifact = {
      id: 'policy-historical',
      repositoryId: repository.id,
      kind: 'policy',
      title: 'Historical authentication policy',
      sourcePath: 'governance/historical-auth.md',
      summary: 'Authentication policy at the reviewed revision.',
      evidence: ['Authentication is required.'],
    }
    vi.mocked(api.policyGateEvaluations).mockImplementation(async (_repositoryId, query = {}) => {
      if (query.revision) return [governanceEvaluation]
      return query.cursor
        ? { items: [historicalEvaluation], page: { nextCursor: null, hasMore: false } }
        : { items: [governanceEvaluation], page: { nextCursor: 'policy-page-2', hasMore: true } }
    })
    vi.mocked(api.qualityArtifacts).mockImplementation(async (_repositoryId, revision) =>
      revision === historicalEvaluation.revision ? [historicalArtifact] : []
    )

    render(<RepositoryIntelligence data={portfolio} />)

    fireEvent.change(await screen.findByLabelText('Governance revision'), {
      target: { value: 'all' },
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Load more policy and gate history' }))

    expect(await screen.findByText(historicalEvaluation.title)).toBeVisible()
    const evidence = screen.getByLabelText(`${historicalEvaluation.title} evidence`)
    expect(within(evidence).getByText(historicalArtifact.title)).toBeVisible()
    expect(within(evidence).queryByText(historicalArtifact.id)).not.toBeInTheDocument()
    expect(api.qualityArtifacts).toHaveBeenCalledWith(
      repository.id,
      historicalEvaluation.revision,
    )
  })

  it('continues immutable execution evidence from an opaque repository cursor', async () => {
    mockEvidenceApis()
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])
    const olderExecution: TestExecution = {
      ...loadExecution,
      id: 'execution-load-older',
      externalRunId: '12344',
      name: 'Older load test',
      completedAt: '2026-10-08T12:00:00.000Z',
    }
    vi.mocked(api.testExecutions)
      .mockResolvedValueOnce({ items: [loadExecution], page: { nextCursor: 'execution-page-2', hasMore: true } })
      .mockResolvedValueOnce({ items: [olderExecution], page: { nextCursor: null, hasMore: false } })

    render(<RepositoryIntelligence data={portfolio} />)

    expect(await screen.findByText(loadExecution.name)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Load more execution evidence' }))
    expect(await screen.findByText(olderExecution.name)).toBeVisible()
    expect(api.testExecutions).toHaveBeenLastCalledWith(repository.id, {
      cursor: 'execution-page-2',
    })
  })

  it('renders complete server-aggregated outcome history independently of loaded execution rows', async () => {
    mockEvidenceApis()
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])
    vi.mocked(api.testExecutions).mockResolvedValue({
      items: [loadExecution],
      page: { nextCursor: 'older-executions', hasMore: true },
    })
    vi.mocked(api.executionTrend).mockResolvedValue([
      { date: '2026-10-01', passed: 7, failed: 2, cancelled: 1, running: 0 },
    ])

    render(<RepositoryIntelligence data={portfolio} />)

    const trend = await screen.findByLabelText('Execution outcome trend')
    expect(trend).toHaveTextContent('2026-10-01')
    expect(trend).toHaveTextContent('7 passed')
    expect(trend).toHaveTextContent('2 failed')
    expect(api.executionTrend).toHaveBeenCalledWith(repository.id, {})
  })

  it('loads older outcome trend pages only after an explicit continuation', async () => {
    mockEvidenceApis()
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])
    vi.mocked(api.executionTrend)
      .mockResolvedValueOnce({
        items: [{ date: '2026-10-01', passed: 7, failed: 2, cancelled: 1, running: 0 }],
        page: { nextCursor: 'older-days', hasMore: true },
      })
      .mockResolvedValueOnce({
        items: [{ date: '2026-09-01', passed: 4, failed: 1, cancelled: 0, running: 0 }],
        page: { nextCursor: null, hasMore: false },
      })

    render(<RepositoryIntelligence data={portfolio} />)

    const trend = await screen.findByLabelText('Execution outcome trend')
    expect(trend).toHaveTextContent('2026-10-01')
    expect(trend).not.toHaveTextContent('2026-09-01')
    fireEvent.click(screen.getByRole('button', { name: 'Load more outcome trend' }))
    await waitFor(() => expect(trend).toHaveTextContent('2026-09-01'))
    expect(api.executionTrend).toHaveBeenLastCalledWith(repository.id, { cursor: 'older-days' })
  })

  it('discards an older trend continuation when the execution filter changes', async () => {
    mockEvidenceApis()
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])
    let resolveOlder: (value: Awaited<ReturnType<typeof api.executionTrend>>) => void = () => undefined
    const olderPage = new Promise<Awaited<ReturnType<typeof api.executionTrend>>>(resolve => {
      resolveOlder = resolve
    })
    vi.mocked(api.executionTrend)
      .mockResolvedValueOnce({
        items: [{ date: '2026-10-01', passed: 7, failed: 2, cancelled: 1, running: 0 }],
        page: { nextCursor: 'older-days', hasMore: true },
      })
      .mockImplementationOnce(() => olderPage)
      .mockResolvedValueOnce({
        items: [{ date: '2026-10-11', passed: 3, failed: 0, cancelled: 0, running: 0 }],
        page: { nextCursor: null, hasMore: false },
      })

    render(<RepositoryIntelligence data={portfolio} />)

    const trend = await screen.findByLabelText('Execution outcome trend')
    fireEvent.click(await screen.findByRole('button', { name: 'Load more outcome trend' }))
    await waitFor(() => expect(api.executionTrend).toHaveBeenCalledWith(repository.id, { cursor: 'older-days' }))
    fireEvent.change(screen.getByLabelText('Outcome'), { target: { value: 'passed' } })
    await waitFor(() => expect(api.executionTrend).toHaveBeenCalledWith(repository.id, { status: 'passed' }))
    await act(async () => {
      resolveOlder({
        items: [{ date: '2026-09-01', passed: 4, failed: 1, cancelled: 0, running: 0 }],
        page: { nextCursor: null, hasMore: false },
      })
      await olderPage
    })

    await waitFor(() => expect(trend).toHaveTextContent('2026-10-11'))
    expect(trend).not.toHaveTextContent('2026-09-01')
  })

  it('retains execution and policy-gate evidence when the optional trend request fails', async () => {
    mockEvidenceApis()
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])
    vi.mocked(api.testExecutions).mockResolvedValue([loadExecution])
    vi.mocked(api.executionPerformance).mockResolvedValue([{
      repositoryId: repository.id,
      policyArtifactId: 'policy-auth',
      gateArtifactId: 'gate-auth',
      passed: 2,
      failed: 1,
      cancelled: 0,
      running: 0,
    }])
    vi.mocked(api.executionTrend).mockRejectedValue(new Error('trend unavailable'))

    render(<RepositoryIntelligence data={portfolio} />)

    expect(await screen.findByText(loadExecution.name)).toBeVisible()
    expect(screen.getByText('policy-auth → gate-auth')).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Execution outcome trend is temporarily unavailable for 1 repository'
    )
  })

  it('retains execution history and trend when policy-gate performance fails', async () => {
    mockEvidenceApis()
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])
    vi.mocked(api.testExecutions).mockResolvedValue([loadExecution])
    vi.mocked(api.executionTrend).mockResolvedValue([
      { date: '2026-10-01', passed: 7, failed: 2, cancelled: 1, running: 0 },
    ])
    vi.mocked(api.executionPerformance).mockRejectedValue(new Error('performance unavailable'))

    render(<RepositoryIntelligence data={portfolio} />)

    expect(await screen.findByText(loadExecution.name)).toBeVisible()
    expect(screen.getByLabelText('Execution outcome trend')).toHaveTextContent('7 passed')
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Policy-gate performance is temporarily unavailable for 1 repository'
    )
  })

  it('continues policy-gate performance from its aggregate cursor', async () => {
    mockEvidenceApis()
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])
    const latest = {
      repositoryId: repository.id,
      policyArtifactId: 'policy-latest',
      gateArtifactId: 'gate-latest',
      failed: 3,
      passed: 1,
      cancelled: 0,
      running: 0,
    }
    const older = {
      ...latest,
      policyArtifactId: 'policy-older',
      gateArtifactId: 'gate-older',
      failed: 1,
      passed: 4,
    }
    vi.mocked(api.executionPerformance)
      .mockResolvedValueOnce({ items: [latest], page: { nextCursor: 'performance-page-2', hasMore: true } })
      .mockResolvedValueOnce({ items: [older], page: { nextCursor: null, hasMore: false } })

    render(<RepositoryIntelligence data={portfolio} />)

    expect(await screen.findByText('policy-latest → gate-latest')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Load more policy-gate performance' }))
    expect(await screen.findByText('policy-older → gate-older')).toBeVisible()
    expect(api.executionPerformance).toHaveBeenLastCalledWith(repository.id, {
      cursor: 'performance-page-2',
    })
  })

  it('surfaces repository evidence scan failures to reviewers', async () => {
    mockEvidenceApis()
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])
    render(<RepositoryIntelligence data={{
      ...portfolio,
      diagnostics: [{
        repositoryId: repository.id,
        revision: 'revision-1',
        sourcePath: 'docs/journey.md',
        category: 'repository',
        severity: 'error',
        code: 'unreadable-quality-evidence',
        message: 'File exceeds 5 MB scan limit: docs/journey.md',
      }],
    }} />)

    expect(screen.getByText('Repository analysis diagnostics')).toBeVisible()
    expect(screen.getByText('unreadable-quality-evidence')).toBeVisible()
    expect(screen.getByText(/fuze\/front · docs\/journey\.md/)).toBeVisible()
  })

  it('excludes a reviewed candidate when it no longer matches the active status', async () => {
    mockEvidenceApis()
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([candidate])
    vi.spyOn(api, 'reviewRepositoryFlowCandidate').mockResolvedValue({
      ...candidate,
      status: 'confirmed',
      reviewedAt: '2026-10-09T01:00:00.000Z',
    })
    render(<RepositoryIntelligence data={portfolio} />)

    await screen.findByText(candidate.title)
    fireEvent.change(screen.getByLabelText('Review state'), {
      target: { value: 'proposed' },
    })
    await waitFor(() => expect(screen.getByText(candidate.title)).toBeVisible())
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() =>
      expect(screen.queryByText(candidate.title)).not.toBeInTheDocument()
    )
  })

  it('locks review controls for a candidate from a historical revision', async () => {
    mockEvidenceApis()
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([
      { ...candidate, revision: 'historical-revision' },
    ])

    render(<RepositoryIntelligence data={portfolio} />)

    expect(await screen.findByText(/Historical proposal/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled()
    expect(screen.getByLabelText('Optional review rationale')).toBeDisabled()
  })

  it('locks a flow review after an atomic stale-revision conflict and preserves rationale', async () => {
    mockEvidenceApis()
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([candidate])
    vi.spyOn(api, 'reviewRepositoryFlowCandidate').mockRejectedValue(
      new CatalogApiError(
        'The UX-flow candidate is stale. Refresh before deciding.',
        'STALE_FLOW_CANDIDATE',
        409
      )
    )

    render(<RepositoryIntelligence data={portfolio} />)
    await screen.findByText(candidate.title)
    const rationale = screen.getByLabelText('Optional review rationale')
    fireEvent.change(rationale, { target: { value: 'Matches the observed path.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Refresh before deciding')
    expect(rationale).toHaveValue('Matches the observed path.')
    expect(rationale).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled()
  })

  it('reloads only flows, hides stale results, and is not blocked by an invalid execution range', async () => {
    mockEvidenceApis()
    let resolveFiltered: (value: RepositoryFlowCandidate[]) => void = () => {}
    const filtered = new Promise<RepositoryFlowCandidate[]>(resolve => {
      resolveFiltered = resolve
    })
    const flowRequest = vi
      .spyOn(api, 'repositoryFlowCandidates')
      .mockResolvedValueOnce([candidate])
      .mockReturnValueOnce(filtered)
    render(<RepositoryIntelligence data={portfolio} />)
    await screen.findByText(candidate.title)

    fireEvent.change(screen.getByLabelText('From'), {
      target: { value: '2026-10-09T12:00' },
    })
    fireEvent.change(screen.getByLabelText('Until'), {
      target: { value: '2026-10-09T11:00' },
    })
    await waitFor(() => expect(screen.getByText('No execution evidence received')).toBeVisible())
    const unrelatedCounts = {
      artifacts: vi.mocked(api.qualityArtifacts).mock.calls.length,
      evaluations: vi.mocked(api.policyGateEvaluations).mock.calls.length,
      executions: vi.mocked(api.testExecutions).mock.calls.length,
      performance: vi.mocked(api.executionPerformance).mock.calls.length,
    }

    fireEvent.change(screen.getByLabelText('Origin'), {
      target: { value: 'litellm' },
    })

    expect(flowRequest).toHaveBeenCalledTimes(2)
    expect(screen.queryByText(candidate.title)).not.toBeInTheDocument()
    expect(screen.getByText('Loading UX flows…')).toBeVisible()
    expect(vi.mocked(api.qualityArtifacts)).toHaveBeenCalledTimes(
      unrelatedCounts.artifacts
    )
    expect(vi.mocked(api.policyGateEvaluations)).toHaveBeenCalledTimes(
      unrelatedCounts.evaluations
    )
    expect(vi.mocked(api.testExecutions)).toHaveBeenCalledTimes(
      unrelatedCounts.executions
    )
    expect(vi.mocked(api.executionPerformance)).toHaveBeenCalledTimes(
      unrelatedCounts.performance
    )

    resolveFiltered([])
    await waitFor(() =>
      expect(screen.queryByText('Loading UX flows…')).not.toBeInTheDocument()
    )
  })

  it('matches reviewed results against repository, source, status, and revision', () => {
    expect(
      flowCandidateMatchesInventory(candidate, [repository], {
        repositoryId: repository.id,
        source: 'litellm',
        status: 'proposed',
        revisionScope: 'current',
        model: '',
        promptVersion: '',
        schemaVersion: '',
      })
    ).toBe(true)
    expect(
      flowCandidateMatchesInventory(
        { ...candidate, status: 'confirmed' },
        [repository],
        {
          repositoryId: repository.id,
          source: 'litellm',
          status: 'proposed',
          revisionScope: 'current',
          model: '',
          promptVersion: '',
          schemaVersion: '',
        }
      )
    ).toBe(false)
  })

  it('queries and labels flows by exact LiteLLM provenance', async () => {
    mockEvidenceApis()
    const flowRequest = vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([
      {
        ...candidate,
        analysis: {
          provider: 'fuzeinfra-litellm',
          model: 'quality-analysis',
          promptVersion: 'flow-v2',
          schemaVersion: '2.0',
        },
      },
    ])

    render(<RepositoryIntelligence data={portfolio} />)
    await screen.findByText(candidate.title)
    expect(screen.getByText('Repository fuze/front')).toBeVisible()

    fireEvent.change(screen.getByLabelText('Analysis model'), {
      target: { value: 'quality-analysis' },
    })
    fireEvent.change(screen.getByLabelText('Prompt version'), {
      target: { value: 'flow-v2' },
    })
    fireEvent.change(screen.getByLabelText('Schema version'), {
      target: { value: '2.0' },
    })

    await waitFor(() =>
      expect(flowRequest).toHaveBeenLastCalledWith(repository.id, {
        model: 'quality-analysis',
        promptVersion: 'flow-v2',
        schemaVersion: '2.0',
      })
    )
  })

  it('loads the tenant-scoped flow detail before opening the wireframe inspector', async () => {
    mockEvidenceApis()
    vi.mocked(api.qualityArtifacts).mockResolvedValue([storyArtifact])
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([
      { ...candidate, evidence: [storyArtifact.id] },
    ])
    const detailRequest = vi.spyOn(api, 'repositoryFlowCandidate').mockResolvedValue({
      ...candidate,
      evidence: [storyArtifact.id],
      analysis: {
        provider: 'fuzeinfra-litellm',
        model: 'quality-analysis',
        promptVersion: 'flow-v2',
        schemaVersion: '2.0',
      },
    })

    render(<RepositoryIntelligence data={portfolio} />)
    await screen.findByText(candidate.title)
    fireEvent.click(screen.getByRole('button', { name: 'Inspect flow and wireframe' }))

    expect(await screen.findByRole('dialog', { name: candidate.title })).toBeVisible()
    expect(detailRequest).toHaveBeenCalledWith(repository.id, candidate.id)
    expect(screen.getByRole('region', { name: 'Flow wireframe' })).toHaveTextContent('Checkout')
    const provenance = screen.getByRole('region', { name: 'Flow provenance' })
    expect(provenance).toHaveTextContent('flow-v2')
    expect(within(provenance).getByText(storyArtifact.sourcePath)).toBeVisible()
  })

  it('resolves flow evidence identifiers to repository source paths', async () => {
    mockEvidenceApis()
    vi.mocked(api.qualityArtifacts).mockResolvedValue([storyArtifact])
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([
      { ...candidate, evidence: [storyArtifact.id] },
    ])

    render(<RepositoryIntelligence data={portfolio} />)
    await screen.findByText(candidate.title)
    fireEvent.click(screen.getByText('Source evidence'))

    expect(
      screen.getByText('story · src/Checkout.stories.tsx')
    ).toBeVisible()
    expect(screen.getByText('Artifact: Checkout / Complete')).toBeVisible()
  })

  it('resolves artifacts referenced only by LiteLLM flow steps', async () => {
    mockEvidenceApis()
    vi.mocked(api.qualityArtifacts).mockResolvedValue([storyArtifact])
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([
      {
        ...candidate,
        evidence: [],
        steps: [
          {
            ...candidate.steps[0],
            targetIds: [storyArtifact.id],
          },
        ],
      },
    ])

    render(<RepositoryIntelligence data={portfolio} />)
    await screen.findByText(candidate.title)
    fireEvent.click(screen.getByText('Source evidence'))

    expect(
      screen.getByText('story · src/Checkout.stories.tsx')
    ).toBeVisible()
    expect(
      screen.getByLabelText('Completes checkout targets')
    ).toHaveTextContent(
      'story · src/Checkout.stories.tsx · Checkout / Complete'
    )
  })

  it('loads revision-specific artifacts for historical flow evidence', async () => {
    mockEvidenceApis()
    const historicalArtifact = { ...storyArtifact, id: 'artifact-story-historical' }
    vi.mocked(api.qualityArtifacts).mockImplementation(async (_repositoryId, revision) =>
      revision === 'historical-revision' ? [historicalArtifact] : []
    )
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([{
      ...candidate,
      id: 'flow-historical',
      revision: 'historical-revision',
      evidence: [historicalArtifact.id],
    }])

    render(<RepositoryIntelligence data={portfolio} />)
    await screen.findByText(candidate.title)
    fireEvent.click(screen.getByText('Source evidence'))

    expect(api.qualityArtifacts).toHaveBeenCalledWith(repository.id, 'historical-revision')
    expect(await screen.findByText('story · src/Checkout.stories.tsx')).toBeVisible()
    expect(screen.getByText('Artifact: Checkout / Complete')).toBeVisible()
  })

  it('renders repository evidence classes supplied to reviewed flow analysis', async () => {
    mockEvidenceApis()
    vi.mocked(api.qualityArtifacts).mockResolvedValue([
      storyArtifact,
      documentationArtifact,
      testPlanArtifact,
    ])
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])

    render(<RepositoryIntelligence data={portfolio} />)

    expect(await screen.findByRole('heading', { name: 'Storybook states' })).toBeVisible()
    expect(screen.getByText(storyArtifact.title)).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Repository documentation' })).toBeVisible()
    expect(screen.getByText(documentationArtifact.title)).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Existing test plans' })).toBeVisible()
    expect(screen.getByText(testPlanArtifact.title)).toBeVisible()
  })

  it('loads only the first repository evidence page until explicit continuation', async () => {
    mockEvidenceApis()
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])
    vi.mocked(api.qualityArtifacts)
      .mockResolvedValueOnce({
        items: [{ ...documentationArtifact, id: 'documentation-page-1', title: 'Initial evidence' }],
        page: { nextCursor: 'artifact-page-2', hasMore: true },
      })
      .mockResolvedValueOnce({
        items: [{ ...documentationArtifact, id: 'documentation-page-2', title: 'Continuation evidence' }],
        page: { nextCursor: null, hasMore: false },
      })

    render(<RepositoryIntelligence data={portfolio} />)

    expect(await screen.findByText('Initial evidence', { exact: true })).toBeVisible()
    expect(screen.queryByText('Continuation evidence', { exact: true })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Load more repository evidence' }))
    expect(await screen.findByText('Continuation evidence', { exact: true })).toBeVisible()
    expect(api.qualityArtifacts).toHaveBeenLastCalledWith(repository.id, undefined, 'artifact-page-2')
  })

  it('renders repeated test titles as separate evidence plans', async () => {
    mockEvidenceApis()
    vi.mocked(api.qualityArtifacts).mockResolvedValue([
      testPlanArtifact,
      {
        ...testPlanArtifact,
        id: 'artifact-test-plan-2',
        evidence: ['test:checkout:second'],
      },
    ])
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])

    render(<RepositoryIntelligence data={portfolio} />)

    expect(await screen.findAllByText(testPlanArtifact.title)).toHaveLength(2)
    expect(screen.getByText('test:checkout')).toBeVisible()
    expect(screen.getByText('test:checkout:second')).toBeVisible()
  })

  it('shows a durable handoff message after dispatching a performance workflow', async () => {
    mockEvidenceApis()
    vi.mocked(api.qualityArtifacts).mockResolvedValue([loadArtifact])
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])
    vi.spyOn(api, 'runPerformanceTest').mockResolvedValue({
      status: 'dispatched',
      artifactId: loadArtifact.id,
      workflowPath: loadArtifact.sourcePath,
      ref: 'main',
      sourceRevision: 'a'.repeat(40),
    })
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<RepositoryIntelligence data={portfolio} />)
    fireEvent.click(
      await screen.findByRole('button', { name: /Run analyzed revision a{12}/ })
    )

    await waitFor(() =>
      expect(api.runPerformanceTest).toHaveBeenCalledWith(
        repository.id,
        loadArtifact.id
      )
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      `Dispatched ${loadArtifact.sourcePath} from main at analyzed commit ${'a'.repeat(40)}`
    )
  })

  it('keeps dispatch failures actionable beside the selected workflow', async () => {
    mockEvidenceApis()
    vi.mocked(api.qualityArtifacts).mockResolvedValue([loadArtifact])
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])
    vi.spyOn(api, 'runPerformanceTest').mockRejectedValue(
      new Error('GitHub App installation is required')
    )
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<RepositoryIntelligence data={portfolio} />)
    fireEvent.click(
      await screen.findByRole('button', { name: /Run analyzed revision a{12}/ })
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'GitHub App installation is required'
    )
  })

  it('keeps a discovered performance definition inventory-only without workflow_dispatch evidence', async () => {
    mockEvidenceApis()
    vi.mocked(api.qualityArtifacts).mockResolvedValue([
      { ...loadArtifact, sourcePath: 'load/k6-test.js', execution: undefined },
    ])
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])

    render(<RepositoryIntelligence data={portfolio} />)

    expect(await screen.findByText(/Inventory only/)).toHaveTextContent(
      'workflow_dispatch workflow must declare the reviewed FUZEQUALITY_PERFORMANCE environment marker as load or stress'
    )
    expect(
      screen.queryByRole('button', { name: /Run analyzed revision/ })
    ).not.toBeInTheDocument()
  })

  it('keeps workflows with unresolved required inputs inventory-only', async () => {
    mockEvidenceApis()
    vi.mocked(api.qualityArtifacts).mockResolvedValue([{
      ...loadArtifact,
      execution: {
        ...loadArtifact.execution!,
        requiredInputs: ['environment', 'duration'],
      },
    }])
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])

    render(<RepositoryIntelligence data={portfolio} />)

    expect(await screen.findByText(/required workflow inputs/)).toHaveTextContent(
      'environment, duration',
    )
    expect(screen.queryByRole('button', { name: /Run analyzed revision/ })).not.toBeInTheDocument()
  })

  it('does not offer dispatch without an immutable analyzed source revision', async () => {
    mockEvidenceApis()
    vi.mocked(api.qualityArtifacts).mockResolvedValue([loadArtifact])
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])

    render(<RepositoryIntelligence data={{
      ...portfolio,
      repositories: [{ ...repository, lastScanDetails: undefined }],
    }} />)

    expect(await screen.findByText(/run repository analysis at an exact commit/)).toBeVisible()
    expect(
      screen.queryByRole('button', { name: /Run analyzed revision/ })
    ).not.toBeInTheDocument()
  })

  it('shows the latest matching load outcome and threshold beside its definition', async () => {
    mockEvidenceApis()
    vi.mocked(api.qualityArtifacts).mockResolvedValue([loadArtifact])
    vi.mocked(api.testExecutions).mockResolvedValue([loadExecution])
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])

    render(<RepositoryIntelligence data={portfolio} />)

    const outcome = await screen.findByLabelText(`Latest execution for ${loadArtifact.title}`)
    expect(outcome).toHaveTextContent('failed · revision-1')
    expect(outcome).toHaveTextContent('Latency threshold exceeded.')
    expect(outcome).toHaveTextContent('p95 latency')
    expect(outcome).toHaveTextContent('420 ms ≤ 300 ms')
    expect(within(outcome).getByRole('link', { name: /Open CI run/ })).toHaveAttribute('href', loadExecution.sourceUrl)
  })

  it('keeps repository and governance evidence visible when optional performance history fails', async () => {
    mockEvidenceApis()
    vi.mocked(api.qualityArtifacts).mockResolvedValue([loadArtifact])
    vi.mocked(api.policyGateEvaluations).mockResolvedValue([governanceEvaluation])
    vi.mocked(api.testExecutions).mockRejectedValue(new Error('execution history unavailable'))
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])

    render(<RepositoryIntelligence data={portfolio} />)

    expect(await screen.findByText(loadArtifact.title)).toBeVisible()
    expect(screen.getByText(governanceEvaluation.title)).toBeVisible()
    expect(screen.getAllByRole('alert').some(alert =>
      alert.textContent?.includes('Latest execution evidence is temporarily unavailable')
    )).toBe(true)
  })

  it('loads revision-specific artifacts for historical governance evidence', async () => {
    mockEvidenceApis()
    const historicalArtifact: QualityArtifact = {
      id: 'policy-auth-historical',
      repositoryId: repository.id,
      kind: 'policy',
      title: 'Historical authentication policy',
      sourcePath: 'governance/auth-v1.md',
      summary: 'Authentication must be verified.',
      evidence: ['Authentication must be verified.'],
    }
    const historicalEvaluation: PolicyGateEvaluation = {
      ...governanceEvaluation,
      id: 'evaluation-historical',
      revision: 'historical-revision',
      policyArtifactIds: [historicalArtifact.id],
    }
    vi.mocked(api.policyGateEvaluations).mockImplementation(async (_repositoryId, filter) =>
      filter?.revision ? [] : [historicalEvaluation]
    )
    vi.mocked(api.qualityArtifacts).mockImplementation(async (_repositoryId, revision) =>
      revision === 'historical-revision' ? [historicalArtifact] : []
    )
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])

    render(<RepositoryIntelligence data={portfolio} />)
    fireEvent.change(await screen.findByLabelText('Governance revision'), {
      target: { value: 'all' },
    })

    expect(await screen.findByText(governanceEvaluation.title)).toBeVisible()
    expect(api.qualityArtifacts).toHaveBeenCalledWith(repository.id, 'historical-revision')
    expect(screen.getByText('Historical authentication policy')).toBeVisible()
    expect(screen.getByText('policy · governance/auth-v1.md')).toBeVisible()
  })

  it('bounds historical governance evidence expansion to the newest 20 revisions', async () => {
    mockEvidenceApis()
    const historicalEvaluations = Array.from({ length: 22 }, (_, index) => ({
      ...governanceEvaluation,
      id: `evaluation-historical-${index}`,
      revision: `historical-revision-${String(index).padStart(2, '0')}`,
      title: `Historical governance finding ${index}`,
    }))
    vi.mocked(api.policyGateEvaluations).mockImplementation(async (_repositoryId, filter) =>
      filter?.revision ? [] : historicalEvaluations
    )
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])

    render(<RepositoryIntelligence data={portfolio} />)
    fireEvent.change(await screen.findByLabelText('Governance revision'), {
      target: { value: 'all' },
    })

    expect(await screen.findByText(/Historical policy and gate evidence is expanded for the 20 newest revisions/)).toHaveTextContent(
      '2 older revisions remain'
    )
    const revisionRequests = vi.mocked(api.qualityArtifacts).mock.calls
      .map(([, revision]) => revision)
      .filter(Boolean)
    expect(revisionRequests).toHaveLength(20)
    expect(revisionRequests).not.toContain('historical-revision-20')
    expect(revisionRequests).not.toContain('historical-revision-21')
  })

  it('shows policy and gate names with their source paths in observed outcomes', async () => {
    mockEvidenceApis()
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])
    vi.mocked(api.executionPerformance).mockResolvedValue([
      {
        repositoryId: repository.id,
        policyArtifactId: 'policy-auth',
        policyTitle: 'Authentication policy',
        policySourcePath: 'governance/auth.md',
        gateArtifactId: 'gate-auth',
        gateTitle: 'Authentication gate',
        gateSourcePath: '.github/workflows/auth.yml',
        revisionCount: 3,
        latestRevision: 'historical-source-revision',
        passed: 3,
        failed: 1,
        cancelled: 0,
        running: 0,
      },
    ])

    render(<RepositoryIntelligence data={portfolio} />)

    expect(await screen.findByText('Authentication policy → Authentication gate')).toBeVisible()
    expect(screen.getByLabelText('Evidence repository')).toHaveTextContent('fuze/front')
    expect(screen.getByText('governance/auth.md → .github/workflows/auth.yml')).toBeVisible()
    expect(screen.getByText('Observed across 3 source revisions')).toHaveAttribute('title', 'historical-source-revision')
    expect(screen.getByText(/3 passed · 1 failed/)).toBeVisible()
  })

  it('filters execution evidence and gate performance by provider', async () => {
    mockEvidenceApis()
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])

    render(<RepositoryIntelligence data={portfolio} />)
    await waitFor(() => expect(api.testExecutions).toHaveBeenCalled())
    fireEvent.change(screen.getByLabelText('Ingestion provider'), {
      target: { value: 'github-actions' },
    })

    await waitFor(() => {
      expect(api.testExecutions).toHaveBeenLastCalledWith(repository.id, {
        provider: 'github-actions',
      })
      expect(api.executionPerformance).toHaveBeenLastCalledWith(repository.id, {
        provider: 'github-actions',
      })
    })
  })

  it('filters execution evidence and gate performance by exact source revision', async () => {
    mockEvidenceApis()
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])

    render(<RepositoryIntelligence data={portfolio} />)
    await waitFor(() => expect(api.testExecutions).toHaveBeenCalled())
    fireEvent.change(screen.getByLabelText('Source revision'), {
      target: { value: 'revision-1' },
    })

    await waitFor(() => {
      expect(api.testExecutions).toHaveBeenLastCalledWith(repository.id, {
        revision: 'revision-1',
      })
      expect(api.executionPerformance).toHaveBeenLastCalledWith(repository.id, {
        revision: 'revision-1',
      })
    })
  })

  it('filters execution evidence and gate performance by exact workflow file', async () => {
    mockEvidenceApis()
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])

    render(<RepositoryIntelligence data={portfolio} />)
    await waitFor(() => expect(api.testExecutions).toHaveBeenCalled())
    fireEvent.change(screen.getByLabelText('Workflow file'), {
      target: { value: '.github/workflows/load.yml' },
    })

    await waitFor(() => {
      expect(api.testExecutions).toHaveBeenLastCalledWith(repository.id, { workflowPath: '.github/workflows/load.yml' })
      expect(api.executionPerformance).toHaveBeenLastCalledWith(repository.id, { workflowPath: '.github/workflows/load.yml' })
    })
  })

  it('submits governance rationale through inline Design System controls', async () => {
    mockEvidenceApis()
    vi.mocked(api.policyGateEvaluations).mockResolvedValue([
      governanceEvaluation,
    ])
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])
    vi.spyOn(api, 'reviewPolicyGateEvaluation').mockResolvedValue({
      ...governanceEvaluation,
      reviewStatus: 'accepted',
      reviewedAt: '2026-10-09T01:00:00.000Z',
      reviewedBy: 'quality-owner',
      reviewReason: 'Required before release.',
    })

    render(<RepositoryIntelligence data={portfolio} />)
    await screen.findByText(governanceEvaluation.title)
    fireEvent.change(screen.getByLabelText('Optional governance rationale'), {
      target: { value: 'Required before release.' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Accept recommendation' })
    )

    await waitFor(() =>
      expect(api.reviewPolicyGateEvaluation).toHaveBeenCalledWith(
        repository.id,
        governanceEvaluation.id,
        'accepted',
        'Required before release.'
      )
    )
    expect(
      screen.queryByRole('button', { name: 'Accept recommendation' })
    ).not.toBeInTheDocument()
  })

  it('removes a reviewed governance finding that no longer matches the active filter', async () => {
    mockEvidenceApis()
    vi.mocked(api.policyGateEvaluations).mockResolvedValue([
      governanceEvaluation,
    ])
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])
    vi.spyOn(api, 'reviewPolicyGateEvaluation').mockResolvedValue({
      ...governanceEvaluation,
      reviewStatus: 'accepted',
      reviewedAt: '2026-10-09T01:00:00.000Z',
      reviewedBy: 'quality-owner',
    })

    render(<RepositoryIntelligence data={portfolio} />)
    await screen.findByText(governanceEvaluation.title)
    fireEvent.change(screen.getByLabelText('Review'), {
      target: { value: 'proposed' },
    })
    await waitFor(() =>
      expect(api.policyGateEvaluations).toHaveBeenLastCalledWith(
        repository.id,
        expect.objectContaining({ reviewStatus: 'proposed' })
      )
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Accept recommendation' })
    )

    await waitFor(() =>
      expect(screen.queryByText(governanceEvaluation.title)).not.toBeInTheDocument()
    )
    expect(
      policyGateEvaluationMatchesInventory(
        { ...governanceEvaluation, reviewStatus: 'accepted' },
        [repository],
        {
          kind: '',
          severity: '',
          reviewStatus: 'proposed',
          revisionScope: 'current',
        }
      )
    ).toBe(false)
  })

  it('requests current governance findings by default and can include history', async () => {
    mockEvidenceApis()
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])

    render(<RepositoryIntelligence data={portfolio} />)

    await waitFor(() =>
      expect(api.policyGateEvaluations).toHaveBeenLastCalledWith(
        repository.id,
        { revision: 'revision-1' }
      )
    )

    fireEvent.change(screen.getByLabelText('Governance revision'), {
      target: { value: 'all' },
    })

    await waitFor(() =>
      expect(api.policyGateEvaluations).toHaveBeenLastCalledWith(
        repository.id,
        {}
      )
    )
  })

  it('locks governance review controls for a historical analysis revision', async () => {
    mockEvidenceApis()
    vi.mocked(api.policyGateEvaluations).mockResolvedValue([
      { ...governanceEvaluation, revision: 'historical-revision' },
    ])
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])

    render(<RepositoryIntelligence data={portfolio} />)

    expect(
      await screen.findByText(/Historical governance finding/)
    ).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Accept recommendation' })
    ).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeDisabled()
    expect(
      screen.getByLabelText('Optional governance rationale')
    ).toBeDisabled()
  })

  it('keeps a failed governance decision actionable without losing rationale', async () => {
    mockEvidenceApis()
    vi.mocked(api.policyGateEvaluations).mockResolvedValue([
      governanceEvaluation,
    ])
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])
    vi.spyOn(api, 'reviewPolicyGateEvaluation').mockRejectedValue(
      new Error('Governance review service unavailable')
    )

    render(<RepositoryIntelligence data={portfolio} />)
    await screen.findByText(governanceEvaluation.title)
    const rationale = screen.getByLabelText('Optional governance rationale')
    fireEvent.change(rationale, { target: { value: 'Needs a named owner.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Governance review service unavailable'
    )
    expect(rationale).toHaveValue('Needs a named owner.')
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeEnabled()
  })

  it('locks governance review after an atomic stale-revision conflict and preserves rationale', async () => {
    mockEvidenceApis()
    vi.mocked(api.policyGateEvaluations).mockResolvedValue([
      governanceEvaluation,
    ])
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])
    vi.spyOn(api, 'reviewPolicyGateEvaluation').mockRejectedValue(
      new CatalogApiError(
        'The policy-gate evaluation is stale. Refresh before deciding.',
        'STALE_POLICY_GATE_EVALUATION',
        409
      )
    )

    render(<RepositoryIntelligence data={portfolio} />)
    await screen.findByText(governanceEvaluation.title)
    const rationale = screen.getByLabelText('Optional governance rationale')
    fireEvent.change(rationale, { target: { value: 'Needs a named owner.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Refresh before deciding')
    expect(rationale).toHaveValue('Needs a named owner.')
    expect(rationale).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Accept recommendation' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeDisabled()
  })
})
