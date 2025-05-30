export * from './types'
export {
  PlatformProvider,
  usePlatformContext,
} from './context/PlatformProvider'
export { createHeartbeat, AppHeartbeat } from './heartbeat'
export type { HeartbeatConfig, HeartbeatResponse } from './heartbeat'
export { useCurrentUser } from './hooks/useCurrentUser'
export { useSession } from './hooks/useSession'
export { useGlobalMenu } from './hooks/useGlobalMenu'
export { useSocketBus } from './hooks/useSocketBus'
export {
  loadApp,
  clearModuleCache,
  getCachedModule,
  isModuleCached,
} from './loader/moduleFederation'
import { PlatformProvider } from './context/PlatformProvider'
import { useCurrentUser } from './hooks/useCurrentUser'
import { useSession } from './hooks/useSession'
import { useGlobalMenu } from './hooks/useGlobalMenu'
import { useSocketBus } from './hooks/useSocketBus'
import { loadApp, clearModuleCache } from './loader/moduleFederation'
declare const _default: {
  PlatformProvider: typeof PlatformProvider
  useCurrentUser: typeof useCurrentUser
  useSession: typeof useSession
  useGlobalMenu: typeof useGlobalMenu
  useSocketBus: typeof useSocketBus
  loadApp: typeof loadApp
  clearModuleCache: typeof clearModuleCache
}
export default _default
//# sourceMappingURL=index.d.ts.map
