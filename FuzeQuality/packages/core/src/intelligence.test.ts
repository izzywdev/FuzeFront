import { describe, expect, it } from 'vitest'
import { adfToText, suggestionsFromAnalysis } from './intelligence'

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
      confidence: 0.9,
      evidence: ['Expired tokens are rejected.'],
    })
    expect(suggestions).toHaveLength(2)
    expect(suggestions.every(item => item.state === 'proposed')).toBe(true)
  })
})
