import type {
  ApiCoverageQuery,
  ApiCoverageResponse,
  CoverageState,
  Portfolio,
} from '@fuzequality/contracts'
import { coverageSummary } from './coverage'

const coverageStates: CoverageState[] = [
  'covered-explicit',
  'covered-generated',
  'likely-covered',
  'gap',
  'excluded',
  'unknown',
]

export function apiCoverageCatalog(
  portfolio: Portfolio,
  query: ApiCoverageQuery = {},
  now = new Date()
): ApiCoverageResponse {
  const repositoryById = new Map(portfolio.repositories.map(repository => [repository.id, repository]))
  const rows = portfolio.operations.flatMap(operation => {
    const repository = repositoryById.get(operation.repositoryId)
    if (!repository) return []
    const expectations = portfolio.expectations.filter(item =>
      item.subjectType === 'api-operation' && item.subjectId === operation.id
    )
    const findings = portfolio.findings.filter(item =>
      item.subjectId === operation.id || (
        item.repositoryId === operation.repositoryId &&
        !item.subjectId &&
        item.status === 'open'
      )
    )
    if (query.repositoryId && operation.repositoryId !== query.repositoryId) return []
    if (query.tag && !operation.tags.some(tag => tag.toLowerCase() === query.tag!.toLowerCase())) return []
    if (query.path && !operation.path.toLowerCase().includes(query.path.toLowerCase())) return []
    if (query.coverage && !expectations.some(item => item.coverage === query.coverage)) return []
    if (query.findingType && !findings.some(item => item.type === query.findingType)) return []
    return [{
      ...operation,
      repositoryName: repository.name,
      expectations,
      findings,
      coverageSummary: coverageSummary(expectations),
    }]
  })
  const expectations = rows.flatMap(row => row.expectations)
  const summary = coverageSummary(expectations)
  return {
    rows,
    totals: {
      operations: rows.length,
      expectations: summary.total,
      covered: summary.covered,
      gaps: summary.gaps,
      findings: rows.reduce((count, row) => count + row.findings.length, 0),
      percent: summary.percent,
    },
    filters: {
      repositories: portfolio.repositories.map(repository => ({ id: repository.id, name: repository.name })),
      tags: [...new Set(portfolio.operations.flatMap(operation => operation.tags))].sort(),
      coverageStates,
      findingTypes: [...new Set(portfolio.findings.map(finding => finding.type))].sort(),
    },
    revisionSet: portfolio.repositories.map(repository => ({
      repositoryId: repository.id,
      revision: repository.lastScanRevision,
      scannedAt: repository.lastScanAt,
    })),
    policyVersion: 'api-coverage-v1',
    generatedAt: now.toISOString(),
  }
}
