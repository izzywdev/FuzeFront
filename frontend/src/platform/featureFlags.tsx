/**
 * Host-shell feature flags.
 *
 * Flags are fetched ONCE per session from the backend (`GET /api/flags`), which
 * evaluates them server-side through @fuzefront/feature-flags (OpenFeature +
 * Unleash) against the AUTHENTICATED user. The browser deliberately does not
 * talk to Unleash directly:
 *
 *   - Unleash's frontend API takes its evaluation context from client-supplied
 *     query params, so any user could pass the platform owner's userId and
 *     enrol themselves into the `developers` segment. Server-side evaluation
 *     makes the cohort tamper-proof.
 *   - No Unleash token ever reaches the browser, and no new public host or
 *     Cloudflare Access carve-out is needed — /api/* is already same-origin.
 *
 * This replaces the previous `import.meta.env.VITE_FF_*` build-time constants,
 * which were baked at build time and therefore IDENTICAL for every user — no
 * per-user rollout or developer targeting was possible at all.
 *
 * Fail-safe: any error, non-200, or missing key yields the caller's default
 * (OFF for release flags), matching the in-code fallback contract.
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { getActiveAuthToken } from '../lib/accounts'

type FlagMap = Record<string, boolean>

interface FlagState {
  flags: FlagMap
  /** False until the first fetch settles; callers render the OFF path meanwhile. */
  loaded: boolean
}

const FeatureFlagContext = createContext<FlagState>({ flags: {}, loaded: false })

/** Same-origin API base — never an absolute host (works under local TLS and prod ingress). */
const FLAGS_ENDPOINT = '/api/flags'

export async function fetchFlags(signal?: AbortSignal): Promise<FlagMap> {
  const token = getActiveAuthToken()
  if (!token) return {}
  try {
    const res = await fetch(FLAGS_ENDPOINT, {
      signal,
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return {}
    const body = await res.json()
    const flags = body?.flags
    if (!flags || typeof flags !== 'object') return {}
    const out: FlagMap = {}
    for (const [key, value] of Object.entries(flags)) {
      out[key] = value === true
    }
    return out
  } catch {
    // Network failure / abort -> defaults. Never breaks the shell.
    return {}
  }
}

export function FeatureFlagProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<FlagState>({ flags: {}, loaded: false })

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    fetchFlags(controller.signal).then(flags => {
      if (active) setState({ flags, loaded: true })
    })
    return () => {
      active = false
      controller.abort()
    }
  }, [])

  const value = useMemo(() => state, [state])
  return (
    <FeatureFlagContext.Provider value={value}>
      {children}
    </FeatureFlagContext.Provider>
  )
}

/**
 * Read a boolean flag. `defaultValue` is the fail-safe used before the fetch
 * settles and whenever the flag is unknown/unreachable — pass OFF for release
 * flags, ON for kill-switches, matching the in-code default contract.
 */
export function useFlag(key: string, defaultValue = false): boolean {
  const { flags, loaded } = useContext(FeatureFlagContext)
  if (!loaded) return defaultValue
  return key in flags ? flags[key] : defaultValue
}

/**
 * Whether the one-shot `GET /api/flags` has settled.
 *
 * `useFlag()` returns its fail-safe default until then. That is correct for
 * RENDERING — a flagged nav item simply stays hidden a moment longer — but
 * wrong for a ROUTE GATE: the router mounts the route tree before the fetch
 * resolves, so a gate that redirects on the default throws away every deep
 * link, bookmark, refresh and email link into a flagged route before the flag
 * can say ON. Route gates read this and hold (render a pending state) instead
 * of redirecting on a default they do not yet know to be the answer.
 *
 * This always settles: with no auth token `fetchFlags()` short-circuits, and
 * every network/parse failure is caught, so `loaded` flips true either way —
 * a gate waiting on it can never hang.
 */
export function useFlagsLoaded(): boolean {
  return useContext(FeatureFlagContext).loaded
}
