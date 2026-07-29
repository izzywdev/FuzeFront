import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortalClient, type PortalContextSource } from '../api/portalClient'
import { normalizePortalContext } from '../normalize'
import type { NormalizedPortalContext, PortalBootStatus } from '../types'

export interface PortalBootState {
  status: PortalBootStatus
  context: NormalizedPortalContext | null
  /** Re-issue the boot request (the error/suspended states' [data-action="retry"]). */
  retry: () => void
}

const DEFAULT_STATE: PortalBootState = {
  status: 'disabled',
  context: null,
  retry: () => {},
}

const PortalBrandingContext = createContext<PortalBootState>(DEFAULT_STATE)

export interface PortalBrandingProviderProps {
  /** Whether portal-context boot is active (the feature-flag gate lives at the
   * call site — Layout.tsx for the authenticated shell, unconditionally true
   * for the pre-auth PortalShell/PortalLoginFlow routes, which only ever
   * mount once the caller has already checked the flag). `false` keeps status
   * 'disabled' and issues NO request — consumers fall back to their existing
   * default rendering untouched. */
  enabled: boolean
  children: React.ReactNode
  /** Injectable source (tests). Defaults to a same-origin `PortalClient`. */
  client?: PortalContextSource
}

/**
 * Owns the `GET /api/v1/portal/context` boot request and its fail-closed
 * branches:
 *   200 -> normalize -> 'ready'
 *   403 -> 'suspended' (PORTAL_SUSPENDED — "This portal is unavailable")
 *   404 -> normalize the (possibly empty) error body -> 'ready' — unknown
 *          host falls back to the root portal, rendered through the SAME
 *          shell (FF-EPIC-10-S1 AC3), never a distinct "leaked" state
 *   other -> 'error' (offer retry, never a silent unbranded fallback)
 */
export function PortalBrandingProvider({ enabled, children, client }: PortalBrandingProviderProps) {
  const [status, setStatus] = useState<PortalBootStatus>(enabled ? 'loading' : 'disabled')
  const [context, setContext] = useState<NormalizedPortalContext | null>(null)
  const [nonce, setNonce] = useState(0)
  const clientRef = useRef<PortalContextSource>(client ?? createPortalClient())

  useEffect(() => {
    if (!enabled) {
      setStatus('disabled')
      setContext(null)
      return
    }
    let cancelled = false
    setStatus('loading')

    clientRef.current
      .getPortalContext()
      .then(raw => {
        if (cancelled) return
        setContext(normalizePortalContext(raw))
        setStatus('ready')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const httpStatus = (err as { response?: { status?: number; data?: unknown } })?.response
          ?.status
        if (httpStatus === 403) {
          setContext(null)
          setStatus('suspended')
          return
        }
        if (httpStatus === 404) {
          const body = (err as { response?: { data?: unknown } })?.response?.data
          setContext(normalizePortalContext(body))
          setStatus('ready')
          return
        }
        setContext(null)
        setStatus('error')
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, nonce])

  const retry = useCallback(() => setNonce(n => n + 1), [])
  const value = useMemo<PortalBootState>(
    () => ({ status, context, retry }),
    [status, context, retry]
  )

  return <PortalBrandingContext.Provider value={value}>{children}</PortalBrandingContext.Provider>
}

/** Read the current portal-boot status/context. Outside a provider, behaves
 * as if the flag were off ('disabled', no context) — a safe default. */
export function usePortalContext(): PortalBootState {
  return useContext(PortalBrandingContext)
}
