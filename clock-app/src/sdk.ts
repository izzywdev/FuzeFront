// Minimal FuzeFront SDK surface for an on-the-fly remote.
//
// The only things this app knows about the host are the agreed contracts:
//   1. window.__FUZEFRONT__ — the platform bridge: live context + shared
//      services (toaster, menu). Installed by the host.
//   2. POST /api/apps/register — the registration endpoint.
// No host code is imported at build time.

export type ToastLevel = 'info' | 'success' | 'warning' | 'error'

export interface ToastInput {
  message: string
  title?: string
  level?: ToastLevel
  durationMs?: number
  appId?: string
}

export interface PlatformSnapshot {
  user: { id: string; email: string; roles: string[] } | null
  apps: Array<{ id: string; name: string }>
  activeApp: { id: string; name: string } | null
  isPlatformMode: boolean
}

interface FuzeFrontBridge {
  version: number
  getContext(): PlatformSnapshot
  subscribe(listener: (ctx: PlatformSnapshot) => void): () => void
  notify(toast: ToastInput): string
  dismiss(id: string): void
  menu: {
    add(appId: string, items: any[]): void
    remove(appId: string): void
  }
}

export function getBridge(): FuzeFrontBridge | null {
  if (typeof window === 'undefined') return null
  return (window as any).__FUZEFRONT__ ?? null
}

const STANDALONE: PlatformSnapshot = {
  user: null,
  apps: [],
  activeApp: null,
  isPlatformMode: false,
}

export function getPlatformContext(): PlatformSnapshot {
  return getBridge()?.getContext() ?? STANDALONE
}

/** Subscribe to live host context. Returns an unsubscribe fn. */
export function subscribeContext(
  listener: (ctx: PlatformSnapshot) => void
): () => void {
  const b = getBridge()
  if (b) return b.subscribe(listener)
  listener(STANDALONE)
  return () => {}
}

/** Show a toast through the host's shared toaster. */
export function notify(toast: ToastInput): void {
  const b = getBridge()
  if (b) b.notify(toast)
  else console.log('[FuzeClock] notify (no host bridge):', toast)
}

export interface RegisterConfig {
  hubApiUrl: string
  name: string
  url: string
  remoteUrl: string
  scope: string
  module: string
  iconUrl?: string
  description?: string
}

export async function registerWithHub(
  cfg: RegisterConfig
): Promise<string | null> {
  try {
    const res = await fetch(`${cfg.hubApiUrl}/api/apps/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: cfg.name,
        url: cfg.url,
        iconUrl: cfg.iconUrl,
        integrationType: 'module-federation',
        remoteUrl: cfg.remoteUrl,
        scope: cfg.scope,
        module: cfg.module,
        description: cfg.description,
      }),
    })
    if (!res.ok) {
      console.error('FuzeClock: register failed', await res.text())
      return null
    }
    const app = await res.json()
    console.log('FuzeClock: registered with hub, app id =', app.id)
    return app.id ?? null
  } catch (e) {
    console.error('FuzeClock: register error', e)
    return null
  }
}
