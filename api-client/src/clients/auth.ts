import { BaseApiClient } from './base'
import {
  LoginRequest,
  LoginResponse,
  User,
  ApiResponse,
  ApiClientConfig,
} from '../types'

export class AuthClient extends BaseApiClient {
  constructor(config: ApiClientConfig) {
    super(config)
  }

  /**
   * Login with email and password
   * @param credentials - Email and password
   * @returns Login response with token and user info
   */
  async login(credentials: LoginRequest): Promise<ApiResponse<LoginResponse>> {
    const response = await this.post<LoginResponse>(
      '/api/auth/login',
      credentials
    )

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
  async logout(): Promise<ApiResponse<{ message: string }>> {
    const response = await this.post<{ message: string }>('/api/auth/logout')

    // Clear the token
    this.clearToken()

    return response
  }

  /**
   * Get current authenticated user information
   * @returns Current user data
   */
  async getCurrentUser(): Promise<ApiResponse<{ user: User }>> {
    return this.get<{ user: User }>('/api/auth/user')
  }

  /**
   * Check if user is authenticated (has valid token)
   * @returns True if token exists
   */
  isAuthenticated(): boolean {
    return !!this.getToken()
  }

  /**
   * Login and return just the user data for convenience
   * @param credentials - Email and password
   * @returns User data
   */
  async loginAndGetUser(credentials: LoginRequest): Promise<User> {
    const response = await this.login(credentials)
    return response.data.user
  }

  /**
   * Verify token validity by attempting to get user info
   * @returns True if token is valid
   */
  async verifyToken(): Promise<boolean> {
    try {
      await this.getCurrentUser()
      return true
    } catch {
      this.clearToken()
      return false
    }
  }
}
