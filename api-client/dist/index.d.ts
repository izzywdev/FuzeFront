import { AxiosRequestConfig, AxiosInstance } from 'axios'

interface User {
  id: string
  email: string
  firstName?: string
  lastName?: string
  defaultAppId?: string
  roles: string[]
}
interface App {
  id: string
  name: string
  url: string
  iconUrl?: string
  isActive: boolean
  isHealthy?: boolean
  integrationType: 'module-federation' | 'iframe' | 'web-component'
  remoteUrl?: string
  scope?: string
  module?: string
  description?: string
}
interface LoginRequest {
  email: string
  password: string
}
interface LoginResponse {
  token: string
  user: User
  sessionId?: string
}
interface CreateAppRequest {
  name: string
  url: string
  iconUrl?: string
  integrationType?: 'module-federation' | 'iframe' | 'web-component'
  remoteUrl?: string
  scope?: string
  module?: string
  description?: string
}
interface HeartbeatRequest {
  status?: 'online' | 'offline'
  metadata?: {
    version?: string
    port?: number
    timestamp?: string
    [key: string]: any
  }
}
interface HealthResponse {
  status: 'ok' | 'degraded' | 'error'
  timestamp: string
  uptime: number
  version: string
  environment: string
  database?: {
    status: 'connected' | 'disconnected'
    type: string
    host: string
    database: string
  }
  memory: {
    used: number
    total: number
  }
}
interface ApiError {
  error: string
}
interface ApiClientConfig {
  baseURL: string
  timeout?: number
  headers?: Record<string, string>
  token?: string | undefined
}
interface ApiResponse<T = any> {
  data: T
  status: number
  statusText: string
  headers: Record<string, string>
}
interface ApiErrorResponse extends Error {
  response?: {
    data: ApiError
    status: number
    statusText: string
  }
}
type IntegrationType = 'module-federation' | 'iframe' | 'web-component'
type UserRole = 'admin' | 'user'
type AppStatus = 'online' | 'offline'
type HealthStatus = 'ok' | 'degraded' | 'error'

declare class BaseApiClient {
  private client
  private token
  constructor(config: ApiClientConfig)
  /**
   * Set or update the authentication token
   */
  setToken(token: string): void
  /**
   * Remove the authentication token
   */
  clearToken(): void
  /**
   * Get current authentication token
   */
  getToken(): string | undefined
  /**
   * Make a GET request
   */
  protected get<T = any>(
    url: string,
    config?: AxiosRequestConfig
  ): Promise<ApiResponse<T>>
  /**
   * Make a POST request
   */
  protected post<T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig
  ): Promise<ApiResponse<T>>
  /**
   * Make a PUT request
   */
  protected put<T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig
  ): Promise<ApiResponse<T>>
  /**
   * Make a DELETE request
   */
  protected delete<T = any>(
    url: string,
    config?: AxiosRequestConfig
  ): Promise<ApiResponse<T>>
  /**
   * Make a PATCH request
   */
  protected patch<T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig
  ): Promise<ApiResponse<T>>
  /**
   * Transform axios response to our API response format
   */
  private transformResponse
  /**
   * Check if a response indicates success
   */
  protected isSuccessResponse(status: number): boolean
  /**
   * Get the underlying axios instance for advanced usage
   */
  getAxiosInstance(): AxiosInstance
}

declare class AuthClient extends BaseApiClient {
  constructor(config: ApiClientConfig)
  /**
   * Login with email and password
   * @param credentials - Email and password
   * @returns Login response with token and user info
   */
  login(credentials: LoginRequest): Promise<ApiResponse<LoginResponse>>
  /**
   * Logout the current user
   * @returns Logout confirmation
   */
  logout(): Promise<
    ApiResponse<{
      message: string
    }>
  >
  /**
   * Get current authenticated user information
   * @returns Current user data
   */
  getCurrentUser(): Promise<
    ApiResponse<{
      user: User
    }>
  >
  /**
   * Check if user is authenticated (has valid token)
   * @returns True if token exists
   */
  isAuthenticated(): boolean
  /**
   * Login and return just the user data for convenience
   * @param credentials - Email and password
   * @returns User data
   */
  loginAndGetUser(credentials: LoginRequest): Promise<User>
  /**
   * Verify token validity by attempting to get user info
   * @returns True if token is valid
   */
  verifyToken(): Promise<boolean>
}

interface GetAppsOptions {
  healthyOnly?: boolean
}
declare class AppsClient extends BaseApiClient {
  constructor(config: ApiClientConfig)
  /**
   * Get all registered applications
   * @param options - Query options
   * @returns List of applications
   */
  getApps(options?: GetAppsOptions): Promise<ApiResponse<App[]>>
  /**
   * Get all healthy applications only
   * @returns List of healthy applications
   */
  getHealthyApps(): Promise<ApiResponse<App[]>>
  /**
   * Register a new application
   * @param appData - Application data
   * @returns Created application
   */
  createApp(appData: CreateAppRequest): Promise<ApiResponse<App>>
  /**
   * Get a specific application by ID
   * @param appId - Application ID
   * @returns Application data
   */
  getApp(appId: string): Promise<ApiResponse<App>>
  /**
   * Update an application
   * @param appId - Application ID
   * @param appData - Updated application data
   * @returns Updated application
   */
  updateApp(
    appId: string,
    appData: Partial<CreateAppRequest>
  ): Promise<ApiResponse<App>>
  /**
   * Delete an application
   * @param appId - Application ID
   * @returns Deletion confirmation
   */
  deleteApp(appId: string): Promise<
    ApiResponse<{
      message: string
    }>
  >
  /**
   * Send heartbeat for an application
   * @param appId - Application ID
   * @param heartbeatData - Heartbeat data
   * @returns Heartbeat confirmation
   */
  sendHeartbeat(
    appId: string,
    heartbeatData?: HeartbeatRequest
  ): Promise<
    ApiResponse<{
      message: string
      status: string
    }>
  >
  /**
   * Register a Module Federation app with validation
   * @param appData - Module Federation app data
   * @returns Created application
   */
  createModuleFederationApp(appData: {
    name: string
    url: string
    remoteUrl: string
    scope: string
    module: string
    iconUrl?: string
    description?: string
  }): Promise<ApiResponse<App>>
  /**
   * Register an iframe app
   * @param appData - Iframe app data
   * @returns Created application
   */
  createIframeApp(appData: {
    name: string
    url: string
    iconUrl?: string
    description?: string
  }): Promise<ApiResponse<App>>
  /**
   * Get apps by integration type
   * @param integrationType - Type of integration
   * @returns Filtered applications
   */
  getAppsByType(
    integrationType: 'module-federation' | 'iframe' | 'web-component'
  ): Promise<App[]>
}

declare class FuzeFrontClient extends BaseApiClient {
  readonly auth: AuthClient
  readonly apps: AppsClient
  constructor(config: ApiClientConfig)
  /**
   * Get platform health status
   * @returns Health information
   */
  getHealth(): Promise<ApiResponse<HealthResponse>>
  /**
   * Check if the platform is healthy
   * @returns True if platform is healthy
   */
  isHealthy(): Promise<boolean>
  /**
   * Set authentication token for all clients
   * @param token - JWT token
   */
  setToken(token: string): void
  /**
   * Clear authentication token from all clients
   */
  clearToken(): void
  /**
   * Login and configure all clients with the token
   * @param email - User email
   * @param password - User password
   * @returns Login response
   */
  login(email: string, password: string): Promise<ApiResponse<any>>
  /**
   * Logout and clear tokens from all clients
   * @returns Logout response
   */
  logout(): Promise<
    ApiResponse<{
      message: string
    }>
  >
  /**
   * Create a new FuzeFront client instance
   * @param baseURL - API base URL
   * @param token - Optional JWT token
   * @returns Configured client instance
   */
  static create(baseURL: string, token?: string): FuzeFrontClient
  /**
   * Create a client for development environment
   * @param token - Optional JWT token
   * @returns Client configured for localhost
   */
  static createForDevelopment(token?: string): FuzeFrontClient
  /**
   * Create a client for production environment
   * @param token - Optional JWT token
   * @returns Client configured for production
   */
  static createForProduction(token?: string): FuzeFrontClient
}

export {
  AppsClient,
  AuthClient,
  BaseApiClient,
  FuzeFrontClient,
  FuzeFrontClient as default,
}
export type {
  ApiClientConfig,
  ApiError,
  ApiErrorResponse,
  ApiResponse,
  App,
  AppStatus,
  CreateAppRequest,
  HealthResponse,
  HealthStatus,
  HeartbeatRequest,
  IntegrationType,
  LoginRequest,
  LoginResponse,
  User,
  UserRole,
}
