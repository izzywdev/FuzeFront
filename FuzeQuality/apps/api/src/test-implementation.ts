import { createHash, randomUUID } from 'node:crypto'
import type {
  ApiOperation,
  FrontendSurface,
  Repository,
  TestExpectation,
  TestImplementationRequest,
} from '@fuzequality/contracts'

const agentSkills = {
  'test-engineer': [
    'api-contract-first',
    'test-driven-development',
    'systematic-debugging',
    'verification-before-completion',
    'ticket-creator',
  ],
  'frontend-test-engineer': [
    'mobile-conformance',
    'ui-frame-contract',
    'ui-runtime-validation',
    'systematic-debugging',
    'verification-before-completion',
    'ticket-creator',
  ],
} as const

export type ImplementationManifest = {
  requestId: string
  repository: { owner: string; name: string }
  sourceRevision: string
  branch: string
  jiraKey: 'FQ-173'
  agentProfile: keyof typeof agentSkills
  skills: readonly string[]
  tests: Array<{
    expectationId: string
    subjectId: string
    kind: string
    title: string
    rule: string
    subject: Record<string, unknown>
  }>
}

export function buildImplementationManifest(input: {
  requestId: string
  repository: Repository
  sourceRevision: string
  expectations: TestExpectation[]
  operations: ApiOperation[]
  surfaces: FrontendSurface[]
}): ImplementationManifest {
  const subjectTypes = new Set(input.expectations.map(item => item.subjectType))
  if (subjectTypes.size !== 1) throw new Error('A request may contain tests for only one implementation agent')
  const agentProfile = subjectTypes.has('frontend-surface') ? 'frontend-test-engineer' : 'test-engineer'
  return {
    requestId: input.requestId,
    repository: { owner: input.repository.owner, name: input.repository.name },
    sourceRevision: input.sourceRevision,
    branch: `codex/fq-${input.requestId.slice(0, 8)}-tests`,
    jiraKey: 'FQ-173',
    agentProfile,
    skills: agentSkills[agentProfile],
    tests: input.expectations.map(expectation => {
      const subject = expectation.subjectType === 'api-operation'
        ? input.operations.find(item => item.id === expectation.subjectId)
        : input.surfaces.find(item => item.id === expectation.subjectId)
      if (!subject) throw new Error(`Subject for expectation ${expectation.id} is unavailable`)
      return {
        expectationId: expectation.id,
        subjectId: expectation.subjectId,
        kind: expectation.kind,
        title: expectation.label,
        rule: expectation.rule,
        subject: subject as unknown as Record<string, unknown>,
      }
    }),
  }
}

export function implementationIdempotencyKey(
  tenantId: string,
  repositoryId: string,
  sourceRevision: string,
  expectationIds: string[],
) {
  return createHash('sha256')
    .update([tenantId, repositoryId, sourceRevision, ...[...expectationIds].sort()].join('\n'))
    .digest('hex')
}

export function newImplementationRequest(input: {
  tenantId: string
  repositoryId: string
  sourceRevision: string
  expectationIds: string[]
  requestedBy: string
  agentProfile: TestImplementationRequest['agentProfile']
  skills: string[]
}): TestImplementationRequest {
  const now = new Date().toISOString()
  return { id: randomUUID(), ...input, status: 'queued', createdAt: now, updatedAt: now }
}

export async function dispatchImplementation(manifest: ImplementationManifest) {
  const token = process.env.FUZEQUALITY_CLOUD_DISPATCH_TOKEN
  if (!token) throw new Error('Cloud implementation dispatch is not configured')
  const response = await fetch(
    `https://api.github.com/repos/${manifest.repository.owner}/${manifest.repository.name}/actions/workflows/fuzequality-implement-tests.yml/dispatches`,
    {
      method: 'POST',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-github-api-version': '2022-11-28',
      },
      body: JSON.stringify({
        ref: manifest.sourceRevision,
        inputs: { manifest: Buffer.from(JSON.stringify(manifest)).toString('base64url') },
      }),
    },
  )
  if (!response.ok) throw new Error(`GitHub cloud dispatch failed (${response.status})`)
  return `https://github.com/${manifest.repository.owner}/${manifest.repository.name}/actions/workflows/fuzequality-implement-tests.yml`
}
