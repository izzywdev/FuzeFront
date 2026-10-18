import { isAuthExperienceEnabled } from '@fuzefront/auth-ui'

/**
 * Single-use secrets in the address bar (the emailed `?token=` on /verify/email
 * and /reset) must never leave the browser in a `Referer` header or telemetry
 * URL. `captureSingleUseParams()` runs BEFORE any API call or telemetry init
 * (first import in main.tsx): it moves the token into memory and rewrites the URL
 * with `history.replaceState` so every later request already sees a clean URL.
 */
const SECRET_PATHS = new Set(['/verify/email', '/reset'])
const SECRET_PARAMS = ['token']

const memory = new Map<string, string>()

export function captureSingleUseParams(): void {
  if (typeof window === 'undefined' || !isAuthExperienceEnabled()) return
  if (!SECRET_PATHS.has(window.location.pathname)) return
  const url = new URL(window.location.href)
  let changed = false
  for (const name of SECRET_PARAMS) {
    const value = url.searchParams.get(name)
    if (value !== null) {
      memory.set(name, value)
      url.searchParams.delete(name)
      changed = true
    }
  }
  if (changed) {
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
  }
}

/** The captured secret (memory first, then — for in-app navigation — the live URL, which is then stripped). */
export function takeSingleUseParam(name: string): string | undefined {
  const held = memory.get(name)
  if (held !== undefined) return held
  const fromUrl = new URLSearchParams(window.location.search).get(name)
  if (fromUrl === null) return undefined
  memory.set(name, fromUrl)
  const url = new URL(window.location.href)
  url.searchParams.delete(name)
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
  return fromUrl
}

/** Test seam. */
export function _resetSingleUseParams(): void {
  memory.clear()
}
