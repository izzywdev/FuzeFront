import { AuthClient } from './auth'
import { AppsClient } from './apps'
import { BaseApiClient } from './base'
import { ApiClientConfig, HealthResponse, ApiResponse } from '../types'

export class FuzeFrontClient extends BaseApiClient {
  public readonly auth: AuthClient
  public readonly apps: AppsClient

  constructor(config: ApiClientConfig) {
    super(config)

    // Initialize sub-clients with the same configuration
    this.auth = new AuthClient(config)
    this.apps = new AppsClient(config)
  }

  /**
   * Get platform health status
   * @returns Health information
   */
  async getHealth(): Promise<ApiResponse<HealthResponse>> {
    return this.get<HealthResponse>('/health')
  }

  /**
   * Check if the platform is healthy
   * @returns True if platform is healthy
   */
  async isHealthy(): Promise<boolean> {
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
  setToken(token: string): void {
    super.setToken(token)
    this.auth.setToken(token)
    this.apps.setToken(token)
  }

  /**
   * Clear authentication token from all clients
   */
  clearToken(): void {
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
  async login(email: string, password: string): Promise<ApiResponse<any>> {
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
  async logout(): Promise<ApiResponse<{ message: string }>> {
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
  static create(baseURL: string, token?: string): FuzeFrontClient {
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
  static createForDevelopment(token?: string): FuzeFrontClient {
    return FuzeFrontClient.create('http://localhost:3001', token)
  }

  /**
   * Create a client for production environment
   * @param token - Optional JWT token
   * @returns Client configured for production
   */
  static createForProduction(token?: string): FuzeFrontClient {
    return FuzeFrontClient.create('https://api.frontfuse.dev', token)
  }
}
