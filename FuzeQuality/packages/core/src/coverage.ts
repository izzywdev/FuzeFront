import { createHash } from 'node:crypto'
import type {
  ApiOperation,
  CatalogFinding,
  FrontendSurface,
  TestCase,
  TestExpectation,
} from '@fuzequality/contracts'

const id = (...parts: string[]) =>
  createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 24)

function normalizeRoute(value: string) {
  return `/${value}`.replace(/\/+/g, '/').replace(/:[^/]+|\{[^}]+\}/g, '{}').replace(/\/$/, '') || '/'
}

export type EvidenceMethod = 'explicit' | 'operation-id' | 'method-route' | 'title'

export function mappingMethod(subject: ApiOperation | FrontendSurface, test: TestCase): EvidenceMethod | undefined {
  if (test.assertionCount <= 0) return undefined
  const explicit = test.explicitTargets ?? []
  if (explicit.some(target => target === subject.id || ('operationId' in subject && target === subject.operationId))) {
    return 'explicit'
  }
  if ('method' in subject) {
    if (subject.operationId && (test.operationIds ?? []).includes(subject.operationId)) return 'operation-id'
    if ((test.routes ?? []).some(route =>
      (!route.method || route.method.toLowerCase() === subject.method.toLowerCase()) &&
      normalizeRoute(route.path) === normalizeRoute(subject.path)
    )) return 'method-route'
    if (subject.operationId && test.title.toLowerCase().includes(subject.operationId.toLowerCase())) return 'title'
    return undefined
  }
  const title = test.title.toLowerCase()
  return [subject.name, subject.routePath, subject.sourcePath]
    .filter((token): token is string => Boolean(token))
    .some(token => title.includes(token.toLowerCase())) ? 'title' : undefined
}

function matchingEvidence(subject: ApiOperation | FrontendSurface, tests: TestCase[]) {
  return tests
    .map(test => ({ test, method: mappingMethod(subject, test) }))
    .filter((candidate): candidate is { test: TestCase; method: EvidenceMethod } => Boolean(candidate.method))
    .sort((a, b) =>
      ['explicit', 'operation-id', 'method-route', 'title'].indexOf(a.method) -
      ['explicit', 'operation-id', 'method-route', 'title'].indexOf(b.method)
    )
    .map(candidate => candidate.test)
}

function scenarioEvidence(
  tests: TestCase[],
  keywords: string[],
  options: { all?: boolean } = {}
) {
  const normalized = keywords.map(keyword => keyword.toLowerCase())
  return tests
    .filter(test => {
      const text = `${test.title} ${test.targets.join(' ')}`.toLowerCase()
      return options.all
        ? normalized.every(keyword => text.includes(keyword))
        : normalized.some(keyword => text.includes(keyword))
    })
    .map(test => test.id)
}

function qualifiedScenarioEvidence(tests: TestCase[], qualifier: string, keywords: string[]) {
  const normalizedQualifier = qualifier.toLowerCase()
  const normalizedKeywords = keywords.filter(Boolean).map(keyword => keyword.toLowerCase())
  return tests
    .filter(test => {
      const text = `${test.title} ${test.targets.join(' ')}`.toLowerCase()
      return text.includes(normalizedQualifier) && normalizedKeywords.some(keyword => text.includes(keyword))
    })
    .map(test => test.id)
}

function expectation(
  subjectType: TestExpectation['subjectType'],
  subjectId: string,
  kind: string,
  label: string,
  rule: string,
  evidenceIds: string[],
  priority: TestExpectation['priority'] = 'required'
): TestExpectation {
  return {
    id: id(subjectId, kind),
    subjectType,
    subjectId,
    kind,
    label,
    priority,
    rule,
    coverage: evidenceIds.length ? 'covered-explicit' : 'gap',
    evidenceIds,
  }
}

export function buildApiExpectations(operation: ApiOperation, tests: TestCase[]) {
  const matchedTests = matchingEvidence(operation, tests)
  const evidence = matchedTests.map(test => test.id)
  const result = [
    expectation(
      'api-operation',
      operation.id,
      'happy-path',
      'Valid request returns a declared success response',
      'api.happy-path',
      evidence
    ),
  ]

  if (operation.security) {
    result.push(
      expectation(
        'api-operation',
        operation.id,
        'authentication-missing',
        'Missing authentication is rejected',
        'api.security.authentication',
        scenarioEvidence(matchedTests, ['unauthenticated', 'missing auth', 'without auth', '401'])
      ),
      expectation(
        'api-operation',
        operation.id,
        'authorization',
        'Insufficient privileges are rejected',
        'api.security.authorization',
        scenarioEvidence(matchedTests, ['unauthorized', 'forbidden', 'insufficient privilege', '403']),
        'recommended'
      )
    )
  }

  if ((operation.securitySchemes ?? []).some(scheme => /oauth|scope|role|permission/i.test(scheme))) {
    result.push(
      expectation(
        'api-operation',
        operation.id,
        'authorization-variation',
        'Declared roles or scopes have permitted and denied cases',
        'api.security.role-variation',
        scenarioEvidence(matchedTests, ['role', 'scope', 'permission', '403'])
      )
    )
  }

  for (const parameter of operation.parameters.filter(item => item.required)) {
    result.push(
      expectation(
        'api-operation',
        operation.id,
        `missing-${parameter.location}-${parameter.name}`,
        `Required ${parameter.location} parameter “${parameter.name}” is validated`,
        'api.parameter.required',
        scenarioEvidence(matchedTests, [parameter.name, 'missing'], { all: true })
      )
    )


    const schema = parameter.schema ?? {}
    const boundaryRules: Array<[string, string, string[]]> = [
      ['minimum', 'minimum boundary', ['minimum', 'below minimum', 'too small']],
      ['maximum', 'maximum boundary', ['maximum', 'above maximum', 'too large']],
      ['minLength', 'minimum length boundary', ['minimum length', 'too short']],
      ['maxLength', 'maximum length boundary', ['maximum length', 'too long']],
      ['pattern', 'pattern constraint', ['pattern', 'invalid format']],
      ['enum', 'allowed-value constraint', ['enum', 'unsupported value', 'invalid value']],
      ['format', `${String(schema.format ?? 'declared')} format`, ['format', String(schema.format ?? '')]],
    ]
    for (const [keyword, label, evidenceKeywords] of boundaryRules) {
      if (!(keyword in schema)) continue
      result.push(
        expectation(
          'api-operation',
          operation.id,
          `parameter-${parameter.location}-${parameter.name}-${keyword.toLowerCase()}`,
          `${parameter.name} enforces its ${label}`,
          `api.parameter.${keyword}`,
          qualifiedScenarioEvidence(matchedTests, parameter.name, evidenceKeywords),
          'recommended'
        )
      )
    }
  }

  const hasIdentifier = /\{[^}]*id[^}]*\}/i.test(operation.path)
  if (hasIdentifier && ['get', 'put', 'patch', 'delete'].includes(operation.method)) {
    result.push(
      expectation(
        'api-operation',
        operation.id,
        'resource-not-found',
        'Unknown resource identifier returns a controlled response',
        'api.resource.not-found',
        scenarioEvidence(matchedTests, ['not found', 'unknown id', 'missing resource', '404']),
        'recommended'
      )
    )
  }

  if (['post', 'put', 'patch'].includes(operation.method)) {
    result.push(
      expectation(
        'api-operation',
        operation.id,
        'invalid-content-type',
        'Unsupported request content type is rejected',
        'api.content-type.invalid',
        scenarioEvidence(matchedTests, ['content type', '415', 'unsupported media']),
        'recommended'
      )
    )
  }

  if ((operation.requestContentTypes ?? []).length > 0) {
    result.push(
      expectation(
        'api-operation',
        operation.id,
        'request-content-type',
        'Every declared request content type is exercised',
        'api.content-type.request',
        scenarioEvidence(matchedTests, operation.requestContentTypes ?? []),
        'recommended'
      )
    )
  }

  if ((operation.responseContentTypes ?? []).length > 0) {
    result.push(
      expectation(
        'api-operation',
        operation.id,
        'response-content-type',
        'Declared response media types and schemas are asserted',
        'api.content-type.response',
        scenarioEvidence(matchedTests, operation.responseContentTypes ?? []),
        'recommended'
      )
    )
  }

  if (operation.idempotencyHeader) {
    result.push(
      expectation(
        'api-operation',
        operation.id,
        'idempotency-replay',
        `${operation.idempotencyHeader} replay does not duplicate the operation`,
        'api.idempotency.replay',
        scenarioEvidence(matchedTests, ['idempotent', 'replay', operation.idempotencyHeader])
      )
    )
  }

  if (operation.supportsCrudSequence) {
    result.push(
      expectation(
        'api-operation',
        operation.id,
        'crud-sequence',
        'The operation participates in a stateful resource lifecycle',
        'api.resource.crud-sequence',
        scenarioEvidence(matchedTests, ['crud', 'lifecycle', 'create read update delete']),
        'recommended'
      )
    )
  }

  for (const response of operation.responses) {
    const successful = /^2\d\d$/.test(response)
    result.push(
      expectation(
        'api-operation',
        operation.id,
        `response-${response}`,
        `Declared ${response} response is asserted`,
        successful ? 'api.response.success' : 'api.response.error',
        scenarioEvidence(matchedTests, [response, `status ${response}`]),
        successful ? 'required' : 'recommended'
      )
    )
  }

  return result
}

export function buildFrontendExpectations(surface: FrontendSurface, tests: TestCase[]) {
  const evidence = matchingEvidence(surface, tests).map(test => test.id)
  const result = [
    expectation(
      'frontend-surface',
      surface.id,
      'render',
      'Surface renders its default state',
      'frontend.render',
      evidence
    ),
  ]

  for (const state of surface.states) {
    result.push(
      expectation(
        'frontend-surface',
        surface.id,
        `state-${state}`,
        `The ${state} state is represented and verified`,
        'frontend.state',
        evidence,
        state === 'default' ? 'required' : 'recommended'
      )
    )
  }

  result.push(
    expectation(
      'frontend-surface',
      surface.id,
      'storybook',
      'Component state is documented in Storybook',
      'frontend.documentation.storybook',
      surface.hasStory ? [surface.id] : [],
      surface.kind === 'component' ? 'recommended' : 'not-applicable'
    )
  )
  return result
}

export function buildFindings(
  repositoryId: string,
  operations: ApiOperation[],
  surfaces: FrontendSurface[],
  expectations: TestExpectation[]
): CatalogFinding[] {
  const findings: CatalogFinding[] = []

  for (const operation of operations.filter(item => !item.operationId)) {
    findings.push({
      id: id(operation.id, 'missing-operation-id'),
      repositoryId,
      subjectId: operation.id,
      type: 'missing-operation-id',
      severity: 'medium',
      title: `${operation.method.toUpperCase()} ${operation.path} has no operationId`,
      detail: 'Add a stable operationId so coverage history survives route refactors.',
      status: 'open',
    })
  }

  const duplicateOperationIds = new Map<string, ApiOperation[]>()
  for (const operation of operations) {
    if (!operation.operationId) continue
    const matches = duplicateOperationIds.get(operation.operationId) ?? []
    matches.push(operation)
    duplicateOperationIds.set(operation.operationId, matches)
  }
  for (const [operationId, duplicates] of duplicateOperationIds) {
    if (duplicates.length < 2) continue
    for (const operation of duplicates) {
      findings.push({
        id: id(operation.id, 'duplicate-operation-id'),
        repositoryId,
        subjectId: operation.id,
        type: 'duplicate-operation-id',
        severity: 'high',
        title: `operationId “${operationId}” is duplicated`,
        detail: `The identifier is shared by ${duplicates.length} operations and cannot provide an unambiguous coverage identity.`,
        status: 'open',
      })
    }
  }

  for (const surface of surfaces.filter(item => item.kind === 'component' && !item.hasStory)) {
    findings.push({
      id: id(surface.id, 'missing-story'),
      repositoryId,
      subjectId: surface.id,
      type: 'missing-storybook-state',
      severity: 'low',
      title: `${surface.name} is not represented in Storybook`,
      detail: 'The component is implemented but has no independently reviewable state catalog.',
      status: 'open',
    })
  }

  for (const item of expectations.filter(
    expectation => expectation.priority === 'required' && expectation.coverage === 'gap'
  )) {
    findings.push({
      id: id(item.id, 'coverage-gap'),
      repositoryId,
      subjectId: item.subjectId,
      type: 'required-test-gap',
      severity: 'high',
      title: item.label,
      detail: `No accepted test evidence satisfies ${item.rule}.`,
      status: 'open',
    })
  }

  return findings
}

export function coverageSummary(expectations: TestExpectation[]) {
  const authoritative = expectations.filter(item => item.priority !== 'not-applicable')
  const covered = authoritative.filter(item =>
    ['covered-explicit', 'covered-generated'].includes(item.coverage)
  ).length
  const gaps = authoritative.filter(item => item.coverage === 'gap').length
  return {
    total: authoritative.length,
    covered,
    gaps,
    percent: authoritative.length ? Math.round((covered / authoritative.length) * 100) : 0,
  }
}
