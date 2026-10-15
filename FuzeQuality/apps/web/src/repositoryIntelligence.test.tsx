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
  mergePolicyGateContinuation,
  normalizeItemList,
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

const postProductionArtifact: QualityArtifact = {
  id: 'artifact-post-production-1', repositoryId: repository.id, kind: 'post-production-test',
  title: 'Post production', sourcePath: '.github/workflows/post-prod.yml',
  summary: 'Post-production workflow', evidence: ['playwright test:post-prod'],
  execution: { provider: 'github-actions', workflowPath: '.github/workflows/post-prod.yml', trigger: 'workflow_dispatch' },
}

const integrationArtifact: QualityArtifact = {
  id: 'artifact-integration-1', repositoryId: repository.id, kind: 'integration-test',
  title: 'Integration', sourcePath: '.github/workflows/integration.yml',
  summary: 'Integration workflow', evidence: ['npm run test:integration'],
  execution: { provider: 'github-actions', workflowPath: '.github/workflows/integration.yml', trigger: 'workflow_dispatch' },
}

const policyArtifact: QualityArtifact = {
  id: 'policy-auth', repositoryId: repository.id, kind: 'policy',
  title: 'Authentication policy', sourcePath: 'governance/auth.md',
  summary: 'Authentication must be verified.', evidence: ['Authentication must be verified.'],
}

const gateArtifact: QualityArtifact = {
  id: 'gate-auth', repositoryId: repository.id, kind: 'gate',
  title: 'Authentication gate', sourcePath: '.github/workflows/auth.yml',
  summary: 'Authentication required check.', evidence: ['Authentication check is required.'],
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
  remediationAction: 'build-gate',
  recommendation: 'Add an authentication gate.',
  reviewStatus: 'proposed',
  createdAt: '2026-10-09T00:00:00.000Z',
}

const guardedEvaluation: PolicyGateEvaluation = {
  ...governanceEvaluation,
  id: 'evaluation-guarded-1',
  kind: 'guarded-policy',
  severity: 'low',
  title: 'Policy is guarded: Authentication policy / Authentication gate',
  detail: '.github/workflows/auth.yml shares enforceable subjects with governance/auth.md.',
  policyArtifactIds: [policyArtifact.id],
  gateArtifactIds: [gateArtifact.id],
  scope: { sourcePaths: [policyArtifact.sourcePath, gateArtifact.sourcePath], subjects: ['authentication'] },
  evidencePassages: [
    { artifactId: policyArtifact.id, sourcePath: policyArtifact.sourcePath, text: policyArtifact.evidence[0], signal: 'obligation' },
    { artifactId: gateArtifact.id, sourcePath: gateArtifact.sourcePath, text: gateArtifact.evidence[0], signal: 'gate' },
  ],
  remediationAction: 'align-policy-gate',
  recommendation: 'Keep the policy and gate aligned.',
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

const postProductionExecution: TestExecution = {
  ...loadExecution,
  id: 'execution-post-production-1', externalRunId: '67890', kind: 'post-production', status: 'passed',
  name: 'Post production', workflowPath: postProductionArtifact.sourcePath,
  sourceUrl: 'https://github.com/fuze/front/actions/runs/67890', thresholds: [],
  summary: 'Production journeys passed.',
}

const integrationExecution: TestExecution = {
  ...loadExecution,
  id: 'execution-integration-1', externalRunId: '56789', kind: 'integration', status: 'passed',
  name: 'Integration', workflowPath: integrationArtifact.sourcePath,
  sourceUrl: 'https://github.com/fuze/front/actions/runs/56789', thresholds: [],
  summary: 'Integration suites passed.',
}

function mockEvidenceApis() {
  vi.spyOn(api, 'qualityArtifacts').mockResolvedValue([])
  vi.spyOn(api, 'qualityArtifactsByIds').mockResolvedValue({ items: [] })
  vi.spyOn(api, 'policyGateEvaluations').mockResolvedValue([])
  vi.spyOn(api, 'testExecutions').mockResolvedValue([])
  vi.spyOn(api, 'testExecutionAttempts').mockResolvedValue([])
  vi.spyOn(api, 'latestPerformanceExecutions').mockResolvedValue({ items: [] })
  vi.spyOn(api, 'latestIntegrationExecutions').mockResolvedValue({ items: [] })
  vi.spyOn(api, 'latestPostProductionExecutions').mockResolvedValue({ items: [] })
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
  it('normalizes malformed optional execution evidence without exposing undefined rows', () => {
    expect(normalizeItemList<TestExecution>({})).toEqual([])
    expect(normalizeItemList<TestExecution>({ items: [loadExecution, undefined] })).toEqual([
      loadExecution,
    ])
  })

  it('shows reviewable policy-to-gate relationships from repository analysis', async () => {
    mockEvidenceApis()
    vi.mocked(api.qualityArtifacts).mockResolvedValue([policyArtifact, gateArtifact])
    vi.mocked(api.policyGateEvaluations).mockResolvedValue([guardedEvaluation])
    const flowRequest = vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])

    const view = render(<RepositoryIntelligence data={portfolio} />)

    expect(await screen.findByLabelText('Relationship or anomaly')).toHaveValue('')
    expect(screen.getByRole('option', { name: 'guarded-policy' })).toBeVisible()
    expect(screen.getAllByText(guardedEvaluation.title)).toHaveLength(2)
    expect(screen.getAllByText('policy · governance/auth.md')).not.toHaveLength(0)
    expect(screen.getAllByText('gate · .github/workflows/auth.yml')).not.toHaveLength(0)
    await waitFor(() => {
      expect(flowRequest).toHaveBeenCalled()
      expect(api.qualityArtifactsByIds).toHaveBeenCalled()
      expect(api.testExecutions).toHaveBeenCalled()
      expect(api.executionPerformance).toHaveBeenCalled()
    })
    view.unmount()
  })

  it('keeps completed policy reviews authoritative when a stale page arrives', () => {
    const accepted = { ...governanceEvaluation, reviewStatus: 'accepted' as const }
    const stale = { ...governanceEvaluation, reviewStatus: 'proposed' as const }
    const continued = { ...governanceEvaluation, id: 'evaluation-page-2' }
    const visibleAtRequestStart = new Set([governanceEvaluation.id])

    expect(mergePolicyGateContinuation(
      [accepted],
      [stale, continued],
      visibleAtRequestStart,
    )).toEqual([accepted, continued])
    expect(mergePolicyGateContinuation(
      [],
      [stale, continued],
      visibleAtRequestStart,
    )).toEqual([continued])
  })

  it('does not revert a policy review completed while continuation is in flight', async () => {
    mockEvidenceApis()
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])
    let resolveContinuation: (value: Awaited<ReturnType<typeof api.policyGateEvaluations>>) => void = () => undefined
    const continuation = new Promise<Awaited<ReturnType<typeof api.policyGateEvaluations>>>(resolve => {
      resolveContinuation = resolve
    })
    vi.mocked(api.policyGateEvaluations)
      .mockResolvedValueOnce({ items: [governanceEvaluation], page: { nextCursor: 'policy-page-2', hasMore: true } })
      .mockImplementationOnce(() => continuation)
    vi.spyOn(api, 'reviewPolicyGateEvaluation').mockResolvedValue({
      ...governanceEvaluation,
      reviewStatus: 'accepted',
      reviewedAt: '2026-10-11T12:00:00.000Z',
      reviewedBy: 'quality-reviewer',
    })
    const continuedEvaluation = {
      ...governanceEvaluation,
      id: 'evaluation-page-2',
      title: 'Continued governance finding',
    }

    render(<RepositoryIntelligence data={portfolio} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Load more policy and gate history' }))
    fireEvent.click(screen.getByRole('button', { name: 'Accept recommendation' }))
    await screen.findByText('high · unguarded-policy · accepted')

    await act(async () => {
      resolveContinuation({
        items: [governanceEvaluation, continuedEvaluation],
        page: { nextCursor: null, hasMore: false },
      })
      await continuation
    })

    expect(await screen.findByText(continuedEvaluation.title)).toBeVisible()
    expect(screen.getByText('high · unguarded-policy · accepted')).toBeVisible()
  })

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

  it('refreshes an expanded flow review history after recording a decision', async () => {
    mockEvidenceApis()
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([candidate])
    vi.mocked(api.repositoryFlowReviewHistory)
      .mockResolvedValueOnce({
        items: [{ id: 'flow-review-old', candidateId: candidate.id, tenantId: candidate.tenantId, status: 'rejected', reviewedBy: 'previous-reviewer', createdAt: '2026-10-09T01:00:00.000Z' }],
        page: { nextCursor: null, hasMore: false },
      })
      .mockResolvedValueOnce({
        items: [{ id: 'flow-review-new', candidateId: candidate.id, tenantId: candidate.tenantId, status: 'confirmed', reviewedBy: 'current-reviewer', createdAt: '2026-10-11T01:00:00.000Z' }],
        page: { nextCursor: null, hasMore: false },
      })
    vi.spyOn(api, 'reviewRepositoryFlowCandidate').mockResolvedValue({
      ...candidate,
      status: 'confirmed',
      reviewedAt: '2026-10-11T01:00:00.000Z',
      reviewedBy: 'current-reviewer',
    })

    render(<RepositoryIntelligence data={portfolio} />)

    const history = (await screen.findByText('UX flow review history')).closest('details')
    expect(history).not.toBeNull()
    fireEvent.click(within(history!).getByText('UX flow review history'))
    expect(await within(history!).findByText('previous-reviewer')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(await within(history!).findByText('current-reviewer')).toBeVisible()
    expect(api.repositoryFlowReviewHistory).toHaveBeenCalledTimes(2)
  })

  it('refreshes an expanded governance history after recording a decision', async () => {
    mockEvidenceApis()
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])
    vi.mocked(api.policyGateEvaluations).mockResolvedValue([governanceEvaluation])
    vi.mocked(api.policyGateReviewHistory)
      .mockResolvedValueOnce({
        items: [{ id: 'policy-review-old', evaluationId: governanceEvaluation.id, tenantId: governanceEvaluation.tenantId, status: 'dismissed', reviewedBy: 'previous-governance-reviewer', createdAt: '2026-10-09T01:00:00.000Z' }],
        page: { nextCursor: null, hasMore: false },
      })
      .mockResolvedValueOnce({
        items: [{ id: 'policy-review-new', evaluationId: governanceEvaluation.id, tenantId: governanceEvaluation.tenantId, status: 'accepted', reviewedBy: 'current-governance-reviewer', createdAt: '2026-10-11T01:00:00.000Z' }],
        page: { nextCursor: null, hasMore: false },
      })
    vi.spyOn(api, 'reviewPolicyGateEvaluation').mockResolvedValue({
      ...governanceEvaluation,
      reviewStatus: 'accepted',
      reviewedAt: '2026-10-11T01:00:00.000Z',
      reviewedBy: 'current-governance-reviewer',
    })

    render(<RepositoryIntelligence data={portfolio} />)

    const history = (await screen.findByText('Review history')).closest('details')
    expect(history).not.toBeNull()
    fireEvent.click(within(history!).getByText('Review history'))
    expect(await within(history!).findByText('previous-governance-reviewer')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Accept recommendation' }))
    expect(await within(history!).findByText('current-governance-reviewer')).toBeVisible()
    expect(api.policyGateReviewHistory).toHaveBeenCalledTimes(2)
  })

  it('does not restore obsolete UX-flow review history after a newer decision reloads it', async () => {
    mockEvidenceApis()
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([candidate])
    let resolveObsolete!: (value: Awaited<ReturnType<typeof api.repositoryFlowReviewHistory>>) => void
    const obsoleteRequest = new Promise<Awaited<ReturnType<typeof api.repositoryFlowReviewHistory>>>(resolve => {
      resolveObsolete = resolve
    })
    vi.mocked(api.repositoryFlowReviewHistory)
      .mockImplementationOnce(async () => obsoleteRequest)
      .mockResolvedValueOnce({
        items: [{
          id: '00000000-0000-4000-8000-000000000002', candidateId: candidate.id,
          tenantId: candidate.tenantId, status: 'confirmed', reviewedBy: 'current-reviewer',
          createdAt: '2026-10-11T01:00:00.000Z',
        }],
        page: { nextCursor: null, hasMore: false },
      })
    vi.spyOn(api, 'reviewRepositoryFlowCandidate').mockResolvedValue({
      ...candidate,
      status: 'confirmed',
      reviewedAt: '2026-10-11T01:00:00.000Z',
      reviewedBy: 'current-reviewer',
    })

    render(<RepositoryIntelligence data={portfolio} />)
    const history = (await screen.findByText('UX flow review history')).closest('details')
    expect(history).not.toBeNull()
    fireEvent.click(within(history!).getByText('UX flow review history'))
    await waitFor(() => expect(api.repositoryFlowReviewHistory).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(await within(history!).findByText('current-reviewer')).toBeVisible()

    await act(async () => {
      resolveObsolete({
        items: [{
          id: '00000000-0000-4000-8000-000000000001', candidateId: candidate.id,
          tenantId: candidate.tenantId, status: 'rejected', reviewedBy: 'obsolete-reviewer',
          createdAt: '2026-10-09T01:00:00.000Z',
        }],
        page: { nextCursor: null, hasMore: false },
      })
      await obsoleteRequest
    })

    expect(within(history!).queryByText('obsolete-reviewer')).not.toBeInTheDocument()
    expect(within(history!).getByText('current-reviewer')).toBeVisible()
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

  it('drops an obsolete UX-flow continuation after filters change', async () => {
    mockEvidenceApis()
    let resolveContinuation!: (value: Awaited<ReturnType<typeof api.repositoryFlowCandidates>>) => void
    const continuation = new Promise<Awaited<ReturnType<typeof api.repositoryFlowCandidates>>>(resolve => {
      resolveContinuation = resolve
    })
    const obsoleteFlow = {
      ...candidate,
      id: 'flow-obsolete',
      title: 'Obsolete flow continuation',
      createdAt: '2026-10-08T00:00:00.000Z',
    }
    vi.spyOn(api, 'repositoryFlowCandidates').mockImplementation(async (_repositoryId, filter = {}) => {
      if (filter.cursor) return continuation
      if (filter.source === 'deterministic') {
        return { items: [], page: { nextCursor: null, hasMore: false } }
      }
      return { items: [candidate], page: { nextCursor: 'flow-page-2', hasMore: true } }
    })

    render(<RepositoryIntelligence data={portfolio} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Load more UX-flow history' }))
    fireEvent.change(screen.getByLabelText('Origin'), { target: { value: 'deterministic' } })
    await waitFor(() => expect(api.repositoryFlowCandidates).toHaveBeenLastCalledWith(
      repository.id,
      { source: 'deterministic' },
    ))
    await act(async () => {
      resolveContinuation({ items: [obsoleteFlow], page: { nextCursor: null, hasMore: false } })
      await continuation
    })

    expect(screen.queryByText(obsoleteFlow.title)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Load more UX-flow history' })).not.toBeInTheDocument()
  })

  it('ignores an obsolete governance continuation failure after filters change', async () => {
    mockEvidenceApis()
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])
    let rejectContinuation!: (reason: Error) => void
    const continuation = new Promise<Awaited<ReturnType<typeof api.policyGateEvaluations>>>((_, reject) => {
      rejectContinuation = reject
    })
    vi.mocked(api.policyGateEvaluations).mockImplementation(async (_repositoryId, filter = {}) => {
      if (filter.cursor) return continuation
      if (filter.reviewStatus === 'accepted') {
        return { items: [], page: { nextCursor: null, hasMore: false } }
      }
      return { items: [governanceEvaluation], page: { nextCursor: 'policy-page-2', hasMore: true } }
    })

    render(<RepositoryIntelligence data={portfolio} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Load more policy and gate history' }))
    fireEvent.change(screen.getByLabelText('Review'), {
      target: { value: 'accepted' },
    })
    await waitFor(() => expect(api.policyGateEvaluations).toHaveBeenLastCalledWith(
      repository.id,
      { revision: repository.lastScanRevision, reviewStatus: 'accepted' },
    ))
    await act(async () => {
      rejectContinuation(new Error('Obsolete governance page failed'))
      await continuation.catch(() => undefined)
    })

    expect(screen.queryByText('Obsolete governance page failed')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Load more policy and gate history' })).not.toBeInTheDocument()
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
    vi.mocked(api.qualityArtifactsByIds).mockImplementation(async (_repositoryId, ids) => ({
      items: ids.includes(historicalArtifact.id) ? [historicalArtifact] : [],
    }))

    render(<RepositoryIntelligence data={portfolio} />)

    fireEvent.change(await screen.findByLabelText('Governance revision'), {
      target: { value: 'all' },
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Load more policy and gate history' }))

    expect(await screen.findByText(historicalEvaluation.title)).toBeVisible()
    const evidence = screen.getByLabelText(`${historicalEvaluation.title} evidence`)
    expect(await within(evidence).findByText(historicalArtifact.title)).toBeVisible()
    expect(within(evidence).queryByText(historicalArtifact.id)).not.toBeInTheDocument()
    expect(api.qualityArtifactsByIds).toHaveBeenCalledWith(
      repository.id,
      expect.arrayContaining([historicalArtifact.id]),
    )
  })

  it('resolves exact evidence for current policy findings outside the artifact first page', async () => {
    mockEvidenceApis()
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])
    const exactArtifact: QualityArtifact = {
      id: 'policy-auth',
      repositoryId: repository.id,
      kind: 'policy',
      title: 'Exact authentication policy',
      sourcePath: 'governance/auth.md',
      summary: 'Authentication is required.',
      evidence: ['Authentication is required.'],
    }
    vi.mocked(api.policyGateEvaluations).mockResolvedValue([governanceEvaluation])
    vi.mocked(api.qualityArtifacts).mockResolvedValue([])
    vi.mocked(api.qualityArtifactsByIds).mockResolvedValue({ items: [exactArtifact] })

    render(<RepositoryIntelligence data={portfolio} />)

    const evidence = await screen.findByLabelText(`${governanceEvaluation.title} evidence`)
    expect(await within(evidence).findByText(exactArtifact.title)).toBeVisible()
    expect(within(evidence).queryByText(exactArtifact.id)).not.toBeInTheDocument()
    expect(api.qualityArtifactsByIds).toHaveBeenCalledWith(repository.id, [exactArtifact.id])
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

  it('loads exact provider attempt history and proves recovery from retained failure evidence', async () => {
    mockEvidenceApis()
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])
    const failedAttempt: TestExecution = {
      ...postProductionExecution,
      id: 'execution-post-production-attempt-1',
      attempt: 1,
      status: 'failed',
      completedAt: '2026-10-09T11:55:00.000Z',
    }
    const recoveredAttempt: TestExecution = {
      ...postProductionExecution,
      id: 'execution-post-production-attempt-2',
      attempt: 2,
      status: 'passed',
      completedAt: '2026-10-09T12:00:00.000Z',
    }
    vi.mocked(api.testExecutions).mockResolvedValue([recoveredAttempt])
    vi.mocked(api.testExecutionAttempts).mockResolvedValue({
      items: [recoveredAttempt, failedAttempt],
      page: { nextCursor: null, hasMore: false },
    })

    render(<RepositoryIntelligence data={portfolio} />)

    fireEvent.click(await screen.findByText('Attempt history'))
    await waitFor(() => expect(api.testExecutionAttempts).toHaveBeenCalledWith(
      repository.id,
      recoveredAttempt.provider,
      recoveredAttempt.externalRunId,
      undefined,
    ))
    expect(await screen.findByText('Attempt 2')).toBeVisible()
    expect(screen.getByText('Attempt 1')).toBeVisible()
    expect(screen.getByText(
      'Each attempt retains its first terminal outcome; provider reruns are separate attempts.'
    )).toBeVisible()
    expect(screen.getByText('Recovered after retained failure evidence.')).toBeVisible()
  })

  it('drops an obsolete execution continuation after filters change', async () => {
    mockEvidenceApis()
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])
    let resolveContinuation!: (value: Awaited<ReturnType<typeof api.testExecutions>>) => void
    const continuation = new Promise<Awaited<ReturnType<typeof api.testExecutions>>>(resolve => {
      resolveContinuation = resolve
    })
    const obsoleteExecution: TestExecution = {
      ...postProductionExecution,
      id: 'execution-obsolete',
      name: 'Obsolete execution continuation',
    }
    vi.mocked(api.testExecutions).mockImplementation(async (_repositoryId, filter = {}) => {
      if (filter.cursor) return continuation
      if (filter.status === 'failed') {
        return { items: [loadExecution], page: { nextCursor: null, hasMore: false } }
      }
      return { items: [loadExecution], page: { nextCursor: 'execution-page-2', hasMore: true } }
    })

    render(<RepositoryIntelligence data={portfolio} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Load more execution evidence' }))
    const filters = screen.getByLabelText('Execution evidence filters')
    fireEvent.change(within(filters).getByLabelText('Outcome'), { target: { value: 'failed' } })
    await waitFor(() => expect(api.testExecutions).toHaveBeenLastCalledWith(
      repository.id,
      { status: 'failed' },
    ))
    await act(async () => {
      resolveContinuation({ items: [obsoleteExecution], page: { nextCursor: null, hasMore: false } })
      await continuation
    })

    expect(screen.queryByText(obsoleteExecution.name)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Load more execution evidence' })).not.toBeInTheDocument()
  })

  it('renders complete server-aggregated outcome history independently of loaded execution rows', async () => {
    mockEvidenceApis()
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])
    vi.mocked(api.testExecutions).mockResolvedValue({
      items: [loadExecution],
      page: { nextCursor: 'older-executions', hasMore: true },
    })
    vi.mocked(api.executionTrend).mockResolvedValue([
      { date: '2026-10-01', total: 10, passed: 7, failed: 2, cancelled: 1, running: 0, passRate: 0.7, durationSampleCount: 9, averageDurationMs: 95_000, maximumDurationMs: 180_000, retryAttemptCount: 3, successfulRetryCount: 2, recoveredRunCount: 1 },
    ])

    render(<RepositoryIntelligence data={portfolio} />)

    const trend = await screen.findByLabelText('Execution outcome trend')
    expect(trend).toHaveTextContent('2026-10-01')
    expect(screen.getByText(/Outcome-trend continuation retains the execution lifecycle state/)).toBeVisible()
    expect(trend).toHaveTextContent('7 passed')
    expect(trend).toHaveTextContent('2 failed')
    expect(trend).toHaveTextContent('10 total · 70% passed among terminal outcomes')
    expect(trend).toHaveTextContent('1m 35s average · 3m 0s slowest · 9 timed')
    expect(trend).toHaveTextContent('3 retries · 2 passed retries')
    expect(trend).toHaveTextContent('1 recovered after failure')
    expect(api.executionTrend).toHaveBeenCalledWith(repository.id, {})
  })

  it('loads older outcome trend pages only after an explicit continuation', async () => {
    mockEvidenceApis()
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])
    vi.mocked(api.executionTrend)
      .mockResolvedValueOnce({
        items: [{ date: '2026-10-01', total: 10, passed: 7, failed: 2, cancelled: 1, running: 0, passRate: 0.7, durationSampleCount: 9, averageDurationMs: 95_000, maximumDurationMs: 180_000, retryAttemptCount: 3, successfulRetryCount: 2, recoveredRunCount: 1 }],
        page: { nextCursor: 'older-days', hasMore: true },
      })
      .mockResolvedValueOnce({
        items: [{ date: '2026-09-01', total: 5, passed: 4, failed: 1, cancelled: 0, running: 0, passRate: 0.8, durationSampleCount: 0, averageDurationMs: 0, maximumDurationMs: 0, retryAttemptCount: 0, successfulRetryCount: 0, recoveredRunCount: 0 }],
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
        items: [{ date: '2026-10-01', total: 10, passed: 7, failed: 2, cancelled: 1, running: 0, passRate: 0.7, durationSampleCount: 9, averageDurationMs: 95_000, maximumDurationMs: 180_000, retryAttemptCount: 3, successfulRetryCount: 2, recoveredRunCount: 1 }],
        page: { nextCursor: 'older-days', hasMore: true },
      })
      .mockImplementationOnce(() => olderPage)
      .mockResolvedValueOnce({
        items: [{ date: '2026-10-11', total: 3, passed: 3, failed: 0, cancelled: 0, running: 0, passRate: 1, durationSampleCount: 3, averageDurationMs: 50_000, maximumDurationMs: 80_000, retryAttemptCount: 1, successfulRetryCount: 1, recoveredRunCount: 1 }],
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
        items: [{ date: '2026-09-01', total: 5, passed: 4, failed: 1, cancelled: 0, running: 0, passRate: 0.8, durationSampleCount: 0, averageDurationMs: 0, maximumDurationMs: 0, retryAttemptCount: 0, successfulRetryCount: 0, recoveredRunCount: 0 }],
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
      total: 3,
      passed: 2,
      failed: 1,
      cancelled: 0,
      running: 0,
      passRate: 2 / 3,
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
      { date: '2026-10-01', total: 10, passed: 7, failed: 2, cancelled: 1, running: 0, passRate: 0.7, durationSampleCount: 9, averageDurationMs: 95_000, maximumDurationMs: 180_000, retryAttemptCount: 3, successfulRetryCount: 2, recoveredRunCount: 1 },
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
      total: 4,
      failed: 3,
      passed: 1,
      cancelled: 0,
      running: 0,
      passRate: 0.25,
    }
    const older = {
      ...latest,
      policyArtifactId: 'policy-older',
      gateArtifactId: 'gate-older',
      total: 5,
      failed: 1,
      passed: 4,
      passRate: 0.8,
    }
    vi.mocked(api.executionPerformance)
      .mockResolvedValueOnce({ items: [latest], page: { nextCursor: 'performance-page-2', hasMore: true } })
      .mockResolvedValueOnce({ items: [older], page: { nextCursor: null, hasMore: false } })

    render(<RepositoryIntelligence data={portfolio} />)

    expect(await screen.findByText('policy-latest → gate-latest')).toBeVisible()
    expect(screen.getByText(/Continuation pages retain the execution state captured/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Load more policy-gate performance' }))
    expect(await screen.findByText('policy-older → gate-older')).toBeVisible()
    expect(api.executionPerformance).toHaveBeenLastCalledWith(repository.id, {
      cursor: 'performance-page-2',
    })
  })

  it('retains successful performance continuation when another repository fails', async () => {
    mockEvidenceApis()
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])
    const secondRepository = { ...repository, id: 'repo-2', name: 'agent' }
    const first = {
      repositoryId: repository.id,
      policyArtifactId: 'policy-first',
      gateArtifactId: 'gate-first',
      total: 3, failed: 2, passed: 1, cancelled: 0, running: 0, passRate: 1 / 3,
    }
    const continued = {
      ...first,
      policyArtifactId: 'policy-continued',
      gateArtifactId: 'gate-continued',
      total: 2,
      failed: 1,
      passRate: 0.5,
    }
    vi.mocked(api.executionPerformance).mockImplementation(async (repositoryId, filter) => {
      if (!filter?.cursor) return {
        items: repositoryId === repository.id ? [first] : [],
        page: { nextCursor: `cursor-${repositoryId}`, hasMore: true },
      }
      if (repositoryId === secondRepository.id) throw new Error('temporary continuation failure')
      return { items: [continued], page: { nextCursor: null, hasMore: false } }
    })

    render(<RepositoryIntelligence data={{ ...portfolio, repositories: [repository, secondRepository] }} />)

    expect(await screen.findByText('policy-first → gate-first')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Load more policy-gate performance' }))
    expect(await screen.findByText('policy-continued → gate-continued')).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Unable to load more policy-gate performance for 1 repository. Successful evidence remains visible.'
    )
    expect(screen.getByRole('button', { name: 'Load more policy-gate performance' })).toBeVisible()
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

  it('allows a current reviewed flow decision to be revised with a concurrency precondition', async () => {
    mockEvidenceApis()
    const reviewedAt = '2026-10-09T01:00:00.000Z'
    const reviewedCandidate = {
      ...candidate,
      status: 'confirmed' as const,
      reviewedAt,
      reviewedBy: 'reviewer-1',
    }
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([reviewedCandidate])
    const review = vi.spyOn(api, 'reviewRepositoryFlowCandidate').mockResolvedValue({
      ...reviewedCandidate,
      status: 'rejected',
      reviewedAt: '2026-10-09T02:00:00.000Z',
      reviewedBy: 'reviewer-2',
      reviewReason: 'The route no longer exists.',
    })
    render(<RepositoryIntelligence data={portfolio} />)

    expect(await screen.findByText(/This decision can be revised/)).toBeVisible()
    fireEvent.change(screen.getByLabelText('Optional review rationale'), {
      target: { value: 'The route no longer exists.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))

    await waitFor(() => expect(review).toHaveBeenCalledWith(
      repository.id,
      candidate.id,
      'rejected',
      'The route no longer exists.',
      reviewedAt,
    ))
    expect(await screen.findByText('The route no longer exists.')).toBeVisible()
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

  it('locks re-review after another reviewer changes the decision and preserves rationale', async () => {
    mockEvidenceApis()
    const reviewedCandidate = {
      ...candidate,
      status: 'confirmed' as const,
      reviewedAt: '2026-10-09T01:00:00.000Z',
      reviewedBy: 'reviewer-1',
    }
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([reviewedCandidate])
    vi.spyOn(api, 'reviewRepositoryFlowCandidate').mockRejectedValue(
      new CatalogApiError(
        'This UX-flow review changed while you were deciding. Refresh the current decision before reviewing it again.',
        'STALE_FLOW_REVIEW',
        409,
      )
    )

    render(<RepositoryIntelligence data={portfolio} />)
    await screen.findByText(/This decision can be revised/)
    const rationale = screen.getByLabelText('Optional review rationale')
    fireEvent.change(rationale, { target: { value: 'The route was removed.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('changed while you were deciding')
    expect(rationale).toHaveValue('The route was removed.')
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
        minimumConfidencePercent: '',
        maximumConfidencePercent: '',
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
          minimumConfidencePercent: '',
          maximumConfidencePercent: '',
        }
      )
    ).toBe(false)
    expect(
      flowCandidateMatchesInventory(candidate, [repository], {
        repositoryId: repository.id,
        source: 'litellm',
        status: 'proposed',
        revisionScope: 'current',
        model: '',
        promptVersion: '',
        schemaVersion: '',
        minimumConfidencePercent: '91',
        maximumConfidencePercent: '100',
      })
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
    fireEvent.change(screen.getByLabelText('Minimum confidence (%)'), {
      target: { value: '70' },
    })
    fireEvent.change(screen.getByLabelText('Maximum confidence (%)'), {
      target: { value: '90' },
    })

    await waitFor(() =>
      expect(flowRequest).toHaveBeenLastCalledWith(repository.id, {
        model: 'quality-analysis',
        promptVersion: 'flow-v2',
        schemaVersion: '2.0',
        minConfidence: '0.7',
        maxConfidence: '0.9',
      })
    )
  })

  it('shows reviewers how much repository evidence the LiteLLM prompt omitted', async () => {
    mockEvidenceApis()
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([
      {
        ...candidate,
        analysis: {
          provider: 'fuzeinfra-litellm',
          model: 'quality-analysis',
          promptVersion: 'flow-v3',
          schemaVersion: '1.0',
          inputArtifactCount: 20,
          promptArtifactCount: 3,
          promptTruncated: true,
        },
      },
    ])

    render(<RepositoryIntelligence data={portfolio} />)

    expect(await screen.findByText('3 of 20 repository artifacts supplied · 17 omitted by prompt budget')).toBeVisible()
  })

  it('blocks an inverted confidence window before querying the API', async () => {
    mockEvidenceApis()
    const flowRequest = vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([candidate])
    render(<RepositoryIntelligence data={portfolio} />)
    await screen.findByText(candidate.title)

    fireEvent.change(screen.getByLabelText('Minimum confidence (%)'), {
      target: { value: '90' },
    })
    fireEvent.change(screen.getByLabelText('Maximum confidence (%)'), {
      target: { value: '70' },
    })

    expect(await screen.findByText('Maximum confidence must be greater than or equal to minimum confidence.')).toBeVisible()
    expect(screen.getByLabelText('Maximum confidence (%)')).toHaveAttribute('aria-invalid', 'true')
    expect(flowRequest).toHaveBeenCalledTimes(2)
  })

  it('retains the confidence window when continuing UX-flow history', async () => {
    mockEvidenceApis()
    const flowRequest = vi.spyOn(api, 'repositoryFlowCandidates').mockImplementation(async (_repositoryId, filter) =>
      filter?.cursor
        ? { items: [], page: { nextCursor: null, hasMore: false } }
        : { items: [candidate], page: { nextCursor: 'flow-page-2', hasMore: true } }
    )
    render(<RepositoryIntelligence data={portfolio} />)
    await screen.findByText(candidate.title)

    fireEvent.change(screen.getByLabelText('Minimum confidence (%)'), {
      target: { value: '70' },
    })
    fireEvent.change(screen.getByLabelText('Maximum confidence (%)'), {
      target: { value: '90' },
    })
    await waitFor(() => expect(flowRequest).toHaveBeenLastCalledWith(repository.id, {
      minConfidence: '0.7',
      maxConfidence: '0.9',
    }))

    fireEvent.click(await screen.findByRole('button', { name: 'Load more UX-flow history' }))
    await waitFor(() => expect(flowRequest).toHaveBeenLastCalledWith(repository.id, {
      minConfidence: '0.7',
      maxConfidence: '0.9',
      cursor: 'flow-page-2',
    }))
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
    vi.mocked(api.qualityArtifactsByIds).mockResolvedValue({ items: [historicalArtifact] })
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([{
      ...candidate,
      id: 'flow-historical',
      revision: 'historical-revision',
      evidence: [historicalArtifact.id],
    }])

    render(<RepositoryIntelligence data={portfolio} />)
    await screen.findByText(candidate.title)
    fireEvent.click(screen.getByText('Source evidence'))

    await waitFor(() => expect(api.qualityArtifactsByIds).toHaveBeenCalledWith(repository.id, [historicalArtifact.id]))
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

  it('renders every repository evidence row loaded into a kind panel', async () => {
    mockEvidenceApis()
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])
    vi.mocked(api.qualityArtifacts).mockResolvedValue(Array.from(
      { length: 13 },
      (_, index) => ({
        ...documentationArtifact,
        id: `documentation-${index + 1}`,
        title: `Documentation ${index + 1}`,
      })
    ))

    render(<RepositoryIntelligence data={portfolio} />)

    expect(await screen.findByText('Documentation 13')).toBeVisible()
  })

  it('retains successful repository evidence when another repository request fails', async () => {
    mockEvidenceApis()
    const secondRepository = { ...repository, id: 'repo-2', name: 'agent' }
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])
    vi.mocked(api.qualityArtifacts).mockImplementation(async repositoryId => {
      if (repositoryId === secondRepository.id) throw new Error('temporary repository failure')
      return [storyArtifact]
    })

    render(<RepositoryIntelligence data={{ ...portfolio, repositories: [repository, secondRepository] }} />)

    expect(await screen.findByText(storyArtifact.title)).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Evidence from successful repositories remains visible.'
    )
  })

  it('retains repository evidence when another governance channel fails', async () => {
    mockEvidenceApis()
    const secondRepository = { ...repository, id: 'repo-2', name: 'agent' }
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])
    vi.mocked(api.qualityArtifacts).mockImplementation(async repositoryId =>
      repositoryId === repository.id ? [storyArtifact] : []
    )
    vi.mocked(api.policyGateEvaluations).mockImplementation(async repositoryId => {
      if (repositoryId === secondRepository.id) throw new Error('temporary governance failure')
      return []
    })

    render(<RepositoryIntelligence data={{ ...portfolio, repositories: [repository, secondRepository] }} />)

    expect(await screen.findByText(storyArtifact.title)).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Evidence from successful repositories remains visible.'
    )
  })

  it('retains successful repository flows when another repository request fails', async () => {
    mockEvidenceApis()
    const secondRepository = { ...repository, id: 'repo-2', name: 'agent' }
    vi.spyOn(api, 'repositoryFlowCandidates').mockImplementation(async repositoryId => {
      if (repositoryId === secondRepository.id) throw new Error('temporary flow failure')
      return [candidate]
    })

    render(<RepositoryIntelligence data={{ ...portfolio, repositories: [repository, secondRepository] }} />)

    expect(await screen.findByText(candidate.title)).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Evidence from successful repositories remains visible.'
    )
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
    vi.spyOn(api, 'runTestSuite').mockResolvedValue({
      status: 'dispatched',
      artifactId: loadArtifact.id,
      artifactKind: 'load-test',
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
      expect(api.runTestSuite).toHaveBeenCalledWith(
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
    vi.spyOn(api, 'runTestSuite').mockRejectedValue(
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
    vi.mocked(api.latestPerformanceExecutions).mockResolvedValue({ items: [loadExecution] })
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])

    render(<RepositoryIntelligence data={portfolio} />)

    const outcome = await screen.findByLabelText(`Latest execution for ${loadArtifact.title}`)
    expect(outcome).toHaveTextContent('failed · revision-1')
    expect(outcome).toHaveTextContent('Latency threshold exceeded.')
    expect(outcome).toHaveTextContent('p95 latency')
    expect(outcome).toHaveTextContent('420 ms ≤ 300 ms')
    expect(within(outcome).getByRole('link', { name: /Open CI run/ })).toHaveAttribute('href', loadExecution.sourceUrl)
  })

  it('loads performance evidence independently of the first mixed execution page', async () => {
    mockEvidenceApis()
    vi.mocked(api.qualityArtifacts).mockResolvedValue([loadArtifact])
    vi.mocked(api.testExecutions).mockResolvedValue(Array.from({ length: 50 }, (_, index) => ({
      ...loadExecution,
      id: `ci-${index}`,
      externalRunId: `ci-${index}`,
      kind: 'ci' as const,
      workflowPath: '.github/workflows/ci.yml',
    })))
    vi.mocked(api.latestPerformanceExecutions).mockResolvedValue({ items: [loadExecution] })
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])

    render(<RepositoryIntelligence data={portfolio} />)

    expect(await screen.findByLabelText(`Latest execution for ${loadArtifact.title}`)).toHaveTextContent('failed · revision-1')
    expect(api.latestPerformanceExecutions).toHaveBeenCalledWith(repository.id)
  })

  it('shows detected post-production workflow inventory with its latest exact-path outcome', async () => {
    mockEvidenceApis()
    vi.mocked(api.qualityArtifacts).mockResolvedValue([postProductionArtifact])
    vi.mocked(api.latestPostProductionExecutions).mockResolvedValue({ items: [postProductionExecution] })
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])

    render(<RepositoryIntelligence data={portfolio} />)

    expect(await screen.findByRole('heading', { name: 'Post-production tests' })).toBeVisible()
    const outcome = await screen.findByLabelText(`Latest execution for ${postProductionArtifact.title}`)
    expect(outcome).toHaveTextContent('passed · revision-1')
    expect(outcome).toHaveTextContent('Production journeys passed.')
    expect(api.latestPostProductionExecutions).toHaveBeenCalledWith(repository.id)
  })

  it('shows detected integration workflow inventory with its latest exact-path outcome', async () => {
    mockEvidenceApis()
    vi.mocked(api.qualityArtifacts).mockResolvedValue([integrationArtifact])
    vi.mocked(api.latestIntegrationExecutions).mockResolvedValue({ items: [integrationExecution] })
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])

    render(<RepositoryIntelligence data={portfolio} />)

    expect(await screen.findByRole('heading', { name: 'Integration tests' })).toBeVisible()
    const outcome = await screen.findByLabelText(`Latest execution for ${integrationArtifact.title}`)
    expect(outcome).toHaveTextContent('passed · revision-1')
    expect(outcome).toHaveTextContent('Integration suites passed.')
    expect(api.latestIntegrationExecutions).toHaveBeenCalledWith(repository.id)
  })

  it('dispatches an explicitly reviewed integration workflow at its analyzed revision', async () => {
    mockEvidenceApis()
    vi.mocked(api.qualityArtifacts).mockResolvedValue([integrationArtifact])
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])
    vi.spyOn(api, 'runTestSuite').mockResolvedValue({
      status: 'dispatched',
      artifactId: integrationArtifact.id,
      artifactKind: 'integration-test',
      workflowPath: integrationArtifact.sourcePath,
      ref: 'main',
      sourceRevision: 'a'.repeat(40),
    })
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<RepositoryIntelligence data={portfolio} />)
    fireEvent.click(await screen.findByRole('button', { name: /Run analyzed revision a{12}/ }))

    await waitFor(() => expect(api.runTestSuite).toHaveBeenCalledWith(repository.id, integrationArtifact.id))
    expect(await screen.findByRole('status')).toHaveTextContent(integrationArtifact.sourcePath)
  })

  it('keeps repository and governance evidence visible when optional performance history fails', async () => {
    mockEvidenceApis()
    vi.mocked(api.qualityArtifacts).mockResolvedValue([loadArtifact])
    vi.mocked(api.policyGateEvaluations).mockResolvedValue([governanceEvaluation])
    vi.mocked(api.latestPerformanceExecutions).mockRejectedValue(new Error('performance history unavailable'))
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
    vi.mocked(api.qualityArtifactsByIds).mockResolvedValue({ items: [historicalArtifact] })
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])

    render(<RepositoryIntelligence data={portfolio} />)
    fireEvent.change(await screen.findByLabelText('Governance revision'), {
      target: { value: 'all' },
    })

    expect(await screen.findByText(governanceEvaluation.title)).toBeVisible()
    await waitFor(() => expect(api.qualityArtifactsByIds).toHaveBeenCalledWith(repository.id, [historicalArtifact.id]))
    expect(await screen.findByText('Historical authentication policy')).toBeVisible()
    expect(screen.getByText('policy · governance/auth-v1.md')).toBeVisible()
  })

  it('bounds historical governance evidence expansion to the newest 20 revisions', async () => {
    mockEvidenceApis()
    const historicalEvaluations = Array.from({ length: 22 }, (_, index) => ({
      ...governanceEvaluation,
      id: `evaluation-historical-${index}`,
      revision: `historical-revision-${String(index).padStart(2, '0')}`,
      title: `Historical governance finding ${index}`,
      policyArtifactIds: [`policy-historical-${String(index).padStart(2, '0')}`],
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
    const requestedArtifactIds = vi.mocked(api.qualityArtifactsByIds).mock.calls.flatMap(([, ids]) => ids)
    expect(requestedArtifactIds).toHaveLength(20)
    expect(requestedArtifactIds).not.toContain('policy-historical-20')
    expect(requestedArtifactIds).not.toContain('policy-historical-21')
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
        total: 4,
        passed: 3,
        failed: 1,
        cancelled: 0,
        running: 0,
        passRate: 0.75,
      },
    ])

    render(<RepositoryIntelligence data={portfolio} />)

    expect(await screen.findByText('Authentication policy → Authentication gate')).toBeVisible()
    expect(screen.getByLabelText('Evidence repository')).toHaveTextContent('fuze/front')
    expect(screen.getByText('governance/auth.md → .github/workflows/auth.yml')).toBeVisible()
    expect(screen.getByText('Observed across 3 source revisions')).toHaveAttribute('title', 'historical-source-revision')
    expect(screen.getByText(/3 passed · 1 failed/)).toBeVisible()
    expect(screen.getByText('4 observations · 75% passed among terminal outcomes')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'Inspect execution evidence' }))

    await waitFor(() => {
      expect(api.testExecutions).toHaveBeenLastCalledWith(repository.id, {
        policyArtifactId: 'policy-auth',
        gateArtifactId: 'gate-auth',
      })
      expect(api.executionTrend).toHaveBeenLastCalledWith(repository.id, {
        policyArtifactId: 'policy-auth',
        gateArtifactId: 'gate-auth',
      })
      expect(api.executionPerformance).toHaveBeenLastCalledWith(repository.id, {
        policyArtifactId: 'policy-auth',
        gateArtifactId: 'gate-auth',
      })
    })
    expect(screen.getByRole('status')).toHaveTextContent('policy-auth')
    expect(screen.getByRole('status')).toHaveTextContent('gate-auth')

    fireEvent.click(screen.getByRole('button', { name: 'Clear policy-gate focus' }))
    await waitFor(() => {
      expect(api.testExecutions).toHaveBeenLastCalledWith(repository.id, {})
      expect(api.executionTrend).toHaveBeenLastCalledWith(repository.id, {})
      expect(api.executionPerformance).toHaveBeenLastCalledWith(repository.id, {})
    })
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

  it('isolates execution history, trends, and policy-gate outcomes with retained video evidence', async () => {
    mockEvidenceApis()
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])

    render(<RepositoryIntelligence data={portfolio} />)
    await waitFor(() => expect(api.testExecutions).toHaveBeenCalled())
    fireEvent.change(screen.getByLabelText('Evidence attachment'), {
      target: { value: 'video' },
    })

    await waitFor(() => {
      expect(api.testExecutions).toHaveBeenLastCalledWith(repository.id, {
        evidenceKind: 'video',
      })
      expect(api.executionTrend).toHaveBeenLastCalledWith(repository.id, {
        evidenceKind: 'video',
      })
      expect(api.executionPerformance).toHaveBeenLastCalledWith(repository.id, {
        evidenceKind: 'video',
      })
    })
  })

  it('isolates execution history, trends, and policy-gate outcomes with breached thresholds', async () => {
    mockEvidenceApis()
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])

    render(<RepositoryIntelligence data={portfolio} />)
    await waitFor(() => expect(api.testExecutions).toHaveBeenCalled())
    fireEvent.change(screen.getByLabelText('Threshold evidence'), {
      target: { value: 'failed' },
    })

    await waitFor(() => {
      expect(api.testExecutions).toHaveBeenLastCalledWith(repository.id, {
        thresholdOutcome: 'failed',
      })
      expect(api.executionTrend).toHaveBeenLastCalledWith(repository.id, {
        thresholdOutcome: 'failed',
      })
      expect(api.executionPerformance).toHaveBeenLastCalledWith(repository.id, {
        thresholdOutcome: 'failed',
      })
    })
  })

  it('isolates execution history, trends, and individual policy-gate outcomes by gate result', async () => {
    mockEvidenceApis()
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])

    render(<RepositoryIntelligence data={portfolio} />)
    await waitFor(() => expect(api.testExecutions).toHaveBeenCalled())
    fireEvent.change(screen.getByLabelText('Gate outcome'), {
      target: { value: 'failed' },
    })

    await waitFor(() => {
      expect(api.testExecutions).toHaveBeenLastCalledWith(repository.id, {
        gateOutcome: 'failed',
      })
      expect(api.executionTrend).toHaveBeenLastCalledWith(repository.id, {
        gateOutcome: 'failed',
      })
      expect(api.executionPerformance).toHaveBeenLastCalledWith(repository.id, {
        gateOutcome: 'failed',
      })
    })
  })

  it('drills execution history, trends, and gate performance into one provider run', async () => {
    mockEvidenceApis()
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])
    vi.mocked(api.testExecutions).mockImplementation(async (_repositoryId, filter) =>
      filter?.cursor
        ? { items: [], page: { nextCursor: null, hasMore: false } }
        : { items: [loadExecution], page: { nextCursor: 'execution-page-2', hasMore: true } }
    )

    render(<RepositoryIntelligence data={portfolio} />)
    await waitFor(() => expect(api.testExecutions).toHaveBeenCalled())
    fireEvent.change(screen.getByLabelText('Provider run ID'), {
      target: { value: ' 12345 ' },
    })

    await waitFor(() => {
      expect(api.testExecutions).toHaveBeenLastCalledWith(repository.id, {
        externalRunId: '12345',
      })
      expect(api.executionTrend).toHaveBeenLastCalledWith(repository.id, {
        externalRunId: '12345',
      })
      expect(api.executionPerformance).toHaveBeenLastCalledWith(repository.id, {
        externalRunId: '12345',
      })
    })

    fireEvent.click(await screen.findByRole('button', { name: 'Load more execution evidence' }))
    await waitFor(() => expect(api.testExecutions).toHaveBeenLastCalledWith(repository.id, {
      externalRunId: '12345',
      cursor: 'execution-page-2',
    }))
  })

  it('filters execution history, trends, and gate performance by exact suite name', async () => {
    mockEvidenceApis()
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])

    render(<RepositoryIntelligence data={portfolio} />)
    await waitFor(() => expect(api.testExecutions).toHaveBeenCalled())
    fireEvent.change(screen.getByLabelText('Suite name'), {
      target: { value: ' Post-production browser suite ' },
    })

    await waitFor(() => {
      expect(api.testExecutions).toHaveBeenLastCalledWith(repository.id, {
        name: 'Post-production browser suite',
      })
      expect(api.executionTrend).toHaveBeenLastCalledWith(repository.id, {
        name: 'Post-production browser suite',
      })
      expect(api.executionPerformance).toHaveBeenLastCalledWith(repository.id, {
        name: 'Post-production browser suite',
      })
    })
  })

  it('filters execution history, trends, and gate performance to retry attempts', async () => {
    mockEvidenceApis()
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])

    render(<RepositoryIntelligence data={portfolio} />)
    await waitFor(() => expect(api.testExecutions).toHaveBeenCalled())
    fireEvent.change(screen.getByLabelText('Attempt'), {
      target: { value: 'retry' },
    })

    await waitFor(() => {
      expect(api.testExecutions).toHaveBeenLastCalledWith(repository.id, {
        attemptScope: 'retry',
      })
      expect(api.executionTrend).toHaveBeenLastCalledWith(repository.id, {
        attemptScope: 'retry',
      })
      expect(api.executionPerformance).toHaveBeenLastCalledWith(repository.id, {
        attemptScope: 'retry',
      })
    })

    fireEvent.change(screen.getByLabelText('Attempt'), {
      target: { value: 'recovered' },
    })
    await waitFor(() => {
      expect(api.testExecutions).toHaveBeenLastCalledWith(repository.id, {
        attemptScope: 'recovered',
      })
      expect(api.executionTrend).toHaveBeenLastCalledWith(repository.id, {
        attemptScope: 'recovered',
      })
      expect(api.executionPerformance).toHaveBeenLastCalledWith(repository.id, {
        attemptScope: 'recovered',
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

  it('filters execution history, trends, and gate performance by exact source branch', async () => {
    mockEvidenceApis()
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])

    render(<RepositoryIntelligence data={portfolio} />)
    await waitFor(() => expect(api.testExecutions).toHaveBeenCalled())
    fireEvent.change(screen.getByLabelText('Source branch'), {
      target: { value: ' feature/checkout ' },
    })

    await waitFor(() => {
      expect(api.testExecutions).toHaveBeenLastCalledWith(repository.id, {
        branch: 'feature/checkout',
      })
      expect(api.executionTrend).toHaveBeenLastCalledWith(repository.id, {
        branch: 'feature/checkout',
      })
      expect(api.executionPerformance).toHaveBeenLastCalledWith(repository.id, {
        branch: 'feature/checkout',
      })
    })
  })

  it('filters execution history, trends, and gate performance by duration window', async () => {
    mockEvidenceApis()
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])

    render(<RepositoryIntelligence data={portfolio} />)
    await waitFor(() => expect(api.testExecutions).toHaveBeenCalled())
    fireEvent.change(screen.getByLabelText('Minimum duration (seconds)'), {
      target: { value: '90' },
    })
    fireEvent.change(screen.getByLabelText('Maximum duration (seconds)'), {
      target: { value: '300' },
    })

    await waitFor(() => {
      expect(api.testExecutions).toHaveBeenLastCalledWith(repository.id, {
        minimumDurationMs: '90000',
        maximumDurationMs: '300000',
      })
      expect(api.executionTrend).toHaveBeenLastCalledWith(repository.id, {
        minimumDurationMs: '90000',
        maximumDurationMs: '300000',
      })
      expect(api.executionPerformance).toHaveBeenLastCalledWith(repository.id, {
        minimumDurationMs: '90000',
        maximumDurationMs: '300000',
      })
    })
  })

  it('rejects an inverted duration window before loading misleading evidence', async () => {
    mockEvidenceApis()
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])

    render(<RepositoryIntelligence data={portfolio} />)
    await waitFor(() => expect(api.testExecutions).toHaveBeenCalled())
    fireEvent.change(screen.getByLabelText('Minimum duration (seconds)'), {
      target: { value: '300' },
    })
    fireEvent.change(screen.getByLabelText('Maximum duration (seconds)'), {
      target: { value: '90' },
    })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Maximum duration must be greater than or equal to minimum duration.'
    )
    expect(screen.getByLabelText('Maximum duration (seconds)')).toHaveAttribute('aria-invalid', 'true')
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
        'Required before release.',
        null
      )
    )
    expect(
      screen.getByRole('button', { name: 'Accept recommendation' })
    ).toBeEnabled()
    expect(screen.getByText(/This governance decision can be revised/)).toBeVisible()
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
          remediationAction: '',
          severity: '',
          reviewStatus: 'proposed',
          revisionScope: 'current',
          subject: '',
          minimumConfidencePercent: '',
          maximumConfidencePercent: '',
        }
      )
    ).toBe(false)
    expect(
      policyGateEvaluationMatchesInventory(governanceEvaluation, [repository], {
        kind: '',
        remediationAction: '',
        severity: '',
        reviewStatus: '',
        revisionScope: 'current',
        subject: '',
        minimumConfidencePercent: '91',
        maximumConfidencePercent: '100',
      })
    ).toBe(false)
    expect(
      policyGateEvaluationMatchesInventory(governanceEvaluation, [repository], {
        kind: '',
        remediationAction: '',
        severity: '',
        reviewStatus: '',
        revisionScope: 'current',
        subject: 'deployment',
        minimumConfidencePercent: '',
        maximumConfidencePercent: '',
      })
    ).toBe(false)
  })

  it('filters governance by remediation action and retains it during continuation', async () => {
    mockEvidenceApis()
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])
    vi.mocked(api.policyGateEvaluations).mockImplementation(async (_repositoryId, filter) =>
      filter?.cursor
        ? { items: [], page: { nextCursor: null, hasMore: false } }
        : { items: [governanceEvaluation], page: { nextCursor: 'policy-page-2', hasMore: true } }
    )
    render(<RepositoryIntelligence data={portfolio} />)
    await screen.findByText(governanceEvaluation.title)

    fireEvent.change(screen.getByLabelText('Proposed remediation'), {
      target: { value: 'build-gate' },
    })
    await waitFor(() => expect(api.policyGateEvaluations).toHaveBeenLastCalledWith(repository.id, {
      revision: repository.lastScanRevision,
      remediationAction: 'build-gate',
    }))

    fireEvent.click(await screen.findByRole('button', { name: 'Load more policy and gate history' }))
    await waitFor(() => expect(api.policyGateEvaluations).toHaveBeenLastCalledWith(repository.id, {
      revision: repository.lastScanRevision,
      remediationAction: 'build-gate',
      cursor: 'policy-page-2',
    }))
  })

  it('filters governance by exact subject and retains it during continuation', async () => {
    mockEvidenceApis()
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])
    vi.mocked(api.policyGateEvaluations).mockImplementation(async (_repositoryId, filter) =>
      filter?.cursor
        ? { items: [], page: { nextCursor: null, hasMore: false } }
        : { items: [governanceEvaluation], page: { nextCursor: 'policy-page-2', hasMore: true } }
    )
    render(<RepositoryIntelligence data={portfolio} />)
    await screen.findByText(governanceEvaluation.title)

    fireEvent.change(screen.getByLabelText('Governance subject'), {
      target: { value: ' authentication ' },
    })
    await waitFor(() => expect(api.policyGateEvaluations).toHaveBeenLastCalledWith(repository.id, {
      revision: repository.lastScanRevision,
      subject: 'authentication',
    }))

    fireEvent.click(await screen.findByRole('button', { name: 'Load more policy and gate history' }))
    await waitFor(() => expect(api.policyGateEvaluations).toHaveBeenLastCalledWith(repository.id, {
      revision: repository.lastScanRevision,
      subject: 'authentication',
      cursor: 'policy-page-2',
    }))
  })

  it('filters governance by confidence and retains the window during continuation', async () => {
    mockEvidenceApis()
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])
    vi.mocked(api.policyGateEvaluations).mockImplementation(async (_repositoryId, filter) =>
      filter?.cursor
        ? { items: [], page: { nextCursor: null, hasMore: false } }
        : { items: [governanceEvaluation], page: { nextCursor: 'policy-page-2', hasMore: true } }
    )
    render(<RepositoryIntelligence data={portfolio} />)
    await screen.findByText(governanceEvaluation.title)

    fireEvent.change(screen.getByLabelText('Minimum governance confidence (%)'), {
      target: { value: '70' },
    })
    fireEvent.change(screen.getByLabelText('Maximum governance confidence (%)'), {
      target: { value: '90' },
    })
    await waitFor(() => expect(api.policyGateEvaluations).toHaveBeenLastCalledWith(repository.id, {
      revision: repository.lastScanRevision,
      minConfidence: '0.7',
      maxConfidence: '0.9',
    }))

    fireEvent.click(await screen.findByRole('button', { name: 'Load more policy and gate history' }))
    await waitFor(() => expect(api.policyGateEvaluations).toHaveBeenLastCalledWith(repository.id, {
      revision: repository.lastScanRevision,
      minConfidence: '0.7',
      maxConfidence: '0.9',
      cursor: 'policy-page-2',
    }))
  })

  it('blocks an inverted governance confidence window before querying the API', async () => {
    mockEvidenceApis()
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])
    render(<RepositoryIntelligence data={portfolio} />)
    await waitFor(() => expect(api.policyGateEvaluations).toHaveBeenCalled())

    fireEvent.change(screen.getByLabelText('Minimum governance confidence (%)'), {
      target: { value: '90' },
    })
    await waitFor(() => expect(api.policyGateEvaluations).toHaveBeenLastCalledWith(repository.id, {
      revision: repository.lastScanRevision,
      minConfidence: '0.9',
    }))
    fireEvent.change(screen.getByLabelText('Maximum governance confidence (%)'), {
      target: { value: '70' },
    })

    expect(await screen.findByText('Maximum governance confidence must be greater than or equal to minimum governance confidence.')).toBeVisible()
    expect(screen.getByLabelText('Maximum governance confidence (%)')).toHaveAttribute('aria-invalid', 'true')
    expect(api.policyGateEvaluations).toHaveBeenLastCalledWith(repository.id, {
      revision: repository.lastScanRevision,
      minConfidence: '0.9',
    })
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

  it('locks governance re-review after another reviewer changes the decision and preserves rationale', async () => {
    mockEvidenceApis()
    const reviewedEvaluation = {
      ...governanceEvaluation,
      reviewStatus: 'accepted' as const,
      reviewedAt: '2026-10-09T01:00:00.000Z',
      reviewedBy: 'reviewer-1',
    }
    vi.mocked(api.policyGateEvaluations).mockResolvedValue([reviewedEvaluation])
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])
    vi.spyOn(api, 'reviewPolicyGateEvaluation').mockRejectedValue(
      new CatalogApiError(
        'This policy/gate review changed while you were deciding. Refresh the current decision before reviewing it again.',
        'STALE_POLICY_GATE_REVIEW',
        409
      )
    )

    render(<RepositoryIntelligence data={portfolio} />)
    await screen.findByText(/This governance decision can be revised/)
    const rationale = screen.getByLabelText('Optional governance rationale')
    fireEvent.change(rationale, { target: { value: 'The guard was replaced.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('changed while you were deciding')
    expect(api.reviewPolicyGateEvaluation).toHaveBeenCalledWith(
      repository.id,
      reviewedEvaluation.id,
      'dismissed',
      'The guard was replaced.',
      reviewedEvaluation.reviewedAt
    )
    expect(rationale).toHaveValue('The guard was replaced.')
    expect(rationale).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Accept recommendation' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeDisabled()
  })
})
