import { BaseApiClient } from './base';
import { App, CreateAppRequest, HeartbeatRequest, ApiResponse, ApiClientConfig } from '../types';
export interface GetAppsOptions {
    healthyOnly?: boolean;
}
export declare class AppsClient extends BaseApiClient {
    constructor(config: ApiClientConfig);
    /**
     * Get all registered applications
     * @param options - Query options
     * @returns List of applications
     */
    getApps(options?: GetAppsOptions): Promise<ApiResponse<App[]>>;
    /**
     * Get all healthy applications only
     * @returns List of healthy applications
     */
    getHealthyApps(): Promise<ApiResponse<App[]>>;
    /**
     * Register a new application
     * @param appData - Application data
     * @returns Created application
     */
    createApp(appData: CreateAppRequest): Promise<ApiResponse<App>>;
    /**
     * Get a specific application by ID
     * @param appId - Application ID
     * @returns Application data
     */
    getApp(appId: string): Promise<ApiResponse<App>>;
    /**
     * Update an application
     * @param appId - Application ID
     * @param appData - Updated application data
     * @returns Updated application
     */
    updateApp(appId: string, appData: Partial<CreateAppRequest>): Promise<ApiResponse<App>>;
    /**
     * Delete an application
     * @param appId - Application ID
     * @returns Deletion confirmation
     */
    deleteApp(appId: string): Promise<ApiResponse<{
        message: string;
    }>>;
    /**
     * Send heartbeat for an application
     * @param appId - Application ID
     * @param heartbeatData - Heartbeat data
     * @returns Heartbeat confirmation
     */
    sendHeartbeat(appId: string, heartbeatData?: HeartbeatRequest): Promise<ApiResponse<{
        message: string;
        status: string;
    }>>;
    /**
     * Register a Module Federation app with validation
     * @param appData - Module Federation app data
     * @returns Created application
     */
    createModuleFederationApp(appData: {
        name: string;
        url: string;
        remoteUrl: string;
        scope: string;
        module: string;
        iconUrl?: string;
        description?: string;
    }): Promise<ApiResponse<App>>;
    /**
     * Register an iframe app
     * @param appData - Iframe app data
     * @returns Created application
     */
    createIframeApp(appData: {
        name: string;
        url: string;
        iconUrl?: string;
        description?: string;
    }): Promise<ApiResponse<App>>;
    /**
     * Get apps by integration type
     * @param integrationType - Type of integration
     * @returns Filtered applications
     */
    getAppsByType(integrationType: 'module-federation' | 'iframe' | 'web-component'): Promise<App[]>;
}
//# sourceMappingURL=apps.d.ts.map