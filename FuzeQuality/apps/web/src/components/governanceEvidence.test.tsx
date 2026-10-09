// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { PolicyGateEvaluation, QualityArtifact } from '@fuzequality/contracts'
import { PolicyGateEvidence } from './governanceEvidence'

const evaluation: PolicyGateEvaluation = {
  id: 'evaluation-1',
  repositoryId: '11111111-1111-4111-8111-111111111111',
  tenantId: 'tenant-1',
  revision: 'abc123',
  kind: 'unguarded-policy',
  severity: 'high',
  title: 'Authentication policy has no gate',
  detail: 'No matching gate was found.',
  policyArtifactIds: ['policy-auth'],
  gateArtifactIds: [],
  confidence: 0.75,
  scope: {
    sourcePaths: ['governance/auth.md'],
    subjects: ['authentication'],
  },
  recommendation: 'Add a gate.',
  reviewStatus: 'proposed',
  createdAt: '2026-10-09T08:00:00.000Z',
}

const artifacts: QualityArtifact[] = [{
  id: 'policy-auth',
  repositoryId: evaluation.repositoryId,
  kind: 'policy',
  title: 'Authentication policy',
  sourcePath: 'governance/auth.md',
  summary: 'Authentication is required.',
  evidence: ['Authentication is required.'],
}]

describe('PolicyGateEvidence', () => {
  it('shows detector confidence, scope, revision, and resolved source evidence', () => {
    render(<PolicyGateEvidence evaluation={evaluation} artifacts={artifacts} />)

    expect(screen.getByText('75%')).toBeInTheDocument()
    expect(screen.getByText('abc123')).toBeInTheDocument()
    expect(screen.getByText('Matched subjects: authentication')).toBeInTheDocument()
    expect(screen.getByText('Authentication policy')).toBeInTheDocument()
    expect(screen.getByText('policy · governance/auth.md')).toBeInTheDocument()
  })

  it('keeps legacy evaluations without confidence or scope reviewable', () => {
    const legacyEvaluation = {
      ...evaluation,
      confidence: undefined,
      scope: undefined,
    } as unknown as PolicyGateEvaluation

    render(<PolicyGateEvidence evaluation={legacyEvaluation} artifacts={artifacts} />)

    expect(screen.getByText('Unknown')).toBeInTheDocument()
    expect(screen.getByText('Repository scope was not recorded for this legacy evaluation.')).toBeInTheDocument()
  })
})
