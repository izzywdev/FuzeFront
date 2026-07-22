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
    test.assertionCount > 0 &&
    tokens
      .filter((token): token is string => Boolean(token))
      .some(token =>
        `${test.title} ${test.targets.join(' ')}`
          .toLowerCase()
          .includes(token.toLowerCase())
      )
  )
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
