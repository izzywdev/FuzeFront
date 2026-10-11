// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { QualityArtifact, TestExecution } from '@fuzequality/contracts'
import { ExecutionEvidenceCoverage, ExecutionEvidenceLinks, ExecutionEvidenceMetadata, ExecutionGateEvidence, ExecutionThresholdEvidence, latestPerformanceExecution } from './executionEvidence'

const execution: TestExecution = {
  id: 'execution-1',
  repositoryId: '11111111-1111-4111-8111-111111111111',
  tenantId: 'tenant-1',
  provider: 'external',
  externalRunId: 'load-42',
  attempt: 1,
  revision: 'abc123',
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
  it('matches a scanner-verified performance workflow despite heuristic run kind differences', () => {
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
    const heuristicStressRun = { ...execution, kind: 'stress' as const }

    expect(latestPerformanceExecution(artifact, [heuristicStressRun])).toBe(
      heuristicStressRun
    )
    expect(
      latestPerformanceExecution(artifact, [
        { ...heuristicStressRun, workflowPath: '.github/workflows/other.yml' },
      ])
    ).toBeUndefined()
  })

  it('renders the workflow file with the provider-owned run identity', () => {
    render(<ExecutionEvidenceMetadata execution={execution} />)

    expect(screen.getByText('.github/workflows/load-test.yml')).toBeInTheDocument()
    expect(screen.getByText('external · load-42')).toBeInTheDocument()
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

  it('renders watchable video and report links for the run', () => {
    render(<ExecutionEvidenceLinks execution={execution} />)

    expect(screen.getByRole('region', { name: 'Run evidence' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Watch FuzeQuality production journey' })).toHaveAttribute(
      'href',
      'https://evidence.example/run-42/video.webm'
    )
    expect(screen.getByRole('link', { name: 'Open Playwright HTML report' })).toHaveAttribute(
      'href',
      'https://evidence.example/run-42/report/'
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
