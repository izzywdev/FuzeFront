import { AxiosInstance, AxiosRequestConfig } from 'axios'
import { ApiClientConfig, ApiResponse } from '../types'
export declare class BaseApiClient {
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
//# sourceMappingURL=base.d.ts.map
