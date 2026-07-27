import type { ApiOperation, FrontendSurface, TestExpectation } from '@fuzequality/contracts'

export type PlannedTest = {
  expectationId: string
  title: string
  priority: TestExpectation['priority']
  level: 'contract' | 'integration' | 'component' | 'e2e'
  suggestedFile: string
  arrange: string
  act: string
  assertions: string[]
  provenance: string
}

function safeName(value: string) {
  return value.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()
}

function apiGuidance(expectation: TestExpectation, operation: ApiOperation): Omit<PlannedTest, 'expectationId' | 'priority' | 'provenance'> {
  const operationName = operation.operationId ?? `${operation.method}-${safeName(operation.path)}`
  const base = {
    title: `${operation.method.toUpperCase()} ${operation.path} — ${expectation.label}`,
    level: 'contract' as const,
    suggestedFile: `tests/contract/${safeName(operationName)}.contract.test.ts`,
    arrange: `Create the smallest valid request for ${operation.method.toUpperCase()} ${operation.path} and isolate its external dependencies.`,
    act: "Send the request through the service's public HTTP boundary.",
    assertions: [`Assert the response satisfies “${expectation.label}”.`, 'Assert the response body matches the declared OpenAPI schema.'],
  }

  if (expectation.kind === 'authentication-missing') return {
    ...base,
    arrange: 'Create an otherwise valid request without an Authorization header or session credential.',
    assertions: ['Assert HTTP 401.', 'Assert no protected response data is disclosed.', 'Assert no state-changing side effect occurs.'],
  }
  if (expectation.kind === 'authorization') return {
    ...base,
    arrange: 'Authenticate a principal that lacks the required permission, role, scope, or tenant access.',
    assertions: ['Assert HTTP 403.', 'Assert the target remains unchanged.', 'Assert cross-tenant details are not disclosed.'],
  }
  if (expectation.kind === 'invalid-content-type') return {
    ...base,
    arrange: 'Create a syntactically valid payload and send it with an unsupported Content-Type.',
    assertions: ['Assert HTTP 415 or the documented rejection status.', 'Assert the error response is controlled and schema-valid.', 'Assert no mutation occurs.'],
  }
  if (expectation.kind === 'resource-not-found') return {
    ...base,
    arrange: 'Use a well-formed identifier that does not exist in the current tenant.',
    assertions: ['Assert the documented not-found status.', 'Assert the error response is schema-valid.', 'Assert no unrelated resource data is disclosed.'],
  }
  if (expectation.kind.startsWith('missing-')) return {
    ...base,
    arrange: `Start with a valid request, then remove the required ${expectation.label.match(/“([^”]+)”/)?.[1] ?? 'input'}.`,
    assertions: ['Assert the documented validation status.', 'Assert the error identifies the missing input safely.', 'Assert the handler does not perform its primary side effect.'],
  }
  if (expectation.kind.startsWith('parameter-')) return {
    ...base,
    arrange: 'Start with a valid request and replace the named parameter with a value immediately outside the declared boundary.',
    assertions: ['Assert the documented validation status.', 'Assert the boundary violation is reported.', 'Assert the invalid value is not persisted.'],
  }
  if (expectation.kind.startsWith('response-')) {
    const status = expectation.kind.slice('response-'.length)
    return {
      ...base,
      arrange: `Configure the request and dependencies to produce the declared ${status} response.`,
      assertions: [`Assert HTTP ${status}.`, 'Assert response headers and body match the declared OpenAPI contract.'],
    }
  }
  return base
}

function frontendGuidance(expectation: TestExpectation, surface: FrontendSurface): Omit<PlannedTest, 'expectationId' | 'priority' | 'provenance'> {
  const state = expectation.kind.startsWith('state-') ? expectation.kind.slice('state-'.length) : 'default'
  return {
    title: `${surface.name} — ${expectation.label}`,
    level: surface.kind === 'route' ? 'e2e' : 'component',
    suggestedFile: `${surface.sourcePath.replace(/\.[^.]+$/, '')}.${surface.kind === 'route' ? 'e2e.spec' : 'test'}.tsx`,
    arrange: `Render ${surface.name} with deterministic fixtures for its ${state} state.`,
    act: state === 'default' ? 'Load the surface and perform its primary supported interaction.' : `Trigger or provide the ${state} state.`,
    assertions: [
      `Assert the ${state} state is visible and accessible.`,
      'Assert the primary user-facing outcome, not implementation details.',
      'Assert keyboard focus and accessible naming where interactive controls are present.',
    ],
  }
}

export function planGap(expectation: TestExpectation, subject: ApiOperation | FrontendSurface): PlannedTest {
  const guidance = 'method' in subject ? apiGuidance(expectation, subject) : frontendGuidance(expectation, subject)
  return {
    expectationId: expectation.id,
    priority: expectation.priority,
    provenance: `${expectation.rule} · deterministic policy v1`,
    ...guidance,
  }
}
