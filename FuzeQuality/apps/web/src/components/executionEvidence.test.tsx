// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { TestExecution } from '@fuzequality/contracts'
import { ExecutionThresholdEvidence } from './executionEvidence'

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
  policyArtifactIds: [],
  gateArtifactIds: [],
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
}

describe('ExecutionThresholdEvidence', () => {
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
})
