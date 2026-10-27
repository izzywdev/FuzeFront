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
  workflowDispatchRequestSchema,
  testImplementationRequestSchema,
  type OrganizationQualitySummary,
  type Portfolio,
  type ScanResult,
  type TestExecution,
  type TestSuiteDispatch,
  repositoryScanFailureSchema,
} from '@fuzequality/contracts'
import {
  apiCoverageCatalog,
  coverageSummary,
  createCatalogStore,
  createEventBus,
  executableWorkflowTarget,
  isPreferredWorkflowExecutionArtifact,
  performanceDispatchRevision,
  performanceWorkflowTarget,
  relayOutboxBatch,
  repositoryCatalogStatus,
  testExecutionCursorCreatedAt,
  testSuiteDispatchRevision,
  validateWorkflowDispatchInputs,
} from '@fuzequality/core'
import { scanRepository } from '@fuzequality/scanner'
import {
  githubWebhookHeadersSchema,
  verifyGithubWebhook,
  webhookScanCommands,
  webhookWorkflowExecutions,
} from '@fuzequality/github-app'
import { dispatchPerformanceWorkflow, dispatchTestWorkflow, GitHubArtifactEvidenceError, githubInstallationToken, githubWorkflowArtifactEvidence } from '../../workers/src/github'
import { createGitHubAccessVerifier, publicAccessError } from './repository-onboarding'
import { requestIdentity, requirePlatformAdminPermission, requirePlatformPermission } from './platform-authorization'
import { qualityResources } from './platform-permissions'
import { isPlatformAuthenticatedRequest, isPublicRequest } from './authentication'
import { createOpenApiSurface } from './openapi'
import { executionAttemptHistoryFilterSchema, executionPerformanceFilterSchema, executionPageFilterSchema } from './execution-filter'
import { enrichPerformanceEvidence } from './execution-performance-evidence'
import { decodeExecutionTrendCursor, executionTrendPage } from './execution-trend-pagination'
import { decodePerformanceCursor, performancePage } from './execution-performance-pagination'
import { executionRecord, linkExecutionToRevisionArtifacts, prepareExecutionEvidence, reconcileExecutionEvidenceForScan, refreshExecutionArtifactEvidence, webhookExecutionRecord } from './test-execution-ingestion'
import { candidateArtifactReferenceError, candidateOwnershipError, repositoryFlowCandidateIngestionSchema } from './repository-flow-ingestion'
import { repositoryFlowFilterSchema } from './repository-flow-filter'
import { repositoryFlowAnalysisProvenanceConflict, repositoryFlowArtifactReferenceConflict, repositoryFlowGroundingRationaleConflict, repositoryFlowReviewConflict, repositoryFlowReviewStateConflict, repositoryFlowWireframeConflict } from './repository-flow-review'
import { repositoryFlowCandidateById, repositoryFlowDetail } from './repository-flow-detail'
import { policyGateArtifactReferenceConflict, policyGateArtifactReferenceError, policyGateEvaluationIngestionSchema, policyGateOwnershipError } from './policy-gate-ingestion'
import { policyGateFilterSchema, policyGateStoreQuery } from './policy-gate-filter'
import { policyGateEvaluationForReview, policyGateReviewConflict, policyGateReviewRationaleConflict, policyGateReviewStateConflict } from './policy-gate-review'
import { policyGateDetail } from './policy-gate-detail'
import { decodeHistoryCursor, decodeUuidHistoryCursor, historyPage, historyPageQuerySchema } from './history-pagination'
import { decodeScanHistoryCursor, scanHistoryPage, scanHistoryPageQuerySchema } from './scan-history-pagination'
import { decodeQualityArtifactCursor, qualityArtifactIdsQuerySchema, qualityArtifactPage, qualityArtifactPageQuerySchema, resolveQualityArtifactRevision } from './quality-artifact-pagination'
import { repositoryAnalysisStatusSchema } from './repository-analysis-status'
import { reviewedPerformanceWorkflowPaths } from './latest-performance-executions'
import { reviewedIntegrationWorkflowPaths } from './latest-integration-executions'
import { reviewedPostProductionWorkflowPaths } from './latest-post-production-executions'
import { repositoryProcessingStatus } from './repository-processing-status'
import { dispatchWebhookScans } from './webhook-scan-dispatch'
import { testExecutionDetail } from './test-execution-detail'
import { testSuiteDispatchLogicalId, testSuiteDispatchPage } from './test-suite-dispatch-pagination'
import { queueRequirementSync } from './requirement-sync'
import { persistTerminalTestSuiteDispatch } from './test-suite-dispatch-audit'
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

async function saveScanWithExecutionReconciliation(result: ScanResult) {
  await store.saveScan(result)
  const tenantId = result.repository.tenantId
  if (!tenantId) return
  await reconcileExecutionEvidenceForScan(
    result,
    tenantId,
    (repositoryId, executionTenantId, revision) =>
      store.testExecutions(repositoryId, executionTenantId, { revision }),
    execution => store.saveTestExecution(execution),
  )
}
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
  expectedReviewedAt: z.string().datetime().nullable().optional(),
}).strict()
const policyGateReviewSchema = z.object({
  status: z.enum(['accepted', 'dismissed']),
  reason: z.string().trim().min(3).max(2000).optional(),
  expectedReviewedAt: z.string().datetime().nullable().optional(),
}).strict()
const intelligenceFailureSchema = z.object({
  tenantId: z.string().trim().min(1).max(200),
  sourceType: z.literal('jira'),
  sourceKey: z.string().trim().min(1).max(200),
  code: z.enum(['JIRA_UNAVAILABLE', 'INTELLIGENCE_UNAVAILABLE', 'INTELLIGENCE_TIMEOUT', 'INTELLIGENCE_INVALID_RESPONSE', 'SEMANTIC_INDEX_UNAVAILABLE']),
}).strict()
const repositoryAdministrationSchema = z.object({
  ownership: z.object({
    team: z.string().trim().min(1).max(100),
    contact: z.string().trim().email().optional(),
  }).nullable().optional(),
  jiraBindings: z.array(z.object({
    project: z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,19}$/),
    component: z.string().trim().min(1).max(255).optional(),
  })).max(100),
  storybookBaseUrl: z.string().trim().url().refine(value => new URL(value).protocol === 'https:').nullable().optional(),
}).strict()
const identityLifecycleEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('organization.upsert'),
    organizationId: z.string().uuid(), slug: z.string().min(1), name: z.string().min(1),
    organizationType: z.enum(['platform', 'organization', 'personal']), ownerId: z.string().uuid().nullable(), isActive: z.boolean(),
  }).strict(),
  z.object({
    type: z.literal('organization.deleted'),
    organizationId: z.string().uuid(),
    cascade: z.enum(['soft', 'hard']).default('soft'),
  }).strict(),
  z.object({
    type: z.literal('user.upsert'), userId: z.string().uuid(), email: z.string().email(),
    firstName: z.string().optional(), lastName: z.string().optional(),
  }).strict(),
  z.object({
    type: z.literal('user.deleted'),
    userId: z.string().uuid(),
    cascade: z.enum(['soft', 'hard']).default('soft'),
  }).strict(),
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
// kubelet probes use. /health is the platform-wide convention every Fuze service
// answers, and additionally reports whether this build shipped with its own
// contract.
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
  // the API can subsequently query its provisioned PostgreSQL database. Keep
  // this constant-time: readiness is also exposed through the standalone origin
  // and must never materialize the full catalog in response to a public probe.
  try {
    await store.checkReadiness()
    response.json({ status: 'ready' })
  } catch (error) {
    console.error('FuzeQuality readiness database check failed', error)
    response.status(503).json({ status: 'not-ready', dependency: 'postgres' })
  }
})
app.get('/metrics', async (_request, response) => {
  const portfolio = await store.portfolio()
  const jiraFreshness = await store.syncCursorStatuses('jira', 'default')
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
      `fuzequality_jira_sync_freshness ${jiraFreshness.length > 0 && jiraFreshness.every(item => item.freshnessStatus === 'fresh') ? 1 : 0}`,
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
app.post('/api/v1/internal/repositories/:id/analysis-status', async (request, response) => {
  const repositoryId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id
  const parsed = repositoryAnalysisStatusSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: parsed.error.flatten() })
  const repository = await store.repository(repositoryId)
  if (!repository) return response.status(404).json({ error: 'Repository not found' })
  await store.setRepositoryAnalysis(repositoryId, parsed.data)
  response.status(202).json({ accepted: true })
})
app.post('/api/v1/internal/repositories/:id/scan-failure', async (request, response) => {
  const repositoryId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id
  const parsed = repositoryScanFailureSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: parsed.error.flatten() })
  const repository = await store.repository(repositoryId)
  if (!repository) return response.status(404).json({ error: 'Repository not found' })
  await store.setRepositoryScanFailure(repositoryId, parsed.data)
  response.status(202).json({ accepted: true })
})
app.get('/api/v1/internal/repositories/:id/quality-artifacts', async (request, response) => {
  const repositoryId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id
  const query = z.object({ revision: z.string().trim().min(1).max(500).optional() }).strict().safeParse(request.query)
  if (!query.success) return response.status(400).json({ error: query.error.flatten() })
  const repository = await store.repository(repositoryId)
  if (!repository) return response.status(404).json({ error: 'Repository not found' })
  response.json(await store.qualityArtifacts(repositoryId, repository.tenantId ?? 'legacy', query.data.revision))
})
app.post('/api/v1/internal/repository-flow-candidates', async (request, response) => {
  const parsed = repositoryFlowCandidateIngestionSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: parsed.error.flatten() })
  const ownershipError = await candidateOwnershipError(parsed.data.candidates, id => store.repository(id))
  if (ownershipError) return response.status(400).json({ error: 'Candidate repository/tenant ownership mismatch', ...ownershipError })
  const referenceError = await candidateArtifactReferenceError(
    parsed.data.candidates,
    (repositoryId, tenantId, revision) => store.qualityArtifacts(repositoryId, tenantId, revision),
  )
  if (referenceError) return response.status(400).json({ error: 'Candidate artifact reference is unavailable in the repository revision', ...referenceError })
  await store.saveRepositoryFlowCandidates(parsed.data.candidates)
  response.status(202).json({ accepted: true })
})
app.get('/api/v1/internal/repositories/:id/policy-gate-evaluations', async (request, response) => {
  const repositoryId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id
  const repository = await store.repository(repositoryId)
  if (!repository) return response.status(404).json({ error: 'Repository not found' })
  const filter = policyGateFilterSchema.safeParse(request.query)
  if (!filter.success) return response.status(400).json({ error: filter.error.flatten() })
  const cursor = decodeHistoryCursor(filter.data.cursor)
  if (!cursor.success) return response.status(400).json({ error: cursor.error })
  const limit = filter.data.limit
  const evaluations = await store.policyGateEvaluations(
    repositoryId,
    repository.tenantId ?? 'legacy',
    policyGateStoreQuery(filter.data, cursor.data),
  )
  response.json(historyPage(evaluations, limit))
})
app.post('/api/v1/internal/policy-gate-evaluations', async (request, response) => {
  const parsed = policyGateEvaluationIngestionSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: parsed.error.flatten() })
  const ownershipError = await policyGateOwnershipError(parsed.data.evaluations, id => store.repository(id))
  if (ownershipError) return response.status(400).json({ error: 'Evaluation repository/tenant ownership mismatch', ...ownershipError })
  const referenceError = await policyGateArtifactReferenceError(
    parsed.data.evaluations,
    (repositoryId, tenantId, revision) => store.qualityArtifacts(repositoryId, tenantId, revision),
  )
  if (referenceError) return response.status(400).json({
    error: 'Evaluation references unavailable or mismatched exact-revision policy/gate evidence',
    ...referenceError,
  })
  await store.savePolicyGateEvaluations(parsed.data.evaluations)
  response.status(202).json({ accepted: true })
})
app.post('/api/v1/internal/test-executions', async (request, response) => {
  const parsed = testExecutionInputSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: parsed.error.flatten() })
  const execution = parsed.data
  const repository = await store.repository(execution.repositoryId, execution.tenantId)
  if (!repository) return response.status(404).json({ error: 'Repository not found' })
  const evidence = await prepareExecutionEvidence(
    execution,
    (repositoryId, tenantId, sourceRevision) =>
      store.catalogRevisionForSource(repositoryId, tenantId, sourceRevision),
    (repositoryId, tenantId, revision) =>
      store.qualityArtifacts(repositoryId, tenantId, revision),
  )
  if (!evidence.ok) return response.status(422).json(evidence)
  const id = randomUUID()
  await store.saveTestExecution(executionRecord(evidence.execution, id))
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
        { type: event.type, tenantId: event.organizationId, cascade: event.cascade },
        { topic: TOPICS.TENANT_DELETED, payload: { tenantId: event.organizationId, cascade: event.cascade }, key: event.organizationId },
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
        { type: event.type, principalId: event.userId, cascade: event.cascade },
        { topic: TOPICS.PRINCIPAL_DELETED, payload: { userId: event.userId, cascade: event.cascade }, key: event.userId },
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
  const query = scanHistoryPageQuerySchema.safeParse(request.query)
  if (!query.success) return response.status(400).json({ error: query.error.flatten() })
  const cursor = decodeScanHistoryCursor(query.data.cursor)
  if (!cursor.success) return response.status(400).json({ error: cursor.error })
  const history = await store.repositoryScanHistory(repositoryId, tenantId, {
    after: cursor.data,
    limit: query.data.limit + 1,
  })
  response.json(scanHistoryPage(history, query.data.limit))
})
app.get('/api/v1/repositories/:id/quality-artifacts', mayReadCatalog, async (request, response) => {
  const repositoryId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id
  const tenantId = requestIdentity(request)!.tenantId
  const repository = await store.repository(repositoryId, tenantId)
  if (!repository) return response.status(404).json({ error: 'Repository not found' })
  const query = qualityArtifactPageQuerySchema.safeParse(request.query)
  if (!query.success) return response.status(400).json({ error: query.error.flatten() })
  const cursor = decodeQualityArtifactCursor(query.data.cursor)
  if (!cursor.success) return response.status(400).json({ error: cursor.error })
  const resolvedRevision = resolveQualityArtifactRevision(
    query.data.revision,
    cursor.data?.revision,
    repository.lastScanRevision,
  )
  if (!resolvedRevision.success) return response.status(400).json({ error: resolvedRevision.error })
  const artifacts = await store.qualityArtifacts(repositoryId, tenantId, resolvedRevision.data, {
    afterId: cursor.data?.id,
    limit: query.data.limit + 1,
  })
  response.json(qualityArtifactPage(artifacts, query.data.limit, resolvedRevision.data))
})
app.get('/api/v1/repositories/:id/quality-artifacts/by-ids', mayReadCatalog, async (request, response) => {
  const repositoryId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id
  const tenantId = requestIdentity(request)!.tenantId
  if (!await store.repository(repositoryId, tenantId)) return response.status(404).json({ error: 'Repository not found' })
  const query = qualityArtifactIdsQuerySchema.safeParse(request.query)
  if (!query.success) return response.status(400).json({ error: query.error.flatten() })
  response.json({
    items: await store.qualityArtifactsByIds(repositoryId, tenantId, query.data.id, query.data.revision),
  })
})
app.get('/api/v1/repositories/:id/flow-candidates', mayReadCatalog, async (request, response) => {
  const repositoryId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id
  const tenantId = requestIdentity(request)!.tenantId
  if (!await store.repository(repositoryId, tenantId)) return response.status(404).json({ error: 'Repository not found' })
  const filter = repositoryFlowFilterSchema.safeParse(request.query)
  if (!filter.success) return response.status(400).json({ error: filter.error.flatten() })
  const cursor = decodeHistoryCursor(filter.data.cursor)
  if (!cursor.success) return response.status(400).json({ error: cursor.error })
  const { limit, cursor: _cursor, ...query } = filter.data
  const candidates = await store.repositoryFlowCandidates(repositoryId, tenantId, {
    ...query,
    after: cursor.data,
    limit: limit + 1,
  })
  response.json(historyPage(candidates, limit))
})
app.get('/api/v1/repositories/:id/flow-candidates/:candidateId', mayReadCatalog, async (request, response) => {
  const repositoryId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id
  const candidateId = Array.isArray(request.params.candidateId) ? request.params.candidateId[0] : request.params.candidateId
  const tenantId = requestIdentity(request)!.tenantId
  const result = await repositoryFlowDetail(repositoryId, tenantId, candidateId, {
    repository: (id, tenant) => store.repository(id, tenant),
    candidates: (id, tenant, query) => store.repositoryFlowCandidates(id, tenant, query),
  })
  if (result.status === 404) return response.status(404).json({ error: result.error })
  response.json(result.candidate)
})
app.get('/api/v1/repositories/:id/flow-candidates/:candidateId/history', mayReadCatalog, async (request, response) => {
  const repositoryId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id
  const candidateId = Array.isArray(request.params.candidateId) ? request.params.candidateId[0] : request.params.candidateId
  const tenantId = requestIdentity(request)!.tenantId
  if (!await store.repository(repositoryId, tenantId)) return response.status(404).json({ error: 'Repository not found' })
  const filter = historyPageQuerySchema.safeParse(request.query)
  if (!filter.success) return response.status(400).json({ error: filter.error.flatten() })
  const cursor = decodeUuidHistoryCursor(filter.data.cursor)
  if (!cursor.success) return response.status(400).json({ error: cursor.error })
  const candidate = (await store.repositoryFlowCandidates(repositoryId, tenantId, { id: candidateId, limit: 1 }))[0]
  if (!candidate) return response.status(404).json({ error: 'Flow candidate not found' })
  const history = await store.repositoryFlowReviewHistory(candidateId, tenantId, {
    after: cursor.data,
    limit: filter.data.limit + 1,
  })
  response.json(historyPage(history, filter.data.limit))
})
app.post('/api/v1/repositories/:id/flow-candidates/:candidateId/review', mayReviewSuggestions, async (request, response) => {
  const parsed = repositoryFlowReviewSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: parsed.error.flatten() })
  const repositoryId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id
  const candidateId = Array.isArray(request.params.candidateId) ? request.params.candidateId[0] : request.params.candidateId
  const tenantId = requestIdentity(request)!.tenantId
  const repository = await store.repository(repositoryId, tenantId)
  if (!repository) return response.status(404).json({ error: 'Repository not found' })
  const existingCandidate = await repositoryFlowCandidateById(
    repositoryId,
    tenantId,
    candidateId,
    (id, tenant, query) => store.repositoryFlowCandidates(id, tenant, query),
  )
  if (!existingCandidate) return response.status(404).json({ error: 'Flow candidate not found' })
  const conflict = repositoryFlowReviewConflict(repository, existingCandidate)
  if (conflict) return response.status(409).json(conflict)
  const provenanceConflict = repositoryFlowAnalysisProvenanceConflict(existingCandidate, parsed.data.status)
  if (provenanceConflict) return response.status(422).json(provenanceConflict)
  const groundingConflict = repositoryFlowGroundingRationaleConflict(existingCandidate, parsed.data.status, parsed.data.reason)
  if (groundingConflict) return response.status(422).json(groundingConflict)
  const wireframeConflict = repositoryFlowWireframeConflict(existingCandidate, parsed.data.status)
  if (wireframeConflict) return response.status(422).json(wireframeConflict)
  const artifactConflict = repositoryFlowArtifactReferenceConflict(
    existingCandidate,
    parsed.data.status === 'confirmed'
      ? await store.qualityArtifacts(repositoryId, tenantId, existingCandidate.revision)
      : [],
    parsed.data.status,
  )
  if (artifactConflict) return response.status(422).json(artifactConflict)
  const candidate = await store.reviewRepositoryFlowCandidate(candidateId, tenantId, {
    status: parsed.data.status,
    reviewedBy: requestIdentity(request)!.userId,
    reason: parsed.data.reason,
    expectedReviewedAt: parsed.data.expectedReviewedAt,
  }, existingCandidate.revision)
  if (!candidate) {
    const latestRepository = await store.repository(repositoryId, tenantId)
    const latestCandidate = await repositoryFlowCandidateById(
      repositoryId,
      tenantId,
      candidateId,
      (id, tenant, query) => store.repositoryFlowCandidates(id, tenant, query),
    )
    if (!latestRepository || !latestCandidate) return response.status(404).json({ error: 'Flow candidate not found' })
    const reviewConflict = repositoryFlowReviewStateConflict(
      latestCandidate,
      parsed.data.expectedReviewedAt,
    )
    if (reviewConflict) return response.status(409).json(reviewConflict)
    return response.status(409).json(repositoryFlowReviewConflict(latestRepository, latestCandidate) ?? {
      error: 'The UX-flow candidate changed while it was being reviewed. Refresh before deciding.',
      code: 'STALE_FLOW_CANDIDATE',
      candidateRevision: latestCandidate.revision,
      currentRevision: latestRepository.lastScanRevision,
    })
  }
  response.json(candidate)
})
app.get('/api/v1/repositories/:id/policy-gate-evaluations', mayReadCatalog, async (request, response) => {
  const repositoryId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id
  const tenantId = requestIdentity(request)!.tenantId
  if (!await store.repository(repositoryId, tenantId)) return response.status(404).json({ error: 'Repository not found' })
  const filter = policyGateFilterSchema.safeParse(request.query)
  if (!filter.success) return response.status(400).json({ error: filter.error.flatten() })
  const cursor = decodeHistoryCursor(filter.data.cursor)
  if (!cursor.success) return response.status(400).json({ error: cursor.error })
  const { limit } = filter.data
  const evaluations = await store.policyGateEvaluations(
    repositoryId,
    tenantId,
    policyGateStoreQuery(filter.data, cursor.data),
  )
  response.json(historyPage(evaluations, limit))
})
app.get('/api/v1/repositories/:id/policy-gate-evaluations/:evaluationId', mayReadCatalog, async (request, response) => {
  const repositoryId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id
  const evaluationId = Array.isArray(request.params.evaluationId) ? request.params.evaluationId[0] : request.params.evaluationId
  const tenantId = requestIdentity(request)!.tenantId
  const result = await policyGateDetail(repositoryId, tenantId, evaluationId, {
    repository: (id, tenant) => store.repository(id, tenant),
    evaluations: (id, tenant, query) => store.policyGateEvaluations(id, tenant, query),
  })
  if (result.status === 404) return response.status(404).json({ error: result.error })
  response.json(result.evaluation)
})
app.get('/api/v1/repositories/:id/policy-gate-evaluations/:evaluationId/history', mayReadCatalog, async (request, response) => {
  const repositoryId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id
  const evaluationId = Array.isArray(request.params.evaluationId) ? request.params.evaluationId[0] : request.params.evaluationId
  const tenantId = requestIdentity(request)!.tenantId
  if (!await store.repository(repositoryId, tenantId)) return response.status(404).json({ error: 'Repository not found' })
  const filter = historyPageQuerySchema.safeParse(request.query)
  if (!filter.success) return response.status(400).json({ error: filter.error.flatten() })
  const cursor = decodeUuidHistoryCursor(filter.data.cursor)
  if (!cursor.success) return response.status(400).json({ error: cursor.error })
  const evaluation = (await store.policyGateEvaluations(repositoryId, tenantId, { id: evaluationId, limit: 1 }))[0]
  if (!evaluation) return response.status(404).json({ error: 'Policy-gate evaluation not found' })
  const history = await store.policyGateReviewHistory(evaluationId, tenantId, {
    after: cursor.data,
    limit: filter.data.limit + 1,
  })
  response.json(historyPage(history, filter.data.limit))
})
app.post('/api/v1/repositories/:id/policy-gate-evaluations/:evaluationId/review', mayReviewSuggestions, async (request, response) => {
  const parsed = policyGateReviewSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: parsed.error.flatten() })
  const repositoryId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id
  const evaluationId = Array.isArray(request.params.evaluationId) ? request.params.evaluationId[0] : request.params.evaluationId
  const tenantId = requestIdentity(request)!.tenantId
  const repository = await store.repository(repositoryId, tenantId)
  if (!repository) return response.status(404).json({ error: 'Repository not found' })
  const existingEvaluation = await policyGateEvaluationForReview(store, repositoryId, tenantId, evaluationId)
  if (!existingEvaluation) return response.status(404).json({ error: 'Policy-gate evaluation not found' })
  const conflict = policyGateReviewConflict(repository, existingEvaluation)
  if (conflict) return response.status(409).json(conflict)
  const rationaleConflict = policyGateReviewRationaleConflict(
    existingEvaluation,
    parsed.data.status,
    parsed.data.reason,
  )
  if (rationaleConflict) return response.status(422).json(rationaleConflict)
  const artifactConflict = parsed.data.status === 'accepted'
    ? policyGateArtifactReferenceConflict(
        existingEvaluation,
        await store.qualityArtifacts(repositoryId, tenantId, existingEvaluation.revision),
      )
    : undefined
  if (artifactConflict) return response.status(422).json({
    error: 'This policy-gate finding references evidence that is unavailable or mismatched in its exact repository revision. Regenerate the analysis before accepting it.',
    code: 'POLICY_GATE_ARTIFACT_REFERENCE_UNAVAILABLE',
    ...artifactConflict,
  })
  const evaluation = await store.reviewPolicyGateEvaluation(evaluationId, tenantId, {
    status: parsed.data.status,
    reviewedBy: requestIdentity(request)!.userId,
    reason: parsed.data.reason,
    expectedReviewedAt: parsed.data.expectedReviewedAt,
  }, existingEvaluation.revision)
  if (!evaluation) {
    const latestRepository = await store.repository(repositoryId, tenantId)
    const latestEvaluation = await policyGateEvaluationForReview(store, repositoryId, tenantId, evaluationId)
    if (!latestRepository || !latestEvaluation) return response.status(404).json({ error: 'Policy-gate evaluation not found' })
    const reviewConflict = policyGateReviewStateConflict(
      latestEvaluation,
      parsed.data.expectedReviewedAt,
    )
    if (reviewConflict) return response.status(409).json(reviewConflict)
    return response.status(409).json(policyGateReviewConflict(latestRepository, latestEvaluation) ?? {
      error: 'The policy-gate evaluation changed while it was being reviewed. Refresh before deciding.',
      code: 'STALE_POLICY_GATE_EVALUATION',
      evaluationRevision: latestEvaluation.revision,
      currentRevision: latestRepository.lastScanRevision,
    })
  }
  response.json(evaluation)
})
app.get('/api/v1/repositories/:id/test-executions', mayReadCatalog, async (request, response) => {
  const repositoryId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id
  const tenantId = requestIdentity(request)!.tenantId
  const repository = await store.repository(repositoryId, tenantId)
  if (!repository) return response.status(404).json({ error: 'Repository not found' })
  const filter = executionPageFilterSchema.safeParse(request.query)
  if (!filter.success) return response.status(400).json({ error: filter.error.flatten() })
  const cursor = decodeHistoryCursor(filter.data.cursor)
  if (!cursor.success) return response.status(400).json({ error: cursor.error })
  const limit = filter.data.limit
  const executions = await store.testExecutions(repositoryId, tenantId, {
    ...filter.data,
    headRepository: `${repository.owner}/${repository.name}`,
    after: cursor.data,
    limit: limit + 1,
  })
  const cursorItems = executions.map(execution => ({
    ...execution,
    createdAt: testExecutionCursorCreatedAt(execution),
  }))
  const page = historyPage(cursorItems, limit)
  response.json({
    items: page.items.map(({ createdAt: _createdAt, ...execution }) => execution),
    page: page.page,
  })
})
app.get('/api/v1/repositories/:id/test-executions/attempts', mayReadCatalog, async (request, response) => {
  const repositoryId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id
  const tenantId = requestIdentity(request)!.tenantId
  const repository = await store.repository(repositoryId, tenantId)
  if (!repository) return response.status(404).json({ error: 'Repository not found' })
  const filter = executionAttemptHistoryFilterSchema.safeParse(request.query)
  if (!filter.success) return response.status(400).json({ error: filter.error.flatten() })
  const cursor = decodeHistoryCursor(filter.data.cursor)
  if (!cursor.success) return response.status(400).json({ error: cursor.error })
  const { provider, externalRunId, limit } = filter.data
  const attempts = await store.testExecutions(repositoryId, tenantId, {
    provider,
    externalRunId,
    headRepository: `${repository.owner}/${repository.name}`,
    after: cursor.data,
    limit: limit + 1,
  })
  const cursorItems = attempts.map(execution => ({
    ...execution,
    createdAt: testExecutionCursorCreatedAt(execution),
  }))
  const page = historyPage(cursorItems, limit)
  response.json({
    items: page.items.map(({ createdAt: _createdAt, ...execution }) => execution),
    page: page.page,
  })
})
const executionEvidenceRefreshSchema = z.object({
  provider: z.literal('github-actions'),
  externalRunId: z.string().max(500).regex(/^\d+$/),
  attempt: z.number().int().positive(),
}).strict()
app.post('/api/v1/repositories/:id/test-executions/evidence/refresh', mayRunExecution, async (request, response) => {
  const repositoryId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id
  const tenantId = requestIdentity(request)!.tenantId
  const repository = await store.repository(repositoryId, tenantId)
  if (!repository) return response.status(404).json({ error: 'Repository not found' })
  const parsed = executionEvidenceRefreshSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: parsed.error.flatten() })
  if (!repository.installationId) {
    return response.status(409).json({
      error: 'Repository has no GitHub App installation available for artifact discovery',
      code: 'GITHUB_INSTALLATION_REQUIRED',
    })
  }
  const installationId = repository.installationId
  const candidates = await store.testExecutions(repositoryId, tenantId, {
    provider: parsed.data.provider,
    externalRunId: parsed.data.externalRunId,
  })
  const execution = candidates.find(item => item.attempt === parsed.data.attempt)
  if (!execution) return response.status(404).json({ error: 'Test execution attempt not found' })
  if (execution.status === 'running') {
    return response.status(409).json({
      error: 'Artifact evidence can only be refreshed after the execution reaches a terminal state',
      code: 'EXECUTION_NOT_TERMINAL',
    })
  }
  let refreshed: TestExecution
  try {
    refreshed = await refreshExecutionArtifactEvidence(execution, () => githubWorkflowArtifactEvidence({
      owner: repository.owner,
      name: repository.name,
      runId: execution.externalRunId,
      attempt: execution.attempt,
      installationId,
    }), new Date().toISOString(), 'throw')
  } catch (error) {
    const errorCode = error instanceof GitHubArtifactEvidenceError
      ? error.code
      : 'PROVIDER_UNAVAILABLE'
    return response.status(errorCode === 'PROVIDER_TIMEOUT' ? 504 : 502).json({
      error: 'Provider evidence reconciliation failed; previously retained evidence was preserved',
      code: errorCode,
    })
  }
  await store.saveTestExecution(refreshed)
  response.json(refreshed)
})
app.get('/api/v1/repositories/:id/test-executions/:executionId', mayReadCatalog, async (request, response) => {
  const repositoryId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id
  const executionId = Array.isArray(request.params.executionId) ? request.params.executionId[0] : request.params.executionId
  const tenantId = requestIdentity(request)!.tenantId
  const result = await testExecutionDetail(repositoryId, tenantId, executionId, {
    repository: (id, tenant) => store.repository(id, tenant),
    executions: (id, tenant, query) => store.testExecutions(id, tenant, query),
    catalogRevisionForSource: (id, tenant, sourceRevision) =>
      store.catalogRevisionForSource(id, tenant, sourceRevision),
  })
  if (result.status === 404) return response.status(404).json({ error: result.error })
  response.json(result.execution)
})
app.get('/api/v1/repositories/:id/performance-test-executions/latest', mayReadCatalog, async (request, response) => {
  const repositoryId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id
  const tenantId = requestIdentity(request)!.tenantId
  const repository = await store.repository(repositoryId, tenantId)
  if (!repository) return response.status(404).json({ error: 'Repository not found' })
  const artifacts = await store.qualityArtifacts(repositoryId, tenantId, repository.lastScanRevision)
  const workflowPaths = reviewedPerformanceWorkflowPaths(artifacts)
  response.json({ items: await store.latestPerformanceExecutions(repositoryId, tenantId, workflowPaths, repository.defaultBranch, `${repository.owner}/${repository.name}`) })
})
app.get('/api/v1/repositories/:id/integration-test-executions/latest', mayReadCatalog, async (request, response) => {
  const repositoryId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id
  const tenantId = requestIdentity(request)!.tenantId
  const repository = await store.repository(repositoryId, tenantId)
  if (!repository) return response.status(404).json({ error: 'Repository not found' })
  const artifacts = await store.qualityArtifacts(repositoryId, tenantId, repository.lastScanRevision)
  const workflowPaths = reviewedIntegrationWorkflowPaths(artifacts)
  response.json({ items: await store.latestIntegrationExecutions(repositoryId, tenantId, workflowPaths, repository.defaultBranch, `${repository.owner}/${repository.name}`) })
})
app.get('/api/v1/repositories/:id/post-production-test-executions/latest', mayReadCatalog, async (request, response) => {
  const repositoryId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id
  const tenantId = requestIdentity(request)!.tenantId
  const repository = await store.repository(repositoryId, tenantId)
  if (!repository) return response.status(404).json({ error: 'Repository not found' })
  const artifacts = await store.qualityArtifacts(repositoryId, tenantId, repository.lastScanRevision)
  const workflowPaths = reviewedPostProductionWorkflowPaths(artifacts)
  response.json({ items: await store.latestPostProductionExecutions(repositoryId, tenantId, workflowPaths, repository.defaultBranch, `${repository.owner}/${repository.name}`) })
})
app.get('/api/v1/repositories/:id/test-suite-dispatches/latest', mayReadCatalog, async (request, response) => {
  const repositoryId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id
  const tenantId = requestIdentity(request)!.tenantId
  if (!await store.repository(repositoryId, tenantId)) return response.status(404).json({ error: 'Repository not found' })
  const filter = historyPageQuerySchema.safeParse(request.query)
  if (!filter.success) return response.status(400).json({ error: filter.error.flatten() })
  const cursor = decodeUuidHistoryCursor(filter.data.cursor)
  if (!cursor.success) return response.status(400).json({ error: cursor.error })
  const items = await store.latestTestSuiteDispatches(repositoryId, tenantId, {
    after: cursor.data,
    limit: filter.data.limit + 1,
  })
  response.json(testSuiteDispatchPage(items, filter.data.limit))
})
app.get('/api/v1/repositories/:id/test-suites/:artifactId/dispatches', mayReadCatalog, async (request, response) => {
  const repositoryId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id
  const artifactId = Array.isArray(request.params.artifactId) ? request.params.artifactId[0] : request.params.artifactId
  const tenantId = requestIdentity(request)!.tenantId
  const repository = await store.repository(repositoryId, tenantId)
  if (!repository) return response.status(404).json({ error: 'Repository not found' })
  const artifacts = await store.qualityArtifacts(repositoryId, tenantId, repository.lastScanRevision)
  let artifactLogicalId = testSuiteDispatchLogicalId(artifactId, artifacts, [])
  if (!artifactLogicalId) {
    artifactLogicalId = await store.testSuiteDispatchLogicalId(repositoryId, tenantId, artifactId)
  }
  if (!artifactLogicalId) {
    return response.status(404).json({ error: 'Test suite not found' })
  }
  const filter = historyPageQuerySchema.safeParse(request.query)
  if (!filter.success) return response.status(400).json({ error: filter.error.flatten() })
  const cursor = decodeUuidHistoryCursor(filter.data.cursor)
  if (!cursor.success) return response.status(400).json({ error: cursor.error })
  const history = await store.testSuiteDispatchHistory(repositoryId, tenantId, artifactLogicalId, {
    after: cursor.data,
    limit: filter.data.limit + 1,
  })
  response.json(testSuiteDispatchPage(history, filter.data.limit))
})
app.get('/api/v1/repositories/:id/execution-trend', mayReadCatalog, async (request, response) => {
  const repositoryId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id
  const tenantId = requestIdentity(request)!.tenantId
  const repository = await store.repository(repositoryId, tenantId)
  if (!repository) return response.status(404).json({ error: 'Repository not found' })
  const filter = executionPageFilterSchema.safeParse(request.query)
  if (!filter.success) return response.status(400).json({ error: filter.error.flatten() })
  const cursor = decodeExecutionTrendCursor(filter.data.cursor)
  if (!cursor.success) return response.status(400).json({ error: cursor.error })
  const { cursor: _cursor, limit, ...query } = filter.data
  const snapshotAt = cursor.data?.snapshotAt ?? new Date().toISOString()
  const items = await store.executionOutcomeTrend(repositoryId, tenantId, {
    ...query,
    headRepository: `${repository.owner}/${repository.name}`,
    beforeDate: cursor.data?.date,
    snapshotAt,
    limit: limit + 1,
  })
  response.json(executionTrendPage(items, limit, snapshotAt))
})
app.get('/api/v1/repositories/:id/execution-performance', mayReadCatalog, async (request, response) => {
  const repositoryId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id
  const tenantId = requestIdentity(request)!.tenantId
  const repository = await store.repository(repositoryId, tenantId)
  if (!repository) return response.status(404).json({ error: 'Repository not found' })
  const filter = executionPerformanceFilterSchema.safeParse(request.query)
  if (!filter.success) return response.status(400).json({ error: filter.error.flatten() })
  const cursor = decodePerformanceCursor(filter.data.cursor)
  if (!cursor.success) return response.status(400).json({ error: cursor.error })
  const { cursor: _cursor, limit, ...query } = filter.data
  const snapshotAt = cursor.data?.snapshotAt ?? new Date().toISOString()
  const items = await store.policyGatePerformance(repositoryId, tenantId, {
    ...query,
    headRepository: `${repository.owner}/${repository.name}`,
    snapshotAt,
    after: cursor.data,
    limit: limit + 1,
  })
  const enriched = await enrichPerformanceEvidence(
    repositoryId,
    tenantId,
    items,
    { sourceRevision: query.revision, currentCatalogRevision: repository.lastScanRevision },
    {
      catalogRevisionForSource: (id, tenant, sourceRevision) =>
        store.catalogRevisionForSource(id, tenant, sourceRevision),
      qualityArtifactsByIds: (id, tenant, ids, catalogRevision) =>
        store.qualityArtifactsByIds(id, tenant, ids, catalogRevision),
    },
  )
  response.json(performancePage(enriched, limit, undefined, snapshotAt))
})
app.post('/api/v1/repositories/:id/test-suites/:artifactId/execute', mayRunExecution, async (request, response) => {
  const parsed = performanceTestRequestSchema.safeParse({ artifactId: request.params.artifactId })
  if (!parsed.success) return response.status(400).json({ error: parsed.error.flatten() })
  const body = workflowDispatchRequestSchema.safeParse(request.body ?? {})
  if (!body.success) return response.status(400).json({ error: body.error.flatten() })
  const repositoryId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id
  const tenantId = requestIdentity(request)!.tenantId
  const repository = await store.repository(repositoryId, tenantId)
  if (!repository) return response.status(404).json({ error: 'Repository not found' })
  const artifacts = await store.qualityArtifacts(repositoryId, tenantId, repository.lastScanRevision)
  const artifact = artifacts.find(item => item.id === parsed.data.artifactId)
  const workflowPath = artifact ? executableWorkflowTarget(artifact) : undefined
  if (!artifact || !['integration-test', 'post-production-test', 'load-test', 'stress-test'].includes(artifact.kind)) {
    return response.status(404).json({ error: 'Executable test suite not found' })
  }
  if (!isPreferredWorkflowExecutionArtifact(artifact, artifacts)) return response.status(422).json({
    error: 'This workflow is represented by a higher-priority reviewed suite classification',
    code: 'TEST_WORKFLOW_CLASSIFICATION_CONFLICT',
  })
  if (!workflowPath) return response.status(422).json({ error: 'Test definition is not a scanner-verified workflow_dispatch workflow', code: 'TEST_WORKFLOW_NOT_DISPATCHABLE' })
  const dispatchInputs = validateWorkflowDispatchInputs(artifact, body.data.inputs)
  if (!dispatchInputs.success) return response.status(422).json({
    error: 'Workflow dispatch inputs must exactly match the required analyzed inputs',
    code: 'TEST_WORKFLOW_INPUTS_INVALID',
    missingInputs: dispatchInputs.missing,
    unexpectedInputs: dispatchInputs.unexpected,
  })
  const sourceRevision = testSuiteDispatchRevision(repository)
  if (!sourceRevision) return response.status(409).json({ error: 'An exact analyzed source revision is required before dispatch', code: 'ANALYSIS_SOURCE_REVISION_REQUIRED' })
  if (!repository.installationId) return response.status(422).json({ error: 'GitHub App installation is required', code: 'INSTALLATION_REQUIRED' })
  const identity = requestIdentity(request)!
  const dispatch: TestSuiteDispatch = {
    id: randomUUID(),
    repositoryId,
    tenantId,
    artifactId: artifact.id,
    artifactLogicalId: artifact.logicalId ?? artifact.id,
    artifactKind: artifact.kind as TestSuiteDispatch['artifactKind'],
    workflowPath,
    ref: repository.defaultBranch,
    sourceRevision,
    requestedBy: identity.userId,
    inputNames: Object.keys(dispatchInputs.inputs).sort(),
    status: 'dispatching',
    requestedAt: new Date().toISOString(),
  }
  try {
    await store.saveTestSuiteDispatch(dispatch)
  } catch {
    return response.status(503).json({ error: 'Dispatch audit storage is unavailable; the workflow was not dispatched', code: 'TEST_DISPATCH_AUDIT_UNAVAILABLE' })
  }
  let receipt: Awaited<ReturnType<typeof dispatchTestWorkflow>>
  try {
    receipt = await dispatchTestWorkflow({ owner: repository.owner, name: repository.name, sourceRevision, sourceRef: repository.defaultBranch, installationId: repository.installationId, workflowPath, inputs: dispatchInputs.inputs })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const auditPersistence = await persistTerminalTestSuiteDispatch(
      terminalDispatch => store.saveTestSuiteDispatch(terminalDispatch),
      { ...dispatch, status: 'failed', error: message.slice(0, 2000), completedAt: new Date().toISOString() },
    )
    return response.status(422).json({ error: message, code: 'TEST_DISPATCH_FAILED', auditPersistence })
  }
  const accepted = { ...dispatch, status: 'accepted' as const, ref: receipt.ref, sourceRevision: receipt.sourceRevision, completedAt: new Date().toISOString() }
  const auditPersistence = await persistTerminalTestSuiteDispatch(
    terminalDispatch => store.saveTestSuiteDispatch(terminalDispatch),
    accepted,
  )
  response.status(202).json({ status: 'dispatched', artifactId: artifact.id, artifactKind: artifact.kind, workflowPath, ref: receipt.ref, sourceRevision: receipt.sourceRevision, auditPersistence, dispatch: accepted })
})
app.post('/api/v1/repositories/:id/performance-tests/:artifactId/execute', mayRunExecution, async (request, response) => {
  const parsed = performanceTestRequestSchema.safeParse({ artifactId: request.params.artifactId })
  if (!parsed.success) return response.status(400).json({ error: parsed.error.flatten() })
  const body = workflowDispatchRequestSchema.safeParse(request.body ?? {})
  if (!body.success) return response.status(400).json({ error: body.error.flatten() })
  const repositoryId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id
  const tenantId = requestIdentity(request)!.tenantId
  const repository = await store.repository(repositoryId, tenantId)
  if (!repository) return response.status(404).json({ error: 'Repository not found' })
  const artifacts = await store.qualityArtifacts(repositoryId, tenantId, repository.lastScanRevision)
  const artifact = artifacts.find(item => item.id === parsed.data.artifactId)
  if (!artifact || !['load-test', 'stress-test'].includes(artifact.kind)) return response.status(404).json({ error: 'Performance test not found' })
  if (!isPreferredWorkflowExecutionArtifact(artifact, artifacts)) return response.status(422).json({
    error: 'This workflow is represented by a higher-priority reviewed suite classification',
    code: 'PERFORMANCE_WORKFLOW_CLASSIFICATION_CONFLICT',
  })
  const workflowPath = performanceWorkflowTarget(artifact)
  if (!workflowPath) return response.status(422).json({ error: 'Performance definition is not a scanner-verified workflow_dispatch workflow', code: 'PERFORMANCE_WORKFLOW_NOT_DISPATCHABLE' })
  const dispatchInputs = validateWorkflowDispatchInputs(artifact, body.data.inputs)
  if (!dispatchInputs.success) return response.status(422).json({
    error: 'Workflow dispatch inputs must exactly match the required analyzed inputs',
    code: 'PERFORMANCE_WORKFLOW_INPUTS_INVALID',
    missingInputs: dispatchInputs.missing,
    unexpectedInputs: dispatchInputs.unexpected,
  })
  const sourceRevision = performanceDispatchRevision(repository)
  if (!sourceRevision) return response.status(409).json({ error: 'An exact analyzed source revision is required before dispatch', code: 'ANALYSIS_SOURCE_REVISION_REQUIRED' })
  if (!repository.installationId) return response.status(422).json({ error: 'GitHub App installation is required', code: 'INSTALLATION_REQUIRED' })
  const identity = requestIdentity(request)!
  const dispatch: TestSuiteDispatch = {
    id: randomUUID(),
    repositoryId,
    tenantId,
    artifactId: artifact.id,
    artifactLogicalId: artifact.logicalId ?? artifact.id,
    artifactKind: artifact.kind as TestSuiteDispatch['artifactKind'],
    workflowPath,
    ref: repository.defaultBranch,
    sourceRevision,
    requestedBy: identity.userId,
    inputNames: Object.keys(dispatchInputs.inputs).sort(),
    status: 'dispatching',
    requestedAt: new Date().toISOString(),
  }
  try {
    await store.saveTestSuiteDispatch(dispatch)
  } catch {
    return response.status(503).json({ error: 'Dispatch audit storage is unavailable; the workflow was not dispatched', code: 'PERFORMANCE_DISPATCH_AUDIT_UNAVAILABLE' })
  }
  let receipt: Awaited<ReturnType<typeof dispatchPerformanceWorkflow>>
  try {
    receipt = await dispatchPerformanceWorkflow({ owner: repository.owner, name: repository.name, sourceRevision, sourceRef: repository.defaultBranch, installationId: repository.installationId, workflowPath, inputs: dispatchInputs.inputs })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const auditPersistence = await persistTerminalTestSuiteDispatch(
      terminalDispatch => store.saveTestSuiteDispatch(terminalDispatch),
      { ...dispatch, status: 'failed', error: message.slice(0, 2000), completedAt: new Date().toISOString() },
    )
    return response.status(422).json({ error: message, code: 'PERFORMANCE_DISPATCH_FAILED', auditPersistence })
  }
  const accepted = { ...dispatch, status: 'accepted' as const, ref: receipt.ref, sourceRevision: receipt.sourceRevision, completedAt: new Date().toISOString() }
  const auditPersistence = await persistTerminalTestSuiteDispatch(
    terminalDispatch => store.saveTestSuiteDispatch(terminalDispatch),
    accepted,
  )
  response.status(202).json({ status: 'dispatched', artifactId: artifact.id, workflowPath, ref: receipt.ref, sourceRevision: receipt.sourceRevision, auditPersistence, dispatch: accepted })
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
      await saveScanWithExecutionReconciliation(result)
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
app.get('/api/v1/repositories/:id/processing-status', mayReadRepositories, async (request, response) => {
  const tenantId = requestIdentity(request)!.tenantId
  const repositoryId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id
  const repository = await store.repository(repositoryId, tenantId)
  if (!repository) return response.status(404).json({ error: 'Repository not found' })
  response.json(repositoryProcessingStatus(repository))
})
app.post('/api/v1/repositories/:id/analysis-retries', mayScanRepositories, async (request, response) => {
  const tenantId = requestIdentity(request)!.tenantId
  const repositoryId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id
  const repository = await store.queueRepositoryAnalysis(repositoryId, tenantId)
  if (!repository) return response.status(409).json({ error: 'Only a failed current-revision analysis can be retried', code: 'ANALYSIS_NOT_RETRYABLE' })
  response.status(202).json(repositoryProcessingStatus(repository))
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
  await saveScanWithExecutionReconciliation(request.body)
  response.status(202).json({ accepted: true })
})
app.post('/api/v1/internal/intelligence/results', async (request, response) => {
  await store.saveIntelligence(request.body.results ?? [], request.body.sync)
  response.status(202).json({ accepted: true })
})
app.post('/api/v1/internal/intelligence/failure', async (request, response) => {
  const failure = intelligenceFailureSchema.parse(request.body)
  await store.markSyncFailed(failure.sourceType, failure.sourceKey, failure.tenantId, failure.code)
  console.error(JSON.stringify({ event: 'intelligence_sync_failed', tenantId: failure.tenantId, sourceType: failure.sourceType, sourceKey: failure.sourceKey, code: failure.code, retryable: true }))
  response.status(202).json({ accepted: true })
})
app.get('/api/v1/requirements/freshness', mayReadRequirements, async (request, response) =>
  response.json(await store.syncCursor('jira', 'default', requestIdentity(request)!.tenantId) ?? { sourceType: 'jira', sourceKey: 'default', freshnessStatus: 'unknown' })
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
  const serviceRequest = isFuzeQualityServiceRequest(request)
  const tenantIds = serviceRequest
    ? await store.activeTenantIds()
    : [requestIdentity(request)!.tenantId]
  const scopeId = request.body?.scopeId ?? 'default'
  const queued = await queueRequirementSync(
    tenantIds,
    scopeId,
    request.body?.jql ?? process.env.JIRA_JQL ?? 'project = FUZE',
    {
      syncCursor: tenantId => store.syncCursor('jira', scopeId, tenantId),
      publish: (topic, payload) => events.publish(topic, payload),
      markQueued: tenantId => store.markSyncQueued('jira', scopeId, tenantId),
    },
  )
  if (serviceRequest) {
    return response.status(202).json({ status: 'queued', scopeId, tenantsQueued: queued.length })
  }
  response.status(202).json({ status: 'queued', scopeId, incrementalFrom: queued[0]?.incrementalFrom, sync: queued[0].sync })
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
    let executionWithEvidence: typeof execution & {
      evidenceCollection?: TestExecution['evidenceCollection']
    } = execution
    if (execution.status !== 'running' && repository.installationId) {
      const checkedAt = new Date().toISOString()
      const installationId = repository.installationId
      executionWithEvidence = await refreshExecutionArtifactEvidence(
        execution,
        () => githubWorkflowArtifactEvidence({
          owner: repository.owner,
          name: repository.name,
          runId: execution.externalRunId,
          attempt: execution.attempt,
          installationId,
        }),
        checkedAt,
      )
      if (executionWithEvidence.evidenceCollection?.status === 'unavailable') {
        console.warn(JSON.stringify({
          event: 'github_workflow_artifact_discovery_failed',
          repositoryId: repository.id,
          externalRunId: execution.externalRunId,
          errorCode: executionWithEvidence.evidenceCollection.errorCode,
        }))
      }
    }
    const links = await linkExecutionToRevisionArtifacts(
      executionWithEvidence,
      repository.tenantId,
      (repositoryId, tenantId, sourceRevision) =>
        store.catalogRevisionForSource(repositoryId, tenantId, sourceRevision),
      (repositoryId, tenantId, revision) =>
        store.qualityArtifacts(repositoryId, tenantId, revision)
    )
    await store.saveTestExecution(webhookExecutionRecord(executionWithEvidence, repository.tenantId, links))
  }
  const queued = await dispatchWebhookScans(commands, repositories, { store, repositoryAccess, events })
  response.status(202).json({ accepted: true, delivery: headers.data.delivery, queued, executions: workflowExecutions.length })
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
