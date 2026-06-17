import { App } from '../lib/shared'
// Dynamic remote-loading helpers from @originjs/vite-plugin-federation (the
// federation runtime this host actually builds with). The previous
// webpack-style __webpack_init_sharing__ approach never worked with Vite remotes.
// @ts-ignore - virtual module provided by the federation plugin at build time
import {
  __federation_method_setRemote,
  __federation_method_getRemote,
  __federation_method_unwrapDefault,
} from 'virtual:__federation__'

interface LoadedModule {
  default: React.ComponentType<any>
}

interface RetryOptions {
  maxAttempts: number
  baseDelay: number
  maxDelay: number
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  baseDelay: 1000,
  maxDelay: 8000,
}

// Cache for loaded modules to avoid re-loading
const moduleCache = new Map<string, Promise<LoadedModule>>()

/**
 * Sleep utility for retry delays
 */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Calculate exponential backoff delay
 */
const getRetryDelay = (
  attempt: number,
  baseDelay: number,
  maxDelay: number
): number => {
  const delay = baseDelay * Math.pow(2, attempt - 1)
  return Math.min(delay + Math.random() * 1000, maxDelay) // Add jitter
}

/**
 * Load a remote module at runtime via @originjs/vite-plugin-federation:
 * register the remote dynamically, fetch the exposed module, unwrap its default.
 */
async function loadRemoteModule(
  remoteUrl: string,
  scope: string,
  module: string
): Promise<LoadedModule> {
  const cacheKey = `${remoteUrl}:${scope}:${module}`

  // Return cached module if available
  if (moduleCache.has(cacheKey)) {
    return moduleCache.get(cacheKey)!
  }

  const loadPromise = (async () => {
    // Register the remote at runtime (remoteUrl is the base; remoteEntry.js lives under it).
    __federation_method_setRemote(scope, {
      url: `${remoteUrl}/remoteEntry.js`,
      format: 'esm',
      from: 'vite',
    })

    const proxy = await __federation_method_getRemote(scope, module)
    const Component = await __federation_method_unwrapDefault(proxy)

    if (!Component) {
      throw new Error(
        `Module '${module}' from '${scope}' did not provide a default export`
      )
    }

    return { default: Component } as LoadedModule
  })()

  // Cache the promise
  moduleCache.set(cacheKey, loadPromise)

  return loadPromise
}

/**
 * Load a federated app with retry logic
 */
export async function loadFederatedApp(
  app: App,
  retryOptions: Partial<RetryOptions> = {}
): Promise<LoadedModule> {
  const options = { ...DEFAULT_RETRY_OPTIONS, ...retryOptions }

  if (app.integrationType !== 'module-federation') {
    throw new Error(`App '${app.name}' is not configured for Module Federation`)
  }

  if (!app.remoteUrl || !app.scope || !app.module) {
    throw new Error(
      `App '${app.name}' is missing required Module Federation configuration`
    )
  }

  let lastError: Error | null = null

  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      console.log(
        `📦 Loading federated app '${app.name}' (attempt ${attempt}/${options.maxAttempts})`
      )

      const module = await loadRemoteModule(
        app.remoteUrl,
        app.scope,
        app.module
      )

      console.log(`✅ Successfully loaded federated app '${app.name}'`)
      return module
    } catch (error) {
      lastError = error as Error
      console.error(
        `❌ Failed to load federated app '${app.name}' (attempt ${attempt}):`,
        error
      )

      // Don't retry on the last attempt
      if (attempt < options.maxAttempts) {
        const delay = getRetryDelay(
          attempt,
          options.baseDelay,
          options.maxDelay
        )
        console.log(`⏳ Retrying in ${delay}ms...`)
        await sleep(delay)
      }
    }
  }

  throw new Error(
    `Failed to load federated app '${app.name}' after ${options.maxAttempts} attempts. Last error: ${lastError?.message}`
  )
}

/**
 * Load an app by ID from the registry
 */
export async function loadApp(appId: string): Promise<LoadedModule> {
  try {
    // Fetch app metadata from the registry. /api/apps requires auth, so send the
    // stored token — a raw fetch without it gets a 401 and breaks app loading.
    const token =
      typeof localStorage !== 'undefined'
        ? localStorage.getItem('authToken')
        : null
    const response = await fetch(
      `${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/apps`,
      token ? { headers: { Authorization: `Bearer ${token}` } } : undefined
    )
    if (!response.ok) {
      throw new Error(`Failed to fetch apps: ${response.statusText}`)
    }

    const apps: App[] = await response.json()
    const app = apps.find(a => a.id === appId)

    if (!app) {
      throw new Error(`App with ID '${appId}' not found in registry`)
    }

    if (!app.isActive) {
      throw new Error(`App '${app.name}' is not active`)
    }

    return loadFederatedApp(app)
  } catch (error) {
    console.error(`❌ Failed to load app '${appId}':`, error)
    throw error
  }
}

/**
 * Preload multiple apps for better performance
 */
export async function preloadApps(appIds: string[]): Promise<void> {
  console.log(`🚀 Preloading ${appIds.length} apps...`)

  const loadPromises = appIds.map(async appId => {
    try {
      await loadApp(appId)
      console.log(`✅ Preloaded app: ${appId}`)
    } catch (error) {
      console.error(`❌ Failed to preload app: ${appId}`, error)
    }
  })

  await Promise.allSettled(loadPromises)
}

/**
 * Clear module cache (useful for development)
 */
export function clearModuleCache(): void {
  moduleCache.clear()
  console.log('🗑️ Module cache cleared')
}
