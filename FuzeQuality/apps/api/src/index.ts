import express from 'express'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  TOPICS,
  repositoryInputSchema,
  reviewDecisionSchema,
  expectationExclusionSchema,
  designTestLinkEventSchema,
  testExecutionInputSchema,
  performanceTestRequestSchema,
  testImplementationRequestSchema,
  type OrganizationQualitySummary,
  type Portfolio,
} from '@fuzequality/contracts'
import {
  apiCoverageCatalog,
  coverageSummary,
  createCatalogStore,
  createEventBus,
  linkExecutionArtifacts,
  executionPerformance,
  filterTestExecutions,
  performanceWorkflowTarget,
  relayOutboxBatch,
  repositoryCatalogStatus,
} from '@fuzequality/core'
import { scanRepository } from '@fuzequality/scanner'
import {
  githubWebhookHeadersSchema,
  verifyGithubWebhook,
  webhookScanCommands,
  webhookWorkflowExecutions,
} from '@fuzequality/github-app'
import { dispatchPerformanceWorkflow, githubInstallationToken } from '../../workers/src/github'
import { createGitHubAccessVerifier, publicAccessError } from './repository-onboarding'
import { requestIdentity, requirePlatformAdminPermission, requirePlatformPermission } from './platform-authorization'
import { qualityResources } from './platform-permissions'
import { isPlatformAuthenticatedRequest, isPublicRequest } from './authentication'
import { createOpenApiSurface } from './openapi'
import { executionFilterSchema } from './execution-filter'
import { executionRecord } from './test-execution-ingestion'
import { candidateOwnershipError, repositoryFlowCandidateIngestionSchema } from './repository-flow-ingestion'
import { filterRepositoryFlowCandidates, repositoryFlowFilterSchema } from './repository-flow-filter'
import { repositoryFlowReviewConflict } from './repository-flow-review'
import { policyGateEvaluationIngestionSchema, policyGateOwnershipError } from './policy-gate-ingestion'
import { policyGateReviewConflict } from './policy-gate-review'
import {
  buildImplementationManifest,
  dispatchImplementation,
  implementationIdempotencyKey,
  newImplementationRequest,
} from './test-implementation'

const app = express()
const store = createCatalogStore()
const events = createEventBus()
const port = Number(process.env.PORT ?? 4180)
const repositoryAccess = createGitHubAccessVerifier(githubInstallationToken)
const mayReadRepositories = requirePlatformPermission(qualityResources.repository, 'read')
const mayManageRepositories = requirePlatformPermission(qualityResources.repository, 'onboard')
const mayScanRepositories = requirePlatformPermission(qualityResources.repository, 'scan')
const mayReadCatalog = requirePlatformPermission(qualityResources.evidence, 'read')
const mayReadRequirements = requirePlatformPermission(qualityResources.evidence, 'read')
const mayReadSuggestions = requirePlatformPermission(qualityResources.suggestion, 'read')
const mayReviewSuggestions = requirePlatformPermission(qualityResources.suggestion, 'review')
const maySuppressSuggestions = requirePlatformPermission(qualityResources.suggestion, 'suppress')
const maySyncRequirementsAsHuman = requirePlatformPermission(qualityResources.evidence, 'export')
// The reconciler is a workload, not a portal user. It authenticates with the
// FuzeQuality service token injected from the cluster Secret; a human caller
// still has to pass the FuzeFront Security permission check below.
const maySyncRequirements: express.RequestHandler = (request, response, next) => {
  if (isFuzeQualityServiceRequest(request)) return next()
  return maySyncRequirementsAsHuman(request, response, next)
}
const mayCreateTestImplementation = requirePlatformPermission(qualityResources.testImplementation, 'create')
const mayReadTestImplementation = requirePlatformPermission(qualityResources.testImplementation, 'read')
const mayRunExecution = requirePlatformPermission(qualityResources.execution, 'run')
const mayReadOrganizationAccess = requirePlatformPermission(qualityResources.organizationAccess, 'read')
const mayManageOrganizationAccess = requirePlatformPermission(qualityResources.organizationAccess, 'manage')
const mayManageRepositoryAdministration = requirePlatformPermission(qualityResources.repositoryAdministration, 'manage')
const mayAdministerPlatform = requirePlatformAdminPermission(qualityResources.platformAdministration, 'read')
const adminContextSchema = z.object({ reason: z.string().trim().min(3).max(500) }).strict()
const organizationRoleSchema = z.enum(['owner', 'admin', 'member', 'viewer'])
const invitationSchema = z.object({
  email: z.string().trim().email(),
  role: organizationRoleSchema,
}).strict()
const memberRoleSchema = z.object({ role: organizationRoleSchema }).strict()
const repositoryFlowReviewSchema = z.object({
  status: z.enum(['confirmed', 'rejected']),
  reason: z.string().trim().min(3).max(2000).optional(),
}).strict()
const policyGateReviewSchema = z.object({ status: z.enum(['accepted', 'dismissed']), reason: z.string().trim().min(3).max(2000).optional() }).strict()
const intelligenceFailureSchema = z.object({
  sourceType: z.literal('jira'),
  sourceKey: z.string().trim().min(1).max(200),
  code: z.enum(['JIRA_UNAVAILABLE', 'INTELLIGENCE_UNAVAILABLE', 'SEMANTIC_INDEX_UNAVAILABLE']),
}).strict()
const repositoryAdministrationSchema = z.object({
  ownership: z.object({
    team: z.string().trim().min(1).max(100),
    contact: z.string().trim().email().optional(),
  }).optional(),
  jiraBindings: z.array(z.object({
    project: z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,19}$/),
    component: z.string().trim().min(1).max(255).optional(),
  })).max(100),
  storybookBaseUrl: z.string().trim().url().refine(value => new URL(value).protocol === 'https:').optional(),
}).strict()
const identityLifecycleEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('organization.upsert'),
    organizationId: z.string().uuid(), slug: z.string().min(1), name: z.string().min(1),
    organizationType: z.enum(['platform', 'organization', 'personal']), ownerId: z.string().uuid().nullable(), isActive: z.boolean(),
  }).strict(),
  z.object({ type: z.literal('organization.deleted'), organizationId: z.string().uuid() }).strict(),
  z.object({
    type: z.literal('user.upsert'), userId: z.string().uuid(), email: z.string().email(),
    firstName: z.string().optional(), lastName: z.string().optional(),
  }).strict(),
  z.object({ type: z.literal('user.deleted'), userId: z.string().uuid() }).strict(),
  z.object({
    type: z.literal('membership.changed'), organizationId: z.string().uuid(), userId: z.string().uuid(),
    role: z.string().min(1), active: z.boolean(),
  }).strict(),
])
const designTestLinkLifecycleEventSchema = z.discriminatedUnion('type', [
  designTestLinkEventSchema.extend({ type: z.literal('design-test-link.upsert') }),
  designTestLinkEventSchema.extend({ type: z.literal('design-test-link.removed') }),
])

async function proxyOrganizationSecurity(
  request: express.Request,
  response: express.Response,
  path: string,
  init?: RequestInit
) {
  const baseUrl = process.env.FUZEFRONT_SECURITY_URL?.replace(/\/$/, '')
  const authorization = request.header('authorization')
  if (!baseUrl || !authorization) {
    return response.status(503).json({ error: 'Platform security is unavailable', code: 'SECURITY_UNAVAILABLE' })
  }
  try {
    const upstream = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        authorization,
        accept: 'application/json',
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
      },
    })
    const body = await upstream.json().catch(() => ({ error: 'Platform security returned an invalid response' }))
    response.status(upstream.status).json(body)
  } catch {
    response.status(503).json({ error: 'Platform security is unavailable', code: 'SECURITY_UNAVAILABLE' })
  }
}

function organizationSummaries(portfolio: Portfolio): OrganizationQualitySummary[] {
  const staleAfter = Number(process.env.FUZEQUALITY_STALE_AFTER_MS ?? 86_400_000)
  const now = Date.now()
  const tenantIds = [...new Set(portfolio.repositories.map(repository => repository.tenantId).filter(Boolean))] as string[]
  return tenantIds.map(organizationId => {
    const repositories = portfolio.repositories.filter(repository => repository.tenantId === organizationId)
    const repositoryIds = new Set(repositories.map(repository => repository.id))
    const operations = portfolio.operations.filter(item => repositoryIds.has(item.repositoryId))
    const surfaces = portfolio.surfaces.filter(item => repositoryIds.has(item.repositoryId))
    const tests = portfolio.tests.filter(item => repositoryIds.has(item.repositoryId))
    const subjectIds = new Set([...operations.map(item => item.id), ...surfaces.map(item => item.id)])
    const expectations = portfolio.expectations.filter(item => subjectIds.has(item.subjectId) && item.priority !== 'not-applicable')
    const covered = expectations.filter(item => item.coverage.startsWith('covered')).length
    const scans = repositories.flatMap(repository => repository.lastScanAt ? [Date.parse(repository.lastScanAt)] : [])
    return {
      organizationId,
      repositories: repositories.length,
      apiOperations: operations.length,
      frontendSurfaces: surfaces.length,
      tests: tests.length,
      expectations: expectations.length,
      coveredExpectations: covered,
      gaps: expectations.filter(item => item.coverage === 'gap').length,
      openFindings: portfolio.findings.filter(item => item.status === 'open' && (!item.repositoryId || repositoryIds.has(item.repositoryId))).length,
      failedScans: repositories.filter(item => item.lastScanStatus === 'failed').length,
      staleScans: repositories.filter(item => !item.lastScanAt || now - Date.parse(item.lastScanAt) > staleAfter).length,
      coveragePercent: expectations.length ? Math.round((covered / expectations.length) * 100) : 0,
      latestScanAt: scans.length ? new Date(Math.max(...scans)).toISOString() : undefined,
    }
  }).sort((left, right) => right.gaps - left.gaps || left.organizationId.localeCompare(right.organizationId))
}

function isFuzeQualityServiceRequest(request: express.Request) {
  const configuredToken = process.env.FUZEQUALITY_API_TOKEN
  return Boolean(configuredToken && request.header('authorization') === `Bearer ${configuredToken}`)
}

app.use(express.json({
  // A normalized inventory for the current FuzeFront repository is ~2.4 MB.
  // Keep this above the scanner's bounded payload while still rejecting
  // unexpectedly large webhook and user-request bodies.
  limit: '5mb',
  verify: (request, _response, buffer) => {
    ;(request as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer)
  },
}))

app.use((request, response, next) => {
  const authorization = request.headers.authorization
  if (
    !process.env.FUZEQUALITY_API_TOKEN ||
    isPublicRequest(request.method, request.path) ||
    isFuzeQualityServiceRequest(request) ||
    (
      request.path.startsWith('/api/v1/internal/test-implementations/') &&
      process.env.FUZEQUALITY_CLOUD_CALLBACK_TOKEN &&
      request.header('x-fuzequality-callback-token') === process.env.FUZEQUALITY_CLOUD_CALLBACK_TOKEN
    ) ||
    (
      authorization?.startsWith('Bearer ') &&
      isPlatformAuthenticatedRequest(request.method, request.path)
    )
  ) {
    next()
    return
  }
  response.status(401).json({ error: 'Authentication required' })
})

// Platform operational surface: GET /health and the two representations of the
// OpenAPI document. Mounted here — after the API-token guard, which
// isPublicRequest() lets these three past — and BEFORE any product route, so a
// probe never depends on the catalog store being reachable.
//
// /health/live and /health/ready below predate it and are what the chart's
// kubelet probes use; they are left exactly as they were. /health is the
// platform-wide convention every Fuze service answers, and additionally reports
// whether this build shipped with its own contract.
const openapi = createOpenApiSurface()
if (!openapi.available) {
  // Not fatal — /health reports it and the spec routes answer 503 — but it must
  // not be silent, because the pod otherwise looks entirely healthy.
  console.error(`FuzeQuality OpenAPI document unavailable: ${openapi.error}`)
}
app.use(openapi.router)

app.get('/health/live', (_request, response) => response.json({ status: 'ok' }))
app.get('/health/ready', async (_request, response) => {
  // A listening process is not ready if its catalog store is unavailable.
  // The bootstrap init container owns schema/topic creation; this probe proves
  // the API can subsequently query its provisioned PostgreSQL database.
  try {
    await store.portfolio()
    response.json({ status: 'ready' })
  } catch (error) {
    console.error('FuzeQuality readiness database check failed', error)
    response.status(503).json({ status: 'not-ready', dependency: 'postgres' })
  }
})
app.get('/metrics', async (_request, response) => {
  const portfolio = await store.portfolio()
  const jiraFreshness = await store.syncCursor('jira', 'default')
  response.type('text/plain').send(
    [
      '# HELP fuzequality_repositories Number of onboarded repositories',
      '# TYPE fuzequality_repositories gauge',
      `fuzequality_repositories ${portfolio.repositories.length}`,
      '# HELP fuzequality_open_findings Number of open catalog findings',
      '# TYPE fuzequality_open_findings gauge',
      `fuzequality_open_findings ${portfolio.findings.filter(item => item.status === 'open').length}`,
      '# HELP fuzequality_flow_gap_findings Number of open deterministic flow-gap findings',
      '# TYPE fuzequality_flow_gap_findings gauge',
      `fuzequality_flow_gap_findings ${portfolio.findings.filter(item => item.status === 'open' && item.policyVersion === 'flow-orphans-v1').length}`,
      '# HELP fuzequality_requirement_review_findings Number of open conflicting or incomplete requirement findings',
      '# TYPE fuzequality_requirement_review_findings gauge',
      `fuzequality_requirement_review_findings ${portfolio.findings.filter(item => item.status === 'open' && item.policyVersion === 'requirement-review-v1').length}`,
      '# HELP fuzequality_jira_sync_freshness Jira requirement synchronization freshness: 1 fresh, 0 otherwise',
      '# TYPE fuzequality_jira_sync_freshness gauge',
      `fuzequality_jira_sync_freshness ${jiraFreshness?.freshnessStatus === 'fresh' ? 1 : 0}`,
    ].join('\n')
  )
})

app.get('/api/v1/portfolio', mayReadCatalog, async (request, response) =>
  response.json(await store.portfolio(requestIdentity(request)!.tenantId))
)
app.get('/api/v1/admin/organizations', mayAdministerPlatform, async (_request, response) =>
  response.json(organizationSummaries(await store.portfolio()))
)
app.post('/api/v1/admin/organizations/:tenantId/context', mayAdministerPlatform, async (request, response) => {
  const parsed = adminContextSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: parsed.error.flatten(), code: 'CONTEXT_REASON_REQUIRED' })
  const targetTenantId = Array.isArray(request.params.tenantId) ? request.params.tenantId[0] : request.params.tenantId
  const identity = requestIdentity(request)!
  const portfolio = await store.portfolio(targetTenantId)
  if (!portfolio.repositories.length) return response.status(404).json({ error: 'Organization catalog not found', code: 'ORGANIZATION_NOT_FOUND' })
  const audit = await store.recordAdminContext({
    actorId: identity.userId,
    sourceTenantId: identity.tenantId,
    targetTenantId,
    reason: parsed.data.reason,
    correlationId: request.header('x-correlation-id') ?? undefined,
  })
  response.json({
    organizationId: targetTenantId,
    mode: 'read-only',
    auditId: audit.id,
    enteredAt: audit.createdAt,
    portfolio,
  })
})
app.get('/api/v1/organization/members', mayReadOrganizationAccess, async (request, response) => {
  const identity = requestIdentity(request)!
  const query = new URLSearchParams()
  for (const key of ['page', 'pageSize', 'search']) {
    if (typeof request.query[key] === 'string') query.set(key, request.query[key])
  }
  const suffix = query.size ? `?${query.toString()}` : ''
  await proxyOrganizationSecurity(request, response, `/api/organizations/${encodeURIComponent(identity.tenantId)}/members${suffix}`)
})
app.get('/api/v1/organization/roles', mayReadOrganizationAccess, async (request, response) => {
  const identity = requestIdentity(request)!
  await proxyOrganizationSecurity(request, response, `/api/organizations/${encodeURIComponent(identity.tenantId)}/roles`)
})
app.post('/api/v1/organization/invitations', mayManageOrganizationAccess, async (request, response) => {
  const parsed = invitationSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: parsed.error.flatten() })
  const identity = requestIdentity(request)!
  await proxyOrganizationSecurity(
    request,
    response,
    `/api/organizations/${encodeURIComponent(identity.tenantId)}/invitations`,
    { method: 'POST', body: JSON.stringify(parsed.data) }
  )
})
app.put('/api/v1/organization/members/:memberId', mayManageOrganizationAccess, async (request, response) => {
  const parsed = memberRoleSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: parsed.error.flatten() })
  const identity = requestIdentity(request)!
  const memberId = Array.isArray(request.params.memberId) ? request.params.memberId[0] : request.params.memberId
  await proxyOrganizationSecurity(
    request,
    response,
    `/api/organizations/${encodeURIComponent(identity.tenantId)}/members/${encodeURIComponent(memberId)}`,
    { method: 'PUT', body: JSON.stringify(parsed.data) }
  )
})
app.delete('/api/v1/organization/members/:memberId', mayManageOrganizationAccess, async (request, response) => {
  const identity = requestIdentity(request)!
  const memberId = Array.isArray(request.params.memberId) ? request.params.memberId[0] : request.params.memberId
  await proxyOrganizationSecurity(
    request,
    response,
    `/api/organizations/${encodeURIComponent(identity.tenantId)}/members/${encodeURIComponent(memberId)}`,
    { method: 'DELETE' }
  )
})
app.get('/api/v1/internal/repositories/:id', async (request, response) => {
  const repositoryId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id
  const repository = await store.repository(repositoryId)
  if (!repository) return response.status(404).json({ error: 'Repository not found' })
  response.json(repository)
})
app.get('/api/v1/internal/repositories/:id/quality-artifacts', async (request, response) => {
  const repositoryId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id
  const repository = await store.repository(repositoryId)
  if (!repository) return response.status(404).json({ error: 'Repository not found' })
  response.json(await store.qualityArtifacts(repositoryId, repository.tenantId ?? 'legacy'))
})
app.post('/api/v1/internal/repository-flow-candidates', async (request, response) => {
  const parsed = repositoryFlowCandidateIngestionSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: parsed.error.flatten() })
  const ownershipError = await candidateOwnershipError(parsed.data.candidates, id => store.repository(id))
  if (ownershipError) return response.status(400).json({ error: 'Candidate repository/tenant ownership mismatch', ...ownershipError })
  await store.saveRepositoryFlowCandidates(parsed.data.candidates)
  response.status(202).json({ accepted: true })
})
app.get('/api/v1/internal/repositories/:id/policy-gate-evaluations', async (request, response) => {
  const repositoryId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id
  const repository = await store.repository(repositoryId)
  if (!repository) return response.status(404).json({ error: 'Repository not found' })
  response.json(await store.policyGateEvaluations(repositoryId, repository.tenantId ?? 'legacy'))
})
app.post('/api/v1/internal/policy-gate-evaluations', async (request, response) => {
  const parsed = policyGateEvaluationIngestionSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: parsed.error.flatten() })
  const ownershipError = await policyGateOwnershipError(parsed.data.evaluations, id => store.repository(id))
  if (ownershipError) return response.status(400).json({ error: 'Evaluation repository/tenant ownership mismatch', ...ownershipError })
  await store.savePolicyGateEvaluations(parsed.data.evaluations)
  response.status(202).json({ accepted: true })
})
app.post('/api/v1/internal/test-executions', async (request, response) => {
  const execution = testExecutionInputSchema.parse(request.body)
  const repository = await store.repository(execution.repositoryId, execution.tenantId)
  if (!repository) return response.status(404).json({ error: 'Repository not found' })
  const id = randomUUID()
  await store.saveTestExecution(executionRecord(execution, id))
  response.status(202).json({ accepted: true })
})
app.post('/api/v1/internal/identity-lifecycle', async (request, response) => {
  const event = identityLifecycleEventSchema.parse(request.body)
  let changed = false
  switch (event.type) {
    case 'organization.upsert':
      changed = await store.projectIdentityLifecycle({ type: event.type, tenant: {
        id: event.organizationId, slug: event.slug, name: event.name, type: event.organizationType,
        ownerId: event.ownerId ?? undefined, active: event.isActive,
      } }, { topic: TOPICS.TENANT_SEEDED, payload: { tenantId: event.organizationId, tenantType: event.organizationType, active: event.isActive }, key: event.organizationId })
      break
    case 'organization.deleted':
      changed = await store.projectIdentityLifecycle(
        { type: event.type, tenantId: event.organizationId },
        { topic: TOPICS.TENANT_DELETED, payload: { tenantId: event.organizationId }, key: event.organizationId },
      )
      break
    case 'user.upsert':
      changed = await store.projectIdentityLifecycle(
        { type: event.type, principal: { id: event.userId, email: event.email, firstName: event.firstName, lastName: event.lastName, active: true } },
        { topic: TOPICS.PRINCIPAL_SEEDED, payload: { userId: event.userId }, key: event.userId },
      )
      break
    case 'user.deleted':
      changed = await store.projectIdentityLifecycle(
        { type: event.type, principalId: event.userId },
        { topic: TOPICS.PRINCIPAL_DELETED, payload: { userId: event.userId }, key: event.userId },
      )
      break
    case 'membership.changed':
      changed = await store.projectIdentityLifecycle(
        { type: event.type, membership: { tenantId: event.organizationId, principalId: event.userId, role: event.role, active: event.active } },
        { topic: TOPICS.ORGANIZATION_MEMBERSHIP_CHANGED, payload: { organizationId: event.organizationId, userId: event.userId, role: event.role, active: event.active }, key: `${event.organizationId}:${event.userId}` },
      )
      break
  }
  await relayOutboxBatch(store, events)
  response.status(202).json({ accepted: true, changed })
})
app.post('/api/v1/internal/design-test-links', async (request, response) => {
  const event = designTestLinkLifecycleEventSchema.parse(request.body)
  const topic = event.type === 'design-test-link.upsert'
    ? TOPICS.DESIGN_TEST_LINK_VERIFIED
    : TOPICS.DESIGN_TEST_LINK_REVOKED
  const changed = await store.projectDesignTestLink(event, {
    topic,
    key: `${event.tenantId}:${event.traceLinkId}`,
    payload: {
      tenantId: event.tenantId,
      traceLinkId: event.traceLinkId,
      fuzexProjectId: event.fuzexProjectId,
      targetKind: event.targetKind,
      targetRef: event.targetRef,
      testCaseId: event.testCaseId,
      active: event.type === 'design-test-link.upsert',
    },
  })
  await relayOutboxBatch(store, events)
  response.status(202).json({ accepted: true, changed })
})
app.get('/api/v1/repositories', mayReadRepositories, async (request, response) =>
  response.json((await store.portfolio(requestIdentity(request)!.tenantId)).repositories)
)
app.get('/api/v1/repositories/:id', mayReadRepositories, async (request, response) => {
  const repositoryId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id
  const repository = await store.repository(repositoryId, requestIdentity(request)!.tenantId)
  if (!repository) return response.status(404).json({ error: 'Repository not found' })
  response.json(repository)
})
app.get('/api/v1/repositories/:id/scan-history', mayReadRepositories, async (request, response) => {
  const repositoryId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id
  const tenantId = requestIdentity(request)!.tenantId
  if (!await store.repository(repositoryId, tenantId)) return response.status(404).json({ error: 'Repository not found' })
  response.json(await store.repositoryScanHistory(repositoryId, tenantId))
})
app.get('/api/v1/repositories/:id/quality-artifacts', mayReadCatalog, async (request, response) => {
  const repositoryId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id
  const tenantId = requestIdentity(request)!.tenantId
  if (!await store.repository(repositoryId, tenantId)) return response.status(404).json({ error: 'Repository not found' })
  response.json(await store.qualityArtifacts(repositoryId, tenantId))
})
app.get('/api/v1/repositories/:id/flow-candidates', mayReadCatalog, async (request, response) => {
  const repositoryId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id
  const tenantId = requestIdentity(request)!.tenantId
  if (!await store.repository(repositoryId, tenantId)) return response.status(404).json({ error: 'Repository not found' })
  const filter = repositoryFlowFilterSchema.safeParse(request.query)
  if (!filter.success) return response.status(400).json({ error: filter.error.flatten() })
  response.json(filterRepositoryFlowCandidates(await store.repositoryFlowCandidates(repositoryId, tenantId), filter.data))
})
app.get('/api/v1/repositories/:id/flow-candidates/:candidateId/history', mayReadCatalog, async (request, response) => {
  const repositoryId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id
  const candidateId = Array.isArray(request.params.candidateId) ? request.params.candidateId[0] : request.params.candidateId
  const tenantId = requestIdentity(request)!.tenantId
  if (!await store.repository(repositoryId, tenantId)) return response.status(404).json({ error: 'Repository not found' })
  const candidate = (await store.repositoryFlowCandidates(repositoryId, tenantId)).find(item => item.id === candidateId)
  if (!candidate) return response.status(404).json({ error: 'Flow candidate not found' })
  response.json(await store.repositoryFlowReviewHistory(candidateId, tenantId))
})
app.post('/api/v1/repositories/:id/flow-candidates/:candidateId/review', mayReviewSuggestions, async (request, response) => {
  const parsed = repositoryFlowReviewSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: parsed.error.flatten() })
  const repositoryId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id
  const candidateId = Array.isArray(request.params.candidateId) ? request.params.candidateId[0] : request.params.candidateId
  const tenantId = requestIdentity(request)!.tenantId
  const repository = await store.repository(repositoryId, tenantId)
  if (!repository) return response.status(404).json({ error: 'Repository not found' })
  const existingCandidate = (await store.repositoryFlowCandidates(repositoryId, tenantId)).find(item => item.id === candidateId)
  if (!existingCandidate) return response.status(404).json({ error: 'Flow candidate not found' })
  const conflict = repositoryFlowReviewConflict(repository, existingCandidate)
  if (conflict) return response.status(409).json(conflict)
  const candidate = await store.reviewRepositoryFlowCandidate(candidateId, tenantId, {
    status: parsed.data.status,
    reviewedBy: requestIdentity(request)!.userId,
    reason: parsed.data.reason,
  })
  if (!candidate) return response.status(404).json({ error: 'Flow candidate not found' })
  response.json(candidate)
})
app.get('/api/v1/repositories/:id/policy-gate-evaluations', mayReadCatalog, async (request, response) => {
  const repositoryId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id
  const tenantId = requestIdentity(request)!.tenantId
  if (!await store.repository(repositoryId, tenantId)) return response.status(404).json({ error: 'Repository not found' })
  response.json(await store.policyGateEvaluations(repositoryId, tenantId))
})
app.get('/api/v1/repositories/:id/policy-gate-evaluations/:evaluationId/history', mayReadCatalog, async (request, response) => {
  const repositoryId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id
  const evaluationId = Array.isArray(request.params.evaluationId) ? request.params.evaluationId[0] : request.params.evaluationId
  const tenantId = requestIdentity(request)!.tenantId
  if (!await store.repository(repositoryId, tenantId)) return response.status(404).json({ error: 'Repository not found' })
  const evaluation = (await store.policyGateEvaluations(repositoryId, tenantId)).find(item => item.id === evaluationId)
  if (!evaluation) return response.status(404).json({ error: 'Policy-gate evaluation not found' })
  response.json(await store.policyGateReviewHistory(evaluationId, tenantId))
})
app.post('/api/v1/repositories/:id/policy-gate-evaluations/:evaluationId/review', mayReviewSuggestions, async (request, response) => {
  const parsed = policyGateReviewSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: parsed.error.flatten() })
  const repositoryId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id
  const evaluationId = Array.isArray(request.params.evaluationId) ? request.params.evaluationId[0] : request.params.evaluationId
  const tenantId = requestIdentity(request)!.tenantId
  const repository = await store.repository(repositoryId, tenantId)
  if (!repository) return response.status(404).json({ error: 'Repository not found' })
  const existingEvaluation = (await store.policyGateEvaluations(repositoryId, tenantId)).find(item => item.id === evaluationId)
  if (!existingEvaluation) return response.status(404).json({ error: 'Policy-gate evaluation not found' })
  const conflict = policyGateReviewConflict(repository, existingEvaluation)
  if (conflict) return response.status(409).json(conflict)
  const evaluation = await store.reviewPolicyGateEvaluation(evaluationId, tenantId, { status: parsed.data.status, reviewedBy: requestIdentity(request)!.userId, reason: parsed.data.reason })
  if (!evaluation) return response.status(404).json({ error: 'Policy-gate evaluation not found' })
  response.json(evaluation)
})
app.get('/api/v1/repositories/:id/test-executions', mayReadCatalog, async (request, response) => {
  const repositoryId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id
  const tenantId = requestIdentity(request)!.tenantId
  if (!await store.repository(repositoryId, tenantId)) return response.status(404).json({ error: 'Repository not found' })
  const filter = executionFilterSchema.safeParse(request.query)
  if (!filter.success) return response.status(400).json({ error: filter.error.flatten() })
  response.json(filterTestExecutions(await store.testExecutions(repositoryId, tenantId), filter.data))
})
app.get('/api/v1/repositories/:id/execution-performance', mayReadCatalog, async (request, response) => {
  const repositoryId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id
  const tenantId = requestIdentity(request)!.tenantId
  if (!await store.repository(repositoryId, tenantId)) return response.status(404).json({ error: 'Repository not found' })
  const filter = executionFilterSchema.safeParse(request.query)
  if (!filter.success) return response.status(400).json({ error: filter.error.flatten() })
  const [executions, artifacts] = await Promise.all([
    store.testExecutions(repositoryId, tenantId),
    store.qualityArtifacts(repositoryId, tenantId),
  ])
  response.json(executionPerformance(filterTestExecutions(executions, filter.data), artifacts))
})
app.post('/api/v1/repositories/:id/performance-tests/:artifactId/execute', mayRunExecution, async (request, response) => {
  const parsed = performanceTestRequestSchema.safeParse({ artifactId: request.params.artifactId })
  if (!parsed.success) return response.status(400).json({ error: parsed.error.flatten() })
  const repositoryId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id
  const tenantId = requestIdentity(request)!.tenantId
  const repository = await store.repository(repositoryId, tenantId)
  if (!repository) return response.status(404).json({ error: 'Repository not found' })
  const artifact = (await store.qualityArtifacts(repositoryId, tenantId)).find(item => item.id === parsed.data.artifactId)
  if (!artifact || !['load-test', 'stress-test'].includes(artifact.kind)) return response.status(404).json({ error: 'Performance test not found' })
  const workflowPath = performanceWorkflowTarget(artifact)
  if (!workflowPath) return response.status(422).json({ error: 'Performance definition is not a scanner-verified workflow_dispatch workflow', code: 'PERFORMANCE_WORKFLOW_NOT_DISPATCHABLE' })
  if (!repository.installationId) return response.status(422).json({ error: 'GitHub App installation is required', code: 'INSTALLATION_REQUIRED' })
  try {
    await dispatchPerformanceWorkflow({ owner: repository.owner, name: repository.name, defaultBranch: repository.defaultBranch, installationId: repository.installationId, workflowPath })
    response.status(202).json({ status: 'dispatched', artifactId: artifact.id, workflowPath, ref: repository.defaultBranch })
  } catch (error) {
    response.status(422).json({ error: error instanceof Error ? error.message : String(error), code: 'PERFORMANCE_DISPATCH_FAILED' })
  }
})
app.get('/api/v1/repositories/:id/catalog-status', mayReadCatalog, async (request, response) => {
  const portfolio = await store.portfolio(requestIdentity(request)!.tenantId)
  const repositoryId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id
  const status = repositoryCatalogStatus(
    portfolio,
    repositoryId,
    new Date(),
    Number(process.env.FUZEQUALITY_STALE_AFTER_MS ?? 86_400_000)
  )
  if (!status) return response.status(404).json({ error: 'Repository not found' })
  response.json(status)
})
app.post('/api/v1/repositories/verify', mayManageRepositories, async (request, response) => {
  const parsed = repositoryInputSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: parsed.error.flatten() })
  if (!parsed.data.installationId) return response.status(400).json({ error: 'GitHub App installation is required', code: 'INSTALLATION_REQUIRED' })
  try {
    const access = await repositoryAccess.verify({
      owner: parsed.data.owner,
      name: parsed.data.name,
      defaultBranch: parsed.data.defaultBranch,
      installationId: parsed.data.installationId,
    })
    response.json({ accessible: true, repository: access })
  } catch (error) {
    const result = publicAccessError(error)
    response.status(result.status).json(result.body)
  }
})
app.post('/api/v1/repositories', mayManageRepositories, async (request, response) => {
  const parsed = repositoryInputSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: parsed.error.flatten() })
  if (!parsed.data.installationId) return response.status(400).json({ error: 'GitHub App installation is required', code: 'INSTALLATION_REQUIRED' })
  if (process.env.NODE_ENV === 'production' && parsed.data.localPath) {
    return response.status(400).json({ error: 'Local paths are not accepted in production', code: 'LOCAL_PATH_FORBIDDEN' })
  }
  const tenantId = requestIdentity(request)!.tenantId
  const existing = (await store.portfolio(tenantId)).repositories.find(item =>
    item.owner.toLowerCase() === parsed.data.owner.toLowerCase() && item.name.toLowerCase() === parsed.data.name.toLowerCase()
  )
  try {
    await repositoryAccess.verify({
      owner: parsed.data.owner,
      name: parsed.data.name,
      defaultBranch: parsed.data.defaultBranch,
      installationId: parsed.data.installationId,
    })
    const repository = await store.addRepository(parsed.data, tenantId)
    response.status(existing ? 200 : 201).json(repository)
  } catch (error) {
    const result = publicAccessError(error)
    response.status(result.status).json(result.body)
  }
})
app.post('/api/v1/repositories/:id/scans', mayScanRepositories, async (request, response) => {
  const tenantId = requestIdentity(request)!.tenantId
  const repositoryId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id
  const repository = await store.repository(repositoryId, tenantId)
  if (!repository) return response.status(404).json({ error: 'Repository not found' })
  await store.setRepositoryStatus(repository.id, 'queued')
  const localPath = typeof request.body?.localPath === 'string' ? request.body.localPath : repository.localPath
  if (localPath && process.env.ALLOW_LOCAL_SCANS !== 'false') {
    await store.setRepositoryStatus(repository.id, 'running')
    try {
      const result = await scanRepository(repository, localPath)
      await store.saveScan(result)
      return response.status(202).json({ status: 'complete', revision: result.revision })
    } catch (error) {
      await store.setRepositoryStatus(repository.id, 'failed')
      return response.status(422).json({ error: error instanceof Error ? error.message : String(error) })
    }
  }
  if (!repository.installationId) {
    await store.setRepositoryStatus(repository.id, 'failed')
    return response.status(422).json({ error: 'GitHub App installation is required', code: 'INSTALLATION_REQUIRED' })
  }
  try {
    const access = await repositoryAccess.verify({
      owner: repository.owner,
      name: repository.name,
      defaultBranch: repository.defaultBranch,
      installationId: repository.installationId,
    })
    await events.publish(
      TOPICS.REPOSITORY_SCAN_REQUESTED,
      { repositoryId: repository.id, commitSha: access.commitSha, trigger: 'manual' },
      repository.id
    )
    response.status(202).json({ status: 'queued', commitSha: access.commitSha })
  } catch (error) {
    await store.setRepositoryStatus(repository.id, 'failed')
    const result = publicAccessError(error)
    response.status(result.status).json(result.body)
  }
})
app.patch('/api/v1/repositories/:id/administration', mayManageRepositoryAdministration, async (request, response) => {
  const parsed = repositoryAdministrationSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: parsed.error.flatten() })
  const identity = requestIdentity(request)!
  const repositoryId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id
  const repository = await store.updateRepositoryAdministration(repositoryId, identity.tenantId, parsed.data)
  if (!repository) return response.status(404).json({ error: 'Repository not found', code: 'REPOSITORY_NOT_FOUND' })
  response.json(repository)
})

app.get('/api/v1/catalog/apis', mayReadCatalog, async (request, response) =>
  response.json((await store.portfolio(requestIdentity(request)!.tenantId)).operations)
)
app.get('/api/v1/catalog/apis/:id', mayReadCatalog, async (request, response) => {
  const portfolio = await store.portfolio(requestIdentity(request)!.tenantId)
  const operation = portfolio.operations.find(item => item.id === request.params.id)
  if (!operation) return response.status(404).json({ error: 'API operation not found', code: 'OPERATION_NOT_FOUND' })
  response.json({
    operation,
    expectations: portfolio.expectations.filter(item => item.subjectId === operation.id),
    findings: portfolio.findings.filter(item => item.subjectId === operation.id),
    revision: portfolio.repositories.find(item => item.id === operation.repositoryId)?.lastScanRevision,
    policyVersion: 'api-coverage-v1',
  })
})
app.get('/api/v1/catalog/frontend', mayReadCatalog, async (request, response) =>
  response.json((await store.portfolio(requestIdentity(request)!.tenantId)).surfaces)
)
app.get('/api/v1/catalog/tests', mayReadCatalog, async (request, response) =>
  response.json((await store.portfolio(requestIdentity(request)!.tenantId)).tests)
)
app.get('/api/v1/coverage/portfolio', mayReadCatalog, async (request, response) => {
  const portfolio = await store.portfolio(requestIdentity(request)!.tenantId)
  response.json({
    summary: coverageSummary(portfolio.expectations),
    expectations: portfolio.expectations,
    generatedAt: new Date().toISOString(),
    policyVersion: 'v1',
  })
})
app.get('/api/v1/coverage/apis', mayReadCatalog, async (request, response) => {
  const portfolio = await store.portfolio(requestIdentity(request)!.tenantId)
  const value = (name: string) => {
    const raw = request.query[name]
    return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined
  }
  response.json(apiCoverageCatalog(portfolio, {
    repositoryId: value('repositoryId'),
    tag: value('tag'),
    path: value('path'),
    coverage: value('coverage') as import('@fuzequality/contracts').CoverageState | undefined,
    findingType: value('findingType'),
  }))
})
app.get('/api/v1/coverage/frontend', mayReadCatalog, async (request, response) => {
  const portfolio = await store.portfolio(requestIdentity(request)!.tenantId)
  response.json({ surfaces: portfolio.surfaces, expectations: portfolio.expectations.filter(item => item.subjectType === 'frontend-surface') })
})
app.post('/api/v1/test-implementations', mayCreateTestImplementation, async (request, response) => {
  const parsed = testImplementationRequestSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: parsed.error.flatten() })
  const identity = requestIdentity(request)!
  const portfolio = await store.portfolio(identity.tenantId)
  const repository = portfolio.repositories.find(item => item.id === parsed.data.repositoryId)
  if (!repository) return response.status(404).json({ error: 'Repository not found', code: 'REPOSITORY_NOT_FOUND' })
  if (!repository.lastScanRevision || repository.lastScanRevision !== parsed.data.sourceRevision) {
    return response.status(409).json({ error: 'The coverage plan is stale; refresh before implementation', code: 'SOURCE_REVISION_STALE' })
  }
  const selected = parsed.data.expectationIds.map(id => portfolio.expectations.find(item => item.id === id))
  if (selected.some(item => !item)) return response.status(409).json({ error: 'One or more expectations are stale', code: 'EXPECTATION_STALE' })
  const expectations = selected as typeof portfolio.expectations
  if (expectations.some(item => item.coverage !== 'gap' || item.priority === 'not-applicable')) {
    return response.status(409).json({ error: 'Only current coverage gaps can be implemented', code: 'EXPECTATION_NOT_GAP' })
  }
  const subjectIds = new Set([
    ...portfolio.operations.filter(item => item.repositoryId === repository.id).map(item => item.id),
    ...portfolio.surfaces.filter(item => item.repositoryId === repository.id).map(item => item.id),
  ])
  if (expectations.some(item => !subjectIds.has(item.subjectId))) {
    return response.status(403).json({ error: 'Expectation does not belong to the selected repository', code: 'EXPECTATION_REPOSITORY_MISMATCH' })
  }
  const requestId = randomUUID()
  let manifest
  try {
    manifest = buildImplementationManifest({
      requestId,
      repository,
      sourceRevision: parsed.data.sourceRevision,
      expectations,
      operations: portfolio.operations,
      surfaces: portfolio.surfaces,
    })
  } catch (error) {
    return response.status(400).json({ error: error instanceof Error ? error.message : String(error), code: 'AGENT_SCOPE_MIXED' })
  }
  const implementation = newImplementationRequest({
    tenantId: identity.tenantId,
    repositoryId: repository.id,
    sourceRevision: parsed.data.sourceRevision,
    expectationIds: parsed.data.expectationIds,
    requestedBy: identity.userId,
    agentProfile: manifest.agentProfile,
    skills: [...manifest.skills],
  })
  implementation.id = requestId
  const key = implementationIdempotencyKey(identity.tenantId, repository.id, parsed.data.sourceRevision, parsed.data.expectationIds)
  const saved = await store.createTestImplementation(implementation, key)
  if (saved.id !== requestId) return response.status(200).json(saved)
  try {
    const workflowUrl = await dispatchImplementation(manifest)
    await store.updateTestImplementation(saved.id, { workflowUrl })
    response.status(202).json({ ...saved, workflowUrl })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await store.updateTestImplementation(saved.id, { status: 'failed', error: message })
    response.status(503).json({ ...saved, status: 'failed', error: message })
  }
})
app.get('/api/v1/test-implementations/:id', mayReadTestImplementation, async (request, response) => {
  const id = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id
  const item = await store.testImplementation(id, requestIdentity(request)!.tenantId)
  if (!item) return response.status(404).json({ error: 'Implementation request not found' })
  response.json(item)
})
app.post('/api/v1/internal/test-implementations/:id/status', async (request, response) => {
  if (!process.env.FUZEQUALITY_CLOUD_CALLBACK_TOKEN || request.header('x-fuzequality-callback-token') !== process.env.FUZEQUALITY_CLOUD_CALLBACK_TOKEN) {
    return response.status(401).json({ error: 'Invalid callback credential' })
  }
  const status = request.body?.status
  if (!['running', 'pr-ready', 'failed'].includes(status)) return response.status(400).json({ error: 'Invalid status' })
  const id = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id
  await store.updateTestImplementation(id, {
    status,
    workflowUrl: typeof request.body?.workflowUrl === 'string' ? request.body.workflowUrl : undefined,
    pullRequestUrl: typeof request.body?.pullRequestUrl === 'string' ? request.body.pullRequestUrl : undefined,
    error: typeof request.body?.error === 'string' ? request.body.error.slice(0, 2000) : undefined,
  })
  response.status(202).json({ accepted: true })
})
app.get('/api/v1/requirements', mayReadRequirements, async (request, response) =>
  response.json((await store.portfolio(requestIdentity(request)!.tenantId)).requirements)
)
app.get('/api/v1/flows', mayReadRequirements, async (request, response) =>
  response.json((await store.portfolio(requestIdentity(request)!.tenantId)).flows)
)
app.get('/api/v1/suggestions', mayReadSuggestions, async (request, response) =>
  response.json((await store.portfolio(requestIdentity(request)!.tenantId)).suggestions)
)
app.get('/api/v1/suggestions/:id/decisions', mayReadSuggestions, async (request, response) => {
  const suggestionId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id
  response.json(await store.suggestionDecisions(suggestionId, requestIdentity(request)!.tenantId))
})
app.post('/api/v1/suggestions/:id/decision', async (request, response, next) => {
  const parsed = reviewDecisionSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: parsed.error.flatten() })
  const suggestionId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id
  const authorize = parsed.data.decision === 'suppress' ? maySuppressSuggestions : mayReviewSuggestions
  return authorize(request, response, async () => {
    const identity = requestIdentity(request)!
    const suggestion = await store.reviewSuggestion(suggestionId, {
      actorId: identity.userId,
      tenantId: identity.tenantId,
      action: parsed.data.decision,
      editedPayload: parsed.data.editedPayload,
      reason: parsed.data.reason,
      owner: parsed.data.owner,
      expiresAt: parsed.data.expiresAt,
      targetSuggestionId: parsed.data.mergeIntoSuggestionId,
    })
  if (!suggestion) return response.status(404).json({ error: 'Suggestion not found' })
    await events.publish(TOPICS.MAPPING_REVIEWED, { suggestionId: suggestion.id, decision: parsed.data.decision }, suggestion.id)
  response.json(suggestion)
  })
})
app.post('/api/v1/suggestions/:id/approve-expected-test', mayReviewSuggestions, async (request, response) => {
  const suggestionId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id
  const identity = requestIdentity(request)!
  const suggestion = await store.approveExpectedTest(suggestionId, { actorId: identity.userId, tenantId: identity.tenantId, action: 'confirm' })
  if (!suggestion) return response.status(404).json({ error: 'Expected-test suggestion not found' })
  await events.publish(TOPICS.MAPPING_REVIEWED, { suggestionId: suggestion.id, decision: 'approve-expected-test' }, suggestion.id)
  response.json(suggestion)
})
app.post('/api/v1/expectations/:id/exclusion', maySuppressSuggestions, async (request, response) => {
  const parsed = expectationExclusionSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: parsed.error.flatten() })
  const expectationId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id
  const identity = requestIdentity(request)!
  const excluded = await store.excludeExpectation(expectationId, identity.tenantId, { ...parsed.data, actorId: identity.userId })
  if (!excluded) return response.status(404).json({ error: 'Expectation not found' })
  await events.publish(TOPICS.COVERAGE_REBUILD_REQUESTED, { scopeId: `expectation:${expectationId}` }, expectationId)
  response.status(202).json({ accepted: true })
})
app.get('/api/v1/findings', mayReadCatalog, async (request, response) =>
  response.json((await store.portfolio(requestIdentity(request)!.tenantId)).findings)
)

app.post('/api/v1/internal/scans/results', async (request, response) => {
  await store.saveScan(request.body)
  await events.publish(
    TOPICS.REPOSITORY_INVENTORY_CHANGED,
    { repositoryId: request.body.repository.id, revision: request.body.revision },
    request.body.repository.id
  )
  response.status(202).json({ accepted: true })
})
app.post('/api/v1/internal/intelligence/results', async (request, response) => {
  await store.saveIntelligence(request.body.results ?? [], request.body.sync)
  response.status(202).json({ accepted: true })
})
app.post('/api/v1/internal/intelligence/failure', async (request, response) => {
  const failure = intelligenceFailureSchema.parse(request.body)
  await store.markSyncFailed(failure.sourceType, failure.sourceKey)
  console.error(JSON.stringify({ event: 'intelligence_sync_failed', sourceType: failure.sourceType, sourceKey: failure.sourceKey, code: failure.code, retryable: true }))
  response.status(202).json({ accepted: true })
})
app.get('/api/v1/requirements/freshness', mayReadRequirements, async (_request, response) =>
  response.json(await store.syncCursor('jira', 'default') ?? { sourceType: 'jira', sourceKey: 'default', freshnessStatus: 'unknown' })
)
app.post('/api/v1/internal/coverage/rebuild', async (_request, response) => {
  try {
    const projection = await store.rebuildCoverage()
    console.info(JSON.stringify({
      event: 'coverage_projection_rebuilt',
      policyVersion: projection.policyVersion,
      schemaVersion: projection.schemaVersion,
      findings: projection.metrics.total,
      byType: projection.metrics.byType,
    }))
    response.status(200).json(projection)
  } catch {
    console.error(JSON.stringify({ event: 'coverage_projection_failed', code: 'QUALITY_PROJECTION_FAILED', retryable: true }))
    response.status(503).json({ error: 'Coverage projection failed; the previous snapshot remains active', code: 'QUALITY_PROJECTION_FAILED' })
  }
})

app.post('/api/v1/jira/sync', maySyncRequirements, async (request, response) => {
  const scopeId = request.body?.scopeId ?? 'default'
  const cursor = await store.syncCursor('jira', scopeId)
  await events.publish(TOPICS.REQUIREMENT_SYNC_REQUESTED, {
    tenantId: requestIdentity(request)!.tenantId,
    scopeId,
    jql: request.body?.jql ?? process.env.JIRA_JQL ?? 'project = FUZE',
    ...(cursor?.cursor ? { since: cursor.cursor } : {}),
  })
  response.status(202).json({ status: 'queued', scopeId, incrementalFrom: cursor?.cursor })
})

app.post('/api/v1/webhooks/github', async (request, response) => {
  const raw = (request as express.Request & { rawBody?: Buffer }).rawBody
  if (!raw) return response.status(400).json({ error: 'Webhook payload is unavailable' })
  const headers = githubWebhookHeadersSchema.safeParse({
    event: request.header('x-github-event'),
    delivery: request.header('x-github-delivery'),
    signature: request.header('x-hub-signature-256'),
  })
  if (!headers.success) return response.status(400).json({ error: 'Invalid GitHub webhook headers' })
  const secret = process.env.GITHUB_WEBHOOK_SECRET ?? ''
  if (!verifyGithubWebhook(raw, headers.data.signature, secret)) {
    return response.status(401).json({ error: 'Invalid webhook signature' })
  }
  const repositories = (await store.portfolio()).repositories
  const commands = webhookScanCommands(headers.data.event, request.body, repositories)
  const workflowExecutions = webhookWorkflowExecutions(headers.data.event, request.body, repositories)
  for (const execution of workflowExecutions) {
    const repository = repositories.find(item => item.id === execution.repositoryId)
    if (!repository?.tenantId) continue
    const links = linkExecutionArtifacts(
      execution.name,
      await store.qualityArtifacts(repository.id, repository.tenantId),
      execution.workflowPath,
    )
    const gateEvaluations = links.policyArtifactIds.length === 1 && links.gateArtifactIds.length === 1
      ? [{ policyArtifactId: links.policyArtifactIds[0], gateArtifactId: links.gateArtifactIds[0], status: execution.status }]
      : []
    await store.saveTestExecution({ id: `${execution.provider}:${execution.externalRunId}:${execution.attempt}:${execution.repositoryId}`, tenantId: repository.tenantId, thresholds: [], gateEvaluations, ...links, ...execution })
  }
  for (const command of commands) {
    let commitSha = command.commitSha
    if (!commitSha) {
      const repository = repositories.find(item => item.id === command.repositoryId)
      if (!repository?.installationId) continue
      const access = await repositoryAccess.verify({
        owner: repository.owner,
        name: repository.name,
        defaultBranch: repository.defaultBranch,
        installationId: repository.installationId,
      })
      commitSha = access.commitSha
    }
    await events.publish(
      TOPICS.REPOSITORY_SCAN_REQUESTED,
      { ...command, commitSha },
      command.repositoryId
    )
  }
  response.status(202).json({ accepted: true, delivery: headers.data.delivery, queued: commands.length, executions: workflowExecutions.length })
})

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  console.error(error)
  response.status(500).json({ error: 'Unexpected service error' })
})

const outboxRelayIntervalMs = Number(process.env.OUTBOX_RELAY_INTERVAL_MS ?? 5_000)
const outboxRelay = setInterval(() => {
  void relayOutboxBatch(store, events).catch(error => console.error('FuzeQuality outbox relay failed', error))
}, outboxRelayIntervalMs)
outboxRelay.unref()

app.listen(port, () => console.log(`FuzeQuality API listening on ${port}`))
