// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { QualityArtifact, RepositoryFlowCandidate } from '@fuzequality/contracts'
import { FlowInspector } from './flowInspector'

const artifact: QualityArtifact = {
  id: 'route-login', repositoryId: 'repo-1', kind: 'route', title: 'Login route',
  sourcePath: 'apps/web/src/routes/login.tsx', summary: 'Login', evidence: ['/login'],
}
const flow: RepositoryFlowCandidate = {
  id: 'flow-1', repositoryId: 'repo-1', tenantId: 'tenant-1', revision: 'abc123',
  title: 'User signs in', confidence: 0.91, evidence: [artifact.id],
  steps: [{ actor: 'User', action: 'Submits credentials', expectedOutcome: 'Dashboard opens', targetIds: [artifact.id] }],
  wireframe: { kind: 'sequence', nodes: [{ label: 'Login', targetIds: [artifact.id] }, { label: 'Dashboard', targetIds: [] }] },
  status: 'proposed', source: 'litellm', createdAt: '2026-10-11T00:00:00.000Z',
  analysis: {
    provider: 'fuzeinfra-litellm', model: 'quality-analysis', promptVersion: 'flow-v2', schemaVersion: '2.0',
    inputArtifactCount: 140, promptArtifactCount: 100, promptTruncated: true,
  },
}

afterEach(cleanup)

describe('FlowInspector', () => {
  it('renders a dedicated wireframe, interaction detail, evidence, and LiteLLM provenance', () => {
    const onClose = vi.fn()
    render(<FlowInspector open flow={flow} repositoryLabel="FuzeFront" artifacts={[artifact]} onClose={onClose} />)

    expect(screen.getByRole('dialog', { name: 'User signs in' })).toBeInTheDocument()
    const wireframe = screen.getByRole('region', { name: 'Flow wireframe' })
    expect(wireframe).toHaveTextContent('Login')
    expect(wireframe).toHaveTextContent('Dashboard')
    expect(screen.getByRole('region', { name: 'Flow steps' })).toHaveTextContent('Dashboard opens')
    expect(screen.getByRole('region', { name: 'Flow provenance' })).toHaveTextContent('fuzeinfra-litellm')
    expect(screen.getByRole('region', { name: 'Flow provenance' })).toHaveTextContent('100 of 140 artifacts · bounded')
    expect(screen.getByTitle('Stable grounded-candidate identity')).toHaveTextContent('flow-1')
    expect(screen.getByText('apps/web/src/routes/login.tsx')).toBeVisible()
    screen.getByRole('button', { name: 'Close flow inspector' }).click()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('shows scoped loading and failure states without leaking a previous flow', () => {
    const { rerender } = render(<FlowInspector open loading artifacts={[]} onClose={vi.fn()} />)
    expect(screen.getByRole('status')).toHaveTextContent('tenant-scoped')

    rerender(<FlowInspector open error="Flow candidate not found" artifacts={[]} onClose={vi.fn()} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Flow candidate not found')
    expect(screen.getByRole('dialog', { name: 'UX flow inspector' })).not.toHaveTextContent('User signs in')
  })

  it('keeps human-readable evidence passages distinct from artifact references', () => {
    render(
      <FlowInspector
        open
        flow={{ ...flow, evidence: [artifact.id, '/login'] }}
        artifacts={[artifact]}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByText('/login')).toBeVisible()
    expect(screen.queryByText('Evidence reference unavailable in this catalog snapshot')).not.toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Flow provenance' }))
      .getByText('apps/web/src/routes/login.tsx')).toBeVisible()
  })
})
