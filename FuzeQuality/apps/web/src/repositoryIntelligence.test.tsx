// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type {
  Portfolio,
  QualityArtifact,
  Repository,
  RepositoryFlowCandidate,
  PolicyGateEvaluation,
} from '@fuzequality/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  flowCandidateMatchesInventory,
  RepositoryIntelligence,
} from './App'
import { api } from './api'

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

const loadArtifact: QualityArtifact = {
  id: 'artifact-load-1',
  repositoryId: repository.id,
  kind: 'load-test',
  title: 'Load test',
  sourcePath: '.github/workflows/load-test.yml',
  summary: 'Load workflow',
  evidence: ['workflow_dispatch'],
  execution: {
    provider: 'github-actions',
    workflowPath: '.github/workflows/load-test.yml',
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

function mockEvidenceApis() {
  vi.spyOn(api, 'qualityArtifacts').mockResolvedValue([])
  vi.spyOn(api, 'policyGateEvaluations').mockResolvedValue([])
  vi.spyOn(api, 'testExecutions').mockResolvedValue([])
  vi.spyOn(api, 'executionPerformance').mockResolvedValue([])
  vi.spyOn(api, 'repositoryFlowReviewHistory').mockResolvedValue([])
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('RepositoryIntelligence flow inventory', () => {
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
        }
      )
    ).toBe(false)
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

  it('shows a durable handoff message after dispatching a performance workflow', async () => {
    mockEvidenceApis()
    vi.mocked(api.qualityArtifacts).mockResolvedValue([loadArtifact])
    vi.spyOn(api, 'repositoryFlowCandidates').mockResolvedValue([])
    vi.spyOn(api, 'runPerformanceTest').mockResolvedValue({
      status: 'dispatched',
      artifactId: loadArtifact.id,
      workflowPath: loadArtifact.sourcePath,
      ref: 'main',
    })
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<RepositoryIntelligence data={portfolio} />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Run on default branch' })
    )

    await waitFor(() =>
      expect(api.runPerformanceTest).toHaveBeenCalledWith(
        repository.id,
        loadArtifact.id
      )
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Dispatched .github/workflows/load-test.yml on main'
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
      await screen.findByRole('button', { name: 'Run on default branch' })
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
      'add a repository-owned GitHub Actions workflow_dispatch workflow'
    )
    expect(
      screen.queryByRole('button', { name: 'Run on default branch' })
    ).not.toBeInTheDocument()
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
})
