// Types
export * from './types'

// Context Provider
export {
  PlatformProvider,
  usePlatformContext,
} from './context/PlatformProvider'

// Heartbeat
export { createHeartbeat, AppHeartbeat } from './heartbeat'
export type { HeartbeatConfig, HeartbeatResponse } from './heartbeat'

// Hooks
export { useCurrentUser } from './hooks/useCurrentUser'
export { useSession } from './hooks/useSession'
export { useGlobalMenu } from './hooks/useGlobalMenu'
export { useSocketBus } from './hooks/useSocketBus'

// Module Federation Loader
export {
  loadApp,
  clearModuleCache,
  getCachedModule,
  isModuleCached,
} from './loader/moduleFederation'

// Re-import for default export
import { PlatformProvider } from './context/PlatformProvider'
import { useCurrentUser } from './hooks/useCurrentUser'
import { useSession } from './hooks/useSession'
import { useGlobalMenu } from './hooks/useGlobalMenu'
import { useSocketBus } from './hooks/useSocketBus'
import { loadApp, clearModuleCache } from './loader/moduleFederation'

// Default export for convenience
export default {
  PlatformProvider,
  useCurrentUser,
  useSession,
  useGlobalMenu,
  useSocketBus,
  loadApp,
  clearModuleCache,
}
