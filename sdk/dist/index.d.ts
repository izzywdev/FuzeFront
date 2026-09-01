import React$1, { ReactNode } from 'react';

interface User {
    id: string;
    email: string;
    defaultAppId?: string;
    roles: string[];
    firstName?: string;
    lastName?: string;
}
interface Session {
    id: string;
    userId: string;
    tenantId?: string;
    expiresAt: Date;
}
interface App {
    id: string;
    name: string;
    url: string;
    iconUrl?: string;
    isActive: boolean;
    integrationType: 'module-federation' | 'iframe' | 'web-component';
    remoteUrl?: string;
    scope?: string;
    module?: string;
    description?: string;
}
interface MenuItem {
    id: string;
    label: string;
    icon?: string;
    route?: string;
    action?: () => void;
    children?: MenuItem[];
    visible?: boolean;
    category?: 'portal' | 'app';
    appId?: string;
    order?: number;
}
interface SocketMessage {
    type: string;
    payload: any;
    targetAppId?: string;
    sourceAppId?: string;
    timestamp: number;
}
interface Permission {
    action: string;
    resource: string;
}
interface CommandEvent {
    type: string;
    payload: any;
    appId?: string;
}
interface AppConfig {
    id: string;
    name: string;
    version?: string;
    apiUrl?: string;
    wsUrl?: string;
}
interface PlatformContext {
    user: User | null;
    session: Session | null;
    apps: App[];
    activeApp: App | null;
    menuItems: MenuItem[];
    isLoading: boolean;
    isPlatformMode: boolean;
}
interface SocketBus {
    on: (eventType: string, handler: (payload: any) => void) => void;
    emit: (eventType: string, payload: any, targetAppId?: string) => void;
    isConnected: boolean;
}
interface LoadedModule {
    default: React.ComponentType<any>;
}
interface ModuleFederationConfig {
    remoteUrl: string;
    scope: string;
    module: string;
}
interface UseCurrentUserResult {
    user: User | null;
    setUser: (user: User | null) => void;
    isAuthenticated: boolean;
    hasRole: (role: string) => boolean;
}
interface UseSessionResult {
    session: Session | null;
    setSession: (session: Session | null) => void;
    tenantId: string | null;
    isExpired: boolean;
}
interface UseGlobalMenuResult {
    menuItems: MenuItem[];
    portalMenuItems: MenuItem[];
    appMenuItems: MenuItem[];
    setMenuItems: (items: MenuItem[]) => void;
    addMenuItem: (item: MenuItem) => void;
    removeMenuItem: (id: string) => void;
    updateMenuItem: (id: string, updates: Partial<MenuItem>) => void;
    addAppMenuItems: (appId: string, items: MenuItem[]) => void;
    removeAppMenuItems: (appId: string) => void;
    clearAllAppMenuItems: () => void;
}
interface UseSocketBusResult extends SocketBus {
}

interface PlatformState {
    user: User | null;
    session: Session | null;
    apps: App[];
    activeApp: App | null;
    menuItems: MenuItem[];
    isLoading: boolean;
    isPlatformMode: boolean;
    config: AppConfig | null;
}
type PlatformAction = {
    type: 'SET_USER';
    payload: User | null;
} | {
    type: 'SET_SESSION';
    payload: Session | null;
} | {
    type: 'SET_APPS';
    payload: App[];
} | {
    type: 'SET_ACTIVE_APP';
    payload: App | null;
} | {
    type: 'SET_MENU_ITEMS';
    payload: MenuItem[];
} | {
    type: 'SET_LOADING';
    payload: boolean;
} | {
    type: 'SET_PLATFORM_MODE';
    payload: boolean;
} | {
    type: 'SET_CONFIG';
    payload: AppConfig;
};
interface PlatformProviderProps {
    children: ReactNode;
    config: AppConfig;
    fallbackMode?: boolean;
}
declare function PlatformProvider({ children, config, fallbackMode, }: PlatformProviderProps): React$1.JSX.Element;
declare function usePlatformContext(): {
    state: PlatformState;
    dispatch: React$1.Dispatch<PlatformAction>;
};

/**
 * FrontFuse Heartbeat SDK
 * Allows microfrontends to report their status to the FrontFuse platform
 */
interface HeartbeatConfig {
    appId: string;
    backendUrl?: string;
    interval?: number;
    metadata?: Record<string, any>;
}
interface HeartbeatResponse {
    success: boolean;
    message: string;
    timestamp: string;
}
declare class AppHeartbeat {
    private config;
    private intervalId;
    private isActive;
    constructor(config: HeartbeatConfig);
    /**
     * Send a single heartbeat to the backend
     */
    sendHeartbeat(status?: 'online' | 'offline', metadata?: Record<string, any>): Promise<HeartbeatResponse>;
    /**
     * Start sending periodic heartbeats
     */
    start(): void;
    /**
     * Stop sending heartbeats
     */
    stop(): void;
    /**
     * Check if heartbeat is currently active
     */
    isRunning(): boolean;
    /**
     * Update configuration
     */
    updateConfig(newConfig: Partial<HeartbeatConfig>): void;
}
/**
 * Create and configure a heartbeat instance for your app
 *
 * @example
 * ```typescript
 * import { createHeartbeat } from '@frontfuse/sdk-react';
 *
 * const heartbeat = createHeartbeat({
 *   appId: 'my-app-uuid',
 *   backendUrl: 'https://frontfuse.example.com',
 *   interval: 60000, // 1 minute
 *   metadata: { version: '1.0.0' }
 * });
 *
 * // Start sending heartbeats
 * heartbeat.start();
 *
 * // Stop when app is unloading
 * window.addEventListener('beforeunload', () => {
 *   heartbeat.stop();
 * });
 * ```
 */
declare function createHeartbeat(config: HeartbeatConfig): AppHeartbeat;

declare function useCurrentUser(): UseCurrentUserResult;

declare function useSession(): UseSessionResult;

declare function useGlobalMenu(): UseGlobalMenuResult;

declare function useSocketBus(appId?: string): UseSocketBusResult;

type ToastLevel = 'info' | 'success' | 'warning' | 'error';
interface ToastInput {
    message: string;
    title?: string;
    level?: ToastLevel;
    durationMs?: number;
    appId?: string;
}
interface Toast extends Required<Omit<ToastInput, 'title' | 'appId'>> {
    id: string;
    title?: string;
    appId?: string;
    createdAt: number;
}
interface PlatformSnapshot {
    user: {
        id: string;
        email: string;
        roles: string[];
    } | null;
    apps: Array<{
        id: string;
        name: string;
    }>;
    activeApp: {
        id: string;
        name: string;
    } | null;
    isPlatformMode: boolean;
}
interface BridgeMenuItem {
    id: string;
    label: string;
    icon?: string;
    route?: string;
    order?: number;
}
interface BridgeSocket {
    on(event: string, handler: (payload: any) => void): void;
    off(event: string, handler: (payload: any) => void): void;
    emit(event: string, payload: any): void;
    isConnected(): boolean;
}
interface FuzeFrontBridge {
    version: number;
    getContext(): PlatformSnapshot;
    subscribe(listener: (ctx: PlatformSnapshot) => void): () => void;
    notify(toast: ToastInput): string;
    dismiss(id: string): void;
    menu: {
        add(appId: string, items: BridgeMenuItem[]): void;
        remove(appId: string): void;
    };
    socket: BridgeSocket;
}
declare global {
    interface Window {
        __FUZEFRONT__?: FuzeFrontBridge;
        __FRONTFUSE_PLATFORM__?: boolean;
    }
}
/** Returns the host-provided bridge, or null when running standalone. */
declare function getBridge(): FuzeFrontBridge | null;
declare function isInPlatform(): boolean;

/** Show toasts through the host's shared toaster (window.__FUZEFRONT__). */
declare function useToast(): {
    notify: (toast: ToastInput) => string | undefined;
    dismiss: (id: string) => void;
};

/**
 * Live platform context from the host (user, apps, active app), delivered over
 * the bridge. Re-renders when the host pushes updates. Returns a standalone
 * snapshot when not running inside the platform.
 */
declare function usePlatform(): PlatformSnapshot;

interface RetryOptions {
    maxAttempts: number;
    baseDelay: number;
    maxDelay: number;
}
/**
 * Load a federated module with retry logic
 */
declare function loadApp(config: ModuleFederationConfig, retryOptions?: Partial<RetryOptions>): Promise<LoadedModule>;
/**
 * Clear module cache (useful for development)
 */
declare function clearModuleCache(): void;
/**
 * Get cached module if available
 */
declare function getCachedModule(config: ModuleFederationConfig): Promise<LoadedModule> | null;
/**
 * Check if a module is cached
 */
declare function isModuleCached(config: ModuleFederationConfig): boolean;

declare const _default: {
    PlatformProvider: typeof PlatformProvider;
    useCurrentUser: typeof useCurrentUser;
    useSession: typeof useSession;
    useGlobalMenu: typeof useGlobalMenu;
    useSocketBus: typeof useSocketBus;
    useToast: typeof useToast;
    usePlatform: typeof usePlatform;
    getBridge: typeof getBridge;
    loadApp: typeof loadApp;
    clearModuleCache: typeof clearModuleCache;
};

export { AppHeartbeat, PlatformProvider, clearModuleCache, createHeartbeat, _default as default, getBridge, getCachedModule, isInPlatform, isModuleCached, loadApp, useCurrentUser, useGlobalMenu, usePlatform, usePlatformContext, useSession, useSocketBus, useToast };
export type { App, AppConfig, BridgeMenuItem, BridgeSocket, CommandEvent, FuzeFrontBridge, HeartbeatConfig, HeartbeatResponse, LoadedModule, MenuItem, ModuleFederationConfig, Permission, PlatformContext, PlatformSnapshot, Session, SocketBus, SocketMessage, Toast, ToastInput, ToastLevel, UseCurrentUserResult, UseGlobalMenuResult, UseSessionResult, UseSocketBusResult, User };
