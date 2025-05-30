import { App } from '@apphub/shared'

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
 * Load a remote module using Webpack Module Federation
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
    // Ensure the remote entry script is loaded
    await loadRemoteEntry(remoteUrl)

    // Initialize sharing scope
    // @ts-ignore - Webpack federation APIs
    await __webpack_init_sharing__('default')

    // Get the container
    // @ts-ignore - Dynamic access to global containers
    const container = window[scope]
    if (!container) {
      throw new Error(`Container '${scope}' not found on window object`)
    }

    // Initialize the container with shared scope
    // @ts-ignore - Webpack federation APIs
    await container.init(__webpack_share_scopes__.default)

    // Get the module factory
    const factory = await container.get(module)
    if (!factory) {
      throw new Error(`Module '${module}' not found in container '${scope}'`)
    }

    // Execute the factory to get the module
    const Module = factory()

    if (!Module || !Module.default) {
      throw new Error(`Module '${module}' does not export a default component`)
    }

    return Module as LoadedModule
  })()

  // Cache the promise
  moduleCache.set(cacheKey, loadPromise)

  return loadPromise
}

/**
 * Load the remote entry script
 */
async function loadRemoteEntry(remoteUrl: string): Promise<void> {
  const scriptId = `remote-${remoteUrl.replace(/[^a-zA-Z0-9]/g, '_')}`

  // Check if script is already loaded
  if (document.getElementById(scriptId)) {
    return
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.id = scriptId
    script.src = `${remoteUrl}/remoteEntry.js`
    script.type = 'text/javascript'
    script.async = true

    script.onload = () => {
      console.log(`✅ Loaded remote entry: ${remoteUrl}`)
      resolve()
    }

    script.onerror = error => {
      console.error(`❌ Failed to load remote entry: ${remoteUrl}`, error)
      document.head.removeChild(script)
      reject(new Error(`Failed to load remote entry: ${remoteUrl}`))
    }

    document.head.appendChild(script)
  })
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
    // Fetch app metadata from the registry
    const response = await fetch(
      `${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/apps`
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
