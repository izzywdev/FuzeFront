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

function matchingEvidence(subject: ApiOperation | FrontendSurface, tests: TestCase[]) {
  const tokens =
    'method' in subject
      ? [subject.operationId, subject.path, `${subject.method} ${subject.path}`]
      : [subject.name, subject.routePath, subject.sourcePath]
  return tests.filter(test =>
    tokens
      .filter((token): token is string => Boolean(token))
      .some(token =>
        `${test.title} ${test.targets.join(' ')}`
          .toLowerCase()
          .includes(token.toLowerCase())
      )
  )
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
  const evidence = matchingEvidence(operation, tests).map(test => test.id)
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
        evidence
      ),
      expectation(
        'api-operation',
        operation.id,
        'authorization',
        'Insufficient privileges are rejected',
        'api.security.authorization',
        evidence,
        'recommended'
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
        evidence
      )
    )
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
        evidence,
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
        evidence,
        'recommended'
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
