import axios, { AxiosRequestConfig } from 'axios'
import { App, User } from '../lib/shared'

// Extend AxiosRequestConfig to include metadata
interface ExtendedAxiosRequestConfig extends AxiosRequestConfig {
  metadata?: {
    startTime: number
    requestId: string
  }
}

// Use relative URLs since nginx proxies /api/ to backend
// This works both in development (via nginx proxy) and production
const API_BASE_URL = ''

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
  baseURL: API_BASE_URL,
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
      window.location.reload()
    }
    return Promise.reject(error)
  }
)

export const login = async (email: string, password: string) => {
  const loginId = Math.random().toString(36).substr(2, 9)

  console.group(`🔐 Login Process [${loginId}]`)
  console.log('Login attempt started:', {
    email,
    passwordLength: password.length,
    timestamp: new Date().toISOString(),
    loginId,
  })

  try {
    console.log('📡 Sending login request...')
    const response = await api.post('/api/auth/login', { email, password })

    console.log('✅ Login response received:', {
      status: response.status,
      hasToken: !!response.data.token,
      hasUser: !!response.data.user,
      userEmail: response.data.user?.email,
      tokenPreview: response.data.token
        ? `${response.data.token.substring(0, 20)}...`
        : 'none',
      fullResponse: response.data,
    })

    const { token, user } = response.data

    if (token) {
      localStorage.setItem('authToken', token)
      console.log('💾 Token stored in localStorage')
    } else {
      console.error('❌ No token in response')
    }

    console.groupEnd()
    return { token, user }
  } catch (error: any) {
    console.error('❌ Login failed:', {
      error: error.message,
      code: error.code,
      status: error.response?.status,
      responseData: error.response?.data,
      fullError: error,
      stack: error.stack,
    })
    console.groupEnd()
    throw error
  }
}

export const logout = async () => {
  try {
    await api.post('/api/auth/logout')
  } catch (error) {
    // Even if logout fails on server, remove local token
    console.error('Logout error:', error)
  } finally {
    localStorage.removeItem('authToken')
  }
}

export const getCurrentUser = async (): Promise<User> => {
  const response = await api.get('/api/auth/user')
  return response.data.user
}

export const fetchApps = async (): Promise<App[]> => {
  const response = await api.get('/api/apps')
  return response.data
}

export const fetchHealthyApps = async (): Promise<App[]> => {
  const response = await api.get('/api/apps?healthyOnly=true')
  return response.data
}

export const checkAppsHealth = async () => {
  const response = await api.get('/api/apps/health')
  return response.data
}

export const createApp = async (appData: Partial<App>): Promise<App> => {
  const response = await api.post('/api/apps', appData)
  return response.data
}

export const updateAppStatus = async (appId: string, isActive: boolean) => {
  const response = await api.put(`/api/apps/${appId}/activate`, { isActive })
  return response.data
}

export const deleteApp = async (appId: string) => {
  const response = await api.delete(`/api/apps/${appId}`)
  return response.data
}

// Organization Management APIs
export interface Organization {
  id: string
  name: string
  slug: string
  type: 'personal' | 'team' | 'enterprise'
  description?: string
  owner_id: string
  is_active: boolean
  settings: Record<string, any>
  metadata: Record<string, any>
  created_at: string
  updated_at: string
  member_count?: number
  user_role?: 'owner' | 'admin' | 'member' | 'viewer'
}

export interface OrganizationMember {
  id: string
  user_id: string
  organization_id: string
  role: 'owner' | 'admin' | 'member' | 'viewer'
  status: 'active' | 'pending' | 'suspended'
  user: {
    id: string
    email: string
    firstName?: string
    lastName?: string
  }
  invited_at?: string
  joined_at?: string
}

export const getOrganizations = async (): Promise<Organization[]> => {
  const response = await api.get('/api/organizations')
  return response.data
}

export const getOrganization = async (
  organizationId: string
): Promise<Organization> => {
  const response = await api.get(`/api/organizations/${organizationId}`)
  return response.data
}

export const createOrganization = async (data: {
  name: string
  description?: string
  type?: 'personal' | 'team' | 'enterprise'
}): Promise<Organization> => {
  const response = await api.post('/api/organizations', data)
  return response.data
}

export const updateOrganization = async (
  organizationId: string,
  data: Partial<Organization>
): Promise<Organization> => {
  const response = await api.put(`/api/organizations/${organizationId}`, data)
  return response.data
}

export const deleteOrganization = async (
  organizationId: string
): Promise<void> => {
  await api.delete(`/api/organizations/${organizationId}`)
}

export const getOrganizationMembers = async (
  organizationId: string
): Promise<OrganizationMember[]> => {
  const response = await api.get(`/api/organizations/${organizationId}/members`)
  return response.data
}

export const inviteOrganizationMember = async (
  organizationId: string,
  data: { email: string; role: 'admin' | 'member' | 'viewer' }
): Promise<OrganizationMember> => {
  const response = await api.post(
    `/api/organizations/${organizationId}/members/invite`,
    data
  )
  return response.data
}

export const updateMemberRole = async (
  organizationId: string,
  memberId: string,
  role: 'admin' | 'member' | 'viewer'
): Promise<OrganizationMember> => {
  const response = await api.put(
    `/api/organizations/${organizationId}/members/${memberId}`,
    { role }
  )
  return response.data
}

export const removeMember = async (
  organizationId: string,
  memberId: string
): Promise<void> => {
  await api.delete(`/api/organizations/${organizationId}/members/${memberId}`)
}

// Permission Checking APIs
export interface PermissionCheckRequest {
  permissions: string[]
  organizationId?: string
  requireAll?: boolean
}

export interface PermissionCheckResponse {
  allowed: boolean
  permissions: Record<string, boolean>
  user_roles: string[]
  organization_role?: string
}

export const checkPermissions = async (
  permissions: string | string[],
  organizationId?: string,
  requireAll = false
): Promise<boolean> => {
  const permissionArray = Array.isArray(permissions)
    ? permissions
    : [permissions]

  const response = await api.post('/api/auth/check-permissions', {
    permissions: permissionArray,
    organizationId,
    requireAll,
  })

  return response.data.allowed
}

export const checkUserPermissions = async (
  userId: string,
  permissions: string[],
  organizationId?: string,
  requireAll = false
): Promise<PermissionCheckResponse> => {
  const response = await api.post('/api/auth/check-user-permissions', {
    userId,
    permissions,
    organizationId,
    requireAll,
  })

  return response.data
}

export const getUserRoles = async (
  organizationId?: string
): Promise<string[]> => {
  const params = organizationId ? { organizationId } : {}
  const response = await api.get('/api/auth/user-roles', { params })
  return response.data.roles
}

// Bulk permission operations
export const bulkCheckPermissions = async (
  checks: Array<{
    permissions: string[]
    organizationId?: string
    requireAll?: boolean
  }>
): Promise<
  Array<{ allowed: boolean; permissions: Record<string, boolean> }>
> => {
  const response = await api.post('/api/auth/bulk-check-permissions', {
    checks,
  })
  return response.data
}
