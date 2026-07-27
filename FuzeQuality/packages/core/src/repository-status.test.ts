import { describe, expect, it } from 'vitest'
import type { Portfolio, Repository } from '@fuzequality/contracts'
import { repositoryCatalogStatus } from './repository-status'

const repository: Repository = {
  id: 'b4908e35-8a57-4c13-9366-489ec59071fe',
  owner: 'izzywdev',
  name: 'FuzeOne',
  canonicalUrl: 'https://github.com/izzywdev/FuzeOne',
  defaultBranch: 'master',
  kind: 'application',
  enabled: true,
  includeGlobs: [],
  excludeGlobs: [],
  jiraProjects: [],
  jiraBindings: [],
  lastScanStatus: 'complete',
  lastScanAt: '2026-07-26T10:00:00.000Z',
  lastScanRevision: 'catalog-revision',
  lastScanDetails: {
    sourceRevision: 'a'.repeat(40),
    catalogRevision: 'catalog-revision',
    scannerVersion: '1.1.0',
    configVersion: 'config-revision',
    partial: true,
    candidates: [{
      sourcePath: 'openapi.yaml',
      kind: 'openapi-document',
      status: 'partial',
      diagnosticCodes: ['unresolved-openapi-ref'],
    }],
    counts: { candidates: 1, operations: 2, frontendSurfaces: 0, tests: 3, diagnostics: 1 },
  },
}

const portfolio = {
  repositories: [repository],
  operations: [],
  surfaces: [],
  tests: [],
  expectations: [],
  findings: [],
  diagnostics: [{
    repositoryId: repository.id,
    revision: 'catalog-revision',
    sourcePath: 'openapi.yaml',
    category: 'openapi',
    severity: 'error',
    code: 'unresolved-openapi-ref',
    message: 'missing',
  }],
  requirements: [],
  flows: [],
  suggestions: [],
} satisfies Portfolio

describe('repository catalog status', () => {
  it('separates partial inventory from zero coverage and exposes immutable provenance', () => {
    const result = repositoryCatalogStatus(portfolio, repository.id, new Date('2026-07-26T11:00:00.000Z'))
    expect(result).toMatchObject({
      freshness: 'partial',
      provenance: {
        sourceRevision: 'a'.repeat(40),
        catalogRevision: 'catalog-revision',
        scannerVersion: '1.1.0',
      },
      counts: { candidates: 1, operations: 2, tests: 3, diagnostics: 1 },
    })
    expect(result?.candidates[0].status).toBe('partial')
  })

  it('marks otherwise complete scans stale after the configured interval', () => {
    const complete = structuredClone(portfolio)
    complete.repositories[0].lastScanDetails!.partial = false
    expect(repositoryCatalogStatus(
      complete,
      repository.id,
      new Date('2026-07-28T11:00:00.000Z')
    )?.freshness).toBe('stale')
  })
})
