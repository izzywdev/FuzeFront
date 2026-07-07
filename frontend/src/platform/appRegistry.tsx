import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import {
  AppRegistryClient,
  type App,
  type RegisterAppRequest,
} from '@fuzefront/app-registry-client'

/**
 * Centralized binding of the frozen `@fuzefront/app-registry-client` to a
 * SAME-ORIGIN base URL. The host, the registration UI, and the federated
 * loader all read the registry through this provider, so the contract is the
 * single source of truth and there is no second hand-rolled `App` shape.
 *
 * The base URL is intentionally a same-origin relative path: the in-pod /
 * ingress nginx proxies `/api/` to the backend, so this works identically
 * under local TLS and prod ingress and never hard-codes an absolute API host.
 */
const _apiBase =
  (typeof import.meta !== 'undefined' ? (import.meta as any).env?.VITE_API_URL : '') ||
  (typeof window !== 'undefined' ? window.location.origin : '')
export const APP_REGISTRY_BASE_URL = _apiBase + '/api/v1/app-registry'

interface AppRegistryContextValue {
  /** The bound, same-origin app-registry client. */
  client: AppRegistryClient
  /** Activated apps visible in the menu/launcher (manifest-driven). */
  apps: App[]
  loading: boolean
  error: string | null
  /** Re-fetch the activated apps (e.g. after register→activate). */
  refresh: () => Promise<void>
  /** Register an app from its manifest then activate it; returns the activated App. */
  registerAndActivate: (body: RegisterAppRequest) => Promise<App>
  /** Look up a known app by slug from the loaded list. */
  getBySlug: (slug: string) => App | undefined
}

const AppRegistryContext = createContext<AppRegistryContextValue | undefined>(
  undefined,
)

function readAuthToken(): string | undefined {
  try {
    return localStorage.getItem('authToken') ?? undefined
  } catch {
    return undefined
  }
}

export function AppRegistryProvider({ children }: { children: React.ReactNode }) {
  // The token can change after login; rebuild the client when it does so the
  // Authorization header stays current. We read it lazily on mount + on focus.
  const [token, setToken] = useState<string | undefined>(() => readAuthToken())

  useEffect(() => {
    const sync = () => setToken(readAuthToken())
    window.addEventListener('focus', sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener('focus', sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const client = useMemo(
    () => new AppRegistryClient({ baseUrl: APP_REGISTRY_BASE_URL, token }),
    [token],
  )

  const [apps, setApps] = useState<App[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // The application menu shows only registered AND activated apps.
      const result = await client.listApps({ status: 'activated' })
      setApps(result.apps ?? [])
    } catch (err) {
      console.error('Failed to load registered apps:', err)
      setError(err instanceof Error ? err.message : 'Failed to load apps')
    } finally {
      setLoading(false)
    }
  }, [client])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const registerAndActivate = useCallback(
    async (body: RegisterAppRequest): Promise<App> => {
      // register (status = registered) → activate (status = activated → visible).
      const registered = await client.registerApp(body)
      const activated = await client.activateApp(registered.slug)
      await refresh()
      return activated
    },
    [client, refresh],
  )

  const getBySlug = useCallback(
    (slug: string) => apps.find(a => a.slug === slug),
    [apps],
  )

  const value = useMemo<AppRegistryContextValue>(
    () => ({ client, apps, loading, error, refresh, registerAndActivate, getBySlug }),
    [client, apps, loading, error, refresh, registerAndActivate, getBySlug],
  )

  return (
    <AppRegistryContext.Provider value={value}>
      {children}
    </AppRegistryContext.Provider>
  )
}

export function useAppRegistry(): AppRegistryContextValue {
  const ctx = useContext(AppRegistryContext)
  if (ctx === undefined) {
    throw new Error('useAppRegistry must be used within an AppRegistryProvider')
  }
  return ctx
}

/** Convenience: just the activated apps list + loading/refresh. */
export function useRegisteredApps() {
  const { apps, loading, error, refresh } = useAppRegistry()
  return { apps, loading, error, refresh }
}
