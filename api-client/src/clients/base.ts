import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios'
import { ApiClientConfig, ApiResponse, ApiErrorResponse } from '../types'

export class BaseApiClient {
  private client: AxiosInstance
  private token: string | undefined

  constructor(config: ApiClientConfig) {
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
        const apiError: ApiErrorResponse = new Error(
          error.response?.data?.error || error.message || 'API request failed'
        ) as ApiErrorResponse

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
  setToken(token: string): void {
    this.token = token
  }

  /**
   * Remove the authentication token
   */
  clearToken(): void {
    this.token = undefined
  }

  /**
   * Get current authentication token
   */
  getToken(): string | undefined {
    return this.token
  }

  /**
   * Make a GET request
   */
  protected async get<T = any>(
    url: string,
    config?: AxiosRequestConfig
  ): Promise<ApiResponse<T>> {
    const response: AxiosResponse<T> = await this.client.get(url, config)
    return this.transformResponse(response)
  }

  /**
   * Make a POST request
   */
  protected async post<T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig
  ): Promise<ApiResponse<T>> {
    const response: AxiosResponse<T> = await this.client.post(url, data, config)
    return this.transformResponse(response)
  }

  /**
   * Make a PUT request
   */
  protected async put<T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig
  ): Promise<ApiResponse<T>> {
    const response: AxiosResponse<T> = await this.client.put(url, data, config)
    return this.transformResponse(response)
  }

  /**
   * Make a DELETE request
   */
  protected async delete<T = any>(
    url: string,
    config?: AxiosRequestConfig
  ): Promise<ApiResponse<T>> {
    const response: AxiosResponse<T> = await this.client.delete(url, config)
    return this.transformResponse(response)
  }

  /**
   * Make a PATCH request
   */
  protected async patch<T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig
  ): Promise<ApiResponse<T>> {
    const response: AxiosResponse<T> = await this.client.patch(
      url,
      data,
      config
    )
    return this.transformResponse(response)
  }

  /**
   * Transform axios response to our API response format
   */
  private transformResponse<T>(response: AxiosResponse<T>): ApiResponse<T> {
    return {
      data: response.data,
      status: response.status,
      statusText: response.statusText,
      headers: response.headers as Record<string, string>,
    }
  }

  /**
   * Check if a response indicates success
   */
  protected isSuccessResponse(status: number): boolean {
    return status >= 200 && status < 300
  }

  /**
   * Get the underlying axios instance for advanced usage
   */
  getAxiosInstance(): AxiosInstance {
    return this.client
  }
}
