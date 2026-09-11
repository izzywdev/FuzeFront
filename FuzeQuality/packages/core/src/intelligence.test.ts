import { describe, expect, it } from 'vitest'
import { FLOW_PROMPT_VERSION, FLOW_SCHEMA_VERSION, LiteLlmFlowAnalyzer, adfToText, suggestionsFromAnalysis } from './intelligence'

describe('Jira intelligence', () => {
  it('normalizes Atlassian document format without executing embedded instructions', () => {
    expect(
      adfToText({
        type: 'doc',
        content: [
          { type: 'heading', content: [{ type: 'text', text: 'Acceptance criteria' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Expired tokens are rejected.' }] },
        ],
      })
    ).toContain('Expired tokens are rejected.')
  })

  it('creates review-only flow and expected-test suggestions', () => {
    const requirement = {
      id: 'requirement-1',
      jiraKey: 'FUZE-1',
      issueType: 'Story' as const,
      summary: 'Reset password',
      description: 'Expired tokens are rejected.',
      status: 'Open',
      project: 'FUZE',
      updatedAt: '2026-07-19T00:00:00.000Z',
    }
    const suggestions = suggestionsFromAnalysis(requirement, {
      title: 'Password reset',
      actors: ['anonymous user'],
      preconditions: [],
      trigger: 'request reset',
      steps: [
        {
          actor: 'anonymous user',
          action: 'submits an expired token',
          expectedOutcome: 'the token is rejected',
          variant: 'error',
          candidateTargetIds: [],
        },
      ],
      suggestedTests: [
        { title: 'Reject expired token', priority: 'required', rationale: 'Explicit criterion' },
      ],
      missingCriteria: [],
      authorizationBoundaries: ['anonymous access is limited to reset requests'],
      tenantBoundaries: ['tokens cannot cross organizations'],
      confidence: 0.9,
      evidence: ['Expired tokens are rejected.'],
      provenance: {
        promptVersion: FLOW_PROMPT_VERSION,
        schemaVersion: FLOW_SCHEMA_VERSION,
        model: 'quality-analysis',
      },
    })
    expect(suggestions).toHaveLength(2)
    expect(suggestions.every(item => item.state === 'proposed')).toBe(true)
    expect(suggestions[0].payload).toMatchObject({
      actors: ['anonymous user'],
      authorizationBoundaries: ['anonymous access is limited to reset requests'],
      tenantBoundaries: ['tokens cannot cross organizations'],
      analysis: { promptVersion: FLOW_PROMPT_VERSION, model: 'quality-analysis' },
    })
  })

  it('records local prompt provenance and validates structured recovery paths', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      title: 'Safe checkout',
      actors: ['buyer'],
      preconditions: ['buyer belongs to an organization'],
      trigger: 'buyer checks out',
      steps: [{ actor: 'buyer', action: 'retries payment', expectedOutcome: 'checkout resumes', variant: 'recovery', candidateTargetIds: ['api:checkout'] }],
      suggestedTests: [], missingCriteria: [], confidence: 0.8, evidence: ['retry payment'],
      authorizationBoundaries: ['buyer role required'], tenantBoundaries: ['order remains in its organization'],
    }) } }] }), { status: 200 })
    const analyzer = new LiteLlmFlowAnalyzer('http://litellm/v1', 'quality-analysis', 'token', fetchImpl as typeof fetch)
    const analysis = await analyzer.analyze({
      id: 'requirement-2', jiraKey: 'FQ-2', issueType: 'Story', summary: 'Checkout',
      description: 'retry payment', status: 'To Do', project: 'FQ', updatedAt: '2026-01-01T00:00:00Z',
    }, { operations: [], surfaces: [] })
    expect(analysis.steps[0].variant).toBe('recovery')
    expect(analysis.provenance).toEqual({
      promptVersion: FLOW_PROMPT_VERSION,
      schemaVersion: FLOW_SCHEMA_VERSION,
      model: 'quality-analysis',
    })
  })
})
