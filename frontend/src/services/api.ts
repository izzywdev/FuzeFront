import axios from 'axios'
import { App } from '../lib/shared'

// Use relative URLs since nginx proxies /api/ to backend
// This works both in development (via nginx proxy) and production
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://fuzefront.dev.local'
const API_URL = `${API_BASE_URL}/api`

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

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 10000, // 10 second timeout
})

// Add request timing and enhanced logging
api.interceptors.request.use(
  config => {
    const token = localStorage.getItem('authToken')
    const requestId = Math.random().toString(36).substr(2, 9)
    ;(config as any).metadata = { startTime: Date.now(), requestId }

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
    console.log('Browser Info:', {
      userAgent: navigator.userAgent,
      onLine: navigator.onLine,
      connection: (navigator as any).connection
        ? {
            effectiveType: (navigator as any).connection.effectiveType,
            downlink: (navigator as any).connection.downlink,
            rtt: (navigator as any).connection.rtt,
          }
        : 'not available',
    })
    console.groupEnd()

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

// Enhanced response logging with timing
api.interceptors.response.use(
  response => {
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
      if (!window.location.pathname.includes('/login')) {
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

export interface AuthMethods {
  methods: string[]
  oidcConfigured: boolean
  defaultMethod: string
  oidcLoginUrl?: string
}

// Authentication API
export const authAPI = {
  // Get available authentication methods
  async getAuthMethods(): Promise<AuthMethods> {
    const response = await api.get<AuthMethods>('/auth/method')
    return response.data
  },

  // Local authentication
  async login(credentials: LoginCredentials): Promise<LoginResponse> {
    const response = await api.post<LoginResponse>('/auth/login', credentials)
    // Persist the token so it survives the post-login page reload and is sent
    // on subsequent requests by the axios interceptor.
    if (response.data?.token) {
      localStorage.setItem('authToken', response.data.token)
    }
    if (response.data?.sessionId) {
      localStorage.setItem('sessionId', response.data.sessionId)
    }
    return response.data
  },

  // OIDC authentication (redirects to Authentik)
  async loginWithOIDC(): Promise<void> {
    // This will redirect the browser to Authentik
    window.location.href = `${API_URL}/auth/oidc/login`
  },

  // Get current user (the backend wraps the payload as { user })
  async getCurrentUser(): Promise<User> {
    const response = await api.get<{ user: User }>('/auth/user')
    return response.data.user
  },

  // Logout
  async logout(): Promise<void> {
    await api.post('/auth/logout')
    localStorage.removeItem('authToken')
    localStorage.removeItem('user')
  },

  // Handle OIDC callback (extract token from URL)
  handleOIDCCallback(): { token?: string; sessionId?: string; error?: string } {
    const urlParams = new URLSearchParams(window.location.search)
    const token = urlParams.get('token')
    const sessionId = urlParams.get('sessionId')
    const error = urlParams.get('error')
    const message = urlParams.get('message')

    if (error) {
      return { error: message || error }
    }

    if (token) {
      localStorage.setItem('authToken', token)
      if (sessionId) {
        localStorage.setItem('sessionId', sessionId)
      }
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname)
      return { token, sessionId: sessionId ?? undefined }
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

// Organization members
export const getOrganizationMembers = async (orgId: string) => {
  const res = await api.get(`/organizations/${orgId}/members`)
  return res.data
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

export default api
