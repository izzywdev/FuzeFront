import { describe, expect, it } from 'vitest'
import type { Portfolio } from '@fuzequality/contracts'
import { buildFlowCoverageProjection, FLOW_COVERAGE_POLICY_VERSION, FLOW_FINDING_SCHEMA_VERSION } from './orphan-analysis'
import { MemoryCatalogStore } from './store'

const now = new Date('2026-09-11T12:00:00.000Z')

function portfolio(): Portfolio {
  return {
    repositories: [], tests: [], expectations: [], findings: [], diagnostics: [], suggestions: [],
    requirements: [
      { id: 'story-empty', jiraKey: 'FQ-10', issueType: 'Story', summary: 'Empty flow', description: '', status: 'To Do', project: 'FQ', updatedAt: '2026-09-01T00:00:00.000Z' },
      { id: 'story-flow', jiraKey: 'FQ-11', issueType: 'Story', summary: 'Checkout', description: '', status: 'In Progress', project: 'FQ', updatedAt: '2026-09-01T00:00:00.000Z', acceptanceCriteria: [{ fingerprint: 'criterion-a', position: 1, text: 'The order is accepted.' }] },
    ],
    flows: [
      { id: 'flow-checkout', requirementId: 'story-flow', title: 'Checkout', origin: 'confirmed', status: 'confirmed', actors: ['buyer'], steps: [{ id: 'step-unmapped', position: 1, actor: 'buyer', action: 'submits an order', expectedOutcome: 'order is accepted', variant: 'main', targetIds: [] }] },
      { id: 'flow-orphan', requirementId: 'deleted-story', title: 'Legacy renewal', origin: 'confirmed', status: 'confirmed', steps: [{ id: 'step-api', position: 1, actor: 'member', action: 'renews', expectedOutcome: 'renewed', variant: 'main', targetIds: ['api-renew'] }] },
    ],
    operations: [{ id: 'api-orphan', repositoryId: 'repo-a', documentPath: 'openapi.yaml', method: 'get', path: '/orphan', summary: 'Orphan', tags: [], security: false, parameters: [], responses: ['200'] }],
    surfaces: [{ id: 'ui-orphan', repositoryId: 'repo-a', packageName: 'web', kind: 'route', name: 'Orphan page', sourcePath: 'App.tsx', public: true, states: [], hasStory: false, stories: [] }],
  }
}

describe('orphan and undocumented flow analysis', () => {
  it('flags both sides of the product graph and missing non-happy paths', () => {
    const result = buildFlowCoverageProjection(portfolio(), { now })
    const types = result.findings.map(item => item.type)
    expect(types).toEqual(expect.arrayContaining([
      'story-without-flow', 'flow-without-active-story', 'uncovered-acceptance-criterion',
      'uncovered-flow-step', 'implementation-without-story', 'missing-role-path',
      'missing-failure-path', 'missing-cancel-path', 'missing-retry-path',
    ]))
    expect(result.policyVersion).toBe(FLOW_COVERAGE_POLICY_VERSION)
    expect(result.schemaVersion).toBe(FLOW_FINDING_SCHEMA_VERSION)
    expect(result.findings.every(item => item.evidenceStrength === 'deterministic')).toBe(true)
    expect(result.metrics.total).toBe(result.findings.length)
    expect(result.metrics.byType['implementation-without-story']).toBe(2)
  })

  it('is stable across duplicate projector deliveries and preserves unrelated findings', async () => {
    const first = buildFlowCoverageProjection(portfolio(), { now })
    const second = buildFlowCoverageProjection(portfolio(), { now })
    expect(second.findings.map(item => item.id)).toEqual(first.findings.map(item => item.id))
    const store = new MemoryCatalogStore({ ...portfolio(), findings: [{ id: 'scanner-finding', type: 'invalid-openapi', severity: 'high', title: 'Invalid spec', detail: 'Schema error', status: 'open' }] })
    const projection1 = await store.rebuildCoverage()
    const projection2 = await store.rebuildCoverage()
    const stored = (await store.portfolio()).findings
    expect(projection2.findings.map(item => item.id)).toEqual(projection1.findings.map(item => item.id))
    expect(new Set(stored.map(item => item.id)).size).toBe(stored.length)
    expect(stored.some(item => item.id === 'scanner-finding')).toBe(true)
  })

  it('does not report new stories during the planning grace period or count proposals as authoritative', () => {
    const value = portfolio()
    value.requirements[0].updatedAt = '2026-09-11T11:00:00.000Z'
    value.suggestions.push({ id: 'proposal', requirementId: 'story-empty', type: 'flow', title: 'Proposal', confidence: 0.9, evidence: [], payload: {}, state: 'proposed', createdAt: now.toISOString() })
    const result = buildFlowCoverageProjection(value, { now })
    expect(result.findings.some(item => item.type === 'story-without-flow' && item.subjectId === 'story-empty')).toBe(false)
  })
})
