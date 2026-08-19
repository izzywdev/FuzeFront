import { describe, expect, it } from 'vitest'
import { apiCoverageCatalog } from './api-catalog'
import { demoPortfolio } from './store'

describe('API coverage catalog query', () => {
  it('returns revision-aware totals and filter dimensions', () => {
    const portfolio = demoPortfolio()
    const response = apiCoverageCatalog(portfolio as never, {}, new Date('2026-07-23T12:00:00Z'))

    expect(response.totals.operations).toBe(2)
    expect(response.totals.expectations).toBeGreaterThan(0)
    expect(response.totals.gaps).toBeGreaterThan(0)
    expect(response.filters.repositories).toEqual([
      expect.objectContaining({ name: 'FuzeFront' }),
    ])
    expect(response.filters.tags).toEqual(expect.arrayContaining(['Billing', 'Identity']))
    expect(response.revisionSet).toHaveLength(1)
    expect(response.policyVersion).toBe('api-coverage-v1')
    expect(response.generatedAt).toBe('2026-07-23T12:00:00.000Z')
  })

  it('filters operations without mixing unrelated expectation denominators', () => {
    const portfolio = demoPortfolio()
    const response = apiCoverageCatalog(portfolio as never, {
      tag: 'Billing',
      coverage: 'gap',
    })

    expect(response.rows).toHaveLength(1)
    expect(response.rows[0].operationId).toBe('createSubscription')
    expect(response.totals.expectations).toBe(response.rows[0].coverageSummary.total)
  })
})
