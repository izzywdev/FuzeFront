import { BaseApiClient } from './base'
import {
  App,
  CreateAppRequest,
  HeartbeatRequest,
  ApiResponse,
  ApiClientConfig,
} from '../types'

export interface GetAppsOptions {
  healthyOnly?: boolean
}

export class AppsClient extends BaseApiClient {
  constructor(config: ApiClientConfig) {
    super(config)
  }

  /**
   * Get all registered applications
   * @param options - Query options
   * @returns List of applications
   */
  async getApps(options: GetAppsOptions = {}): Promise<ApiResponse<App[]>> {
    const params = new URLSearchParams()

    if (options.healthyOnly) {
      params.append('healthyOnly', 'true')
    }

    const queryString = params.toString()
    const url = queryString ? `/api/apps?${queryString}` : '/api/apps'

    return this.get<App[]>(url)
  }

  /**
   * Get all healthy applications only
   * @returns List of healthy applications
   */
  async getHealthyApps(): Promise<ApiResponse<App[]>> {
    return this.getApps({ healthyOnly: true })
  }

  /**
   * Register a new application
   * @param appData - Application data
   * @returns Created application
   */
  async createApp(appData: CreateAppRequest): Promise<ApiResponse<App>> {
    return this.post<App>('/api/apps', appData)
  }

  /**
   * Get a specific application by ID
   * @param appId - Application ID
   * @returns Application data
   */
  async getApp(appId: string): Promise<ApiResponse<App>> {
    return this.get<App>(`/api/apps/${appId}`)
  }

  /**
   * Update an application
   * @param appId - Application ID
   * @param appData - Updated application data
   * @returns Updated application
   */
  async updateApp(
    appId: string,
    appData: Partial<CreateAppRequest>
  ): Promise<ApiResponse<App>> {
    return this.put<App>(`/api/apps/${appId}`, appData)
  }

  /**
   * Delete an application
   * @param appId - Application ID
   * @returns Deletion confirmation
   */
  async deleteApp(appId: string): Promise<ApiResponse<{ message: string }>> {
    return this.delete<{ message: string }>(`/api/apps/${appId}`)
  }

  /**
   * Send heartbeat for an application
   * @param appId - Application ID
   * @param heartbeatData - Heartbeat data
   * @returns Heartbeat confirmation
   */
  async sendHeartbeat(
    appId: string,
    heartbeatData: HeartbeatRequest = {}
  ): Promise<ApiResponse<{ message: string; status: string }>> {
    const payload = {
      status: 'online',
      metadata: {
        timestamp: new Date().toISOString(),
        ...heartbeatData.metadata,
      },
      ...heartbeatData,
    }

    return this.post<{ message: string; status: string }>(
      `/api/apps/${appId}/heartbeat`,
      payload
    )
  }

  /**
   * Register a Module Federation app with validation
   * @param appData - Module Federation app data
   * @returns Created application
   */
  async createModuleFederationApp(appData: {
    name: string
    url: string
    remoteUrl: string
    scope: string
    module: string
    iconUrl?: string
    description?: string
  }): Promise<ApiResponse<App>> {
    const payload: CreateAppRequest = {
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
  async createIframeApp(appData: {
    name: string
    url: string
    iconUrl?: string
    description?: string
  }): Promise<ApiResponse<App>> {
    const payload: CreateAppRequest = {
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
  async getAppsByType(
    integrationType: 'module-federation' | 'iframe' | 'web-component'
  ): Promise<App[]> {
    const response = await this.getApps()
    return response.data.filter(app => app.integrationType === integrationType)
  }
}
