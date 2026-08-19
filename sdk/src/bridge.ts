// The FuzeFront platform bridge contract.
//
// The host installs a single, versioned API object on `window.__FUZEFRONT__`.
// This is the one thing a runtime-loaded microfrontend needs to know about the
// host — it shares nothing else at build time. The hooks in this SDK are thin,
// typed wrappers over this object.

export type ToastLevel = 'info' | 'success' | 'warning' | 'error'

export interface ToastInput {
  message: string
  title?: string
  level?: ToastLevel
  durationMs?: number
  appId?: string
}

export interface Toast extends Required<Omit<ToastInput, 'title' | 'appId'>> {
  id: string
  title?: string
  appId?: string
  createdAt: number
}

export interface PlatformSnapshot {
  user: { id: string; email: string; roles: string[] } | null
  apps: Array<{ id: string; name: string }>
  activeApp: { id: string; name: string } | null
  isPlatformMode: boolean
}

export interface BridgeMenuItem {
  id: string
  label: string
  icon?: string
  route?: string
  order?: number
}

export interface BridgeSocket {
  on(event: string, handler: (payload: any) => void): void
  off(event: string, handler: (payload: any) => void): void
  emit(event: string, payload: any): void
  isConnected(): boolean
}

export interface FuzeFrontBridge {
  version: number
  getContext(): PlatformSnapshot
  subscribe(listener: (ctx: PlatformSnapshot) => void): () => void
  notify(toast: ToastInput): string
  dismiss(id: string): void
  menu: {
    add(appId: string, items: BridgeMenuItem[]): void
    remove(appId: string): void
  }
  socket: BridgeSocket
}

declare global {
  interface Window {
    __FUZEFRONT__?: FuzeFrontBridge
    __FRONTFUSE_PLATFORM__?: boolean
  }
}

/** Returns the host-provided bridge, or null when running standalone. */
export function getBridge(): FuzeFrontBridge | null {
  if (typeof window === 'undefined') return null
  return window.__FUZEFRONT__ ?? null
}

export function isInPlatform(): boolean {
  return getBridge() != null
}
