'use strict'

Object.defineProperty(exports, '__esModule', { value: true })

var axios = require('axios')

class BaseApiClient {
  constructor(config) {
    this.token = config.token || undefined
    this.client = axios.create({
      baseURL: config.baseURL,
      timeout: config.timeout || 10000,
      headers: {
        'Content-Type': 'application/json',
        ...config.headers,
      },
    })
    // Request interceptor to add auth token
    this.client.interceptors.request.use(
      config => {
        if (this.token) {
          config.headers.Authorization = `Bearer ${this.token}`
        }
        return config
      },
      error => Promise.reject(error)
    )
    // Response interceptor for error handling
    this.client.interceptors.response.use(
      response => response,
      error => {
        const apiError = new Error(
          error.response?.data?.error || error.message || 'API request failed'
        )
        if (error.response) {
          apiError.response = {
            data: error.response.data,
            status: error.response.status,
            statusText: error.response.statusText,
          }
        }
        return Promise.reject(apiError)
      }
    )
  }
  /**
   * Set or update the authentication token
   */
  setToken(token) {
    this.token = token
  }
  /**
   * Remove the authentication token
   */
  clearToken() {
    this.token = undefined
  }
  /**
   * Get current authentication token
   */
  getToken() {
    return this.token
  }
  /**
   * Make a GET request
   */
  async get(url, config) {
    const response = await this.client.get(url, config)
    return this.transformResponse(response)
  }
  /**
   * Make a POST request
   */
  async post(url, data, config) {
    const response = await this.client.post(url, data, config)
    return this.transformResponse(response)
  }
  /**
   * Make a PUT request
   */
  async put(url, data, config) {
    const response = await this.client.put(url, data, config)
    return this.transformResponse(response)
  }
  /**
   * Make a DELETE request
   */
  async delete(url, config) {
    const response = await this.client.delete(url, config)
    return this.transformResponse(response)
  }
  /**
   * Make a PATCH request
   */
  async patch(url, data, config) {
    const response = await this.client.patch(url, data, config)
    return this.transformResponse(response)
  }
  /**
   * Transform axios response to our API response format
   */
  transformResponse(response) {
    return {
      data: response.data,
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    }
  }
  /**
   * Check if a response indicates success
   */
  isSuccessResponse(status) {
    return status >= 200 && status < 300
  }
  /**
   * Get the underlying axios instance for advanced usage
   */
  getAxiosInstance() {
    return this.client
  }
}

class AuthClient extends BaseApiClient {
  constructor(config) {
    super(config)
  }
  /**
   * Login with email and password
   * @param credentials - Email and password
   * @returns Login response with token and user info
   */
  async login(credentials) {
    const response = await this.post('/api/auth/login', credentials)
    // Automatically set the token for future requests
    if (response.data.token) {
      this.setToken(response.data.token)
    }
    return response
  }
  /**
   * Logout the current user
   * @returns Logout confirmation
   */
  async logout() {
    const response = await this.post('/api/auth/logout')
    // Clear the token
    this.clearToken()
    return response
  }
  /**
   * Get current authenticated user information
   * @returns Current user data
   */
  async getCurrentUser() {
    return this.get('/api/auth/user')
  }
  /**
   * Check if user is authenticated (has valid token)
   * @returns True if token exists
   */
  isAuthenticated() {
    return !!this.getToken()
  }
  /**
   * Login and return just the user data for convenience
   * @param credentials - Email and password
   * @returns User data
   */
  async loginAndGetUser(credentials) {
    const response = await this.login(credentials)
    return response.data.user
  }
  /**
   * Verify token validity by attempting to get user info
   * @returns True if token is valid
   */
  async verifyToken() {
    try {
      await this.getCurrentUser()
      return true
    } catch {
      this.clearToken()
      return false
    }
  }
}

class AppsClient extends BaseApiClient {
  constructor(config) {
    super(config)
  }
  /**
   * Get all registered applications
   * @param options - Query options
   * @returns List of applications
   */
  async getApps(options = {}) {
    const params = new URLSearchParams()
    if (options.healthyOnly) {
      params.append('healthyOnly', 'true')
    }
    const queryString = params.toString()
    const url = queryString ? `/api/apps?${queryString}` : '/api/apps'
    return this.get(url)
  }
  /**
   * Get all healthy applications only
   * @returns List of healthy applications
   */
  async getHealthyApps() {
    return this.getApps({ healthyOnly: true })
  }
  /**
   * Register a new application
   * @param appData - Application data
   * @returns Created application
   */
  async createApp(appData) {
    return this.post('/api/apps', appData)
  }
  /**
   * Get a specific application by ID
   * @param appId - Application ID
   * @returns Application data
   */
  async getApp(appId) {
    return this.get(`/api/apps/${appId}`)
  }
  /**
   * Update an application
   * @param appId - Application ID
   * @param appData - Updated application data
   * @returns Updated application
   */
  async updateApp(appId, appData) {
    return this.put(`/api/apps/${appId}`, appData)
  }
  /**
   * Delete an application
   * @param appId - Application ID
   * @returns Deletion confirmation
   */
  async deleteApp(appId) {
    return this.delete(`/api/apps/${appId}`)
  }
  /**
   * Send heartbeat for an application
   * @param appId - Application ID
   * @param heartbeatData - Heartbeat data
   * @returns Heartbeat confirmation
   */
  async sendHeartbeat(appId, heartbeatData = {}) {
    const payload = {
      status: 'online',
      metadata: {
        timestamp: new Date().toISOString(),
        ...heartbeatData.metadata,
      },
      ...heartbeatData,
    }
    return this.post(`/api/apps/${appId}/heartbeat`, payload)
  }
  /**
   * Register a Module Federation app with validation
   * @param appData - Module Federation app data
   * @returns Created application
   */
  async createModuleFederationApp(appData) {
    const payload = {
      ...appData,
      integrationType: 'module-federation',
    }
    return this.createApp(payload)
  }
  /**
   * Register an iframe app
   * @param appData - Iframe app data
   * @returns Created application
   */
  async createIframeApp(appData) {
    const payload = {
      ...appData,
      integrationType: 'iframe',
    }
    return this.createApp(payload)
  }
  /**
   * Get apps by integration type
   * @param integrationType - Type of integration
   * @returns Filtered applications
   */
  async getAppsByType(integrationType) {
    const response = await this.getApps()
    return response.data.filter(app => app.integrationType === integrationType)
  }
}

class FuzeFrontClient extends BaseApiClient {
  constructor(config) {
    super(config)
    // Initialize sub-clients with the same configuration
    this.auth = new AuthClient(config)
    this.apps = new AppsClient(config)
  }
  /**
   * Get platform health status
   * @returns Health information
   */
  async getHealth() {
    return this.get('/health')
  }
  /**
   * Check if the platform is healthy
   * @returns True if platform is healthy
   */
  async isHealthy() {
    try {
      const response = await this.getHealth()
      return response.data.status === 'ok'
    } catch {
      return false
    }
  }
  /**
   * Set authentication token for all clients
   * @param token - JWT token
   */
  setToken(token) {
    super.setToken(token)
    this.auth.setToken(token)
    this.apps.setToken(token)
  }
  /**
   * Clear authentication token from all clients
   */
  clearToken() {
    super.clearToken()
    this.auth.clearToken()
    this.apps.clearToken()
  }
  /**
   * Login and configure all clients with the token
   * @param email - User email
   * @param password - User password
   * @returns Login response
   */
  async login(email, password) {
    const response = await this.auth.login({ email, password })
    // Token is automatically set by AuthClient.login()
    // But we ensure all clients have it
    if (response.data.token) {
      this.setToken(response.data.token)
    }
    return response
  }
  /**
   * Logout and clear tokens from all clients
   * @returns Logout response
   */
  async logout() {
    const response = await this.auth.logout()
    this.clearToken()
    return response
  }
  /**
   * Create a new FuzeFront client instance
   * @param baseURL - API base URL
   * @param token - Optional JWT token
   * @returns Configured client instance
   */
  static create(baseURL, token) {
    return new FuzeFrontClient({
      baseURL,
      token,
      timeout: 10000,
    })
  }
  /**
   * Create a client for development environment
   * @param token - Optional JWT token
   * @returns Client configured for localhost
   */
  static createForDevelopment(token) {
    return FuzeFrontClient.create('http://localhost:3001', token)
  }
  /**
   * Create a client for production environment
   * @param token - Optional JWT token
   * @returns Client configured for production
   */
  static createForProduction(token) {
    return FuzeFrontClient.create('https://api.frontfuse.dev', token)
  }
}

exports.AppsClient = AppsClient
exports.AuthClient = AuthClient
exports.BaseApiClient = BaseApiClient
exports.FuzeFrontClient = FuzeFrontClient
exports.default = FuzeFrontClient
//# sourceMappingURL=index.js.map
