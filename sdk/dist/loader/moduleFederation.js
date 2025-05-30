const DEFAULT_RETRY_OPTIONS = {
  maxAttempts: 3,
  baseDelay: 1000,
  maxDelay: 8000,
}
// Cache for loaded modules to avoid re-loading
const moduleCache = new Map()
/**
 * Sleep utility for retry delays
 */
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
/**
 * Calculate exponential backoff delay
 */
const getRetryDelay = (attempt, baseDelay, maxDelay) => {
  const delay = baseDelay * Math.pow(2, attempt - 1)
  return Math.min(delay + Math.random() * 1000, maxDelay) // Add jitter
}
/**
 * Load the remote entry script
 */
async function loadRemoteEntry(remoteUrl) {
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
 * Load a remote module using Webpack Module Federation
 */
async function loadRemoteModule(config) {
  const { remoteUrl, scope, module } = config
  const cacheKey = `${remoteUrl}:${scope}:${module}`
  // Return cached module if available
  if (moduleCache.has(cacheKey)) {
    return moduleCache.get(cacheKey)
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
    return Module
  })()
  // Cache the promise
  moduleCache.set(cacheKey, loadPromise)
  return loadPromise
}
/**
 * Load a federated module with retry logic
 */
export async function loadApp(config, retryOptions = {}) {
  const options = { ...DEFAULT_RETRY_OPTIONS, ...retryOptions }
  let lastError = null
  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      console.log(
        `📦 Loading federated module '${config.scope}/${config.module}' (attempt ${attempt}/${options.maxAttempts})`
      )
      const module = await loadRemoteModule(config)
      console.log(
        `✅ Successfully loaded federated module '${config.scope}/${config.module}'`
      )
      return module
    } catch (error) {
      lastError = error
      console.error(
        `❌ Failed to load federated module '${config.scope}/${config.module}' (attempt ${attempt}):`,
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
    `Failed to load federated module '${config.scope}/${config.module}' after ${options.maxAttempts} attempts. Last error: ${lastError === null || lastError === void 0 ? void 0 : lastError.message}`
  )
}
/**
 * Clear module cache (useful for development)
 */
export function clearModuleCache() {
  moduleCache.clear()
  console.log('🗑️ Module cache cleared')
}
/**
 * Get cached module if available
 */
export function getCachedModule(config) {
  const cacheKey = `${config.remoteUrl}:${config.scope}:${config.module}`
  return moduleCache.get(cacheKey) || null
}
/**
 * Check if a module is cached
 */
export function isModuleCached(config) {
  const cacheKey = `${config.remoteUrl}:${config.scope}:${config.module}`
  return moduleCache.has(cacheKey)
}
