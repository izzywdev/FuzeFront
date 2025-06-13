import { AuthClient } from './auth'
import { AppsClient } from './apps'
import { BaseApiClient } from './base'
import { ApiClientConfig, HealthResponse, ApiResponse } from '../types'
export declare class FuzeFrontClient extends BaseApiClient {
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
//# sourceMappingURL=fuzefront.d.ts.map
