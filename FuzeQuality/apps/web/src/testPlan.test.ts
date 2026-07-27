import { describe, expect, it } from 'vitest'
import type { ApiOperation, TestExpectation } from '@fuzequality/contracts'
import { planGap } from './testPlan'

const operation: ApiOperation = {
  id: 'operation',
  repositoryId: 'repository',
  documentPath: 'openapi.yaml',
  operationId: 'suspendApp',
  method: 'post',
  path: '/apps/{slug}/suspend',
  summary: 'Suspend an app',
  tags: [],
  security: true,
  parameters: [],
  responses: ['200', '401', '403'],
}

function expectation(kind: string, label: string): TestExpectation {
  return {
    id: kind,
    subjectType: 'api-operation',
    subjectId: operation.id,
    kind,
    label,
    priority: 'required',
    rule: `api.${kind}`,
    coverage: 'gap',
    evidenceIds: [],
  }
}

describe('planGap', () => {
  it('turns an authentication gap into an actionable contract test', () => {
    const plan = planGap(expectation('authentication-missing', 'Missing authentication is rejected'), operation)
    expect(plan.title).toContain('POST /apps/{slug}/suspend')
    expect(plan.suggestedFile).toBe('tests/contract/suspendapp.contract.test.ts')
    expect(plan.assertions).toContain('Assert HTTP 401.')
    expect(plan.provenance).toContain('deterministic policy v1')
  })

  it('uses the declared response status in response guidance', () => {
    const plan = planGap(expectation('response-200', 'Declared 200 response is asserted'), operation)
    expect(plan.arrange).toContain('200')
    expect(plan.assertions[0]).toBe('Assert HTTP 200.')
  })
})
