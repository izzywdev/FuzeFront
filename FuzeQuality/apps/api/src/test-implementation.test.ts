import { describe, expect, it } from 'vitest'
import type { Repository, TestExpectation } from '@fuzequality/contracts'
import { buildImplementationManifest, implementationIdempotencyKey } from './test-implementation'

const repository = {
  id: 'b4908e35-8a57-4c13-9366-489ec59071fe', owner: 'izzywdev', name: 'FuzeFront',
  canonicalUrl: 'https://github.com/izzywdev/FuzeFront', defaultBranch: 'master',
  kind: 'mixed', enabled: true, includeGlobs: [], excludeGlobs: [], jiraProjects: [],
  jiraBindings: [], lastScanStatus: 'complete',
} satisfies Repository

const expectation = {
  id: 'expectation-1', subjectType: 'api-operation', subjectId: 'operation-1',
  kind: 'api.security.authentication', label: 'Missing authentication is rejected',
  priority: 'required', rule: 'api.security.authentication', coverage: 'gap', evidenceIds: [],
} satisfies TestExpectation

describe('governed test implementation manifests', () => {
  it('selects the API test agent and a server-owned skill allowlist', () => {
    const manifest = buildImplementationManifest({
      requestId: '12345678-1234-1234-1234-123456789012', repository,
      sourceRevision: 'a'.repeat(40), expectations: [expectation],
      operations: [{ id: 'operation-1', repositoryId: repository.id, documentPath: 'openapi.yaml',
        method: 'post', path: '/apps/{slug}/suspend', summary: 'Suspend app', tags: [],
        security: true, parameters: [], responses: ['200'] }],
      surfaces: [],
    })
    expect(manifest.agentProfile).toBe('test-engineer')
    expect(manifest.skills).toContain('verification-before-completion')
    expect(manifest.tests[0].subject).toMatchObject({ method: 'post', path: '/apps/{slug}/suspend' })
  })

  it('rejects mixed API and frontend work that requires different agents', () => {
    expect(() => buildImplementationManifest({
      requestId: '12345678-1234-1234-1234-123456789012', repository,
      sourceRevision: 'a'.repeat(40),
      expectations: [expectation, { ...expectation, id: 'expectation-2', subjectId: 'surface-1', subjectType: 'frontend-surface' }],
      operations: [], surfaces: [],
    })).toThrow('only one implementation agent')
  })

  it('is idempotent regardless of expectation selection order', () => {
    expect(implementationIdempotencyKey('tenant', repository.id, 'a'.repeat(40), ['b', 'a']))
      .toBe(implementationIdempotencyKey('tenant', repository.id, 'a'.repeat(40), ['a', 'b']))
  })
})
