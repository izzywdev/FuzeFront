import { describe, expect, it } from 'vitest'
import type { Portfolio } from '@fuzequality/contracts'
import { buildRequirementReviewProjection, REQUIREMENT_REVIEW_POLICY_VERSION } from './requirement-analysis'

const now = new Date('2026-09-11T12:00:00.000Z')

function portfolio(): Portfolio {
  return {
    repositories: [], operations: [], surfaces: [], tests: [], expectations: [], findings: [], diagnostics: [],
    requirements: [
      { id: 'missing', jiraKey: 'FQ-100', issueType: 'Story', summary: 'Undefined export', description: 'An owner exports the report.', status: 'To Do', project: 'FQ', updatedAt: '2026-09-10T00:00:00.000Z' },
      { id: 'conflict', jiraKey: 'FQ-101', issueType: 'Story', summary: 'Tenant export', description: '', status: 'In Progress', project: 'FQ', updatedAt: '2026-09-09T00:00:00.000Z', acceptanceCriteria: [
        { fingerprint: 'allow', position: 1, text: 'The viewer can download tenant reports.' },
        { fingerprint: 'deny', position: 2, text: 'The viewer cannot download tenant reports.' },
      ] },
    ],
    flows: [{ id: 'flow-missing', requirementId: 'missing', title: 'Export', origin: 'confirmed', status: 'confirmed', steps: [
      { id: 'step-export', position: 1, actor: 'owner', action: 'exports', expectedOutcome: 'report downloads', variant: 'main', targetIds: ['api:export'] },
    ] }],
    suggestions: [{ id: 'semantic-gap', requirementId: 'conflict', type: 'missing-criteria', title: 'Define export retention', confidence: 0.84, evidence: ['Reports are retained.'], payload: {}, state: 'proposed', createdAt: now.toISOString() }],
  }
}

describe('requirement review analysis', () => {
  it('exposes incomplete and contradictory source evidence without changing Jira', () => {
    const source = portfolio()
    const before = structuredClone(source.requirements)
    const result = buildRequirementReviewProjection(source, { now })
    expect(result.policyVersion).toBe(REQUIREMENT_REVIEW_POLICY_VERSION)
    expect(result.findings.map(item => item.type)).toEqual(expect.arrayContaining([
      'missing-acceptance-criteria', 'conflicting-requirement-outcome', 'incomplete-requirement-criteria',
    ]))
    const conflict = result.findings.find(item => item.type === 'conflicting-requirement-outcome')
    expect(conflict?.sourcePassages).toHaveLength(2)
    expect(conflict?.remediationOptions).toHaveLength(3)
    const semantic = result.findings.find(item => item.type === 'incomplete-requirement-criteria')
    expect(semantic).toMatchObject({ confidence: 0.84, evidenceStrength: 'semantic' })
    expect(source.requirements).toEqual(before)
  })

  it('uses stable identities across duplicate deliveries', () => {
    const first = buildRequirementReviewProjection(portfolio(), { now })
    const second = buildRequirementReviewProjection(portfolio(), { now })
    expect(second.findings.map(item => item.id)).toEqual(first.findings.map(item => item.id))
    expect(new Set(first.findings.map(item => item.id)).size).toBe(first.findings.length)
  })
})
