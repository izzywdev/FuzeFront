import express from 'express'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  TOPICS,
  repositoryInputSchema,
  reviewDecisionSchema,
  testImplementationRequestSchema,
  type OrganizationQualitySummary,
  type Portfolio,
} from '@fuzequality/contracts'
import {
  apiCoverageCatalog,
  coverageSummary,
  createCatalogStore,
  createEventBus,
  repositoryCatalogStatus,
} from '@fuzequality/core'
import { scanRepository } from '@fuzequality/scanner'
import {
  githubWebhookHeadersSchema,
  verifyGithubWebhook,
  webhookScanCommands,
} from '@fuzequality/github-app'
import { githubInstallationToken } from '../../workers/src/github'
import { createGitHubAccessVerifier, publicAccessError } from './repository-onboarding'
import { requestIdentity, requirePlatformAdminPermission, requirePlatformPermission } from './platform-authorization'
import { isPlatformAuthenticatedRequest, isPublicRequest } from './authentication'
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
const mayReadRepositories = requirePlatformPermission('fuzequality.Repository', 'read')
const mayManageRepositories = requirePlatformPermission('fuzequality.Repository', 'onboard')
const mayScanRepositories = requirePlatformPermission('fuzequality.Repository', 'scan')
const mayReadCatalog = requirePlatformPermission('fuzequality.Evidence', 'read')
const mayReadRequirements = requirePlatformPermission('fuzequality.Evidence', 'read')
const mayReviewSuggestions = requirePlatformPermission('fuzequality.Evidence', 'export')
const maySyncRequirements = requirePlatformPermission('fuzequality.Evidence', 'export')
const mayCreateTestImplementation = requirePlatformPermission('fuzequality.TestImplementation', 'create')
const mayReadTestImplementation = requirePlatformPermission('fuzequality.TestImplementation', 'read')
const mayReadOrganizationAccess = requirePlatformPermission('fuzequality.OrganizationAccess', 'read')
const mayManageOrganizationAccess = requirePlatformPermission('fuzequality.OrganizationAccess', 'manage')
const mayManageRepositoryAdministration = requirePlatformPermission('fuzequality.RepositoryAdministration', 'manage')
const mayAdministerPlatform = requirePlatformAdminPermission('fuzequality.PlatformAdministration', 'read')
const adminContextSchema = z.object({ reason: z.string().trim().min(3).max(500) }).strict()
const organizationRoleSchema = z.enum(['owner', 'admin', 'member', 'viewer'])
const invitationSchema = z.object({
  email: z.string().trim().email(),
  role: organizationRoleSchema,
}).strict()
const memberRoleSchema = z.object({ role: organizationRoleSchema }).strict()
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

app.use(express.json({
  limit: '2mb',
  verify: (request, _response, buffer) => {
    ;(request as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer)
  },
}))

app.use((request, response, next) => {
  const configuredToken = process.env.FUZEQUALITY_API_TOKEN
  const authorization = request.headers.authorization
  if (
    !configuredToken ||
    isPublicRequest(request.method, request.path) ||
    authorization === `Bearer ${configuredToken}` ||
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

app.get('/health/live', (_request, response) => response.json({ status: 'ok' }))
app.get('/health/ready', (_request, response) => response.json({ status: 'ready' }))
app.get('/metrics', async (_request, response) => {
  const portfolio = await store.portfolio()
  response.type('text/plain').send(
    [
      '# HELP fuzequality_repositories Number of onboarded repositories',
      '# TYPE fuzequality_repositories gauge',
      `fuzequality_repositories ${portfolio.repositories.length}`,
      '# HELP fuzequality_open_findings Number of open catalog findings',
      '# TYPE fuzequality_open_findings gauge',
      `fuzequality_open_findings ${portfolio.findings.filter(item => item.status === 'open').length}`,
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
app.get('/api/v1/repositories', mayReadRepositories, async (request, response) =>
  response.json((await store.portfolio(requestIdentity(request)!.tenantId)).repositories)
)
app.get('/api/v1/repositories/:id', mayReadRepositories, async (request, response) => {
  const repositoryId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id
  const repository = await store.repository(repositoryId, requestIdentity(request)!.tenantId)
  if (!repository) return response.status(404).json({ error: 'Repository not found' })
  response.json(repository)
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
app.get('/api/v1/suggestions', mayReadRequirements, async (request, response) =>
  response.json((await store.portfolio(requestIdentity(request)!.tenantId)).suggestions)
)
app.post('/api/v1/suggestions/:id/decision', mayReviewSuggestions, async (request, response) => {
  const parsed = reviewDecisionSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: parsed.error.flatten() })
  const suggestionId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id
  const suggestion = await store.decideSuggestion(suggestionId, parsed.data.decision)
  if (!suggestion) return response.status(404).json({ error: 'Suggestion not found' })
  await events.publish(TOPICS.MAPPING_REVIEWED, { suggestionId: suggestion.id, decision: parsed.data.decision }, suggestion.id)
  response.json(suggestion)
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
  await store.saveIntelligence(request.body.results ?? [])
  response.status(202).json({ accepted: true })
})
app.post('/api/v1/internal/coverage/rebuild', async (_request, response) => {
  response.status(202).json({ accepted: true, rebuiltAt: new Date().toISOString() })
})

app.post('/api/v1/jira/sync', maySyncRequirements, async (request, response) => {
  await events.publish(TOPICS.REQUIREMENT_SYNC_REQUESTED, {
    scopeId: request.body?.scopeId ?? 'default',
    jql: request.body?.jql ?? process.env.JIRA_JQL ?? 'project = FUZE',
  })
  response.status(202).json({ status: 'queued' })
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
  response.status(202).json({ accepted: true, delivery: headers.data.delivery, queued: commands.length })
})

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  console.error(error)
  response.status(500).json({ error: 'Unexpected service error' })
})

app.listen(port, () => console.log(`FuzeQuality API listening on ${port}`))
