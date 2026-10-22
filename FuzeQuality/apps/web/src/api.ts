import type {
  AdminTenantContext,
  OrganizationQualitySummary,
  Portfolio,
  QualityArtifact,
  QualityArtifactPage,
  TestImplementationRequest,
} from '@fuzequality/contracts'
import type { Identity } from '@fuzefront/security-client'

export type OrganizationRole = 'owner' | 'admin' | 'member' | 'viewer'
export type OrganizationMember = { id: string; email?: string; name?: string; displayName?: string; userId?: string; user_id?: string; role: OrganizationRole; status?: string; user?: { id?: string; email?: string; name?: string; displayName?: string; firstName?: string; lastName?: string } }

export function normalizeOrganizationMember(member: OrganizationMember): OrganizationMember {
  const nestedName = member.user ? [member.user.firstName, member.user.lastName].filter(Boolean).join(' ') : ''
  return { ...member, email: member.email ?? member.user?.email, displayName: member.displayName ?? member.user?.displayName ?? (nestedName || undefined), userId: member.userId ?? member.user_id ?? member.user?.id }
}


// Standalone access stays same-origin. A federated remote is rendered at
// app.fuzefront.com/app/fuzequality, where its companion ingress mount proxies
// /apps/fuzequality/api straight to this application's frontend and backend.
// Keeping this request same-origin preserves the portal session and avoids the
// Cloudflare Access/CORS boundary around the standalone admin host.
const portalApiBase = typeof window !== 'undefined' && window.location.pathname.startsWith('/app/fuzequality')
  ? '/apps/fuzequality'
  : ''
const API_BASE = (portalApiBase || import.meta.env.VITE_FUZEQUALITY_API_URL || '').replace(/\/$/, '')
const REQUEST_TIMEOUT_MS = 15_000
type TokenProvider = () => string | null | undefined
let platformToken: TokenProvider | undefined
let platformTenant: TokenProvider | undefined

function portalToken(): string | null | undefined {
  const context = (window as Window & {
    __FRONTFUSE_CONTEXT__?: { getAccessToken?: TokenProvider }
  }).__FRONTFUSE_CONTEXT__
  return context?.getAccessToken?.()
}

function portalTenant(): string | null {
  const hostWindow = window as Window & {
    __FUZEFRONT__?: { getContext?: () => { tenantId?: string | null; activeOrganization?: { id: string } | null } }
    __FRONTFUSE_CONTEXT__?: { session?: { tenantId?: string | null } | null }
  }
  const context = hostWindow.__FUZEFRONT__?.getContext?.()
  // The aggregate runtime bridge is canonical. The federation loader context
  // is an equivalent host-owned fallback during the short interval before the
  // bridge's React effect publishes its first organization snapshot.
  return context?.tenantId
    ?? context?.activeOrganization?.id
    ?? hostWindow.__FRONTFUSE_CONTEXT__?.session?.tenantId
    ?? platformTenant?.()
    ?? null
}

/**
 * Receives the portal account-vault token from the Module Federation host.
 * A remote must never read the host's storage directly: the host remains the
 * sole owner of multi-account session selection and token refresh.
 */
export function configurePlatformSecurity(getToken?: TokenProvider, getTenantId?: TokenProvider) {
  platformToken = getToken
  platformTenant = getTenantId
}

export type PlatformSession = Pick<Identity, 'userId' | 'tenantId' | 'roles'>
type ApiFailure = { error?: string; code?: string }

export class CatalogApiError extends Error {
  constructor(message: string, readonly code?: string, readonly status?: number) {
    super(message)
    this.name = 'CatalogApiError'
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const token = platformToken?.() ?? portalToken()
    const tenant = portalTenant()
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(tenant ? { 'x-fuzefront-tenant-id': tenant } : {}),
        ...init?.headers,
      },
    })
    if (!response.ok) {
      const error = await response.json().catch(() => null) as ApiFailure | null
      throw new CatalogApiError(
        error?.error ?? `Request failed: ${response.status}`,
        error?.code,
        response.status
      )
    }
    return response.json() as Promise<T>
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`Catalog API timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds`)
    }
    throw error
  } finally {
    window.clearTimeout(timeout)
  }
}

async function qualityArtifacts(id: string, revision?: string, cursor?: string): Promise<QualityArtifactPage | QualityArtifact[]> {
  const query = new URLSearchParams()
  if (revision) query.set('revision', revision)
  if (cursor) query.set('cursor', cursor)
  return request<QualityArtifactPage | QualityArtifact[]>(
    `/api/v1/repositories/${id}/quality-artifacts${query.size ? `?${query}` : ''}`
  )
}

export const api = {
  portfolio: () => request<Portfolio>('/api/v1/portfolio'),
  requirementFreshness: () => request<{ freshnessStatus: 'unknown' | 'fresh' | 'stale' | 'failed'; lastSuccessAt?: string }>('/api/v1/requirements/freshness'),
  addRepository: (value: Record<string, unknown>) =>
    request('/api/v1/repositories', { method: 'POST', body: JSON.stringify(value) }),
  repositoryScanHistory: (id: string, cursor?: string) => request<import('@fuzequality/contracts').RepositoryScanHistoryPage | import('@fuzequality/contracts').RepositoryScanHistoryEntry[]>(`/api/v1/repositories/${id}/scan-history${cursor ? `?${new URLSearchParams({ cursor })}` : ''}`),
  qualityArtifacts,
  qualityArtifactsByIds: (id: string, artifactIds: string[], revision?: string) => {
    const query = new URLSearchParams()
    if (revision) query.set('revision', revision)
    artifactIds.forEach(artifactId => query.append('id', artifactId))
    return request<{ items: import('@fuzequality/contracts').QualityArtifact[] }>(
      `/api/v1/repositories/${id}/quality-artifacts/by-ids?${query}`
    )
  },
  repositoryFlowCandidates: (id: string, filter: Record<string, string> = {}) => request<import('@fuzequality/contracts').RepositoryFlowCandidatePage | import('@fuzequality/contracts').RepositoryFlowCandidate[]>(`/api/v1/repositories/${id}/flow-candidates?${new URLSearchParams(filter)}`),
  repositoryFlowCandidate: (repositoryId: string, candidateId: string) => request<import('@fuzequality/contracts').RepositoryFlowCandidate>(`/api/v1/repositories/${repositoryId}/flow-candidates/${candidateId}`),
  reviewRepositoryFlowCandidate: (repositoryId: string, candidateId: string, status: 'confirmed' | 'rejected', reason?: string, expectedReviewedAt?: string | null) => request<import('@fuzequality/contracts').RepositoryFlowCandidate>(`/api/v1/repositories/${repositoryId}/flow-candidates/${candidateId}/review`, { method: 'POST', body: JSON.stringify({ status, ...(reason ? { reason } : {}), ...(expectedReviewedAt !== undefined ? { expectedReviewedAt } : {}) }) }),
  repositoryFlowReviewHistory: (repositoryId: string, candidateId: string, cursor?: string) => request<import('@fuzequality/contracts').RepositoryFlowReviewHistoryPage | import('@fuzequality/contracts').RepositoryFlowReviewHistoryEntry[]>(`/api/v1/repositories/${repositoryId}/flow-candidates/${candidateId}/history${cursor ? `?${new URLSearchParams({ cursor })}` : ''}`),
  policyGateEvaluations: (id: string, filter: Record<string, string> = {}) => request<import('@fuzequality/contracts').PolicyGateEvaluationPage | import('@fuzequality/contracts').PolicyGateEvaluation[]>(`/api/v1/repositories/${id}/policy-gate-evaluations?${new URLSearchParams(filter)}`),
  policyGateEvaluation: (repositoryId: string, evaluationId: string) => request<import('@fuzequality/contracts').PolicyGateEvaluation>(`/api/v1/repositories/${repositoryId}/policy-gate-evaluations/${evaluationId}`),
  policyGateReviewHistory: (repositoryId: string, evaluationId: string, cursor?: string) => request<import('@fuzequality/contracts').PolicyGateReviewHistoryPage | import('@fuzequality/contracts').PolicyGateReviewHistoryEntry[]>(`/api/v1/repositories/${repositoryId}/policy-gate-evaluations/${evaluationId}/history${cursor ? `?${new URLSearchParams({ cursor })}` : ''}`),
  reviewPolicyGateEvaluation: (repositoryId: string, evaluationId: string, status: 'accepted' | 'dismissed', reason?: string, expectedReviewedAt?: string | null) => request<import('@fuzequality/contracts').PolicyGateEvaluation>(`/api/v1/repositories/${repositoryId}/policy-gate-evaluations/${evaluationId}/review`, { method: 'POST', body: JSON.stringify({ status, ...(reason ? { reason } : {}), ...(expectedReviewedAt !== undefined ? { expectedReviewedAt } : {}) }) }),
  testExecutions: (id: string, filter: Record<string, string> = {}) => request<import('@fuzequality/contracts').TestExecutionPage | import('@fuzequality/contracts').TestExecution[]>(`/api/v1/repositories/${id}/test-executions?${new URLSearchParams(filter)}`),
  testExecution: (repositoryId: string, executionId: string) => request<import('@fuzequality/contracts').TestExecutionDetail>(`/api/v1/repositories/${repositoryId}/test-executions/${encodeURIComponent(executionId)}`),
  testExecutionAttempts: (id: string, provider: import('@fuzequality/contracts').TestExecution['provider'], externalRunId: string, cursor?: string) => request<import('@fuzequality/contracts').TestExecutionPage | import('@fuzequality/contracts').TestExecution[]>(`/api/v1/repositories/${id}/test-executions/attempts?${new URLSearchParams({ provider, externalRunId, ...(cursor ? { cursor } : {}) })}`),
  refreshTestExecutionEvidence: (id: string, execution: Pick<import('@fuzequality/contracts').TestExecution, 'provider' | 'externalRunId' | 'attempt'>) => request<import('@fuzequality/contracts').TestExecution>(`/api/v1/repositories/${id}/test-executions/evidence/refresh`, {
    method: 'POST',
    body: JSON.stringify(execution),
  }),
  latestPerformanceExecutions: (id: string) => request<{ items: import('@fuzequality/contracts').TestExecution[] }>(`/api/v1/repositories/${id}/performance-test-executions/latest`),
  latestIntegrationExecutions: (id: string) => request<{ items: import('@fuzequality/contracts').TestExecution[] }>(`/api/v1/repositories/${id}/integration-test-executions/latest`),
  latestPostProductionExecutions: (id: string) => request<{ items: import('@fuzequality/contracts').TestExecution[] }>(`/api/v1/repositories/${id}/post-production-test-executions/latest`),
  latestTestSuiteDispatches: (id: string) => request<{ items: import('@fuzequality/contracts').TestSuiteDispatch[] }>(`/api/v1/repositories/${id}/test-suite-dispatches/latest`),
  testSuiteDispatchHistory: (repositoryId: string, artifactId: string, cursor?: string) => request<import('@fuzequality/contracts').TestSuiteDispatchPage>(`/api/v1/repositories/${repositoryId}/test-suites/${encodeURIComponent(artifactId)}/dispatches${cursor ? `?${new URLSearchParams({ cursor })}` : ''}`),
  executionTrend: (id: string, filter: Record<string, string> = {}) => request<{
    items: import('@fuzequality/core').ExecutionOutcomeTrend[]
    page: { nextCursor: string | null; hasMore: boolean }
  } | import('@fuzequality/core').ExecutionOutcomeTrend[]>(`/api/v1/repositories/${id}/execution-trend?${new URLSearchParams(filter)}`),
  executionPerformance: (id: string, filter: Record<string, string> = {}) => request<import('@fuzequality/core').PolicyGatePerformancePage | import('@fuzequality/core').PolicyGatePerformance[]>(`/api/v1/repositories/${id}/execution-performance?${new URLSearchParams(filter)}`),
  runPerformanceTest: (repositoryId: string, artifactId: string, inputs: Record<string, string> = {}) => request<{
    status: 'dispatched'
    artifactId: string
    workflowPath: string
    ref: string
    sourceRevision: string
    dispatch: import('@fuzequality/contracts').TestSuiteDispatch
  }>(`/api/v1/repositories/${repositoryId}/performance-tests/${artifactId}/execute`, {
    method: 'POST',
    body: JSON.stringify({ inputs }),
  }),
  runTestSuite: (repositoryId: string, artifactId: string, inputs: Record<string, string> = {}) => request<{
    status: 'dispatched'
    artifactId: string
    artifactKind: 'integration-test' | 'post-production-test' | 'load-test' | 'stress-test'
    workflowPath: string
    ref: string
    sourceRevision: string
    dispatch: import('@fuzequality/contracts').TestSuiteDispatch
  }>(`/api/v1/repositories/${repositoryId}/test-suites/${artifactId}/execute`, {
    method: 'POST',
    body: JSON.stringify({ inputs }),
  }),
  scanRepository: (id: string, localPath?: string) =>
    request(`/api/v1/repositories/${id}/scans`, {
      method: 'POST',
      body: JSON.stringify({ localPath }),
    }),
  repositoryProcessingStatus: (id: string) => request<import('@fuzequality/contracts').RepositoryProcessingStatus>(`/api/v1/repositories/${id}/processing-status`),
  retryRepositoryAnalysis: (id: string) => request<import('@fuzequality/contracts').RepositoryProcessingStatus>(`/api/v1/repositories/${id}/analysis-retries`, { method: 'POST' }),
  decideSuggestion: (id: string, value: Record<string, unknown>) =>
    request(`/api/v1/suggestions/${id}/decision`, {
      method: 'POST',
      body: JSON.stringify(value),
    }),
  suggestionDecisions: (id: string) => request(`/api/v1/suggestions/${id}/decisions`),
  verifyRepository: (value: Record<string, unknown>) =>
    request('/api/v1/repositories/verify', { method: 'POST', body: JSON.stringify(value) }),
  updateRepositoryAdministration: (id: string, value: Record<string, unknown>) =>
    request(`/api/v1/repositories/${id}/administration`, { method: 'PATCH', body: JSON.stringify(value) }),
  implementTests: (value: Record<string, unknown>) =>
    request<TestImplementationRequest>('/api/v1/test-implementations', { method: 'POST', body: JSON.stringify(value) }),
  testImplementation: (id: string) =>
    request<TestImplementationRequest>(`/api/v1/test-implementations/${id}`),
  organizationMembers: async () => {
    const result = await request<{ items?: OrganizationMember[]; members?: OrganizationMember[] } | OrganizationMember[]>('/api/v1/organization/members')
    return (Array.isArray(result) ? result : (result.items ?? result.members ?? [])).map(normalizeOrganizationMember)
  },
  inviteOrganizationMember: (email: string, role: OrganizationRole) =>
    request('/api/v1/organization/invitations', { method: 'POST', body: JSON.stringify({ email, role }) }),
  updateOrganizationMember: (id: string, role: OrganizationRole) =>
    request(`/api/v1/organization/members/${id}`, { method: 'PUT', body: JSON.stringify({ role }) }),
  removeOrganizationMember: (id: string) =>
    request(`/api/v1/organization/members/${id}`, { method: 'DELETE' }),
  platformOrganizations: () => request<OrganizationQualitySummary[]>('/api/v1/admin/organizations'),
  enterOrganizationContext: (organizationId: string, reason: string) =>
    request<AdminTenantContext>(`/api/v1/admin/organizations/${encodeURIComponent(organizationId)}/context`, { method: 'POST', body: JSON.stringify({ reason }) }),
}
