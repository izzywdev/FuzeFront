/**
 * Single-use secrets in the address bar (the emailed token on /verify/email and
 * /reset) must never leave the browser in a `Referer` header or telemetry URL.
 * Emails put the token in the FRAGMENT (`#token=`), which browsers never send to
 * the server or in a Referer, so it never reaches nginx access logs either. The
 * legacy query form (`?token=`) is still accepted and scrubbed for old links. Scrubbing a credential is a security property, not a UI feature, so it
 * runs REGARDLESS of the `fuzefront.auth.experience` flag. `captureSingleUseParams()` runs BEFORE any API call or telemetry init
 * (first import in main.tsx): it moves the token into memory and rewrites the URL
 * with `history.replaceState` so every later request already sees a clean URL.
 */
const SECRET_PATHS = new Set(['/verify/email', '/reset'])
const SECRET_PARAMS = ['token']

const memory = new Map<string, string>()

function hashParams(hash: string): URLSearchParams {
  return new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
}

/** Remove `names` from both the query and the fragment; returns the rewritten path. */
function stripped(url: URL, names: string[]): string {
  for (const name of names) url.searchParams.delete(name)
  const h = hashParams(url.hash)
  // Leave an unrelated fragment (e.g. `#section`) byte-for-byte untouched.
  if (!names.some(name => h.has(name))) return url.pathname + url.search + url.hash
  for (const name of names) h.delete(name)
  const hash = h.toString()
  return url.pathname + url.search + (hash ? `#${hash}` : '')
}

export function captureSingleUseParams(): void {
  if (typeof window === 'undefined') return
  if (!SECRET_PATHS.has(window.location.pathname)) return
  const url = new URL(window.location.href)
  const fromHash = hashParams(url.hash)
  let changed = false
  for (const name of SECRET_PARAMS) {
    const value = fromHash.get(name) ?? url.searchParams.get(name)
    if (value !== null) {
      memory.set(name, value)
      changed = true
    }
  }
  if (changed) {
    window.history.replaceState(window.history.state, '', stripped(url, SECRET_PARAMS))
  }
}

/** The captured secret (memory first, then — for in-app navigation — the live URL, which is then stripped). */
export function takeSingleUseParam(name: string): string | undefined {
  const held = memory.get(name)
  if (held !== undefined) return held
  const url = new URL(window.location.href)
  const fromUrl = hashParams(url.hash).get(name) ?? url.searchParams.get(name)
  if (fromUrl === null) return undefined
  memory.set(name, fromUrl)
  window.history.replaceState(window.history.state, '', stripped(url, [name]))
  return fromUrl
}

/** Test seam. */
export function _resetSingleUseParams(): void {
  memory.clear()
}
