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
    inputArtifactCount: 140, promptArtifactCount: 100, promptOmittedArtifactCount: 40,
    promptContentTruncated: true, promptTruncated: true,
    grounding: { referencedArtifactCount: 1, groundedArtifactCount: 1, rejectedArtifactCount: 0, ungroundedStepCount: 0 },
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
    expect(screen.getByRole('region', { name: 'Flow provenance' })).toHaveTextContent('100 of 140 repository artifacts supplied · 40 artifacts omitted · source content truncated')
    expect(screen.getByRole('region', { name: 'Flow provenance' })).toHaveTextContent('1 of 1 artifact references verified')
    expect(screen.getByTitle('Stable grounded-candidate identity')).toHaveTextContent('flow-1')
    expect(screen.getByText('apps/web/src/routes/login.tsx')).toBeVisible()
    screen.getByRole('button', { name: 'Close flow inspector' }).click()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('warns reviewers when LiteLLM returned references that repository evidence could not verify', () => {
    render(
      <FlowInspector
        open
        flow={{
          ...flow,
          analysis: {
            ...flow.analysis!,
            grounding: { referencedArtifactCount: 3, groundedArtifactCount: 1, rejectedArtifactCount: 2, ungroundedStepCount: 1 },
          },
        }}
        artifacts={[artifact]}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByRole('alert')).toHaveTextContent('2 unverified artifact references')
    expect(screen.getByRole('alert')).toHaveTextContent('1 step without grounded targets')
    expect(screen.getByRole('alert')).toHaveTextContent('before confirming this flow')
  })

  it('shows scoped loading and failure states without leaking a previous flow', () => {
    const { rerender } = render(<FlowInspector open loading artifacts={[]} onClose={vi.fn()} />)
    expect(screen.getByRole('status')).toHaveTextContent('tenant-scoped')

    rerender(<FlowInspector open error="Flow candidate not found" artifacts={[]} onClose={vi.fn()} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Flow candidate not found')
    expect(screen.getByRole('dialog', { name: 'UX flow inspector' })).not.toHaveTextContent('User signs in')
  })

  it('keeps deterministic human-readable evidence passages distinct from artifact references', () => {
    render(
      <FlowInspector
        open
        flow={{ ...flow, source: 'deterministic', analysis: undefined, evidence: [artifact.id, '/login'] }}
        artifacts={[artifact]}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByText('/login')).toBeVisible()
    expect(screen.queryByText('Evidence reference unavailable in this catalog snapshot')).not.toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Flow provenance' }))
      .getByText('apps/web/src/routes/login.tsx')).toBeVisible()
  })

  it('blocks reviewer trust when a legacy wireframe target is unavailable at the exact revision', () => {
    render(
      <FlowInspector
        open
        flow={{
          ...flow,
          steps: flow.steps.map(step => ({ ...step, targetIds: ['missing-route'] })),
          wireframe: { kind: 'sequence', nodes: [{ label: 'Login', targetIds: ['missing-route'] }] },
        }}
        artifacts={[artifact]}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByRole('alert')).toHaveTextContent(
      '1 artifact reference is unavailable in this exact repository revision'
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Do not confirm this flow')
  })

  it('blocks reviewer trust when a legacy flow has no wireframe', () => {
    render(
      <FlowInspector
        open
        flow={{ ...flow, wireframe: { kind: 'sequence', nodes: [] } }}
        artifacts={[artifact]}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByRole('alert')).toHaveTextContent('No reviewable wireframe is stored')
    expect(screen.getByRole('alert')).toHaveTextContent('Do not confirm it')
  })

  it('blocks reviewer trust when a legacy LiteLLM proposal has no analysis provenance', () => {
    render(
      <FlowInspector
        open
        flow={{ ...flow, analysis: undefined }}
        artifacts={[artifact]}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByRole('alert')).toHaveTextContent('no stored model, prompt, and schema provenance')
    expect(screen.getByRole('alert')).toHaveTextContent('Do not confirm it')
    expect(screen.queryByText('Deterministic analysis; no model invocation.')).not.toBeInTheDocument()
  })

  it('blocks reviewer trust when a legacy flow has no interaction steps', () => {
    render(
      <FlowInspector
        open
        flow={{ ...flow, steps: [] }}
        artifacts={[artifact]}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByRole('alert')).toHaveTextContent('No reviewable interaction steps are stored')
    expect(screen.getByRole('alert')).toHaveTextContent('Do not confirm it')
  })

  it('blocks reviewer trust when retained LiteLLM provenance is incomplete', () => {
    render(
      <FlowInspector
        open
        flow={{ ...flow, analysis: { ...flow.analysis!, model: ' ' } }}
        artifacts={[artifact]}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByRole('alert')).toHaveTextContent('no stored model, prompt, and schema provenance')
    expect(screen.queryByText('fuzeinfra-litellm')).not.toBeInTheDocument()
  })

  it('blocks reviewer trust when LiteLLM evidence is unavailable even if targets still resolve', () => {
    render(
      <FlowInspector
        open
        flow={{ ...flow, evidence: ['missing-model-evidence'] }}
        artifacts={[artifact]}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByRole('alert')).toHaveTextContent(
      '1 artifact reference is unavailable in this exact repository revision'
    )
    expect(screen.getByText('Evidence reference unavailable in this catalog snapshot')).toBeVisible()
  })
})
