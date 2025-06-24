export interface User {
    id: string;
    email: string;
    firstName?: string;
    lastName?: string;
    defaultAppId?: string;
    roles: string[];
}
export interface App {
    id: string;
    name: string;
    url: string;
    iconUrl?: string;
    isActive: boolean;
    isHealthy?: boolean;
    integrationType: 'module-federation' | 'iframe' | 'web-component';
    remoteUrl?: string;
    scope?: string;
    module?: string;
    description?: string;
}
export interface LoginRequest {
    email: string;
    password: string;
}
export interface LoginResponse {
    token: string;
    user: User;
    sessionId?: string;
}
export interface CreateAppRequest {
    name: string;
    url: string;
    iconUrl?: string;
    integrationType?: 'module-federation' | 'iframe' | 'web-component';
    remoteUrl?: string;
    scope?: string;
    module?: string;
    description?: string;
}
export interface HeartbeatRequest {
    status?: 'online' | 'offline';
    metadata?: {
        version?: string;
        port?: number;
        timestamp?: string;
        [key: string]: any;
    };
}
export interface HealthResponse {
    status: 'ok' | 'degraded' | 'error';
    timestamp: string;
    uptime: number;
    version: string;
    environment: string;
    database?: {
        status: 'connected' | 'disconnected';
        type: string;
        host: string;
        database: string;
    };
    memory: {
        used: number;
        total: number;
    };
}
export interface ApiError {
    error: string;
}
export interface ApiClientConfig {
    baseURL: string;
    timeout?: number;
    headers?: Record<string, string>;
    token?: string | undefined;
}
export interface ApiResponse<T = any> {
    data: T;
    status: number;
    statusText: string;
    headers: Record<string, string>;
}
export interface ApiErrorResponse extends Error {
    response?: {
        data: ApiError;
        status: number;
        statusText: string;
    };
}
export type IntegrationType = 'module-federation' | 'iframe' | 'web-component';
export type UserRole = 'admin' | 'user';
export type AppStatus = 'online' | 'offline';
export type HealthStatus = 'ok' | 'degraded' | 'error';
//# sourceMappingURL=index.d.ts.map