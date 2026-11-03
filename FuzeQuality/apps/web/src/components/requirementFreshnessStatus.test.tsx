// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RequirementFreshnessStatus } from './requirementFreshnessStatus'

afterEach(cleanup)

describe('RequirementFreshnessStatus', () => {
  it.each([
    ['JIRA_UNAVAILABLE', 'Jira requirements are temporarily unavailable.'],
    ['INTELLIGENCE_UNAVAILABLE', 'FuzeInfra LiteLLM analysis is temporarily unavailable.'],
    ['INTELLIGENCE_TIMEOUT', 'FuzeInfra LiteLLM analysis timed out and will be retried.'],
    ['INTELLIGENCE_INVALID_RESPONSE', 'FuzeInfra LiteLLM returned an invalid analysis response.'],
    ['SEMANTIC_INDEX_UNAVAILABLE', 'FuzeInfra semantic retrieval is temporarily unavailable.'],
  ] as const)('shows the retained %s dependency failure safely', (failureCode, message) => {
    render(<RequirementFreshnessStatus sync={{
      sourceType: 'jira', sourceKey: 'default', freshnessStatus: 'failed', failureCode,
    }} />)

    expect(screen.getByLabelText('Requirement analysis freshness')).toHaveTextContent('Jira failed')
    expect(screen.getByLabelText('Requirement analysis freshness')).toHaveTextContent(message)
  })

  it('does not show a stale failure after a successful sync', () => {
    render(<RequirementFreshnessStatus sync={{
      sourceType: 'jira', sourceKey: 'default', freshnessStatus: 'fresh',
    }} />)

    expect(screen.getByLabelText('Requirement analysis freshness')).toHaveTextContent('Jira fresh')
    expect(screen.getByLabelText('Requirement analysis freshness')).not.toHaveTextContent('unavailable')
  })

  it('offers a reviewed retry only for failed analysis and exposes queued state', () => {
    const onRetry = vi.fn()
    const { rerender } = render(<RequirementFreshnessStatus sync={{
      sourceType: 'jira', sourceKey: 'default', freshnessStatus: 'failed', failureCode: 'INTELLIGENCE_TIMEOUT',
    }} onRetry={onRetry} />)

    screen.getByRole('button', { name: 'Retry requirement analysis' }).click()
    expect(onRetry).toHaveBeenCalledOnce()

    rerender(<RequirementFreshnessStatus sync={{
      sourceType: 'jira', sourceKey: 'default', freshnessStatus: 'queued',
    }} onRetry={onRetry} />)
    expect(screen.getByLabelText('Requirement analysis freshness')).toHaveTextContent('Jira queued')
    expect(screen.queryByRole('button', { name: 'Retry requirement analysis' })).not.toBeInTheDocument()
  })
})
