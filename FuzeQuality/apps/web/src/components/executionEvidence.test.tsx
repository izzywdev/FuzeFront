// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { QualityArtifact, TestExecution, TestSuiteDispatch } from '@fuzequality/contracts'
import { ExecutionEvidenceCoverage, ExecutionEvidenceLinks, ExecutionEvidenceMetadata, ExecutionGateEvidence, ExecutionLinkageEvidence, ExecutionSourceLink, ExecutionThresholdEvidence, latestIntegrationExecution, latestPerformanceExecution, latestPostProductionExecution } from './executionEvidence'

const execution: TestExecution = {
  id: 'execution-1',
  repositoryId: '11111111-1111-4111-8111-111111111111',
  tenantId: 'tenant-1',
  provider: 'external',
  externalRunId: 'load-42',
  attempt: 1,
  revision: 'abc123',
  branch: 'feature/checkout',
  kind: 'load',
  status: 'failed',
  name: 'Checkout load test',
  workflowPath: '.github/workflows/load-test.yml',
  policyArtifactIds: [],
  gateArtifactIds: [],
  gateEvaluations: [{
    policyArtifactId: 'policy-performance',
    gateArtifactId: 'gate-load-budget',
    status: 'failed',
    detail: 'Latency budget exceeded.',
  }],
  thresholds: [
    {
      metric: 'p95 latency',
      observed: 430,
      unit: 'ms',
      operator: 'lte',
      target: 400,
      passed: false,
    },
    {
      metric: 'success rate',
      observed: 99.95,
      unit: '%',
      operator: 'gte',
      target: 99.9,
      passed: true,
    },
  ],
  evidenceLinks: [
    { kind: 'video', name: 'FuzeQuality production journey', url: 'https://evidence.example/run-42/video.webm' },
    { kind: 'report', name: 'Playwright HTML report', url: 'https://evidence.example/run-42/report/' },
  ],
}

const artifacts = [
  {
    id: 'policy-performance',
    repositoryId: execution.repositoryId,
    kind: 'policy' as const,
    title: 'Performance budget policy',
    sourcePath: 'governance/performance.md',
    summary: 'Latency budget policy',
    evidence: ['p95 latency must remain below 400 ms'],
  },
  {
    id: 'gate-load-budget',
    repositoryId: execution.repositoryId,
    kind: 'gate' as const,
    title: 'Load budget workflow',
    sourcePath: '.github/workflows/load-test.yml',
    summary: 'Load budget gate',
    evidence: ['Run the load budget gate'],
  },
]

describe('ExecutionThresholdEvidence', () => {
  it('distinguishes an unavailable provider lookup from a verified empty artifact result', () => {
    const { rerender, unmount } = render(<ExecutionEvidenceCoverage execution={{
      ...execution,
      evidenceLinks: [],
      evidenceCollection: {
        status: 'unavailable',
        checkedAt: '2026-10-16T08:00:00.000Z',
        errorCode: 'PROVIDER_TIMEOUT',
      },
    }} />)

    expect(screen.getByText(/artifact lookup timed out/i)).toHaveTextContent('zero artifacts is not a verified result')
    expect(screen.getByText(/provider evidence checked/i).querySelector('time')).toHaveAttribute(
      'datetime',
      '2026-10-16T08:00:00.000Z',
    )

    rerender(<ExecutionEvidenceCoverage execution={{
      ...execution,
      evidenceLinks: [],
      evidenceCollection: {
        status: 'complete',
        checkedAt: '2026-10-16T08:00:00.000Z',
      },
    }} />)

    expect(screen.getByText('Provider checked; no durable artifacts reported')).toBeInTheDocument()

    rerender(<ExecutionEvidenceCoverage execution={{
      ...execution,
      evidenceLinks: [],
      evidenceCollection: {
        status: 'partial',
        checkedAt: '2026-10-16T08:00:00.000Z',
        errorCode: 'PROVIDER_RESULT_LIMIT_EXCEEDED',
      },
    }} />)

    expect(screen.getByText(/provider result limit reached/i)).toHaveTextContent('including videos first')
    expect(screen.queryByText('Provider checked; no durable artifacts reported')).not.toBeInTheDocument()

    rerender(<ExecutionEvidenceCoverage execution={{
      ...execution,
      provider: 'github-actions',
      attempt: 2,
      evidenceLinks: [],
      evidenceCollection: {
        status: 'partial', checkedAt: '2026-10-16T08:00:00.000Z',
        issues: ['attempt-provenance-unverified'],
        unverifiedLinks: [{ kind: 'video', name: 'Run video', url: 'https://github.com/acme/app/actions/runs/42/artifacts/9' }],
      },
    }} />)

    expect(screen.getByText(/run-level artifacts were withheld/i)).toHaveTextContent('attempt 2')
    expect(screen.queryByText('Required post-production video evidence is missing')).not.toBeInTheDocument()

    rerender(<ExecutionEvidenceCoverage execution={{
      ...execution,
      provider: 'github-actions',
      evidenceLinks: [],
      evidenceCollection: {
        status: 'partial',
        checkedAt: '2026-10-16T08:00:00.000Z',
        issues: ['head-repository-unverified'],
      },
    }} onRefresh={vi.fn()} />)

    expect(screen.getByText(/head repository could not be verified/i)).toHaveTextContent(
      'Provider artifacts were withheld'
    )
    expect(screen.queryByRole('button', { name: /provider evidence/i })).not.toBeInTheDocument()
    expect(screen.queryByText('Provider checked; no durable artifacts reported')).not.toBeInTheDocument()

    rerender(<ExecutionEvidenceCoverage execution={{
      ...execution,
      provider: 'github-actions',
      attempt: 2,
      evidenceLinks: [{
        kind: 'video',
        name: 'Verified Playwright video',
        url: 'https://github.com/acme/app/actions/runs/42/artifacts/7',
      }],
      evidenceCollection: {
        status: 'partial', checkedAt: '2026-10-16T08:00:00.000Z',
        issues: ['attempt-provenance-unverified'],
        unverifiedLinks: [{ kind: 'video', name: 'Run video', url: 'https://github.com/acme/app/actions/runs/42/artifacts/9' }],
      },
    }} />)

    expect(screen.getByRole('region', { name: 'Execution evidence coverage' })).toHaveTextContent(
      '2 thresholds · 1 artifacts · 1 policy–gate outcomes'
    )
    expect(screen.getByText(/run-level artifacts were withheld/i)).toHaveTextContent('attempt 2')
    expect(screen.queryByText('Required post-production video evidence is missing')).not.toBeInTheDocument()

    rerender(<ExecutionEvidenceCoverage execution={{
      ...execution,
      provider: 'github-actions',
      evidenceLinks: [{
        kind: 'report',
        name: 'GitHub Actions artifacts',
        url: 'https://github.com/acme/app/actions/runs/42#artifacts',
      }],
      evidenceCollection: {
        status: 'complete',
        checkedAt: '2026-10-16T08:00:00.000Z',
      },
    }} />)

    expect(screen.getByRole('region', { name: 'Execution evidence coverage' })).toHaveTextContent(
      '2 thresholds · 0 artifacts · 1 policy–gate outcomes'
    )
    expect(screen.getByText('Provider checked; no durable artifacts reported')).toBeInTheDocument()
    unmount()
  })

  it('offers refresh for terminal GitHub evidence and reconciliation after a complete lookup', () => {
    const onRefresh = vi.fn()
    const { rerender, unmount } = render(<ExecutionEvidenceCoverage execution={{
      ...execution,
      provider: 'github-actions',
      status: 'failed',
      evidenceCollection: undefined,
    }} onRefresh={onRefresh} />)

    expect(screen.getByText(/artifact discovery has not run/i)).toHaveTextContent('zero artifacts is not a verified result')
    fireEvent.click(screen.getByRole('button', { name: 'Refresh provider evidence' }))
    expect(onRefresh).toHaveBeenCalledOnce()

    rerender(<ExecutionEvidenceCoverage execution={{
      ...execution,
      provider: 'github-actions',
      status: 'failed',
      evidenceCollection: { status: 'unavailable', checkedAt: '2026-10-18T04:00:00.000Z', errorCode: 'PROVIDER_TIMEOUT' },
    }} onRefresh={onRefresh} />)

    fireEvent.click(screen.getByRole('button', { name: 'Refresh provider evidence' }))
    expect(onRefresh).toHaveBeenCalledTimes(2)

    rerender(<ExecutionEvidenceCoverage execution={{
      ...execution,
      provider: 'github-actions',
      status: 'running',
      evidenceCollection: { status: 'partial', checkedAt: '2026-10-18T04:00:00.000Z', errorCode: 'PROVIDER_RESULT_LIMIT_EXCEEDED' },
    }} onRefresh={onRefresh} />)
    expect(screen.queryByRole('button', { name: /refresh provider evidence/i })).not.toBeInTheDocument()

    rerender(<ExecutionEvidenceCoverage execution={{
      ...execution,
      provider: 'external',
      evidenceCollection: { status: 'unavailable', checkedAt: '2026-10-18T04:00:00.000Z', errorCode: 'PROVIDER_UNAVAILABLE' },
    }} onRefresh={onRefresh} />)
    expect(screen.queryByRole('button', { name: /refresh provider evidence/i })).not.toBeInTheDocument()

    rerender(<ExecutionEvidenceCoverage execution={{
      ...execution,
      provider: 'github-actions',
      evidenceCollection: { status: 'complete', checkedAt: '2026-10-18T04:00:00.000Z' },
    }} onRefresh={onRefresh} />)
    fireEvent.click(screen.getByRole('button', { name: 'Reconcile provider evidence' }))
    expect(onRefresh).toHaveBeenCalledTimes(3)
    unmount()
  })

  it('does not present complete post-production evidence without a video as sufficient', () => {
    const { unmount } = render(<ExecutionEvidenceCoverage execution={{
      ...execution,
      kind: 'post-production',
      evidenceLinks: [{ kind: 'report', name: 'Playwright report', url: 'https://evidence.example/report' }],
      evidenceCollection: { status: 'complete', checkedAt: '2026-10-20T08:00:00.000Z' },
    }} />)

    expect(screen.getByText('Required post-production video evidence is missing')).toBeVisible()
    unmount()
  })

  it('does not count an unsafe legacy video as post-production evidence', () => {
    const { unmount } = render(<ExecutionEvidenceCoverage execution={{
      ...execution,
      kind: 'post-production',
      evidenceLinks: [{ kind: 'video', name: 'Unsafe legacy video', url: 'javascript:alert(1)' }],
      evidenceCollection: { status: 'complete', checkedAt: '2026-10-20T08:00:00.000Z' },
    }} />)

    expect(screen.getByText('2 thresholds · 0 artifacts · 1 policy–gate outcomes')).toBeVisible()
    expect(screen.getByText('1 invalid or non-HTTPS artifact link was withheld')).toBeVisible()
    expect(screen.getByText('Required post-production video evidence is missing')).toBeVisible()
    unmount()
  })

  it('matches a scanner-verified performance workflow only to its current artifact kind', () => {
    const artifact: QualityArtifact = {
      id: 'performance-workflow',
      repositoryId: execution.repositoryId,
      kind: 'load-test',
      title: 'Performance workflow',
      sourcePath: '.github/workflows/load-test.yml',
      summary: 'Load and soak coverage',
      evidence: [],
      execution: {
        provider: 'github-actions',
        workflowPath: '.github/workflows/load-test.yml',
        trigger: 'workflow_dispatch',
      },
    }
    const loadRun = { ...execution, id: 'load-run', kind: 'load' as const }
    const newerStressRun = {
      ...execution,
      id: 'stress-run',
      kind: 'stress' as const,
      completedAt: '2026-10-15T00:00:00.000Z',
    }

    expect(latestPerformanceExecution(artifact, [newerStressRun, loadRun])).toBe(loadRun)
    expect(
      latestPerformanceExecution(artifact, [
        { ...loadRun, workflowPath: '.github/workflows/other.yml' },
      ])
    ).toBeUndefined()
    expect(latestPerformanceExecution(artifact, [{
      ...loadRun,
      workflowPath: `${artifact.sourcePath}@refs/heads/main`,
    }])).toMatchObject({ id: loadRun.id })
  })

  it('shows ingested evidence for a non-dispatch performance workflow', () => {
    const artifact: QualityArtifact = {
      id: 'scheduled-load-workflow',
      repositoryId: execution.repositoryId,
      kind: 'load-test',
      title: 'Scheduled load workflow',
      sourcePath: '.github/workflows/load-test.yml',
      summary: 'Nightly load coverage',
      evidence: ['schedule'],
    }

    expect(latestPerformanceExecution(artifact, [execution])).toBe(execution)
  })

  it('matches post-production evidence only by detected workflow identity', () => {
    const artifact: QualityArtifact = {
      id: 'post-prod-workflow', repositoryId: execution.repositoryId, kind: 'post-production-test',
      title: 'Post production', sourcePath: '.github/workflows/post-prod.yml', summary: 'Production validation', evidence: [],
    }
    const run = { ...execution, kind: 'post-production' as const, workflowPath: artifact.sourcePath }
    expect(latestPostProductionExecution(artifact, [run])).toBe(run)
    expect(latestPostProductionExecution(artifact, [{
      ...run,
      workflowPath: `${artifact.sourcePath}@refs/heads/main`,
    }])).toMatchObject({ id: run.id })
    expect(latestPostProductionExecution(artifact, [{ ...run, kind: 'ci' }])).toBeUndefined()
  })

  it('matches integration evidence only by detected workflow identity', () => {
    const artifact: QualityArtifact = {
      id: 'integration-workflow', repositoryId: execution.repositoryId, kind: 'integration-test',
      title: 'Integration', sourcePath: '.github/workflows/integration.yml', summary: 'Integration tests', evidence: [],
    }
    const run = { ...execution, kind: 'integration' as const, workflowPath: artifact.sourcePath }
    expect(latestIntegrationExecution(artifact, [run])).toBe(run)
    expect(latestIntegrationExecution(artifact, [{
      ...run,
      workflowPath: `${artifact.sourcePath}@refs/heads/main`,
    }])).toMatchObject({ id: run.id })
    expect(latestIntegrationExecution(artifact, [{ ...run, kind: 'ci' }])).toBeUndefined()
  })

  it('keeps newer feature-branch runs out of current default-branch evidence', () => {
    const artifact: QualityArtifact = {
      id: 'integration-workflow', repositoryId: execution.repositoryId, kind: 'integration-test',
      title: 'Integration', sourcePath: '.github/workflows/integration.yml', summary: 'Integration tests', evidence: [],
    }
    const main = {
      ...execution,
      id: 'main-run',
      branch: 'main',
      kind: 'integration' as const,
      workflowPath: artifact.sourcePath,
      completedAt: '2026-10-14T00:00:00.000Z',
    }
    const feature = {
      ...main,
      id: 'feature-run',
      branch: 'feature/checkout',
      completedAt: '2026-10-15T00:00:00.000Z',
    }

    expect(latestIntegrationExecution(artifact, [feature, main], 'main')).toBe(main)
  })

  it('shows a pinned-tag run only when an accepted dispatch proves its inventory identity', () => {
    const revision = 'b'.repeat(40)
    const ref = `fuzequality-revision-${revision}`
    const artifact: QualityArtifact = {
      id: 'integration-workflow-revision',
      logicalId: 'workflow:.github/workflows/integration.yml',
      repositoryId: execution.repositoryId,
      kind: 'integration-test',
      title: 'Integration',
      sourcePath: '.github/workflows/integration.yml',
      summary: 'Integration tests',
      evidence: [],
    }
    const pinned = {
      ...execution,
      provider: 'github-actions' as const,
      id: 'pinned-run',
      revision,
      branch: ref,
      headRepository: 'acme/app',
      kind: 'integration' as const,
      workflowPath: artifact.sourcePath,
    }
    const dispatch: TestSuiteDispatch = {
      id: '77777777-7777-4777-8777-777777777777',
      repositoryId: artifact.repositoryId,
      tenantId: pinned.tenantId,
      artifactId: artifact.id,
      artifactLogicalId: artifact.logicalId!,
      artifactKind: 'integration-test',
      workflowPath: artifact.sourcePath,
      ref,
      sourceRevision: revision,
      requestedBy: 'user-1',
      inputNames: [],
      status: 'accepted',
      requestedAt: '2026-10-25T06:59:00.000Z',
      completedAt: '2026-10-25T06:59:01.000Z',
    }

    expect(latestIntegrationExecution(artifact, [pinned], 'main', 'acme/app')).toBeUndefined()
    expect(latestIntegrationExecution(artifact, [pinned], 'main', 'acme/app', [dispatch])).toBe(pinned)
    expect(latestIntegrationExecution(
      artifact,
      [pinned],
      'main',
      'acme/app',
      [{ ...dispatch, status: 'failed' }],
    )).toBeUndefined()
  })

  it('keeps same-name fork branches out of reviewed repository evidence', () => {
    const artifact: QualityArtifact = {
      id: 'integration-workflow', repositoryId: execution.repositoryId, kind: 'integration-test',
      title: 'Integration', sourcePath: '.github/workflows/integration.yml', summary: 'Integration tests', evidence: [],
    }
    const trusted = {
      ...execution,
      provider: 'github-actions' as const,
      id: 'trusted-run',
      branch: 'main',
      headRepository: 'acme/app',
      kind: 'integration' as const,
      workflowPath: artifact.sourcePath,
      completedAt: '2026-10-14T00:00:00.000Z',
    }
    const fork = {
      ...trusted,
      id: 'fork-run',
      headRepository: 'contributor/app',
      completedAt: '2026-10-15T00:00:00.000Z',
    }

    expect(latestIntegrationExecution(artifact, [fork, trusted], 'main', 'ACME/App')).toBe(trusted)
  })

  it('renders the workflow file with the provider-owned run identity', () => {
    render(<ExecutionEvidenceMetadata execution={{ ...execution, headRepository: 'acme/app' }} />)

    expect(screen.getByText('.github/workflows/load-test.yml')).toBeInTheDocument()
    expect(screen.getByText('external · load-42')).toBeInTheDocument()
    expect(screen.getByText('Source branch')).toBeInTheDocument()
    expect(screen.getByText('feature/checkout')).toBeInTheDocument()
    expect(screen.getByText('Source repository')).toBeInTheDocument()
    expect(screen.getByText('acme/app')).toBeInTheDocument()
    expect(screen.getByText('Suite classification')).toBeInTheDocument()
    expect(screen.getByText('load')).toBeInTheDocument()
  })

  it('shows exact lifecycle timestamps and warns on retained legacy timing conflicts', () => {
    const { container, rerender } = render(<ExecutionEvidenceMetadata execution={{
      ...execution,
      startedAt: '2026-10-20T12:00:00.000Z',
      completedAt: '2026-10-20T12:01:00.000Z',
    }} />)

    const metadata = within(container).getByRole('region', { name: 'Execution provider metadata' })
    expect(within(metadata).getByText('Started').nextElementSibling?.querySelector('time')).toHaveAttribute(
      'datetime',
      '2026-10-20T12:00:00.000Z',
    )
    expect(within(metadata).getByText('Completed').nextElementSibling?.querySelector('time')).toHaveAttribute(
      'datetime',
      '2026-10-20T12:01:00.000Z',
    )
    expect(within(metadata).getByText('1m 0s')).toBeVisible()
    expect(within(metadata).queryByRole('alert')).not.toBeInTheDocument()

    rerender(<ExecutionEvidenceMetadata execution={{
      ...execution,
      status: 'running',
      startedAt: '2026-10-20T12:00:00.000Z',
      completedAt: '2026-10-20T12:01:00.000Z',
    }} />)
    expect(within(container).getByRole('alert')).toHaveTextContent(
      'Running execution includes a completion timestamp; timing evidence is inconsistent.'
    )
    expect(within(container).queryByText('1m 0s')).not.toBeInTheDocument()

    rerender(<ExecutionEvidenceMetadata execution={{
      ...execution,
      startedAt: '2026-10-20T12:01:00.000Z',
      completedAt: '2026-10-20T12:00:00.000Z',
    }} />)
    expect(within(container).getByRole('alert')).toHaveTextContent(
      'Completion timestamp precedes start; duration evidence is invalid.'
    )

    rerender(<ExecutionEvidenceMetadata execution={{
      ...execution,
      startedAt: undefined,
      completedAt: '2026-10-20T12:01:00.000Z',
    }} />)
    expect(within(container).getByRole('status')).toHaveTextContent(
      'Terminal execution is missing start or completion timing evidence.'
    )
  })

  it('renders observed-versus-target values and evaluated outcomes', () => {
    render(<ExecutionThresholdEvidence execution={execution} />)

    expect(
      screen.getByRole('region', { name: 'Execution threshold evidence' })
    ).toBeInTheDocument()
    expect(screen.getByText('p95 latency')).toBeInTheDocument()
    expect(screen.getByText('430 ms ≤ 400 ms')).toBeInTheDocument()
    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.getByText('99.95 % ≥ 99.9 %')).toBeInTheDocument()
    expect(screen.getByText('Passed')).toBeInTheDocument()
  })

  it('renders nothing when no thresholds were supplied', () => {
    const { container } = render(
      <ExecutionThresholdEvidence execution={{ ...execution, thresholds: [] }} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders explicit policy-gate outcomes without inferring pairs', () => {
    render(
      <ExecutionGateEvidence execution={execution} artifacts={artifacts} />
    )

    expect(
      screen.getByRole('region', { name: 'Policy gate evidence' })
    ).toBeInTheDocument()
    expect(screen.getByText('1 evaluated pair')).toBeInTheDocument()
    expect(screen.getByText('Performance budget policy')).toBeInTheDocument()
    expect(screen.getByText('Load budget workflow')).toBeInTheDocument()
    expect(
      screen.getByText(
        'governance/performance.md → .github/workflows/load-test.yml'
      )
    ).toBeInTheDocument()
    expect(screen.getByText('Latency budget exceeded.')).toBeInTheDocument()
    expect(screen.getByText('failed')).toBeInTheDocument()
  })

  it('renders every explicit policy outcome for a shared exact gate', () => {
    render(
      <ExecutionGateEvidence
        execution={{
          ...execution,
          policyArtifactIds: ['policy-performance', 'policy-reliability'],
          gateEvaluations: [
            { policyArtifactId: 'policy-performance', gateArtifactId: 'gate-load-budget', status: 'passed' },
            { policyArtifactId: 'policy-reliability', gateArtifactId: 'gate-load-budget', status: 'passed' },
          ],
        }}
        artifacts={[
          ...artifacts,
          { id: 'policy-reliability', repositoryId: execution.repositoryId, kind: 'policy', title: 'Reliability policy', sourcePath: 'governance/reliability.md', summary: 'Load reliability is required.', evidence: [] },
        ]}
      />
    )

    const region = screen.getAllByRole('region', { name: 'Policy gate evidence' }).at(-1)!
    expect(within(region).getByText('2 evaluated pairs')).toBeInTheDocument()
    expect(within(region).getByText('Performance budget policy')).toBeInTheDocument()
    expect(within(region).getByText('Reliability policy')).toBeInTheDocument()
    expect(within(region).getAllByText('Load budget workflow')).toHaveLength(2)
    expect(within(region).getAllByText('passed')).toHaveLength(2)
  })

  it('renders watchable video and report links for the run', () => {
    const { container } = render(<ExecutionEvidenceLinks execution={{
      ...execution,
      evidenceLinks: [...execution.evidenceLinks].reverse(),
    }} />)

    expect(screen.getByRole('region', { name: 'Run evidence' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Watch FuzeQuality production journey' })).toHaveAttribute(
      'href',
      'https://evidence.example/run-42/video.webm'
    )
    expect(screen.getByRole('link', { name: 'Open Playwright HTML report' })).toHaveAttribute(
      'href',
      'https://evidence.example/run-42/report/'
    )
    expect([...container.querySelectorAll('a')].map(link => link.textContent)).toEqual([
      'Watch FuzeQuality production journey',
      'Open Playwright HTML report',
    ])
  })

  it('renders only the latest label for a stable evidence link', () => {
    const report = execution.evidenceLinks.find(link => link.kind === 'report')!
    const { container } = render(<ExecutionEvidenceLinks execution={{
      ...execution,
      evidenceLinks: [
        { ...report, name: 'Pending report' },
        { ...report, name: 'Final Playwright report' },
      ],
    }} />)

    expect(screen.queryByRole('link', { name: 'Open Pending report' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open Final Playwright report' })).toHaveAttribute('href', report.url)
    expect(container.querySelectorAll('a')).toHaveLength(1)
  })

  it('labels a provider-hosted video archive as a download', () => {
    render(<ExecutionEvidenceLinks execution={{
      ...execution,
      evidenceLinks: [{
        kind: 'video',
        name: 'fuzequality-post-prod-playwright-video',
        url: 'https://github.com/izzywdev/FuzeFront/actions/runs/4242/artifacts/11',
      }],
    }} />)

    expect(screen.getByRole('link', {
      name: 'Download fuzequality-post-prod-playwright-video',
    })).toHaveAttribute(
      'href',
      'https://github.com/izzywdev/FuzeFront/actions/runs/4242/artifacts/11'
    )
  })

  it('does not render unsafe legacy evidence or provider URLs', () => {
    const { container, rerender } = render(<ExecutionEvidenceLinks execution={{
      ...execution,
      evidenceLinks: [
        { kind: 'video', name: 'Unsafe video', url: 'javascript:alert(1)' },
        { kind: 'report', name: 'Insecure report', url: 'http://evidence.example/report' },
      ],
    }} />)

    expect(container).toBeEmptyDOMElement()

    rerender(<ExecutionSourceLink execution={{ ...execution, sourceUrl: 'javascript:alert(1)' }} />)
    expect(container).toBeEmptyDOMElement()

    rerender(<ExecutionSourceLink execution={{
      ...execution,
      sourceUrl: 'https://github.com/izzywdev/FuzeFront/actions/runs/42',
    }} />)
    expect(container.querySelector('a')).toHaveAttribute(
      'href',
      'https://github.com/izzywdev/FuzeFront/actions/runs/42'
    )
  })

  it('summarizes detailed evidence and flags a lifecycle-only performance run', () => {
    const { rerender } = render(<ExecutionEvidenceCoverage execution={execution} />)

    expect(screen.getByRole('region', { name: 'Execution evidence coverage' })).toHaveTextContent(
      '2 thresholds · 2 artifacts · 1 policy–gate outcomes'
    )
    expect(screen.queryByText(/No performance threshold/)).not.toBeInTheDocument()

    rerender(
      <ExecutionEvidenceCoverage
        execution={{ ...execution, thresholds: [], evidenceLinks: [], gateEvaluations: [] }}
      />
    )
    expect(screen.getByText('No performance threshold observations ingested')).toBeVisible()
  })

  it('distinguishes explicit outcomes from legacy, ambiguous, and missing linkage', () => {
    const { rerender } = render(<ExecutionLinkageEvidence execution={execution} />)
    expect(screen.getByText('Explicit outcome linkage')).toBeVisible()
    expect(screen.getByText('1 policy–gate pair evaluated for this run')).toBeVisible()

    rerender(<ExecutionLinkageEvidence execution={{
      ...execution,
      policyArtifactIds: ['policy-performance'],
      gateArtifactIds: ['gate-load-budget'],
      gateEvaluations: [],
    }} />)
    expect(screen.getByText('Legacy one-to-one linkage')).toBeVisible()

    rerender(<ExecutionLinkageEvidence execution={{
      ...execution,
      policyArtifactIds: ['policy-1', 'policy-2'],
      gateArtifactIds: ['gate-1'],
      gateEvaluations: [],
    }} />)
    expect(screen.getByText('Inventory linkage only')).toBeVisible()
    expect(screen.getByText(/no unambiguous pair outcome exists/i)).toBeVisible()

    rerender(<ExecutionLinkageEvidence execution={{
      ...execution,
      policyArtifactIds: [],
      gateArtifactIds: [],
      gateEvaluations: [],
    }} />)
    expect(screen.getByText('No policy–gate linkage')).toBeVisible()
  })

  it('renders legacy executions without optional evidence collections safely', () => {
    const legacyExecution = {
      ...execution,
      thresholds: undefined,
      gateEvaluations: undefined,
      evidenceLinks: undefined,
    } as unknown as TestExecution

    const { container } = render(
      <>
        <ExecutionThresholdEvidence execution={legacyExecution} />
        <ExecutionGateEvidence execution={legacyExecution} />
        <ExecutionEvidenceLinks execution={legacyExecution} />
      </>
    )

    expect(container).toBeEmptyDOMElement()
  })
})
