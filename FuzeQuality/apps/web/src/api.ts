import type {
  AdminTenantContext,
  OrganizationQualitySummary,
  Portfolio,
  TestImplementationRequest,
} from '@fuzequality/contracts'
import type { Identity, SecurityErrorCode } from '@fuzefront/security-client'

export type OrganizationRole = 'owner' | 'admin' | 'member' | 'viewer'
export type OrganizationMember = { id: string; email?: string; name?: string; displayName?: string; userId?: string; user_id?: string; role: OrganizationRole; status?: string }


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

function portalToken(): string | null | undefined {
  const context = (window as Window & {
    __FRONTFUSE_CONTEXT__?: { getAccessToken?: TokenProvider }
  }).__FRONTFUSE_CONTEXT__
  return context?.getAccessToken?.()
}

/**
 * Receives the portal account-vault token from the Module Federation host.
 * A remote must never read the host's storage directly: the host remains the
 * sole owner of multi-account session selection and token refresh.
 */
export function configurePlatformSecurity(getToken?: TokenProvider) {
  platformToken = getToken
}

export type PlatformSession = Pick<Identity, 'userId' | 'tenantId' | 'roles'>
type SecurityFailure = { error?: string; code?: SecurityErrorCode }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const token = platformToken?.() ?? portalToken()
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
    })
    if (!response.ok) {
      const error = await response.json().catch(() => null) as SecurityFailure | null
      throw new Error(error?.error ?? `Request failed: ${response.status}`)
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

export const api = {
  portfolio: () => request<Portfolio>('/api/v1/portfolio'),
  addRepository: (value: Record<string, unknown>) =>
    request('/api/v1/repositories', { method: 'POST', body: JSON.stringify(value) }),
  scanRepository: (id: string, localPath?: string) =>
    request(`/api/v1/repositories/${id}/scans`, {
      method: 'POST',
      body: JSON.stringify({ localPath }),
    }),
  decideSuggestion: (id: string, decision: 'confirm' | 'reject') =>
    request(`/api/v1/suggestions/${id}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision }),
    }),
  verifyRepository: (value: Record<string, unknown>) =>
    request('/api/v1/repositories/verify', { method: 'POST', body: JSON.stringify(value) }),
  updateRepositoryAdministration: (id: string, value: Record<string, unknown>) =>
    request(`/api/v1/repositories/${id}/administration`, { method: 'PATCH', body: JSON.stringify(value) }),
  implementTests: (value: Record<string, unknown>) =>
    request<TestImplementationRequest>('/api/v1/test-implementations', { method: 'POST', body: JSON.stringify(value) }),
  testImplementation: (id: string) =>
    request<TestImplementationRequest>(`/api/v1/test-implementations/${id}`),
  organizationMembers: () => request<{ items?: OrganizationMember[]; members?: OrganizationMember[] } | OrganizationMember[]>('/api/v1/organization/members'),
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
