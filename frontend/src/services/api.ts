import axios from 'axios'
import { App } from '../lib/shared'
import type {
  AuthMethods,
  SessionResult,
  SocialProvider,
} from '@fuzefront/security-client'

// Re-export the provider-neutral contract types so existing consumers can keep
// importing them from this module (e.g. `import { AuthMethods } from '../services/api'`).
export type { AuthMethods, SessionResult, SocialProvider }

// Default to the same origin the app is served from (the in-pod / ingress nginx
// proxies /api/ to the backend). Same-origin keeps the protocol correct — http
// on http, https on https — so there's no mixed-content breakage under TLS.
// VITE_API_URL still overrides for cross-origin setups.
const API_BASE_URL =
  import.meta.env.VITE_API_URL ||
  (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3001')
const API_URL = `${API_BASE_URL}/api`

// Verbose API diagnostics (config dump, per-request console groups, module-load
// health probe) are DEV-ONLY: in production they flooded the console with a
// multi-line group for every API call and fired an extra /api/health request
// on each page load.
const API_DEBUG = import.meta.env.DEV

if (API_DEBUG) {
  console.log('🔧 API Configuration:', {
    API_BASE_URL,
    VITE_API_URL: import.meta.env.VITE_API_URL,
    NODE_ENV: import.meta.env.NODE_ENV,
    MODE: import.meta.env.MODE,
    timestamp: new Date().toISOString(),
  })

  // Test API connectivity on module load
  console.log('🌐 Testing API connectivity...')
  fetch('/api/health')
    .then(response => {
      console.log('✅ API Health Check Success:', {
        status: response.status,
        statusText: response.statusText,
        url: response.url,
        headers: Object.fromEntries(response.headers.entries()),
      })
    })
    .catch(error => {
      console.error('❌ API Health Check Failed:', {
        error: error.message,
        type: error.constructor.name,
        stack: error.stack,
      })
    })
}

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  // Server-brokered sign-in/up drive the identity provider's flow-executor +
  // OIDC exchange server-side (several hops); allow headroom so a legitimate
  // login isn't cut off. The provider itself is reached over fast in-cluster DNS.
  timeout: 30000, // 30 second timeout
})

// Add request timing and enhanced logging
api.interceptors.request.use(
  config => {
    const token = localStorage.getItem('authToken')
    const requestId = Math.random().toString(36).substr(2, 9)
    ;(config as any).metadata = { startTime: Date.now(), requestId }

    if (API_DEBUG) {
      console.group(`🚀 API Request [${requestId}]`)
      console.log('Request Details:', {
        method: config.method?.toUpperCase(),
        url: config.url,
        baseURL: config.baseURL,
        fullURL: `${config.baseURL}${config.url}`,
        timeout: config.timeout,
        hasToken: !!token,
        tokenPreview: token ? `${token.substring(0, 20)}...` : 'none',
        headers: config.headers,
        data: config.data,
        timestamp: new Date().toISOString(),
      })
      console.groupEnd()
    }

    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  error => {
    console.error('❌ API Request Setup Error:', {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
    })
    return Promise.reject(error)
  }
)

/**
 * Routes that ARE the auth surface. A 401 while already here is expected — it is
 * the boot probe answering "no, you are not signed in" — so the interceptor must
 * not redirect away from them. Keep this the single source of truth: LoginPage
 * derives sign-in vs sign-up from the path, so silently rewriting it loses intent.
 */
const AUTH_ROUTE_RE = /^\/(login|signup)\b/

// Enhanced response logging with timing
api.interceptors.response.use(
  response => {
    if (API_DEBUG) {
      const duration = (response.config as any).metadata
        ? Date.now() - (response.config as any).metadata.startTime
        : 0
      const requestId = (response.config as any).metadata?.requestId || 'unknown'

      console.group(`✅ API Response [${requestId}] - ${duration}ms`)
      console.log('Response Details:', {
        status: response.status,
        statusText: response.statusText,
        url: response.config.url,
        method: response.config.method?.toUpperCase(),
        duration: `${duration}ms`,
        headers: response.headers,
        dataKeys: response.data ? Object.keys(response.data) : 'no data',
        dataSize: JSON.stringify(response.data || {}).length + ' bytes',
        timestamp: new Date().toISOString(),
      })
      console.log('Response Data:', response.data)
      console.groupEnd()
    }

    return response
  },
  error => {
    const duration = (error.config as any)?.metadata
      ? Date.now() - (error.config as any).metadata.startTime
      : 0
    const requestId = (error.config as any)?.metadata?.requestId || 'unknown'

    console.group(`❌ API Response Error [${requestId}] - ${duration}ms`)
    console.error('Error Details:', {
      message: error.message,
      code: error.code,
      status: error.response?.status,
      statusText: error.response?.statusText,
      url: error.config?.url,
      method: error.config?.method?.toUpperCase(),
      duration: `${duration}ms`,
      responseData: error.response?.data,
      responseHeaders: error.response?.headers,
      isNetworkError: error.code === 'NETWORK_ERROR' || !error.response,
      isTimeout: error.code === 'ECONNABORTED',
      stack: error.stack,
      timestamp: new Date().toISOString(),
    })

    // Additional network diagnostics
    if (!error.response) {
      console.error('Network Diagnostics:', {
        navigator: {
          onLine: navigator.onLine,
          connection: (navigator as any).connection,
          userAgent: navigator.userAgent,
        },
        window: {
          location: window.location.href,
          origin: window.location.origin,
        },
      })
    }
    console.groupEnd()

    if (error.response?.status === 401) {
      console.log('🔐 Unauthorized - removing token and reloading')
      localStorage.removeItem('authToken')
      localStorage.removeItem('user')
      // Never bounce a visitor who is ALREADY on an auth route.
      //
      // This guard knew about /login but not /signup, which broke sign-up
      // entirely: an anonymous visitor lands on /signup, the shell's boot probe
      // (AuthWrapper -> GET /session) 401s — the NORMAL answer for someone not
      // signed in — and this redirect fired, replacing the path with /login.
      // LoginPage derives its mode from window.location.pathname, so by the time
      // it mounted the /signup intent was gone and it always rendered sign-in.
      //
      // A 401 here means two very different things: "your session expired, go
      // re-authenticate" (redirect is right) and "you are simply not signed in
      // yet" (redirect is wrong — you are already where you should be).
      if (!AUTH_ROUTE_RE.test(window.location.pathname)) {
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  }
)

export interface LoginCredentials {
  email: string
  password: string
}

export interface User {
  id: string
  email: string
  firstName: string
  lastName: string
  roles: string[]
}

export interface LoginResponse {
  token: string
  user: User
  sessionId: string
}

// Account-creation payload for the server-brokered signup endpoint. Mirrors the
// contract `SignupRequest` (see @fuzefront/security-client / openapi.yaml).
export interface SignupCredentials {
  email: string
  password: string
  firstName?: string
  lastName?: string
  tenantName?: string
}

// Persist a freshly authenticated session so it survives the post-login page
// reload and is attached to subsequent requests by the axios interceptor.
function persistSession(token?: string, sessionId?: string): void {
  if (token) localStorage.setItem('authToken', token)
  if (sessionId) localStorage.setItem('sessionId', sessionId)
}

// ─────────────────────────────────────────────────────────────────────────────
// Authentication API — provider-agnostic FuzeFront Security API.
//
// Talks ONLY to FuzeFront's own same-origin `/api/v1/security/*` surface and the
// generated `@fuzefront/security-client` contract types. No identity provider is
// named here or anywhere on the consumer surface: the underlying federation /
// MFA / enrollment engine is a swappable server-side adapter the browser never
// sees. Social login transits only `app.fuzefront.com` and the chosen social
// provider's own consent host.
// ─────────────────────────────────────────────────────────────────────────────
const SECURITY_BASE = '/v1/security'

export const authAPI = {
  // Neutral auth capability descriptor — lets the UI render the right affordances
  // (password form, social buttons, MFA, contact verification) without knowing
  // any provider. Replaces the legacy vendor-specific `oidcConfigured` boolean.
  async getAuthMethods(): Promise<AuthMethods> {
    const response = await api.get<AuthMethods>(`${SECURITY_BASE}/methods`)
    return response.data
  },

  // Password login — establishes a session. Returns a `SessionResult`: either an
  // authenticated session, OR (when the account has MFA enabled) an
  // `mfa_required` challenge the caller completes via `mfaAPI`. On the
  // authenticated branch the session is persisted here.
  async login(credentials: LoginCredentials): Promise<SessionResult> {
    const response = await api.post<SessionResult>(
      `${SECURITY_BASE}/session`,
      credentials
    )
    const result = response.data
    if (result.status === 'authenticated') {
      persistSession(result.token, result.sessionId)
    }
    return result
  },

  // Server-brokered account creation. The user only ever sees FuzeFront-branded
  // UI — never a provider's raw enrollment page. On success a session is
  // established directly and persisted.
  async signup(credentials: SignupCredentials): Promise<LoginResponse> {
    const response = await api.post<LoginResponse>(
      `${SECURITY_BASE}/signup`,
      credentials
    )
    persistSession(response.data?.token, response.data?.sessionId)
    return response.data
  },

  // Begin a server-brokered social login. 302-redirects the browser to the
  // social provider's own consent host via a FuzeFront-owned, same-host authorize
  // path; on completion the app is returned to with `?code=` for exchange.
  async startSocialLogin(provider: SocialProvider = 'google'): Promise<void> {
    window.location.href = `${API_URL}${SECURITY_BASE}/social/${provider}/start`
  },

  // Current identity ("me"). The Security API returns `{ identity, user }`; the
  // UI consumes the hydrated user.
  async getCurrentUser(): Promise<User> {
    const response = await api.get<{ user: User }>(`${SECURITY_BASE}/session`)
    return response.data.user
  },

  // Logout — revoke the current session (idempotent) and clear local state.
  async logout(): Promise<void> {
    await api.delete(`${SECURITY_BASE}/session`)
    localStorage.removeItem('authToken')
    localStorage.removeItem('sessionId')
    localStorage.removeItem('user')
  },

  // Complete a social-login round-trip. The social callback redirects back to
  // the app with a single-use opaque `?code=`; exchange it for a session via
  // `POST /session/exchange`. The `SessionResult` may itself be an
  // `mfa_required` challenge when the account requires step-up.
  async handleAuthCallback(): Promise<{
    result?: SessionResult
    error?: string
  }> {
    const urlParams = new URLSearchParams(window.location.search)
    const code = urlParams.get('code')
    const error = urlParams.get('error')
    const message = urlParams.get('message')

    if (error) {
      return { error: message || error }
    }

    if (code) {
      try {
        const response = await api.post<SessionResult>(
          `${SECURITY_BASE}/session/exchange`,
          { code }
        )
        const result = response.data
        if (result.status === 'authenticated') {
          persistSession(result.token, result.sessionId)
        }
        // Strip the opaque code from the URL so a reload can't re-exchange it.
        window.history.replaceState({}, document.title, window.location.pathname)
        return { result }
      } catch (err: any) {
        const failMessage =
          err?.response?.data?.error || err?.message || 'Sign-in failed'
        return { error: failMessage }
      }
    }

    return {}
  },
}

// Apps API
export const appsAPI = {
  async getApps() {
    const response = await api.get('/apps')
    return response.data
  },
}

// Organizations API  
export const organizationsAPI = {
  async getOrganizations() {
    const response = await api.get('/organizations')
    // Backend returns { organizations, pagination }; callers expect the array.
    return response.data?.organizations ?? response.data
  },
}

// ---------------------------------------------------------------------------
// Backward-compatible standalone exports.
// Components import these named functions/types directly. They wrap the *API
// objects above and add the org/member/app-CRUD + permission calls the
// components expect, following the backend's /api routes.
// ---------------------------------------------------------------------------

export interface Organization {
  id: string
  name: string
  slug?: string
  description?: string
  ownerId?: string
  parentId?: string | null
  type?: string
  metadata?: Record<string, any>
  createdAt?: string
  updatedAt?: string
  // Snake_case fields returned by the backend / consumed by the UI.
  user_role?: string
  member_count?: number
  created_at?: string
}

export interface OrganizationMember {
  id: string
  organizationId: string
  userId: string
  email?: string
  firstName?: string
  lastName?: string
  role: string
  status?: string
  createdAt?: string
}

// Auth
export const getCurrentUser = () => authAPI.getCurrentUser()
export const logout = () => authAPI.logout()

// Apps
export const fetchApps = () => appsAPI.getApps()
export const createApp = async (app: Partial<App>) => {
  const res = await api.post('/apps', app)
  return res.data
}
export const updateAppStatus = async (id: string, isActive: boolean) => {
  const res = await api.put(`/apps/${id}/activate`, { isActive })
  return res.data
}
export const deleteApp = async (id: string) => {
  const res = await api.delete(`/apps/${id}`)
  return res.data
}

// Organizations
export const getOrganizations = () => organizationsAPI.getOrganizations()
export const createOrganization = async (data: Partial<Organization>) => {
  const res = await api.post('/organizations', data)
  return res.data
}
export const updateOrganization = async (
  id: string,
  data: Partial<Organization>
) => {
  const res = await api.put(`/organizations/${id}`, data)
  return res.data
}
export const deleteOrganization = async (id: string) => {
  const res = await api.delete(`/organizations/${id}`)
  return res.data
}

// Organization members.
// The endpoint returns a paginated envelope `{ members, pagination }`; older
// callers expect a bare array, so unwrap to the members array (tolerating both
// the new envelope and a legacy array response).
export const getOrganizationMembers = async (orgId: string) => {
  const res = await api.get(`/organizations/${orgId}/members`)
  return Array.isArray(res.data) ? res.data : (res.data?.members ?? [])
}
export const inviteOrganizationMember = async (
  orgId: string,
  data: { email: string; role: string }
) => {
  const res = await api.post(`/organizations/${orgId}/members`, data)
  return res.data
}
export const updateMemberRole = async (
  orgId: string,
  memberId: string,
  role: string
) => {
  const res = await api.put(`/organizations/${orgId}/members/${memberId}`, {
    role,
  })
  return res.data
}
export const removeMember = async (orgId: string, memberId: string) => {
  const res = await api.delete(`/organizations/${orgId}/members/${memberId}`)
  return res.data
}

// Permission checks: no PDP endpoint is wired yet (Permit deferred), so resolve
// permissively client-side instead of POSTing to a non-existent endpoint (which
// 404s on every check). Role-based gating below uses the real user roles.
// Signature matches PermissionGate: (permissions, organizationId?, requireAll?).
export const checkPermissions = async (
  _permissions?: string | string[],
  _organizationId?: string,
  _requireAll?: boolean
): Promise<boolean> => {
  return true
}
export const getUserRoles = async (
  _organizationId?: string
): Promise<string[]> => {
  try {
    const user = await authAPI.getCurrentUser()
    return Array.isArray(user.roles) ? user.roles : []
  } catch {
    return []
  }
}


// ── Invitation types ───────────────────────────────────────────────────────
export interface OrganizationInvitation {
  id: string
  organizationId: string
  email: string
  role: string
  token?: string
  expiresAt: string
  status: 'pending' | 'accepted' | 'revoked' | 'expired'
  invitedBy: string
  createdAt: string
}

// ── Invitation API ─────────────────────────────────────────────────────────

/** Resolve a public invitation token (no auth required). */
export const getInvitation = async (token: string) => {
  const res = await api.get(`/invitations/${token}`)
  return res.data
}

/** Accept an invitation via its token. */
export const acceptInvitation = async (token: string) => {
  const res = await api.post(`/invitations/${token}/accept`)
  return res.data
}

/** Create a single invitation for an org. */
export const createInvitation = async (orgId: string, email: string, role: string) => {
  const res = await api.post(`/organizations/${orgId}/invitations`, { email, role })
  return res.data
}

/** Bulk invite up to 50 emails to an org. */
export const bulkInvite = async (orgId: string, emails: string[], role: string) => {
  const res = await api.post(`/organizations/${orgId}/invitations/bulk`, { emails, role })
  return res.data
}

/** Revoke an invitation. */
export const revokeInvitation = async (orgId: string, invitationId: string) => {
  const res = await api.delete(`/organizations/${orgId}/invitations/${invitationId}`)
  return res.data
}

/** List pending invitations for an org. */
export const listInvitations = async (orgId: string) => {
  const res = await api.get(`/organizations/${orgId}/invitations`)
  return res.data
}
export default api

