// FuzeFront SDK - Main Export File
// Auto-publishing test: version will be bumped automatically

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

// Platform bridge — the window.__FUZEFRONT__ contract + bridge-native hooks.
export { getBridge, isInPlatform } from './bridge'
export type {
  FuzeFrontBridge,
  BridgeSocket,
  BridgeMenuItem,
  Toast,
  ToastInput,
  ToastLevel,
  PlatformSnapshot,
} from './bridge'
export { useToast } from './hooks/useToast'
export { usePlatform } from './hooks/usePlatform'

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
import { getBridge } from './bridge'
import { useToast } from './hooks/useToast'
import { usePlatform } from './hooks/usePlatform'

// Default export for convenience
export default {
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
}
