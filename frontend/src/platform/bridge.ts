// The FuzeFront platform bridge.
//
// The host installs a single, versioned API object on `window.__FUZEFRONT__`.
// Runtime-loaded microfrontends (which share nothing with the host at build
// time) call this object through the SDK to use shared services: live platform
// context, the toaster, and the global menu. Because it's a plain object on
// `window`, it works across the Module Federation boundary regardless of how
// React instances are bundled.

export type ToastLevel = 'info' | 'success' | 'warning' | 'error'

export interface ToastInput {
  message: string
  title?: string
  level?: ToastLevel
  durationMs?: number
  appId?: string
}

export interface Toast {
  id: string
  message: string
  title?: string
  level: ToastLevel
  durationMs: number
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

export interface FuzeFrontBridge {
  /** Contract version — apps can feature-detect. */
  version: number
  getContext(): PlatformSnapshot
  /** Subscribe to live context changes. Returns an unsubscribe fn. */
  subscribe(listener: (ctx: PlatformSnapshot) => void): () => void
  /** Show a toast. Returns the toast id. */
  notify(toast: ToastInput): string
  dismiss(id: string): void
  /** Subscribe to the toast list (used by the host's Toaster). */
  subscribeToasts(listener: (toasts: Toast[]) => void): () => void
  menu: {
    add(appId: string, items: BridgeMenuItem[]): void
    remove(appId: string): void
  }
  socket: BridgeSocket
}

export interface BridgeSocket {
  on(event: string, handler: (payload: any) => void): void
  off(event: string, handler: (payload: any) => void): void
  emit(event: string, payload: any): void
  isConnected(): boolean
}

const CONTRACT_VERSION = 1

function newId(prefix: string): string {
  try {
    return `${prefix}_${crypto.randomUUID()}`
  } catch {
    return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
  }
}

export interface BridgeHandlers {
  onMenuAdd: (appId: string, items: BridgeMenuItem[]) => void
  onMenuRemove: (appId: string) => void
  socket: BridgeSocket
}

class PlatformBridge implements FuzeFrontBridge {
  version = CONTRACT_VERSION
  private ctx: PlatformSnapshot = {
    user: null,
    apps: [],
    activeApp: null,
    isPlatformMode: true,
  }
  private ctxListeners = new Set<(ctx: PlatformSnapshot) => void>()
  private toasts: Toast[] = []
  private toastListeners = new Set<(toasts: Toast[]) => void>()
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private handlers: BridgeHandlers = {
    onMenuAdd: () => {},
    onMenuRemove: () => {},
    socket: {
      on: () => {},
      off: () => {},
      emit: () => {},
      isConnected: () => false,
    },
  }

  setHandlers(handlers: BridgeHandlers) {
    this.handlers = handlers
  }

  /** Host pushes context updates here when its state changes. */
  setContext(ctx: PlatformSnapshot) {
    this.ctx = ctx
    this.ctxListeners.forEach(l => l(ctx))
  }

  getContext() {
    return this.ctx
  }

  subscribe(listener: (ctx: PlatformSnapshot) => void) {
    this.ctxListeners.add(listener)
    listener(this.ctx)
    return () => this.ctxListeners.delete(listener)
  }

  notify(input: ToastInput): string {
    const toast: Toast = {
      id: newId('toast'),
      message: input.message,
      title: input.title,
      level: input.level || 'info',
      durationMs: input.durationMs ?? 5000,
      appId: input.appId,
      createdAt: Date.now(),
    }
    this.toasts = [...this.toasts, toast]
    this.emitToasts()
    if (toast.durationMs > 0) {
      this.timers.set(
        toast.id,
        setTimeout(() => this.dismiss(toast.id), toast.durationMs)
      )
    }
    return toast.id
  }

  dismiss(id: string) {
    const timer = this.timers.get(id)
    if (timer) {
      clearTimeout(timer)
      this.timers.delete(id)
    }
    this.toasts = this.toasts.filter(t => t.id !== id)
    this.emitToasts()
  }

  subscribeToasts(listener: (toasts: Toast[]) => void) {
    this.toastListeners.add(listener)
    listener(this.toasts)
    return () => this.toastListeners.delete(listener)
  }

  private emitToasts() {
    this.toastListeners.forEach(l => l(this.toasts))
  }

  menu = {
    add: (appId: string, items: BridgeMenuItem[]) =>
      this.handlers.onMenuAdd(appId, items),
    remove: (appId: string) => this.handlers.onMenuRemove(appId),
  }

  socket: BridgeSocket = {
    on: (event, handler) => this.handlers.socket.on(event, handler),
    off: (event, handler) => this.handlers.socket.off(event, handler),
    emit: (event, payload) => this.handlers.socket.emit(event, payload),
    isConnected: () => this.handlers.socket.isConnected(),
  }
}

// Module singleton — created once per host page load.
export const bridge = new PlatformBridge()

declare global {
  interface Window {
    __FUZEFRONT__?: FuzeFrontBridge
    __FRONTFUSE_PLATFORM__?: boolean
  }
}

/** Install the bridge on window so federated remotes can find it. */
export function installBridge(handlers: BridgeHandlers): PlatformBridge {
  bridge.setHandlers(handlers)
  if (typeof window !== 'undefined') {
    window.__FUZEFRONT__ = bridge
    window.__FRONTFUSE_PLATFORM__ = true
  }
  return bridge
}
