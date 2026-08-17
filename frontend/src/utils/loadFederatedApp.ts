import { App as LegacyApp } from '../lib/shared'
import type { App } from '@fuzefront/app-registry-client'
// Dynamic remote-loading helpers from @originjs/vite-plugin-federation (the
// federation runtime this host actually builds with). The previous
// webpack-style __webpack_init_sharing__ approach never worked with Vite remotes.
import {
  __federation_method_setRemote,
  __federation_method_getRemote,
  __federation_method_unwrapDefault,
} from 'virtual:__federation__'
import { getActiveAuthToken } from '../lib/accounts'

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
 * Resolve a contract `remoteEntry` to the absolute URL the federation runtime
 * registers.
 *
 * The frozen contract accepts two shapes (see openapi.yaml `Integration`):
 * an absolute `http(s)` URL for remotes hosted outside the cluster, and a
 * same-origin absolute path (`/apps/<slug>/assets/remoteEntry.js`) for apps the
 * host ingress proxies to an in-cluster Service. Resolving the path here
 * against the page origin keeps the module cache key stable and means the SAME
 * manifest works on the prod host, a tenant wildcard host, and localhost.
 *
 * Defence in depth: anything not written as an explicit `http(s)://` URL is
 * REQUIRED to resolve back to this page's origin. `URL` silently resolves both
 * `//host/x.js` and `/\/host/x.js` (the WHATWG parser folds a backslash into a
 * slash) to a cross-origin host — a manifest that reads as a harmless path
 * would then execute an attacker's module inside the host shell's origin. The
 * manifest schema rejects those shapes on write, but rows registered before
 * that validation existed are still in the database, so the browser re-checks
 * rather than trusting the stored value.
 */
export function resolveRemoteEntry(remoteEntry: string): string {
  const origin = window.location.origin
  const resolved = new URL(remoteEntry, origin)
  const isExplicitlyAbsolute = /^https?:\/\//i.test(remoteEntry)

  if (!isExplicitlyAbsolute && resolved.origin !== origin) {
    throw new Error(
      `Refusing to load remote entry '${remoteEntry}': a same-origin path must ` +
        `not resolve off-origin (got ${resolved.origin}).`
    )
  }

  if (!/^https?:$/.test(resolved.protocol)) {
    throw new Error(
      `Refusing to load remote entry '${remoteEntry}': unsupported scheme ` +
        `'${resolved.protocol}'.`
    )
  }

  return resolved.toString()
}

/**
 * Load a remote module at runtime via @originjs/vite-plugin-federation:
 * register the remote dynamically, fetch the exposed module, unwrap its default.
 *
 * `remoteEntry` is the FULL entry (URL or same-origin path) — the frozen
 * contract resolved the legacy base-vs-entry ambiguity in favor of the complete
 * entry, so we register it as-is once resolved to an absolute URL.
 */
async function loadRemoteModule(
  remoteEntryInput: string,
  scope: string,
  module: string
): Promise<LoadedModule> {
  const remoteEntry = resolveRemoteEntry(remoteEntryInput)
  const cacheKey = `${remoteEntry}:${scope}:${module}`

  // Return cached module if available
  if (moduleCache.has(cacheKey)) {
    return moduleCache.get(cacheKey)!
  }

  const loadPromise = (async () => {
    // Register the remote at runtime. remoteEntry is the complete entry URL.
    __federation_method_setRemote(scope, {
      url: remoteEntry,
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

  // Cache the promise; remove on rejection so retries can make a fresh attempt
  moduleCache.set(cacheKey, loadPromise)
  loadPromise.catch(() => moduleCache.delete(cacheKey))

  return loadPromise
}

/**
 * Load a federated app described by a FROZEN-contract manifest `App`. This is
 * the path the host uses now (the registry client returns this shape); it reads
 * `integration.remoteEntry` (full URL), `scope`, and `module` directly.
 */
export async function loadFederatedAppFromManifest(
  app: App,
  retryOptions: Partial<RetryOptions> = {}
): Promise<LoadedModule> {
  const options = { ...DEFAULT_RETRY_OPTIONS, ...retryOptions }
  const { integration } = app.manifest

  if (integration.type !== 'module-federation') {
    throw new Error(
      `App '${app.manifest.name}' is not configured for Module Federation`
    )
  }
  if (!integration.remoteEntry || !integration.scope || !integration.module) {
    throw new Error(
      `App '${app.manifest.name}' is missing required Module Federation configuration ` +
        `(remoteEntry/scope/module)`
    )
  }

  let lastError: Error | null = null
  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      console.log(
        `📦 Loading federated app '${app.manifest.name}' (attempt ${attempt}/${options.maxAttempts})`
      )
      const module = await loadRemoteModule(
        integration.remoteEntry,
        integration.scope,
        integration.module
      )
      console.log(`✅ Successfully loaded federated app '${app.manifest.name}'`)
      return module
    } catch (error) {
      lastError = error as Error
      console.error(
        `❌ Failed to load federated app '${app.manifest.name}' (attempt ${attempt}):`,
        error
      )
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
    `Failed to load federated app '${app.manifest.name}' after ${options.maxAttempts} attempts. Last error: ${lastError?.message}`
  )
}

/**
 * Load a federated app with retry logic
 */
export async function loadFederatedApp(
  app: LegacyApp,
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

      // Legacy shape stores the BASE url; the entry lives under it.
      const module = await loadRemoteModule(
        `${app.remoteUrl.replace(/\/$/, '')}/remoteEntry.js`,
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
    const token = getActiveAuthToken()
    const response = await fetch(
      `${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/apps`,
      token ? { headers: { Authorization: `Bearer ${token}` } } : undefined
    )
    if (!response.ok) {
      throw new Error(`Failed to fetch apps: ${response.statusText}`)
    }

    const apps: LegacyApp[] = await response.json()
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


