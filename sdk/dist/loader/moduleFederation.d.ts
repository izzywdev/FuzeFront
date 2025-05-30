import type { LoadedModule, ModuleFederationConfig } from '../types'
interface RetryOptions {
  maxAttempts: number
  baseDelay: number
  maxDelay: number
}
/**
 * Load a federated module with retry logic
 */
export declare function loadApp(
  config: ModuleFederationConfig,
  retryOptions?: Partial<RetryOptions>
): Promise<LoadedModule>
/**
 * Clear module cache (useful for development)
 */
export declare function clearModuleCache(): void
/**
 * Get cached module if available
 */
export declare function getCachedModule(
  config: ModuleFederationConfig
): Promise<LoadedModule> | null
/**
 * Check if a module is cached
 */
export declare function isModuleCached(config: ModuleFederationConfig): boolean
export {}
//# sourceMappingURL=moduleFederation.d.ts.map
