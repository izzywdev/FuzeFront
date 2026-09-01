import { jsx } from 'react/jsx-runtime';
import { createContext, useReducer, useEffect, useContext, useCallback, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const initialState = {
    user: null,
    session: null,
    apps: [],
    activeApp: null,
    menuItems: [],
    isLoading: false,
    isPlatformMode: false,
    config: null,
};
function platformReducer(state, action) {
    switch (action.type) {
        case 'SET_USER':
            return { ...state, user: action.payload };
        case 'SET_SESSION':
            return { ...state, session: action.payload };
        case 'SET_APPS':
            return { ...state, apps: action.payload };
        case 'SET_ACTIVE_APP':
            return { ...state, activeApp: action.payload };
        case 'SET_MENU_ITEMS':
            return { ...state, menuItems: action.payload };
        case 'SET_LOADING':
            return { ...state, isLoading: action.payload };
        case 'SET_PLATFORM_MODE':
            return { ...state, isPlatformMode: action.payload };
        case 'SET_CONFIG':
            return { ...state, config: action.payload };
        default:
            return state;
    }
}
const PlatformContext = createContext(null);
function PlatformProvider({ children, config, fallbackMode = false, }) {
    const [state, dispatch] = useReducer(platformReducer, {
        ...initialState,
        config,
        isPlatformMode: !fallbackMode,
    });
    useEffect(() => {
        // Try to detect if we're running inside the FrontFuse platform
        const isPlatform = !fallbackMode &&
            // Check for platform-specific global variables
            typeof window !== 'undefined' &&
            window.__FRONTFUSE_PLATFORM__ === true;
        dispatch({ type: 'SET_PLATFORM_MODE', payload: isPlatform });
        if (!isPlatform && fallbackMode) {
            // Set up fallback data for standalone development
            const mockUser = {
                id: 'dev-user',
                email: 'developer@example.com',
                firstName: 'Dev',
                lastName: 'User',
                roles: ['user', 'developer'],
            };
            const mockSession = {
                id: 'dev-session',
                userId: 'dev-user',
                tenantId: 'dev-tenant',
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
            };
            dispatch({ type: 'SET_USER', payload: mockUser });
            dispatch({ type: 'SET_SESSION', payload: mockSession });
            console.log('🔧 FrontFuse SDK running in fallback mode (standalone development)');
        }
        else if (isPlatform) {
            // Try to get data from the platform context
            try {
                const platformData = window.__FRONTFUSE_CONTEXT__;
                if (platformData) {
                    if (platformData.user)
                        dispatch({ type: 'SET_USER', payload: platformData.user });
                    if (platformData.session)
                        dispatch({ type: 'SET_SESSION', payload: platformData.session });
                    if (platformData.apps)
                        dispatch({ type: 'SET_APPS', payload: platformData.apps });
                    if (platformData.activeApp)
                        dispatch({
                            type: 'SET_ACTIVE_APP',
                            payload: platformData.activeApp,
                        });
                    if (platformData.menuItems)
                        dispatch({
                            type: 'SET_MENU_ITEMS',
                            payload: platformData.menuItems,
                        });
                }
            }
            catch (error) {
                console.warn('Failed to load platform context:', error);
            }
        }
    }, [fallbackMode]);
    // Expose context to child microfrontends when in platform mode
    useEffect(() => {
        if (state.isPlatformMode && typeof window !== 'undefined') {
            window.__FRONTFUSE_CONTEXT__ = {
                user: state.user,
                session: state.session,
                apps: state.apps,
                activeApp: state.activeApp,
                menuItems: state.menuItems,
                isLoading: state.isLoading,
                isPlatformMode: state.isPlatformMode,
            };
        }
    }, [state]);
    return (jsx(PlatformContext.Provider, { value: { state, dispatch }, children: children }));
}
function usePlatformContext() {
    const context = useContext(PlatformContext);
    if (!context) {
        throw new Error('usePlatformContext must be used within a PlatformProvider');
    }
    return context;
}

/**
 * FrontFuse Heartbeat SDK
 * Allows microfrontends to report their status to the FrontFuse platform
 */
class AppHeartbeat {
    constructor(config) {
        this.intervalId = null;
        this.isActive = false;
        this.config = {
            backendUrl: 'http://localhost:3001',
            interval: 30000, // 30 seconds default
            ...config,
        };
    }
    /**
     * Send a single heartbeat to the backend
     */
    async sendHeartbeat(status = 'online', metadata) {
        try {
            const response = await fetch(`${this.config.backendUrl}/api/apps/${this.config.appId}/heartbeat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    status,
                    metadata: { ...this.config.metadata, ...metadata },
                }),
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            const result = await response.json();
            console.log(`💓 Heartbeat sent successfully for app ${this.config.appId}`);
            return result;
        }
        catch (error) {
            console.error(`❌ Failed to send heartbeat for app ${this.config.appId}:`, error);
            throw error;
        }
    }
    /**
     * Start sending periodic heartbeats
     */
    start() {
        if (this.isActive) {
            console.warn('Heartbeat is already active');
            return;
        }
        this.isActive = true;
        // Send initial heartbeat
        this.sendHeartbeat('online').catch(console.error);
        // Set up periodic heartbeats
        this.intervalId = setInterval(() => {
            this.sendHeartbeat('online').catch(console.error);
        }, this.config.interval);
        console.log(`🚀 Started heartbeat for app ${this.config.appId} (interval: ${this.config.interval}ms)`);
    }
    /**
     * Stop sending heartbeats
     */
    stop() {
        if (!this.isActive) {
            return;
        }
        this.isActive = false;
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        // Send offline status
        this.sendHeartbeat('offline').catch(console.error);
        console.log(`🛑 Stopped heartbeat for app ${this.config.appId}`);
    }
    /**
     * Check if heartbeat is currently active
     */
    isRunning() {
        return this.isActive;
    }
    /**
     * Update configuration
     */
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
    }
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
function createHeartbeat(config) {
    return new AppHeartbeat(config);
}

function useCurrentUser() {
    var _a;
    const { state, dispatch } = usePlatformContext();
    const setUser = useCallback((user) => {
        dispatch({ type: 'SET_USER', payload: user });
    }, [dispatch]);
    const hasRole = useCallback((role) => {
        var _a, _b;
        return (_b = (_a = state.user) === null || _a === void 0 ? void 0 : _a.roles.includes(role)) !== null && _b !== void 0 ? _b : false;
    }, [(_a = state.user) === null || _a === void 0 ? void 0 : _a.roles]);
    return {
        user: state.user,
        setUser,
        isAuthenticated: !!state.user,
        hasRole,
    };
}

function useSession() {
    var _a;
    const { state, dispatch } = usePlatformContext();
    const setSession = useCallback((session) => {
        dispatch({ type: 'SET_SESSION', payload: session });
    }, [dispatch]);
    const isExpired = useCallback(() => {
        if (!state.session)
            return true;
        return new Date(state.session.expiresAt) <= new Date();
    }, [state.session]);
    return {
        session: state.session,
        setSession,
        tenantId: ((_a = state.session) === null || _a === void 0 ? void 0 : _a.tenantId) || null,
        isExpired: isExpired(),
    };
}

function useGlobalMenu() {
    const { state, dispatch } = usePlatformContext();
    const portalMenuItems = state.menuItems
        .filter(item => item.category === 'portal' || !item.category)
        .sort((a, b) => (a.order || 0) - (b.order || 0));
    const appMenuItems = state.menuItems
        .filter(item => item.category === 'app')
        .sort((a, b) => (a.order || 0) - (b.order || 0));
    const setMenuItems = useCallback((items) => {
        dispatch({ type: 'SET_MENU_ITEMS', payload: items });
    }, [dispatch]);
    const addMenuItem = useCallback((item) => {
        const newItems = [...state.menuItems];
        // Insert before 'help' which should always be last for portal items
        if (item.category === 'portal' || !item.category) {
            const helpIndex = newItems.findIndex(i => i.id === 'help');
            if (helpIndex > -1) {
                newItems.splice(helpIndex, 0, item);
            }
            else {
                newItems.push(item);
            }
        }
        else {
            // App items go after portal items
            newItems.push(item);
        }
        setMenuItems(newItems);
    }, [state.menuItems, setMenuItems]);
    const removeMenuItem = useCallback((id) => {
        const newItems = state.menuItems.filter(item => item.id !== id);
        setMenuItems(newItems);
    }, [state.menuItems, setMenuItems]);
    const updateMenuItem = useCallback((id, updates) => {
        const newItems = state.menuItems.map(item => item.id === id ? { ...item, ...updates } : item);
        setMenuItems(newItems);
    }, [state.menuItems, setMenuItems]);
    const addAppMenuItems = useCallback((appId, items) => {
        // Mark items as app-specific and add appId
        const appMenuItems = items.map(item => ({
            ...item,
            category: 'app',
            appId,
        }));
        // Add to existing menu items
        const newItems = [...state.menuItems, ...appMenuItems];
        setMenuItems(newItems);
    }, [state.menuItems, setMenuItems]);
    const removeAppMenuItems = useCallback((appId) => {
        const newItems = state.menuItems.filter(item => item.appId !== appId);
        setMenuItems(newItems);
    }, [state.menuItems, setMenuItems]);
    const clearAllAppMenuItems = useCallback(() => {
        const newItems = state.menuItems.filter(item => item.category === 'portal' || !item.category);
        setMenuItems(newItems);
    }, [state.menuItems, setMenuItems]);
    return {
        menuItems: state.menuItems,
        portalMenuItems,
        appMenuItems,
        setMenuItems,
        addMenuItem,
        removeMenuItem,
        updateMenuItem,
        addAppMenuItems,
        removeAppMenuItems,
        clearAllAppMenuItems,
    };
}

function useSocketBus(appId) {
    var _a, _b, _c;
    const { state } = usePlatformContext();
    const socketRef = useRef(null);
    const handlersRef = useRef(new Map());
    useEffect(() => {
        var _a, _b, _c;
        // Don't initialize socket in fallback mode unless explicitly configured
        if (!state.isPlatformMode && !((_a = state.config) === null || _a === void 0 ? void 0 : _a.wsUrl)) {
            return;
        }
        const wsUrl = ((_b = state.config) === null || _b === void 0 ? void 0 : _b.wsUrl) || 'ws://localhost:3001';
        const effectiveAppId = appId || ((_c = state.config) === null || _c === void 0 ? void 0 : _c.id) || 'unknown';
        // Initialize socket connection
        const socket = io(wsUrl, {
            auth: {
                appId: effectiveAppId,
                token: localStorage.getItem('authToken'), // Get from storage
            },
        });
        socketRef.current = socket;
        // Set up message routing
        socket.on('command-event', (event) => {
            const handler = handlersRef.current.get(event.type);
            if (handler) {
                handler(event.payload);
            }
        });
        socket.on('connect', () => {
            console.log(`🔌 Socket connected for app: ${effectiveAppId}`);
        });
        socket.on('disconnect', () => {
            console.log(`🔌 Socket disconnected for app: ${effectiveAppId}`);
        });
        socket.on('connect_error', error => {
            console.error('🔌 Socket connection error:', error);
        });
        return () => {
            socket.disconnect();
            socketRef.current = null;
        };
    }, [state.isPlatformMode, (_a = state.config) === null || _a === void 0 ? void 0 : _a.wsUrl, (_b = state.config) === null || _b === void 0 ? void 0 : _b.id, appId]);
    const on = useCallback((eventType, handler) => {
        handlersRef.current.set(eventType, handler);
    }, []);
    const emit = useCallback((eventType, payload, targetAppId) => {
        if (socketRef.current && socketRef.current.connected) {
            const event = {
                type: eventType,
                payload,
                appId: targetAppId,
            };
            socketRef.current.emit('command-event', event);
        }
        else if (!state.isPlatformMode) {
            // In fallback mode, just log the event
            console.log('📡 [Fallback Mode] Socket emit:', {
                eventType,
                payload,
                targetAppId,
            });
        }
    }, [state.isPlatformMode]);
    return {
        on,
        emit,
        isConnected: ((_c = socketRef.current) === null || _c === void 0 ? void 0 : _c.connected) || false,
    };
}

// The FuzeFront platform bridge contract.
//
// The host installs a single, versioned API object on `window.__FUZEFRONT__`.
// This is the one thing a runtime-loaded microfrontend needs to know about the
// host — it shares nothing else at build time. The hooks in this SDK are thin,
// typed wrappers over this object.
/** Returns the host-provided bridge, or null when running standalone. */
function getBridge() {
    var _a;
    if (typeof window === 'undefined')
        return null;
    return (_a = window.__FUZEFRONT__) !== null && _a !== void 0 ? _a : null;
}
function isInPlatform() {
    return getBridge() != null;
}

/** Show toasts through the host's shared toaster (window.__FUZEFRONT__). */
function useToast() {
    const notify = useCallback((toast) => { var _a; return (_a = getBridge()) === null || _a === void 0 ? void 0 : _a.notify(toast); }, []);
    const dismiss = useCallback((id) => { var _a; return (_a = getBridge()) === null || _a === void 0 ? void 0 : _a.dismiss(id); }, []);
    return { notify, dismiss };
}

const STANDALONE = {
    user: null,
    apps: [],
    activeApp: null,
    isPlatformMode: false,
};
/**
 * Live platform context from the host (user, apps, active app), delivered over
 * the bridge. Re-renders when the host pushes updates. Returns a standalone
 * snapshot when not running inside the platform.
 */
function usePlatform() {
    const [snapshot, setSnapshot] = useState(() => { var _a, _b; return (_b = (_a = getBridge()) === null || _a === void 0 ? void 0 : _a.getContext()) !== null && _b !== void 0 ? _b : STANDALONE; });
    useEffect(() => {
        const bridge = getBridge();
        if (!bridge)
            return;
        return bridge.subscribe(setSnapshot);
    }, []);
    return snapshot;
}

const DEFAULT_RETRY_OPTIONS = {
    maxAttempts: 3,
    baseDelay: 1000,
    maxDelay: 8000,
};
// Cache for loaded modules to avoid re-loading
const moduleCache = new Map();
/**
 * Sleep utility for retry delays
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
/**
 * Calculate exponential backoff delay
 */
const getRetryDelay = (attempt, baseDelay, maxDelay) => {
    const delay = baseDelay * Math.pow(2, attempt - 1);
    return Math.min(delay + Math.random() * 1000, maxDelay); // Add jitter
};
/**
 * Load the remote entry script
 */
async function loadRemoteEntry(remoteUrl) {
    const scriptId = `remote-${remoteUrl.replace(/[^a-zA-Z0-9]/g, '_')}`;
    // Check if script is already loaded
    if (document.getElementById(scriptId)) {
        return;
    }
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.id = scriptId;
        script.src = `${remoteUrl}/remoteEntry.js`;
        script.type = 'text/javascript';
        script.async = true;
        script.onload = () => {
            console.log(`✅ Loaded remote entry: ${remoteUrl}`);
            resolve();
        };
        script.onerror = error => {
            console.error(`❌ Failed to load remote entry: ${remoteUrl}`, error);
            document.head.removeChild(script);
            reject(new Error(`Failed to load remote entry: ${remoteUrl}`));
        };
        document.head.appendChild(script);
    });
}
/**
 * Load a remote module using Webpack Module Federation
 */
async function loadRemoteModule(config) {
    const { remoteUrl, scope, module } = config;
    const cacheKey = `${remoteUrl}:${scope}:${module}`;
    // Return cached module if available
    if (moduleCache.has(cacheKey)) {
        return moduleCache.get(cacheKey);
    }
    const loadPromise = (async () => {
        // Ensure the remote entry script is loaded
        await loadRemoteEntry(remoteUrl);
        // Initialize sharing scope
        // @ts-expect-error - Webpack federation APIs
        await __webpack_init_sharing__('default');
        // Get the container
        // @ts-expect-error - Dynamic access to global containers
        const container = window[scope];
        if (!container) {
            throw new Error(`Container '${scope}' not found on window object`);
        }
        // Initialize the container with shared scope
        // @ts-expect-error - Webpack federation APIs
        await container.init(__webpack_share_scopes__.default);
        // Get the module factory
        const factory = await container.get(module);
        if (!factory) {
            throw new Error(`Module '${module}' not found in container '${scope}'`);
        }
        // Execute the factory to get the module
        const Module = factory();
        if (!Module || !Module.default) {
            throw new Error(`Module '${module}' does not export a default component`);
        }
        return Module;
    })();
    // Cache the promise
    moduleCache.set(cacheKey, loadPromise);
    return loadPromise;
}
/**
 * Load a federated module with retry logic
 */
async function loadApp(config, retryOptions = {}) {
    const options = { ...DEFAULT_RETRY_OPTIONS, ...retryOptions };
    let lastError = null;
    for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
        try {
            console.log(`📦 Loading federated module '${config.scope}/${config.module}' (attempt ${attempt}/${options.maxAttempts})`);
            const module = await loadRemoteModule(config);
            console.log(`✅ Successfully loaded federated module '${config.scope}/${config.module}'`);
            return module;
        }
        catch (error) {
            lastError = error;
            console.error(`❌ Failed to load federated module '${config.scope}/${config.module}' (attempt ${attempt}):`, error);
            // Don't retry on the last attempt
            if (attempt < options.maxAttempts) {
                const delay = getRetryDelay(attempt, options.baseDelay, options.maxDelay);
                console.log(`⏳ Retrying in ${delay}ms...`);
                await sleep(delay);
            }
        }
    }
    throw new Error(`Failed to load federated module '${config.scope}/${config.module}' after ${options.maxAttempts} attempts. Last error: ${lastError === null || lastError === void 0 ? void 0 : lastError.message}`);
}
/**
 * Clear module cache (useful for development)
 */
function clearModuleCache() {
    moduleCache.clear();
    console.log('🗑️ Module cache cleared');
}
/**
 * Get cached module if available
 */
function getCachedModule(config) {
    const cacheKey = `${config.remoteUrl}:${config.scope}:${config.module}`;
    return moduleCache.get(cacheKey) || null;
}
/**
 * Check if a module is cached
 */
function isModuleCached(config) {
    const cacheKey = `${config.remoteUrl}:${config.scope}:${config.module}`;
    return moduleCache.has(cacheKey);
}

// FuzeFront SDK - Main Export File
// Auto-publishing test: version will be bumped automatically
// Types
// Default export for convenience
var index = {
    PlatformProvider,
    useCurrentUser,
    useSession,
    useGlobalMenu,
    useSocketBus,
    useToast,
    usePlatform,
    getBridge,
    loadApp,
    clearModuleCache,
};

export { AppHeartbeat, PlatformProvider, clearModuleCache, createHeartbeat, index as default, getBridge, getCachedModule, isInPlatform, isModuleCached, loadApp, useCurrentUser, useGlobalMenu, usePlatform, usePlatformContext, useSession, useSocketBus, useToast };
//# sourceMappingURL=index.esm.js.map
