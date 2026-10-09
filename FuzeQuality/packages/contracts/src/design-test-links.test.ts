import { describe, expect, it } from 'vitest'
import { designTestLinkEventSchema } from './index'

describe('FuzeX design-test-link event contract', () => {
  const event = {
    tenantId: '123e4567-e89b-12d3-a456-426614174000',
    traceLinkId: 'trace_1',
    fuzexProjectId: 'project_1',
    targetKind: 'component',
    targetRef: 'checkout/payment-submit',
    testCaseId: 'test_1',
  }

  it('accepts a relationship-only tenant-scoped event', () => {
    expect(designTestLinkEventSchema.parse(event)).toEqual(event)
  })

  it('rejects fields that could smuggle design documents or credentials', () => {
    expect(designTestLinkEventSchema.safeParse({ ...event, html: '<script>' }).success).toBe(false)
  })
})
