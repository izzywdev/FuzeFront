import { describe, expect, it } from 'vitest'
import type { ApiOperation, TestCase } from '@fuzequality/contracts'
import { buildApiExpectations, mappingMethod } from './coverage'

const operation: ApiOperation = {
  id: 'api:sample:document:getUser',
  repositoryId: 'repository',
  documentPath: 'openapi.yaml',
  operationId: 'getUser',
  method: 'get',
  path: '/users/{id}',
  summary: 'Get user',
  tags: [],
  security: false,
  parameters: [],
  responses: ['200'],
}

function testCase(overrides: Partial<TestCase>): TestCase {
  return {
    id: String(overrides.id ?? 'test'),
    repositoryId: 'repository',
    framework: 'vitest',
    level: 'integration',
    title: 'unrelated title',
    sourcePath: 'users.test.ts',
    assertionCount: 1,
    targets: [],
    ...overrides,
  }
}

describe('API test evidence mapping', () => {
  it('uses explicit annotation before operationId, method/route, and title evidence', () => {
    expect(mappingMethod(operation, testCase({ explicitTargets: [operation.id] }))).toBe('explicit')
    expect(mappingMethod(operation, testCase({ operationIds: ['getUser'] }))).toBe('operation-id')
    expect(mappingMethod(operation, testCase({ routes: [{ method: 'get', path: '/users/{userId}' }] }))).toBe('method-route')
    expect(mappingMethod(operation, testCase({ title: 'getUser returns a user' }))).toBe('title')
  })

  it('does not credit assertion-free or ambiguous route evidence', () => {
    expect(mappingMethod(operation, testCase({ assertionCount: 0, explicitTargets: [operation.id] }))).toBeUndefined()
    expect(mappingMethod(operation, testCase({ routes: [{ method: 'post', path: '/users/{id}' }] }))).toBeUndefined()
    const expectations = buildApiExpectations(operation, [
      testCase({ id: 'no-assertion', assertionCount: 0, title: 'getUser returns 200' }),
    ])
    expect(expectations.find(item => item.kind === 'happy-path')?.coverage).toBe('gap')
  })
})
